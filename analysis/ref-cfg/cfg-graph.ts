import { LinkedCfgs, Cfg } from "./data";
import { isGoSubCall } from "../control-flow-graph/data/transition-kind";
import { getOrSet } from "../control-flow-graph/graph-utils";

export interface Edge {
  from: string;
  to: string;
  kind: "flow" | "call" | "return";
}

export interface Graph {
  edges: Edge[];
  predecessors: Map<string, Edge[]>;
  successors: Map<string, string[]>;
  order: string[];
}

export const buildCfgGraph = (linked: LinkedCfgs, blockToCfg?: Map<string, string>): Graph => {
  const edges = buildEdges(linked, blockToCfg);

  const predecessors = new Map<string, Edge[]>();
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    getOrSet(predecessors, edge.to, () => []).push(edge);
    getOrSet(successors, edge.from, () => []).push(edge.to);
  }

  const order = topologicalOrder(linked, edges);

  return { edges, predecessors, successors, order };
};

const buildEdges = (linked: LinkedCfgs, blockToCfg?: Map<string, string>): Edge[] => {
  const edges: Edge[] = [];
  const returnTargets = new Map<string, Set<string>>();

  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (isGoSubCall(exit.kind) && exit.continuation) {
        if (exit.target.type === "cfg") {
          edges.push({ from: cfg.id, to: exit.target.cfgId, kind: "call" });
          const contCfgId = linked.cfgs[exit.continuation]
            ? exit.continuation
            : blockToCfg?.get(exit.continuation);
          if (contCfgId) {
            getOrSet(returnTargets, exit.target.cfgId, () => new Set()).add(contCfgId);
          }
        }
        continue;
      }

      if (exit.target.type === "return") continue;

      if (exit.target.type === "cfg") {
        edges.push({ from: cfg.id, to: exit.target.cfgId, kind: "flow" });
      }
    }
  }

  const flowSuccs = new Map<string, string[]>();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type === "cfg" && !isGoSubCall(exit.kind)) {
        getOrSet(flowSuccs, cfg.id, () => []).push(exit.target.cfgId);
      }
    }
  }

  for (const [gosubTarget, continuations] of returnTargets) {
    const body = floodFill(gosubTarget, flowSuccs);
    for (const bodyCfgId of body) {
      const cfg = linked.cfgs[bodyCfgId];
      if (!cfg) continue;
      if (cfg.exits.some(e => e.target.type === "return")) {
        for (const contCfgId of continuations) {
          edges.push({ from: bodyCfgId, to: contCfgId, kind: "return" });
        }
      }
    }
  }

  return edges;
};

const floodFill = (start: string, flowSuccs: Map<string, string[]>): Set<string> => {
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const succ of flowSuccs.get(id) ?? []) {
      stack.push(succ);
    }
  }
  return visited;
};

const topologicalOrder = (linked: LinkedCfgs, edges: Edge[]): string[] => {
  const succs = new Map<string, string[]>();

  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === "return") continue;
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    getOrSet(succs, edge.from, () => []).push(edge.to);
  }

  // Continuations are only reachable via return edges (excluded above).
  // Add synthetic caller→continuation edges so they appear after their caller.
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (isGoSubCall(exit.kind) && exit.continuation) {
        const contCfgId = linked.cfgs[exit.continuation]
          ? exit.continuation
          : undefined;
        if (contCfgId) {
          const key = `${cfg.id}->${contCfgId}`;
          if (!seen.has(key)) {
            seen.add(key);
            getOrSet(succs, cfg.id, () => []).push(contCfgId);
          }
        }
      }
    }
  }

  const sceneIndex = new Map<string, number>();
  for (let i = 0; i < linked.sceneOrder.length; i++) {
    sceneIndex.set(linked.sceneOrder[i], i);
  }

  const cfgIds = Object.keys(linked.cfgs);
  const isEntry = (id: string) => {
    const cfg = linked.cfgs[id];
    return cfg && id === `${cfg.scene}:`;
  };

  cfgIds.sort((a, b) => {
    const cfgA = linked.cfgs[a];
    const cfgB = linked.cfgs[b];
    const sceneA = sceneIndex.get(cfgA?.scene ?? "") ?? Infinity;
    const sceneB = sceneIndex.get(cfgB?.scene ?? "") ?? Infinity;
    if (sceneA !== sceneB) return sceneA - sceneB;
    const entryA = isEntry(a) ? 0 : 1;
    const entryB = isEntry(b) ? 0 : 1;
    return entryA - entryB;
  });

  const visited = new Set<string>();
  const postOrder: string[] = [];

  const dfs = (id: string) => {
    const stack: Array<{ id: string; childIdx: number }> = [{ id, childIdx: 0 }];
    visited.add(id);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = succs.get(frame.id) ?? [];

      if (frame.childIdx < children.length) {
        const child = children[frame.childIdx++];
        if (!visited.has(child)) {
          visited.add(child);
          stack.push({ id: child, childIdx: 0 });
        }
      } else {
        postOrder.push(frame.id);
        stack.pop();
      }
    }
  };

  if (linked.entryCfgId && linked.cfgs[linked.entryCfgId]) {
    dfs(linked.entryCfgId);
  }
  const reachableCount = postOrder.length;

  for (const id of cfgIds) {
    if (!visited.has(id)) dfs(id);
  }

  const reachable = postOrder.slice(0, reachableCount).reverse();
  const unreachable = postOrder.slice(reachableCount).reverse();
  return [...reachable, ...unreachable];
};
