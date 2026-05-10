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

export const flattenSubroutines = (
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): FlattenResult => {
  const edgesBySource = buildEdgesBySource(cfg.edges);

  // First pass: collect all subroutine entries and their bodies.
  const pendingEntries = new Set<string>();
  for (const edge of cfg.edges) {
    if (isAnyGoSubCall(edge.kind) && edge.targetBlockId) {
      pendingEntries.add(edge.targetBlockId);
    }
  }
  const bodies = new Map<string, SubroutineBody>();
  for (const entryId of pendingEntries) {
    bodies.set(entryId, findSubroutineBody(entryId, cfg.blocks, edgesBySource));
  }

  // Iterative leaf-first: leaf -> self-referential loop -> loop analysis -> unroll -> flatten.
  const subroutines: FlattenedSubroutine[] = [];
  let totalLoopsUnrolled = 0;

  const MAX_PASSES = 100;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const leaves: string[] = [];
    for (const entryId of pendingEntries) {
      if (isLeafBody(bodies.get(entryId)!, entryId, edgesBySource, pendingEntries)) {
        leaves.push(entryId);
      }
    }

    if (leaves.length === 0) break;

    for (const entryId of leaves) {
      const raw = bodies.get(entryId)!;
      const unrolled = unrollSubroutineBody(entryId, raw, cfg, statements, resolver);
      totalLoopsUnrolled += unrolled.loopsUnrolled;

      const result = flattenOne(entryId, unrolled);
      subroutines.push(result.sub);

      pendingEntries.delete(entryId);
    }
  }

  return { subroutines, totalEntries: subroutines.length, totalNested: 0, totalLoopsUnrolled };
};

const isLeafBody = (
  body: SubroutineBody,
  entryId: string,
  edgesBySource: Map<string, Transition[]>,
  pendingEntries: Set<string>,
): boolean => {
  for (const bid of body.coreBlockIds) {
    for (const e of edgesBySource.get(bid) ?? []) {
      if (!isGoSubCall(e.kind) || !e.targetBlockId) continue;
      if (e.targetBlockId === entryId) continue;
      if (pendingEntries.has(e.targetBlockId)) return false;
    }
  }
  return true;
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
  for (const bid of raw.coreBlockIds) {
    const sourceEdges = globalEdgesBySource.get(bid);
    if (!sourceEdges) continue;
    for (const e of sourceEdges) {
      if (isAnyGoSubReturn(e.kind)) {
        if (e.targetBlockId && raw.coreBlockIds.has(e.targetBlockId)) {
          coreEdges.push({ ...e, metadata: { ...e.metadata } });
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

  let unrolledBlocks: Record<string, BlockRef>;
  let unrolledEdges: Transition[];
  let loopsUnrolled = 0;

  if (loopResult.loops.length > 0) {
    const unrolled = unrollLoops(coreCfg, loopResult.loops);
    unrolledBlocks = unrolled.cfg.blocks;
    unrolledEdges = unrolled.cfg.edges;
    loopsUnrolled = unrolled.loopsUnrolled;
  } else {
    unrolledBlocks = coreBlocks;
    unrolledEdges = filteredCoreEdges;
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
): { sub: FlattenedSubroutine } => {
  const refsByIdMap = new Map<string, BlockRef>();
  for (const [bid, ref] of Object.entries(body.blocks)) {
    const origId = (ref.sourceBlockId ?? bid).replace(/\.iter_\d+/g, "");
    refsByIdMap.set(bid, { ...ref, id: bid, sourceBlockId: origId });
  }

  const edges = [...body.edges];
  const nestedReturnBlocks = new Set<string>();

  // Iteratively resolve nested gosub returns, inside-out.
  for (;;) {
    const edgesBySource = buildEdgesBySource(edges);
    let resolvedAny = false;

    for (const [, sourceEdges] of edgesBySource) {
      let gosubEdge: Transition | undefined;
      let returnEdge: Transition | undefined;

      for (const e of sourceEdges) {
        if (isGoSubCall(e.kind) && e.targetBlockId) {
          gosubEdge = e;
        }
        if (isGoSubReturn(e.kind) && e.targetBlockId) {
          returnEdge = e;
        }
      }

      if (!gosubEdge || !returnEdge) continue;

      const nestedEntry = gosubEdge.targetBlockId!;
      const continuation = returnEdge.targetBlockId!;

      const { collected: nestedReturns } = walkGraph<string>(
        nestedEntry,
        id => (edgesBySource.get(id) ?? [])
          .filter(e => e.targetBlockId && !isGoSubCall(e.kind) && body.blockIds.has(e.targetBlockId))
          .map(e => e.targetBlockId!),
        {
          exitWhen: id => {
            const ref = refsByIdMap.get(id);
            return !ref || isReturnExit(ref.exitType);
          },
          collect: id => {
            const ref = refsByIdMap.get(id);
            return ref?.exitType === "Return" ? id : undefined;
          },
        },
      );

      if (nestedReturns.length === 0) continue;

      gosubEdge.kind = goSubCallToInlined(gosubEdge.kind);
      returnEdge.kind = goSubReturnToInlined(returnEdge.kind);

      for (const retId of nestedReturns) {
        const ref = refsByIdMap.get(retId);
        if (ref) ref.exitType = "InlinedReturn";
        nestedReturnBlocks.add(retId);

        edges.push({
          id: `${retId}.nested-ret`,
          kind: "InlinedReturn" as Transition["kind"],
          sourceBlockId: retId,
          targetBlockId: continuation,
          metadata: {},
        });
      }

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
