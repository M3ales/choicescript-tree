import { ControlFlowGraph } from "./data";
import { isGoSubCall, isAnyGoSubCall } from "./data/transition-kind";

export const getOrSet = <K, V>(map: Map<K, V>, key: K, create: () => V): V => {
  let v = map.get(key);
  if (!v) { v = create(); map.set(key, v); }
  return v;
};

export const walkGraph = <T = never>(
  starts: string | Iterable<string>,
  getSuccessors: (id: string) => Iterable<string>,
  options: {
    exitWhen?: (id: string) => boolean;
    collect?: (id: string) => T | undefined;
    dfs?: boolean;
  } = {},
): { visited: Set<string>; collected: T[] } => {
  const { exitWhen, collect, dfs = false } = options;
  const visited = new Set<string>();
  const frontier: string[] = [];
  const collected: T[] = [];

  const enqueue = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    frontier.push(id);
  };

  if (typeof starts === "string") {
    enqueue(starts);
  } else {
    for (const s of starts) enqueue(s);
  }

  while (frontier.length > 0) {
    const id = dfs ? frontier.pop()! : frontier.shift()!;
    if (collect) {
      const v = collect(id);
      if (v !== undefined) collected.push(v);
    }
    if (exitWhen?.(id)) continue;
    for (const succ of getSuccessors(id)) enqueue(succ);
  }

  return { visited, collected };
};

export const reachableFrom = (
  startId: string,
  getSuccessors: (id: string) => Iterable<string>,
): Set<string> => walkGraph(startId, getSuccessors).visited;

export const buildSuccessorMap = (
  cfg: ControlFlowGraph,
  excludeGoSub = false
): Map<string, Set<string>> => {
  const succs = new Map<string, Set<string>>();
  for (const edge of cfg.edges) {
    if (!edge.targetBlockId) continue;
    if (excludeGoSub && isAnyGoSubCall(edge.kind)) continue;
    getOrSet(succs, edge.sourceBlockId, () => new Set()).add(edge.targetBlockId);
  }
  return succs;
};

export const buildPredecessorMap = (
  successors: Map<string, Set<string>>
): Map<string, string[]> => {
  const preds = new Map<string, string[]>();
  for (const [bid, succs] of successors) {
    for (const succId of succs) {
      getOrSet(preds, succId, () => []).push(bid);
    }
  }
  return preds;
};

export const detectBackEdges = (
  entryBlockId: string,
  successors: Map<string, Set<string>>,
  allBlockIds?: string[]
): { loopHeaders: Set<string>; backEdges: Array<{ from: string; to: string }> } => {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const loopHeaders = new Set<string>();
  const backEdges: Array<{ from: string; to: string }> = [];

  const dfs = (blockId: string, parent?: string) => {
    if (visited.has(blockId)) {
      if (inStack.has(blockId) && parent) {
        loopHeaders.add(blockId);
        backEdges.push({ from: parent, to: blockId });
      }
      return;
    }
    visited.add(blockId);
    inStack.add(blockId);
    const succs = successors.get(blockId);
    if (succs) {
      for (const succId of succs) dfs(succId, blockId);
    }
    inStack.delete(blockId);
  };

  dfs(entryBlockId);

  if (allBlockIds) {
    for (const blockId of allBlockIds) {
      if (!visited.has(blockId)) dfs(blockId);
    }
  }

  return { loopHeaders, backEdges };
};
