import {
  ControlFlowGraph, StatementIndexEntry, BlockRef, Transition,
  isGoSubCall, isGoSubReturn, isAnyGoSubReturn,
  goSubCallToInlined,
} from "../data";
import { buildEdgesBySource } from "./clone-subgraph";
import { getOrSet, reachableFrom, walkGraph } from "../graph-utils";
import { FlattenedSubroutine } from "./flatten-gosubs";

export interface InlineResult {
  blockRefs: BlockRef[];
  edges: Transition[];
  entryBlockId: string;
  sceneOrder: string[];
  statementIndex: Record<string, StatementIndexEntry>;
  gosubsInlined: number;
  errors: InlineError[];
}

export type InlineError =
  | { kind: "unreachable-block"; blockId: string }
  | { kind: "inlined-original"; blockId: string }
  | { kind: "unresolved-gosub"; callerBlockId: string; targetBlockId: string | null; label?: string };

interface SubroutineBody {
  blockIds: Set<string>;
  edges: Transition[];
  returnBlockIds: string[];
}

/**
 * Inlines gosub calls bottom-up: finds leaf subroutines (those with no further
 * gosub calls in their body), inlines them at all call sites, then repeats on
 * the callers until no gosub calls remain. GoSubScene is treated identically to
 * GoSub — no special casing.
 *
 * Loop unrolling is intentionally deferred until after all inlining is complete,
 * so it runs on the fully-flattened graph.
 */
export const inlineGosubs = (cfg: ControlFlowGraph): InlineResult => {
  const refMap = new Map<string, BlockRef>();
  for (const [id, block] of Object.entries(cfg.blocks)) {
    refMap.set(id, { id, sourceBlockId: block.sourceBlockId, exitType: block.exitType });
  }

  const edges: Transition[] = cfg.edges.map(e => ({ ...e, metadata: { ...e.metadata } }));

  let gosubsInlined = 0;
  let callSiteCounter = 0;
  const errors: InlineError[] = [];

  const MAX_PASSES = 100;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { inlined, newCallSites } = inlineLeafPass(refMap, edges, callSiteCounter);
    callSiteCounter += newCallSites;
    gosubsInlined += inlined;
    if (inlined === 0) break;
  }

  const { refs, edges: prunedEdges } = pruneUnreachable(cfg.entryBlockId, refMap, edges, errors);

  // Only report gosub calls that survived pruning — callers that are in dead code
  // (original subroutine bodies) are silently pruned and do not count as errors.
  for (const e of prunedEdges) {
    if (isGoSubCall(e.kind)) {
      errors.push({
        kind: "unresolved-gosub",
        callerBlockId: e.sourceBlockId,
        targetBlockId: e.targetBlockId,
        label: e.metadata.label as string | undefined,
      });
    }
  }

  return {
    blockRefs: refs,
    edges: prunedEdges,
    entryBlockId: cfg.entryBlockId,
    sceneOrder: cfg.sceneOrder,
    statementIndex: cfg.statementIndex,
    gosubsInlined,
    errors,
  };
};

const inlineLeafPass = (
  refMap: Map<string, BlockRef>,
  edges: Transition[],
  callSiteCounterStart: number,
): { inlined: number; newCallSites: number } => {
  const edgesBySource = buildEdgesBySource(edges);

  // Group non-inlined gosub call edges by their target entry block.
  const callsByTarget = new Map<string, Transition[]>();
  for (const e of edges) {
    if (isGoSubCall(e.kind) && e.targetBlockId) {
      getOrSet(callsByTarget, e.targetBlockId, () => []).push(e);
    }
  }

  // Identify all leaf subroutines up front (snapshot before any mutations).
  // A subroutine is a leaf if its body contains no un-inlined GoSubCall edges to
  // other subroutines. Self-referential calls (GoSubCall back to entryId) are
  // treated as while-loop back edges, not external dependencies.
  const leaves = new Map<string, SubroutineBody>();
  for (const [entryId] of callsByTarget) {
    if (!refMap.has(entryId)) continue;
    const body = findSubroutineBody(entryId, refMap, edgesBySource);
    if (isLeafBody(body, entryId)) {
      leaves.set(entryId, body);
    }
  }

  let inlined = 0;
  let newCallSites = 0;
  const removedEdges = new Set<string>();

  for (const [entryId, body] of leaves) {
    const callEdges = callsByTarget.get(entryId) ?? [];
    const returnBlockSet = new Set(body.returnBlockIds);

    for (const callEdge of callEdges) {
      // Find the paired GoSubReturn edge from the same caller block — its target
      // is the continuation to wire each return block to.
      const callerEdges = edgesBySource.get(callEdge.sourceBlockId) ?? [];
      let returnEdge: Transition | undefined;
      for (const e of callerEdges) {
        if (isGoSubReturn(e.kind) && e.targetBlockId) {
          returnEdge = e;
          break;
        }
      }
      if (!returnEdge) continue;

      const continuation = returnEdge.targetBlockId!;
      const callNumber = callSiteCounterStart + newCallSites++;
      const suffix = `call_${callNumber}`;

      // Build a rename map: original block ID → cloned block ID.
      const blockIdMap = new Map<string, string>();
      for (const blockId of body.blockIds) {
        blockIdMap.set(blockId, `${blockId}.${suffix}`);
      }

      // Register the cloned block refs.
      for (const [origId, clonedId] of blockIdMap) {
        const ref = refMap.get(origId)!;
        refMap.set(clonedId, {
          id: clonedId,
          sourceBlockId: ref.sourceBlockId ?? origId,
          clonedFrom: { parentId: origId, purpose: "inline", call: callNumber, parent: ref.clonedFrom },
          exitType: ref.exitType,
        });
      }

      // Self-referential blocks: GoSubCall(entryId) becomes an InlinedGoSubCall
      // back edge to the cloned entry; the paired GoSubReturn is dropped.
      const selfRefCallers = new Set<string>();
      for (const e of body.edges) {
        if (isGoSubCall(e.kind) && e.targetBlockId === entryId) {
          selfRefCallers.add(e.sourceBlockId);
        }
      }

      // Clone body edges, skipping Return edges from return blocks (rewired below).
      for (const e of body.edges) {
        if (e.kind === "Return" && returnBlockSet.has(e.sourceBlockId)) continue;
        if (isGoSubReturn(e.kind) && selfRefCallers.has(e.sourceBlockId)) continue;
        const kind = (isGoSubCall(e.kind) && e.targetBlockId === entryId)
          ? goSubCallToInlined(e.kind)
          : e.kind;
        edges.push({
          id: `${e.id}.${suffix}`,
          kind,
          sourceBlockId: blockIdMap.get(e.sourceBlockId) ?? e.sourceBlockId,
          targetBlockId: e.targetBlockId
            ? (blockIdMap.get(e.targetBlockId) ?? e.targetBlockId)
            : null,
          metadata: { ...e.metadata },
        });
      }

      // Wire each return block in the clone to this call site's continuation.
      for (const retId of body.returnBlockIds) {
        const clonedRetId = blockIdMap.get(retId)!;
        const ref = refMap.get(clonedRetId);
        if (ref) ref.exitType = "InlinedReturn";
        edges.push({
          id: `${clonedRetId}.ret`,
          kind: "InlinedReturn",
          sourceBlockId: clonedRetId,
          targetBlockId: continuation,
          metadata: {},
        });
      }

      // Replace the original GoSubCall with an InlinedGoSubCall to the cloned entry,
      // and drop the GoSubReturn — actual return flow now goes through InlinedReturn.
      removedEdges.add(callEdge.id);
      removedEdges.add(returnEdge.id);
      edges.push({
        id: `${callEdge.id}.${suffix}`,
        kind: goSubCallToInlined(callEdge.kind),
        sourceBlockId: callEdge.sourceBlockId,
        targetBlockId: blockIdMap.get(entryId)!,
        metadata: { ...callEdge.metadata },
      });

      inlined++;
    }

  }

  // Compact the edges array, dropping the replaced GoSubCall and GoSubReturn edges.
  if (removedEdges.size > 0) {
    let write = 0;
    for (let read = 0; read < edges.length; read++) {
      if (!removedEdges.has(edges[read].id)) edges[write++] = edges[read];
    }
    edges.length = write;
  }

  return { inlined, newCallSites };
};

/**
 * Finds all blocks reachable from entryId that form this subroutine's body.
 *
 * Traversal rules:
 * - Follow all edges except: un-inlined GoSubCall (other subroutines),
 *   any GoSubReturn (not real control flow), SceneProgression, GotoScene.
 * - InlinedGoSubCall IS followed — those sub-sub blocks are now part of the body.
 * - Stop (but collect) at Return blocks.
 */
const findSubroutineBody = (
  entryId: string,
  refMap: Map<string, BlockRef>,
  edgesBySource: Map<string, Transition[]>,
): SubroutineBody => {
  const { visited } = walkGraph(entryId, id => {
    return (edgesBySource.get(id) ?? [])
      .filter(e =>
        e.targetBlockId &&
        !isGoSubCall(e.kind) &&
        !isAnyGoSubReturn(e.kind) &&
        e.kind !== "SceneProgression" &&
        e.kind !== "GotoScene" &&
        !(e.kind === "FallThrough" && refMap.get(e.sourceBlockId)?.exitType === "Choice"),
      )
      .map(e => e.targetBlockId!);
  }, {
    exitWhen: id => {
      const ref = refMap.get(id);
      return !ref || ref.exitType === "Return";
    },
  });

  const returnBlockIds: string[] = [];
  const bodyEdges: Transition[] = [];

  for (const id of visited) {
    if (refMap.get(id)?.exitType === "Return") returnBlockIds.push(id);
    for (const e of edgesBySource.get(id) ?? []) {
      bodyEdges.push(e);
    }
  }

  return { blockIds: visited, edges: bodyEdges, returnBlockIds };
};

const isLeafBody = (body: SubroutineBody, entryId: string): boolean => {
  for (const e of body.edges) {
    if (isGoSubCall(e.kind) && e.targetBlockId && e.targetBlockId !== entryId) return false;
  }
  return true;
};

const pruneUnreachable = (
  entryBlockId: string,
  refMap: Map<string, BlockRef>,
  edges: Transition[],
  errors: InlineError[],
  gosubReturnTargets?: Set<string>,
): { refs: BlockRef[]; edges: Transition[] } => {
  const succs = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.targetBlockId) continue;
    // GoSubCall edges that were not inlined are treated as non-traversable: their
    // targets (original subroutine blocks) are considered unreachable and pruned.
    if (isGoSubCall(e.kind)) continue;
    getOrSet(succs, e.sourceBlockId, () => new Set()).add(e.targetBlockId);
  }

  const visited = reachableFrom(entryBlockId, id => succs.get(id) ?? []);

  const inlinedOriginals = new Set<string>();
  for (const id of visited) {
    const ref = refMap.get(id);
    if (ref?.sourceBlockId) inlinedOriginals.add(ref.sourceBlockId);
  }

  const allCloneSources = new Set<string>();
  for (const ref of refMap.values()) {
    if (ref.sourceBlockId) allCloneSources.add(ref.sourceBlockId);
  }

  const subroutineRelated = new Set<string>();
  for (const id of allCloneSources) subroutineRelated.add(id);
  if (gosubReturnTargets) {
    for (const id of gosubReturnTargets) {
      if (!visited.has(id)) subroutineRelated.add(id);
    }
  }

  if (subroutineRelated.size > 0) {
    const unreachable = new Set<string>();
    for (const id of refMap.keys()) {
      if (!visited.has(id)) unreachable.add(id);
    }
    const unreachableSuccs = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!e.targetBlockId) continue;
      if (unreachable.has(e.sourceBlockId) && unreachable.has(e.targetBlockId)) {
        getOrSet(unreachableSuccs, e.sourceBlockId, () => new Set()).add(e.targetBlockId);
      }
    }
    const queue = [...subroutineRelated];
    while (queue.length > 0) {
      const id = queue.pop()!;
      for (const next of unreachableSuccs.get(id) ?? []) {
        if (!subroutineRelated.has(next)) {
          subroutineRelated.add(next);
          queue.push(next);
        }
      }
    }
  }

  const refs: BlockRef[] = [];
  for (const [id, ref] of refMap) {
    if (visited.has(id)) {
      refs.push(ref);
    } else {
      if (ref.sourceBlockId || inlinedOriginals.has(id)) continue;
      if (subroutineRelated.has(id)) {
        errors.push({ kind: "inlined-original", blockId: id });
      } else {
        errors.push({ kind: "unreachable-block", blockId: id });
      }
    }
  }

  const liveEdges = edges.filter(e => visited.has(e.sourceBlockId));
  return { refs, edges: liveEdges };
};

export const inlineFlattened = (
  cfg: ControlFlowGraph,
  subroutines: FlattenedSubroutine[],
): InlineResult => {
  const subByEntry = new Map<string, FlattenedSubroutine>();
  for (const sub of subroutines) {
    subByEntry.set(sub.entryBlockId, sub);
  }

  const refMap = new Map<string, BlockRef>();
  for (const [id, block] of Object.entries(cfg.blocks)) {
    refMap.set(id, { id, sourceBlockId: block.sourceBlockId, exitType: block.exitType });
  }

  const edges: Transition[] = cfg.edges.map(e => ({ ...e, metadata: { ...e.metadata } }));
  const edgesBySource = buildEdgesBySource(edges);

  const originalGoSubReturnTargets = new Set<string>();
  for (const e of cfg.edges) {
    if (isAnyGoSubReturn(e.kind) && e.targetBlockId) {
      originalGoSubReturnTargets.add(e.targetBlockId);
    }
  }

  let gosubsInlined = 0;
  let callSiteCounter = 0;
  const errors: InlineError[] = [];
  const removedEdges = new Set<string>();

  for (const edge of [...edges]) {
    if (!isGoSubCall(edge.kind) || !edge.targetBlockId) continue;

    const sub = subByEntry.get(edge.targetBlockId);
    if (!sub) continue;

    const callerEdges = edgesBySource.get(edge.sourceBlockId) ?? [];
    let returnEdge: Transition | undefined;
    for (const e of callerEdges) {
      if (isGoSubReturn(e.kind) && e.targetBlockId) {
        returnEdge = e;
        break;
      }
    }
    if (!returnEdge) continue;

    const continuation = returnEdge.targetBlockId!;
    const callNumber = callSiteCounter++;
    const suffix = `call_${callNumber}`;

    const blockIdMap = new Map<string, string>();
    for (const ref of sub.blockRefs) {
      const clonedId = `${ref.id}.${suffix}`;
      blockIdMap.set(ref.id, clonedId);
      refMap.set(clonedId, {
        id: clonedId,
        sourceBlockId: ref.sourceBlockId ?? ref.id,
        clonedFrom: { parentId: ref.id, purpose: "inline", call: callNumber, parent: ref.clonedFrom },
        exitType: ref.exitType,
      });
    }

    for (const e of sub.edges) {
      edges.push({
        id: `${e.id}.${suffix}`,
        kind: e.kind,
        sourceBlockId: blockIdMap.get(e.sourceBlockId) ?? e.sourceBlockId,
        targetBlockId: e.targetBlockId ? (blockIdMap.get(e.targetBlockId) ?? e.targetBlockId) : null,
        metadata: { ...e.metadata },
      });
    }

    for (const retId of sub.returnBlockIds) {
      const clonedRetId = blockIdMap.get(retId)!;
      const ref = refMap.get(clonedRetId);
      if (ref) ref.exitType = "InlinedReturn";
      edges.push({
        id: `${clonedRetId}.ret`,
        kind: "InlinedReturn" as Transition["kind"],
        sourceBlockId: clonedRetId,
        targetBlockId: continuation,
        metadata: {},
      });
    }

    removedEdges.add(edge.id);
    removedEdges.add(returnEdge.id);
    edges.push({
      id: `${edge.id}.${suffix}`,
      kind: goSubCallToInlined(edge.kind),
      sourceBlockId: edge.sourceBlockId,
      targetBlockId: blockIdMap.get(sub.entryBlockId)!,
      metadata: { ...edge.metadata },
    });

    gosubsInlined++;
  }

  if (removedEdges.size > 0) {
    let write = 0;
    for (let read = 0; read < edges.length; read++) {
      if (!removedEdges.has(edges[read].id)) edges[write++] = edges[read];
    }
    edges.length = write;
  }

  const { refs, edges: prunedEdges } = pruneUnreachable(
    cfg.entryBlockId, refMap, edges, errors, originalGoSubReturnTargets,
  );

  for (const e of prunedEdges) {
    if (isGoSubCall(e.kind)) {
      errors.push({
        kind: "unresolved-gosub",
        callerBlockId: e.sourceBlockId,
        targetBlockId: e.targetBlockId,
        label: e.metadata.label as string | undefined,
      });
    }
  }

  return {
    blockRefs: refs,
    edges: prunedEdges,
    entryBlockId: cfg.entryBlockId,
    sceneOrder: cfg.sceneOrder,
    statementIndex: cfg.statementIndex,
    gosubsInlined,
    errors,
  };
};
