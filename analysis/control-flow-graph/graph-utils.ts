import { Transition } from "./data/transition";
import { BlockRef } from "./data/block-ref";

export const getOrSet = <K, V>(map: Map<K, V>, key: K, create: () => V): V => {
  let v = map.get(key);
  if (!v) { v = create(); map.set(key, v); }
  return v;
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

export const topologicalBlockOrder = (
  blocks: Record<string, BlockRef>,
  edges: Transition[],
): string[] => {
  const inDegree = new Map<string, number>();
  const succs = new Map<string, string[]>();

  for (const id of Object.keys(blocks)) {
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    if (!edge.targetBlockId || !blocks[edge.targetBlockId]) continue;
    const list = succs.get(edge.sourceBlockId);
    if (list) list.push(edge.targetBlockId);
    else succs.set(edge.sourceBlockId, [edge.targetBlockId]);
    inDegree.set(edge.targetBlockId, (inDegree.get(edge.targetBlockId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    order.push(id);
    for (const succ of succs.get(id) ?? []) {
      const newDeg = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }

  return order;
};

export const findCfgContaining = <T extends { blocks: Record<string, unknown> }>(
  blockId: string,
  cfgs: Record<string, T>,
): string | undefined => {
  for (const [id, cfg] of Object.entries(cfgs)) {
    if (cfg.blocks[blockId]) return id;
  }
  return undefined;
};
