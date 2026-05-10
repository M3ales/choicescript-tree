import { BlockRef, Transition } from "../data";
import { getOrSet } from "../graph-utils";

export interface CloneResult {
  blocks: Record<string, BlockRef>;
  edges: Transition[];
  blockIdMap: Map<string, string>;
}

export type CloneSource = "inlined" | "unrolled";

export const cloneSubgraph = (
  blockIds: Set<string>,
  allBlocks: Record<string, BlockRef>,
  edgesBySource: Map<string, Transition[]>,
  suffix: string,
  source: CloneSource,
): CloneResult => {
  const blockIdMap = new Map<string, string>();
  const clonedBlocks: Record<string, BlockRef> = {};

  for (const id of blockIds) {
    blockIdMap.set(id, `${id}.${suffix}`);
  }

  for (const id of blockIds) {
    const original = allBlocks[id];
    if (!original) continue;
    const newId = blockIdMap.get(id)!;
    clonedBlocks[newId] = {
      ...original,
      id: newId,
      sourceBlockId: original.sourceBlockId ?? id,
      [source]: true,
    };
  }

  const clonedEdges: Transition[] = [];
  for (const id of blockIds) {
    const sourceEdges = edgesBySource.get(id);
    if (!sourceEdges) continue;

    for (const edge of sourceEdges) {
      const newSource = blockIdMap.get(edge.sourceBlockId)!;
      const newTarget = edge.targetBlockId && blockIds.has(edge.targetBlockId)
        ? blockIdMap.get(edge.targetBlockId)!
        : edge.targetBlockId;

      clonedEdges.push({
        id: `${edge.id}.${suffix}`,
        kind: edge.kind,
        sourceBlockId: newSource,
        targetBlockId: newTarget,
        metadata: { ...edge.metadata },
      });
    }
  }

  return { blocks: clonedBlocks, edges: clonedEdges, blockIdMap };
};

export const buildEdgesBySource = (
  edges: Transition[],
): Map<string, Transition[]> => {
  const map = new Map<string, Transition[]>();
  for (const edge of edges) {
    getOrSet(map, edge.sourceBlockId, () => []).push(edge);
  }
  return map;
};
