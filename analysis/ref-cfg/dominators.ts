import { Transition } from "../control-flow-graph/data/transition";
import { BlockRef } from "../control-flow-graph/data/block-ref";

export interface DominatorTree {
  idom: Map<string, string | null>;
  ipdom: Map<string, string | null>;
  children: Map<string, string[]>;
  pdomChildren: Map<string, string[]>;
}

export const buildDominatorTree = (
  entryBlockId: string,
  blocks: Record<string, BlockRef>,
  edges: Transition[],
): DominatorTree => {
  const blockIds = Object.keys(blocks);
  const succs = new Map<string, string[]>();
  const preds = new Map<string, string[]>();

  for (const id of blockIds) {
    succs.set(id, []);
    preds.set(id, []);
  }

  for (const edge of edges) {
    if (!edge.targetBlockId || !blocks[edge.targetBlockId]) continue;
    succs.get(edge.sourceBlockId)!.push(edge.targetBlockId);
    preds.get(edge.targetBlockId)!.push(edge.sourceBlockId);
  }

  const rpo = reversePostOrder(entryBlockId, succs, blockIds);
  const idom = computeDominators(entryBlockId, rpo, preds);
  const children = buildChildren(idom);

  const exitBlocks = findExitBlocks(blockIds, succs);
  const ipdom = computePostDominators(exitBlocks, preds, succs, blockIds);
  const pdomChildren = buildChildren(ipdom);

  return { idom, ipdom, children, pdomChildren };
};

/**
 * Iterative DFS producing reverse-postorder.
 * `adj` = successor adjacency for the traversal direction.
 */
const reversePostOrder = (
  entry: string,
  adj: Map<string, string[]>,
  allNodes: string[],
): string[] => {
  const visited = new Set<string>();
  const order: string[] = [];

  const stack: Array<{ id: string; childIndex: number }> = [];
  stack.push({ id: entry, childIndex: 0 });
  visited.add(entry);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const neighbours = adj.get(frame.id) ?? [];

    if (frame.childIndex < neighbours.length) {
      const child = neighbours[frame.childIndex++];
      if (!visited.has(child)) {
        visited.add(child);
        stack.push({ id: child, childIndex: 0 });
      }
    } else {
      order.push(frame.id);
      stack.pop();
    }
  }

  for (const id of allNodes) {
    if (!visited.has(id)) order.push(id);
  }

  order.reverse();
  return order;
};

/**
 * Cooper-Harvey-Kennedy iterative dominator computation.
 * `rpo` = reverse-postorder of nodes, `preds` = predecessor map.
 */
const computeDominators = (
  entry: string,
  rpo: string[],
  preds: Map<string, string[]>,
): Map<string, string | null> => {
  const rpoIndex = new Map<string, number>();
  for (let i = 0; i < rpo.length; i++) rpoIndex.set(rpo[i], i);

  const idom = new Map<string, string | null>();
  idom.set(entry, null);

  const intersect = (a: string, b: string): string => {
    let fingerA = a;
    let fingerB = b;
    while (fingerA !== fingerB) {
      while (rpoIndex.get(fingerA)! > rpoIndex.get(fingerB)!) {
        fingerA = idom.get(fingerA) as string;
      }
      while (rpoIndex.get(fingerB)! > rpoIndex.get(fingerA)!) {
        fingerB = idom.get(fingerB) as string;
      }
    }
    return fingerA;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rpo) {
      if (b === entry) continue;
      const predecessors = preds.get(b) ?? [];

      let newIdom: string | undefined;
      for (const p of predecessors) {
        if (!idom.has(p)) continue;
        if (newIdom === undefined) {
          newIdom = p;
        } else {
          newIdom = intersect(newIdom, p);
        }
      }

      if (newIdom !== undefined && idom.get(b) !== newIdom) {
        idom.set(b, newIdom);
        changed = true;
      }
    }
  }

  return idom;
};

/**
 * Post-dominators = dominators on the reverse CFG.
 * Reverse CFG: edges flipped, entry = exit blocks.
 * - Reverse-graph successors = forward-graph predecessors (`fwdPreds`)
 * - Reverse-graph predecessors = forward-graph successors (`fwdSuccs`)
 */
const computePostDominators = (
  exitBlocks: string[],
  fwdPreds: Map<string, string[]>,
  fwdSuccs: Map<string, string[]>,
  allBlocks: string[],
): Map<string, string | null> => {
  if (exitBlocks.length === 0) {
    const map = new Map<string, string | null>();
    for (const id of allBlocks) map.set(id, null);
    return map;
  }

  if (exitBlocks.length === 1) {
    const rpo = reversePostOrder(exitBlocks[0], fwdPreds, allBlocks);
    return computeDominators(exitBlocks[0], rpo, fwdSuccs);
  }

  const virtualExit = "__virtual_exit__";

  const revAdj = new Map<string, string[]>();
  for (const id of allBlocks) revAdj.set(id, [...(fwdPreds.get(id) ?? [])]);
  revAdj.set(virtualExit, [...exitBlocks]);
  for (const exit of exitBlocks) {
    revAdj.get(exit)!.push(virtualExit);
  }

  const revPreds = new Map<string, string[]>();
  for (const id of allBlocks) revPreds.set(id, [...(fwdSuccs.get(id) ?? [])]);
  revPreds.set(virtualExit, []);
  for (const exit of exitBlocks) {
    revPreds.get(virtualExit)!.push(exit);
  }

  const allWithVirtual = [...allBlocks, virtualExit];
  const rpo = reversePostOrder(virtualExit, revAdj, allWithVirtual);
  const idom = computeDominators(virtualExit, rpo, revPreds);

  idom.delete(virtualExit);
  for (const [k, v] of idom) {
    if (v === virtualExit) idom.set(k, null);
  }

  return idom;
};

const findExitBlocks = (
  blockIds: string[],
  succs: Map<string, string[]>,
): string[] => {
  const exits: string[] = [];
  for (const id of blockIds) {
    const s = succs.get(id);
    if (!s || s.length === 0) exits.push(id);
  }
  return exits;
};

const buildChildren = (idom: Map<string, string | null>): Map<string, string[]> => {
  const children = new Map<string, string[]>();
  for (const [node, parent] of idom) {
    if (parent === null) continue;
    const list = children.get(parent);
    if (list) list.push(node);
    else children.set(parent, [node]);
  }
  return children;
};

export const getMergePoint = (
  branchBlockId: string,
  ipdom: Map<string, string | null>,
): string | null => ipdom.get(branchBlockId) ?? null;
