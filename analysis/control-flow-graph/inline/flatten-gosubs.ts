import { ControlFlowGraph, StatementIndexEntry, BlockRef, Transition, isGoSubCall, isGoSubReturn, isAnyGoSubCall, isAnyGoSubReturn, isReturnExit, goSubCallToInlined, goSubReturnToInlined } from "../data";
import { buildEdgesBySource } from "./clone-subgraph";
import { walkGraph } from "../graph-utils";
import { analyseLoops } from "../loop-analysis";
import { BlockResolver } from "../cfg-io";
import { unrollLoops } from "./unroll-loops";
import { Statement } from "../../../parser/statements";

export interface FlattenedSubroutine {
  entryBlockId: string;
  blockRefs: BlockRef[];
  edges: Transition[];
  returnBlockIds: string[];
}

export interface FlattenResult {
  subroutines: FlattenedSubroutine[];
  totalEntries: number;
  totalNested: number;
  totalLoopsUnrolled: number;
}

interface SubroutineBody {
  coreBlockIds: Set<string>;
  blockIds: Set<string>;
  returnBlockIds: string[];
}

interface UnrolledBody {
  blocks: Record<string, BlockRef>;
  edges: Transition[];
  blockIds: Set<string>;
  returnBlockIds: string[];
  loopsUnrolled: number;
}

interface SubroutineNode {
  entryId: string;
  name: string | undefined;
  body: SubroutineBody;
  children: Set<string>;
}

export const flattenSubroutines = (
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): FlattenResult => {
  const edgesBySource = buildEdgesBySource(cfg.edges);

  const entryIds = new Set<string>();
  const subroutineNames = new Map<string, string>();
  for (const edge of cfg.edges) {
    if (isAnyGoSubCall(edge.kind) && edge.targetBlockId) {
      entryIds.add(edge.targetBlockId);
      if (edge.metadata?.label && !subroutineNames.has(edge.targetBlockId)) {
        subroutineNames.set(edge.targetBlockId, edge.metadata.label);
      }
    }
  }

  const nodes = new Map<string, SubroutineNode>();
  for (const entryId of entryIds) {
    const body = findSubroutineBody(entryId, cfg.blocks, edgesBySource);
    const children = new Set<string>();
    for (const bid of body.coreBlockIds) {
      for (const e of edgesBySource.get(bid) ?? []) {
        if (!isGoSubCall(e.kind) || !e.targetBlockId) continue;
        if (e.targetBlockId === entryId) continue;
        if (entryIds.has(e.targetBlockId)) children.add(e.targetBlockId);
      }
    }
    nodes.set(entryId, { entryId, name: subroutineNames.get(entryId), body, children });
  }

  const sccs = findSccs(nodes);

  const subroutines: FlattenedSubroutine[] = [];
  const flattenedMap = new Map<string, FlattenedSubroutine>();
  let totalLoopsUnrolled = 0;

  for (const scc of sccs) {
    if (scc.length === 1) {
      const entryId = scc[0];
      const node = nodes.get(entryId)!;
      const unrolled = unrollSubroutineBody(entryId, node.body, cfg, statements, resolver);
      totalLoopsUnrolled += unrolled.loopsUnrolled;
      const sub = flattenOne(entryId, unrolled, node.name, flattenedMap).sub;
      subroutines.push(sub);
      flattenedMap.set(entryId, sub);
    } else {
      const result = flattenScc(scc, nodes, cfg, statements, resolver, flattenedMap);
      totalLoopsUnrolled += result.loopsUnrolled;
      for (const sub of result.subroutines) {
        subroutines.push(sub);
        flattenedMap.set(sub.entryBlockId, sub);
      }
    }
  }

  return { subroutines, totalEntries: subroutines.length, totalNested: 0, totalLoopsUnrolled };
};

const findSccs = (nodes: Map<string, SubroutineNode>): string[][] => {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (id: string): void => {
    const idx = nextIndex++;
    indices.set(id, idx);
    lowlinks.set(id, idx);
    stack.push(id);
    onStack.add(id);

    const node = nodes.get(id);
    if (node) {
      for (const child of node.children) {
        if (!indices.has(child)) {
          strongconnect(child);
          lowlinks.set(id, Math.min(lowlinks.get(id)!, lowlinks.get(child)!));
        } else if (onStack.has(child)) {
          lowlinks.set(id, Math.min(lowlinks.get(id)!, indices.get(child)!));
        }
      }
    }

    if (lowlinks.get(id) === indices.get(id)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== id);
      sccs.push(scc);
    }
  };

  for (const id of nodes.keys()) {
    if (!indices.has(id)) strongconnect(id);
  }

  return sccs;
};

const flattenScc = (
  sccEntryIds: string[],
  nodes: Map<string, SubroutineNode>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
  flattenedMap: Map<string, FlattenedSubroutine>,
): { subroutines: FlattenedSubroutine[]; loopsUnrolled: number } => {
  const globalEdgesBySource = buildEdgesBySource(cfg.edges);
  const sccSet = new Set(sccEntryIds);

  const mergedCoreBlockIds = new Set<string>();
  for (const entryId of sccEntryIds) {
    const node = nodes.get(entryId)!;
    for (const bid of node.body.coreBlockIds) mergedCoreBlockIds.add(bid);
  }

  const coreBlocks: Record<string, BlockRef> = {};
  for (const bid of mergedCoreBlockIds) {
    if (cfg.blocks[bid]) coreBlocks[bid] = cfg.blocks[bid];
  }

  const coreEdges: Transition[] = [];
  const intraSccCallSources = new Set<string>();
  for (const bid of mergedCoreBlockIds) {
    const sourceEdges = globalEdgesBySource.get(bid);
    if (!sourceEdges) continue;
    for (const e of sourceEdges) {
      if (isAnyGoSubReturn(e.kind)) {
        if (e.targetBlockId && mergedCoreBlockIds.has(e.targetBlockId)) {
          coreEdges.push({ ...e, metadata: { ...e.metadata } });
        }
        continue;
      }
      if (e.targetBlockId === null || mergedCoreBlockIds.has(e.targetBlockId)) {
        const cloned: Transition = { ...e, metadata: { ...e.metadata } };
        if (isGoSubCall(cloned.kind) && cloned.targetBlockId && sccSet.has(cloned.targetBlockId)) {
          cloned.kind = goSubCallToInlined(cloned.kind);
          intraSccCallSources.add(cloned.sourceBlockId);
        }
        coreEdges.push(cloned);
      }
    }
  }

  const filteredCoreEdges = intraSccCallSources.size > 0
    ? coreEdges.filter(e => !(isGoSubReturn(e.kind) && intraSccCallSources.has(e.sourceBlockId)))
    : coreEdges;

  const coreStatementIndex: Record<string, StatementIndexEntry> = {};
  for (const bid of mergedCoreBlockIds) {
    const ref = cfg.blocks[bid];
    if (!ref) continue;
    const block = resolver.resolve(ref);
    if (!block) continue;
    for (const stmtId of block.statementIds) {
      if (cfg.statementIndex[stmtId]) {
        coreStatementIndex[stmtId] = cfg.statementIndex[stmtId];
      }
    }
  }

  const coreCfg: ControlFlowGraph = {
    blocks: coreBlocks,
    edges: filteredCoreEdges,
    statementIndex: coreStatementIndex,
    entryBlockId: sccEntryIds[0],
    sceneOrder: [],
  };

  const loopResult = analyseLoops(coreCfg, statements, resolver);

  const unboundedLoops = loopResult.loops.filter(l => l.tripCount === null);
  if (unboundedLoops.length > 0) {
    const names = sccEntryIds.map(id => nodes.get(id)?.name ?? id);
    const headers = unboundedLoops.map(l => l.headerId).join(", ");
    throw new Error(
      `Mutually recursive subroutines [${names.join(", ")}] contain ${unboundedLoops.length} unbounded loop(s) ` +
      `at header(s): ${headers}. Cannot flatten without a known trip count.`,
    );
  }

  let finalBlocks: Record<string, BlockRef>;
  let finalEdges: Transition[];
  let loopsUnrolled = 0;

  if (loopResult.loops.length > 0) {
    const unrolled = unrollLoops(coreCfg, loopResult.loops);
    finalBlocks = unrolled.cfg.blocks;
    finalEdges = unrolled.cfg.edges;
    loopsUnrolled = unrolled.loopsUnrolled;
  } else {
    finalBlocks = coreBlocks;
    finalEdges = filteredCoreEdges;
  }

  const allBlockIds = new Set(Object.keys(finalBlocks));
  const returnBlockIds: string[] = [];
  for (const bid of allBlockIds) {
    const block = finalBlocks[bid];
    if (block && isReturnExit(block.exitType)) returnBlockIds.push(bid);
  }

  const subroutines: FlattenedSubroutine[] = [];
  for (const entryId of sccEntryIds) {
    const node = nodes.get(entryId)!;
    const body: UnrolledBody = {
      blocks: finalBlocks,
      edges: finalEdges,
      blockIds: allBlockIds,
      returnBlockIds,
      loopsUnrolled,
    };
    subroutines.push(flattenOne(entryId, body, node.name, flattenedMap).sub);
  }

  return { subroutines, loopsUnrolled };
};

const findSubroutineBody = (
  entryBlockId: string,
  allBlocks: Record<string, BlockRef>,
  edgesBySource: Map<string, Transition[]>,
): SubroutineBody => {
  const { visited, collected: returnBlockIds } = walkGraph<string>(
    entryBlockId,
    id => (edgesBySource.get(id) ?? [])
      .filter(e => e.targetBlockId && !isAnyGoSubReturn(e.kind) && e.kind !== "SceneProgression" && e.kind !== "GotoScene")
      .map(e => e.targetBlockId!),
    {
      exitWhen: id => {
        const block = allBlocks[id];
        return !block || isReturnExit(block.exitType);
      },
      collect: id => {
        const block = allBlocks[id];
        return block && isReturnExit(block.exitType) ? id : undefined;
      },
    },
  );
  return { coreBlockIds: new Set(visited), blockIds: new Set(visited), returnBlockIds };
};

const unrollSubroutineBody = (
  entryId: string,
  raw: SubroutineBody,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): UnrolledBody => {
  const globalEdgesBySource = buildEdgesBySource(cfg.edges);

  const coreBlocks: Record<string, BlockRef> = {};
  for (const bid of raw.coreBlockIds) {
    if (cfg.blocks[bid]) coreBlocks[bid] = cfg.blocks[bid];
  }

  const coreEdges: Transition[] = [];
  const externalGoSubReturns: Transition[] = [];
  for (const bid of raw.coreBlockIds) {
    const sourceEdges = globalEdgesBySource.get(bid);
    if (!sourceEdges) continue;
    for (const e of sourceEdges) {
      if (isAnyGoSubReturn(e.kind)) {
        if (e.targetBlockId && raw.coreBlockIds.has(e.targetBlockId)) {
          coreEdges.push({ ...e, metadata: { ...e.metadata } });
        } else {
          externalGoSubReturns.push({ ...e, metadata: { ...e.metadata } });
        }
        continue;
      }
      if (e.targetBlockId === null || raw.coreBlockIds.has(e.targetBlockId)) {
        coreEdges.push({ ...e, metadata: { ...e.metadata } });
      }
    }
  }

  // Convert self-referential GoSubCall(entryId) → InlinedGoSubCall so loop analysis
  // can see the back edge. Drop the paired GoSubReturn — the loop exits via Return paths.
  const selfRefSources = new Set<string>();
  for (const e of coreEdges) {
    if (isGoSubCall(e.kind) && e.targetBlockId === entryId) {
      e.kind = goSubCallToInlined(e.kind);
      selfRefSources.add(e.sourceBlockId);
    }
  }
  const filteredCoreEdges = selfRefSources.size > 0
    ? coreEdges.filter(e => !(isGoSubReturn(e.kind) && selfRefSources.has(e.sourceBlockId)))
    : coreEdges;

  const coreStatementIndex: Record<string, StatementIndexEntry> = {};
  for (const bid of raw.coreBlockIds) {
    const ref = cfg.blocks[bid];
    if (!ref) continue;
    const block = resolver.resolve(ref);
    if (!block) continue;
    for (const stmtId of block.statementIds) {
      if (cfg.statementIndex[stmtId]) {
        coreStatementIndex[stmtId] = cfg.statementIndex[stmtId];
      }
    }
  }

  const coreCfg: ControlFlowGraph = {
    blocks: coreBlocks,
    edges: filteredCoreEdges,
    statementIndex: coreStatementIndex,
    entryBlockId: entryId,
    sceneOrder: [],
  };

  const loopResult = analyseLoops(coreCfg, statements, resolver);

  const unboundedLoops = loopResult.loops.filter(l => l.tripCount === null);
  if (unboundedLoops.length > 0) {
    const headers = unboundedLoops.map(l => l.headerId).join(", ");
    throw new Error(
      `Subroutine "${entryId}" contains ${unboundedLoops.length} unbounded loop(s) at header(s): ${headers}. ` +
      `Cannot flatten without a known trip count.`,
    );
  }

  let unrolledBlocks: Record<string, BlockRef>;
  let unrolledEdges: Transition[];
  let loopsUnrolled = 0;

  if (loopResult.loops.length > 0) {
    const unrolled = unrollLoops(coreCfg, loopResult.loops);
    unrolledBlocks = unrolled.cfg.blocks;
    unrolledEdges = [...unrolled.cfg.edges, ...externalGoSubReturns];
    loopsUnrolled = unrolled.loopsUnrolled;
  } else {
    unrolledBlocks = coreBlocks;
    unrolledEdges = [...filteredCoreEdges, ...externalGoSubReturns];
  }

  // Re-scan for return blocks after unrolling
  const allBlockIds = new Set(Object.keys(unrolledBlocks));
  const returnBlockIds: string[] = [];
  for (const bid of allBlockIds) {
    const block = unrolledBlocks[bid];
    if (block && isReturnExit(block.exitType)) {
      returnBlockIds.push(bid);
    }
  }

  return { blocks: unrolledBlocks, edges: unrolledEdges, blockIds: allBlockIds, returnBlockIds, loopsUnrolled };
};

const flattenOne = (
  entryId: string,
  body: UnrolledBody,
  subroutineName: string | undefined,
  flattenedChildren: Map<string, FlattenedSubroutine>,
): { sub: FlattenedSubroutine } => {
  const refsByIdMap = new Map<string, BlockRef>();
  for (const [bid, ref] of Object.entries(body.blocks)) {
    const clonedFrom = ref.clonedFrom ?? { parentId: bid, purpose: "flatten" as const };
    if (subroutineName) clonedFrom.subroutine = subroutineName;
    refsByIdMap.set(bid, { ...ref, id: bid, clonedFrom, sourceBlockId: ref.sourceBlockId ?? bid });
  }

  const edges = [...body.edges];
  const nestedReturnBlocks = new Set<string>();
  let nestCounter = 0;

  for (;;) {
    const edgesBySource = buildEdgesBySource(edges);
    let resolvedAny = false;

    for (const [, sourceEdges] of edgesBySource) {
      let gosubEdge: Transition | undefined;
      let returnEdge: Transition | undefined;

      for (const e of sourceEdges) {
        if (isGoSubCall(e.kind) && e.targetBlockId) gosubEdge = e;
        if (isGoSubReturn(e.kind) && e.targetBlockId) returnEdge = e;
      }

      if (!gosubEdge || !returnEdge) continue;

      const child = flattenedChildren.get(gosubEdge.targetBlockId!);
      if (!child) continue;

      const continuation = returnEdge.targetBlockId!;
      const suffix = `nested_${nestCounter++}`;

      const blockIdMap = new Map<string, string>();
      for (const ref of child.blockRefs) {
        const clonedId = `${ref.id}.${suffix}`;
        blockIdMap.set(ref.id, clonedId);
        refsByIdMap.set(clonedId, {
          ...ref, id: clonedId,
          sourceBlockId: ref.sourceBlockId ?? ref.id,
          clonedFrom: { parentId: ref.id, purpose: "flatten" as const, parent: ref.clonedFrom },
        });
      }

      for (const e of child.edges) {
        edges.push({
          id: `${e.id}.${suffix}`,
          kind: e.kind,
          sourceBlockId: blockIdMap.get(e.sourceBlockId) ?? e.sourceBlockId,
          targetBlockId: e.targetBlockId ? (blockIdMap.get(e.targetBlockId) ?? e.targetBlockId) : null,
          metadata: { ...e.metadata },
        });
      }

      for (const retId of child.returnBlockIds) {
        const clonedRetId = blockIdMap.get(retId)!;
        const ref = refsByIdMap.get(clonedRetId);
        if (ref) ref.exitType = "InlinedReturn";
        nestedReturnBlocks.add(clonedRetId);

        edges.push({
          id: `${clonedRetId}.nested-ret`,
          kind: "InlinedReturn" as Transition["kind"],
          sourceBlockId: clonedRetId,
          targetBlockId: continuation,
          metadata: {},
        });
      }

      gosubEdge.kind = goSubCallToInlined(gosubEdge.kind);
      gosubEdge.targetBlockId = blockIdMap.get(child.entryBlockId)!;
      returnEdge.kind = goSubReturnToInlined(returnEdge.kind);

      resolvedAny = true;
    }

    if (!resolvedAny) break;
  }

  const outerReturnBlockIds = body.returnBlockIds.filter((id) => !nestedReturnBlocks.has(id));

  const allReturnBlocks = new Set([...outerReturnBlockIds, ...nestedReturnBlocks]);
  const liveEdges = edges.filter((e) => {
    if (e.kind === "Return" && allReturnBlocks.has(e.sourceBlockId)) return false;
    return true;
  });

  return {
    sub: {
      entryBlockId: entryId,
      blockRefs: [...refsByIdMap.values()],
      edges: liveEdges,
      returnBlockIds: outerReturnBlockIds,
    },
  };
};
