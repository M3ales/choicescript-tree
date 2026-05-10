import { ControlFlowGraph, Transition } from "../data";
import { LoopInfo } from "../loop-analysis";
import { cloneSubgraph, buildEdgesBySource } from "./clone-subgraph";
import { getOrSet } from "../graph-utils";

export interface UnrollResult {
  cfg: ControlFlowGraph;
  loopsUnrolled: number;
  blocksAdded: number;
  edgesAdded: number;
}

export const unrollLoops = (
  cfg: ControlFlowGraph,
  loops: LoopInfo[],
): UnrollResult => {
  const blocks = { ...cfg.blocks };
  const edges = [...cfg.edges];
  let loopsUnrolled = 0;
  let blocksAdded = 0;
  let edgesAdded = 0;

  const cloneToOriginal = new Map<string, string>();
  const cloneRegistry = new Map<string, string[]>();

  const edgesBySource = buildEdgesBySource(edges);

  const sorted = [...loops].sort(
    (a, b) => a.bodyBlockIds.length - b.bodyBlockIds.length,
  );

  const edgesToRemove = new Set<Transition>();
  let globalIterCounter = 0;

  for (const loop of sorted) {
    if (loop.tripCount === null) continue;
    if (loop.tripCount < 1) continue;

    const bodySet = expandBodySet(loop.bodyBlockIds, cloneRegistry);
    const headerId = loop.headerId;

    const backEdgePairs = new Set(
      loop.backEdges.map((be) => `${be.from}|${be.to}`),
    );

    const isBackEdge = (e: Transition): boolean => {
      if (!e.targetBlockId) return false;
      const origSource = cloneToOriginal.get(e.sourceBlockId) ?? e.sourceBlockId;
      const origTarget = cloneToOriginal.get(e.targetBlockId) ?? e.targetBlockId;
      return backEdgePairs.has(`${origSource}|${origTarget}`);
    };

    if (loop.tripCount === 1) {
      for (const bid of bodySet) {
        const sourceEdges = edgesBySource.get(bid);
        if (!sourceEdges) continue;
        for (const e of sourceEdges) {
          if (isBackEdge(e)) edgesToRemove.add(e);
        }
      }
      loopsUnrolled++;
      continue;
    }

    const K = loop.tripCount;

    let prevIterBackEdges: Transition[] = [];
    for (const bid of bodySet) {
      const sourceEdges = edgesBySource.get(bid);
      if (!sourceEdges) continue;
      for (const e of sourceEdges) {
        if (isBackEdge(e)) prevIterBackEdges.push(e);
      }
    }

    const deferredRewirings: Array<{ edge: Transition; newTarget: string }> = [];

    for (let iter = 1; iter < K; iter++) {
      const suffix = `iter_${++globalIterCounter}`;
      const { blocks: cloned, edges: clonedEdges, blockIdMap } = cloneSubgraph(
        bodySet, blocks, edgesBySource, suffix, "unrolled",
      );

      const iterHeaderId = blockIdMap.get(headerId)!;

      const reverseBlockIdMap = new Map<string, string>();
      for (const [origId, newId] of blockIdMap) {
        const block = cloned[newId];
        if (block) {
          block.loopHeaderId = headerId;
          block.iterationHeaderId = iterHeaderId;
          blocks[newId] = block;
          blocksAdded++;
        }

        cloneToOriginal.set(newId, cloneToOriginal.get(origId) ?? origId);
        reverseBlockIdMap.set(newId, origId);

        getOrSet(cloneRegistry, origId, () => []).push(newId);
      }

      for (const e of prevIterBackEdges) {
        deferredRewirings.push({ edge: e, newTarget: iterHeaderId });
      }

      for (const e of clonedEdges) {
        edges.push(e);
        getOrSet(edgesBySource, e.sourceBlockId, () => []).push(e);
        edgesAdded++;
      }

      prevIterBackEdges = clonedEdges.filter((e) => {
        if (!e.targetBlockId) return false;
        const origSource = reverseBlockIdMap.get(e.sourceBlockId) ?? e.sourceBlockId;
        const origTarget = reverseBlockIdMap.get(e.targetBlockId) ?? e.targetBlockId;
        return backEdgePairs.has(`${origSource}|${origTarget}`);
      });
    }

    for (const { edge, newTarget } of deferredRewirings) {
      edge.targetBlockId = newTarget;
    }

    for (const e of prevIterBackEdges) {
      edgesToRemove.add(e);
    }

    loopsUnrolled++;
  }

  const filteredEdges = edges.filter((e) => !edgesToRemove.has(e));

  return {
    cfg: { ...cfg, blocks, edges: filteredEdges },
    loopsUnrolled,
    blocksAdded,
    edgesAdded,
  };
};

const expandBodySet = (
  bodyBlockIds: string[],
  cloneRegistry: Map<string, string[]>,
): Set<string> => {
  const expanded = new Set(bodyBlockIds);
  for (const id of bodyBlockIds) {
    const clones = cloneRegistry.get(id);
    if (clones) {
      for (const c of clones) expanded.add(c);
    }
  }
  return expanded;
};
