import { LinkedCfgs, CfgExit } from "./data";
import { LoopAnalysis } from "./loop-analysis";
import { isGoSubCall } from "../control-flow-graph/data/transition-kind";
import { topologicalBlockOrder } from "../control-flow-graph/graph-utils";
import { BlockRef } from "../control-flow-graph/data/block-ref";
import { FNV_OFFSET, fnvMixStr, fnvMixInt } from "../../utils/fnv";

export { FNV_OFFSET, fnvMixStr, fnvMixInt };

export type ContextId = number;

export type ContextEdgeKind = "forward" | "call" | "return" | "loop-back";

export interface ContextEdge {
  from: ContextId;
  to: ContextId;
  kind: ContextEdgeKind;
  crossScene: boolean;
}

export interface ContextNode {
  id: ContextId;
  cfgId: string;
  scene: string;
  callDepth: number;
  loopIteration: number | undefined;
  subroutineEntry: number | null;
  predecessors: ContextEdge[];
}

export interface DroppedContext {
  cfgId: string;
  reason: "max-per-cfg" | "max-total" | "call-depth";
}

export interface ContextGraphDiagnostics {
  unresolvedExits: CfgExit[];
  droppedContexts: DroppedContext[];
  missingCfgs: string[];
}

export interface ContextGraphOptions {
  maxCallDepth?: number;
  maxLoopIterations?: number;
  maxContextsPerCfg?: number;
  maxContextNodes?: number;
}

export interface ContextGraph {
  nodes: ReadonlyMap<ContextId, ContextNode>;
  order: readonly ContextId[];
  diagnostics: ContextGraphDiagnostics;

  predecessors(id: ContextId): readonly ContextEdge[];
  successors(id: ContextId): readonly ContextEdge[];
  forEachBlock(id: ContextId, cb: (blockId: string, ref: BlockRef) => void): void;
}

const contextHash = (
  cfgId: string,
  loopIteration: number | undefined,
  callSiteHash: number = 0,
): number => {
  let h = fnvMixStr(FNV_OFFSET, cfgId);
  if (loopIteration !== undefined) h = fnvMixInt(h, loopIteration);
  if (callSiteHash !== 0) h = fnvMixInt(h, callSiteHash);
  return h;
};

export const blockContextKey = (contextId: ContextId, blockId: string): number =>
  fnvMixStr(contextId, blockId);

interface QueueItem {
  cfgId: string;
  loopIter: number | undefined;
  callDepth: number;
  subroutineEntry: number | null;
  callSiteHash: number;
  loopIterations: Map<string, number>;
  fromHash: ContextId | null;
  crossScene: boolean;
  edgeKind: ContextEdgeKind;
}

export const buildContextGraph = (
  linked: LinkedCfgs,
  loops: LoopAnalysis,
  blockToCfg: Map<string, string>,
  options: ContextGraphOptions = {},
): ContextGraph => {
  const {
    maxCallDepth = 20,
    maxLoopIterations = 5,
    maxContextsPerCfg = 50,
    maxContextNodes = 75_000,
  } = options;

  const diagnostics: ContextGraphDiagnostics = {
    unresolvedExits: [...linked.unresolvedExits],
    droppedContexts: [],
    missingCfgs: [],
  };

  const nodes = new Map<ContextId, ContextNode>();
  const processed = new Set<ContextId>();
  const contextsPerCfg = new Map<string, number>();
  const successorMap = new Map<ContextId, ContextEdge[]>();
  const missingCfgSet = new Set<string>();
  const subroutineContinuations = new Map<number, Array<{ contCfgId: string; callerSubroutineEntry: number | null; callerCallSiteHash: number }>>();

  const backEdgeKeys = new Set<string>();
  for (const loop of loops.loops) {
    for (const be of loop.backEdges) {
      if (be.target.type === "cfg") {
        const srcCfg = blockToCfg.get(be.blockId);
        if (srcCfg) backEdgeKeys.add(`${srcCfg}->${be.target.cfgId}`);
      }
    }
  }

  const getOrCreateNode = (hash: ContextId, cfgId: string, scene: string, callDepth: number, loopIter: number | undefined, subroutineEntry: number | null): ContextNode => {
    let node = nodes.get(hash);
    if (!node) {
      node = { id: hash, cfgId, scene, callDepth, loopIteration: loopIter, subroutineEntry, predecessors: [] };
      nodes.set(hash, node);
    }
    return node;
  };

  const addEdge = (edge: ContextEdge) => {
    const node = nodes.get(edge.to);
    if (node) node.predecessors.push(edge);
    const list = successorMap.get(edge.from);
    if (list) list.push(edge);
    else successorMap.set(edge.from, [edge]);
  };

  const queue: QueueItem[] = [];

  const enqueue = (item: QueueItem): void => {
    const cfg = linked.cfgs[item.cfgId];
    if (!cfg) {
      if (!missingCfgSet.has(item.cfgId)) {
        missingCfgSet.add(item.cfgId);
        diagnostics.missingCfgs.push(item.cfgId);
      }
      return;
    }

    const hash = contextHash(item.cfgId, item.loopIter, item.callSiteHash);
    const existing = nodes.has(hash);

    if (!existing) {
      const count = contextsPerCfg.get(item.cfgId) ?? 0;
      if (count >= maxContextsPerCfg) {
        diagnostics.droppedContexts.push({ cfgId: item.cfgId, reason: "max-per-cfg" });
        return;
      }
      contextsPerCfg.set(item.cfgId, count + 1);
      if (nodes.size >= maxContextNodes) {
        diagnostics.droppedContexts.push({ cfgId: item.cfgId, reason: "max-total" });
        return;
      }
    }

    const node = getOrCreateNode(hash, item.cfgId, cfg.scene, item.callDepth, item.loopIter, item.subroutineEntry);

    if (item.fromHash !== null) {
      const edge: ContextEdge = {
        from: item.fromHash,
        to: hash,
        kind: item.edgeKind,
        crossScene: item.crossScene,
      };
      addEdge(edge);
    }

    if (!processed.has(hash)) {
      processed.add(hash);
      queue.push(item);
    }
  };

  enqueue({
    cfgId: linked.entryCfgId,
    loopIter: undefined,
    callDepth: 0,
    subroutineEntry: null,
    callSiteHash: 0,
    loopIterations: new Map(),
    fromHash: null,
    crossScene: false,
    edgeKind: "forward",
  });

  const returnExitNodes = new Map<number, ContextId[]>();

  while (queue.length > 0) {
    const item = queue.shift()!;
    const cfg = linked.cfgs[item.cfgId];
    if (!cfg) continue;

    const hash = contextHash(item.cfgId, item.loopIter, item.callSiteHash);

    for (const exit of cfg.exits) {
      if (isGoSubCall(exit.kind) && exit.continuation) {
        if (exit.target.type !== "cfg") continue;
        if (!linked.cfgs[exit.target.cfgId]) {
          if (!missingCfgSet.has(exit.target.cfgId)) {
            missingCfgSet.add(exit.target.cfgId);
            diagnostics.missingCfgs.push(exit.target.cfgId);
          }
          continue;
        }
        if (item.callDepth >= maxCallDepth) {
          diagnostics.droppedContexts.push({ cfgId: exit.target.cfgId, reason: "call-depth" });
          continue;
        }

        const continuationCfgId = linked.cfgs[exit.continuation]
          ? exit.continuation
          : (blockToCfg.get(exit.continuation) ?? item.cfgId);

        const callSiteId = fnvMixStr(fnvMixStr(FNV_OFFSET, item.cfgId), exit.blockId);
        const targetEntryHash = contextHash(exit.target.cfgId, undefined, callSiteId);

        const contEntry = { contCfgId: continuationCfgId, callerSubroutineEntry: item.subroutineEntry, callerCallSiteHash: item.callSiteHash };
        const conts = subroutineContinuations.get(targetEntryHash);
        if (conts) conts.push(contEntry);
        else subroutineContinuations.set(targetEntryHash, [contEntry]);

        const targetScene = linked.cfgs[exit.target.cfgId]?.scene;
        const cross = targetScene !== undefined && targetScene !== cfg.scene;

        enqueue({
          cfgId: exit.target.cfgId,
          loopIter: undefined,
          callDepth: item.callDepth + 1,
          subroutineEntry: targetEntryHash,
          callSiteHash: callSiteId,
          loopIterations: new Map(item.loopIterations),
          fromHash: hash,
          crossScene: cross,
          edgeKind: "call",
        });

        const exitNodes = returnExitNodes.get(targetEntryHash);
        if (exitNodes) {
          for (const exitHash of exitNodes) {
            const exitNode = nodes.get(exitHash);
            const exitScene = exitNode ? linked.cfgs[exitNode.cfgId]?.scene : undefined;
            const contScene = linked.cfgs[continuationCfgId]?.scene;
            const cr = contScene !== undefined && exitScene !== undefined && contScene !== exitScene;
            enqueue({
              cfgId: continuationCfgId,
              loopIter: item.loopIterations.get(continuationCfgId),
              callDepth: item.callDepth,
              subroutineEntry: item.subroutineEntry,
              callSiteHash: item.callSiteHash,
              loopIterations: new Map(item.loopIterations),
              fromHash: exitHash,
              crossScene: cr,
              edgeKind: "return",
            });
          }
        }

        continue;
      }

      if (exit.target.type === "return") {
        const myEntry = nodes.get(hash)?.subroutineEntry ?? item.subroutineEntry;
        if (myEntry === null) continue;
        const exits = returnExitNodes.get(myEntry);
        if (exits) { if (!exits.includes(hash)) exits.push(hash); }
        else returnExitNodes.set(myEntry, [hash]);

        const conts = subroutineContinuations.get(myEntry);
        if (conts) {
          for (const { contCfgId, callerSubroutineEntry, callerCallSiteHash } of conts) {
            const contScene = linked.cfgs[contCfgId]?.scene;
            const cross = contScene !== undefined && contScene !== cfg.scene;
            enqueue({
              cfgId: contCfgId,
              loopIter: item.loopIterations.get(contCfgId),
              callDepth: item.callDepth - 1,
              subroutineEntry: callerSubroutineEntry,
              callSiteHash: callerCallSiteHash,
              loopIterations: new Map(item.loopIterations),
              fromHash: hash,
              crossScene: cross,
              edgeKind: "return",
            });
          }
        }
        continue;
      }

      if (exit.target.type !== "cfg") continue;

      const key = `${item.cfgId}->${exit.target.cfgId}`;
      if (backEdgeKeys.has(key)) {
        const headerCfgId = exit.target.cfgId;
        const currentIter = item.loopIterations.get(headerCfgId) ?? 0;
        const nextIter = currentIter + 1;
        const loopTripCount = loops.cfgToLoop.get(headerCfgId)?.classification.unrollDepth;
        const iterLimit = loopTripCount ?? maxLoopIterations;
        if (nextIter >= iterLimit) continue;

        const nextIterations = new Map(item.loopIterations);
        nextIterations.set(headerCfgId, nextIter);

        enqueue({
          cfgId: headerCfgId,
          loopIter: nextIter,
          callDepth: item.callDepth,
          subroutineEntry: item.subroutineEntry,
          callSiteHash: item.callSiteHash,
          loopIterations: nextIterations,
          fromHash: hash,
          crossScene: false,
          edgeKind: "loop-back",
        });
        continue;
      }

      const targetScene = linked.cfgs[exit.target.cfgId]?.scene;
      const cross = targetScene !== undefined && targetScene !== cfg.scene;

      enqueue({
        cfgId: exit.target.cfgId,
        loopIter: item.loopIterations.get(exit.target.cfgId),
        callDepth: item.callDepth,
        subroutineEntry: item.subroutineEntry,
        callSiteHash: item.callSiteHash,
        loopIterations: new Map(item.loopIterations),
        fromHash: hash,
        crossScene: cross,
        edgeKind: "forward",
      });
    }
  }

  const order = topoSort(nodes);

  const blockOrderCache = new Map<string, string[]>();

  const graph: ContextGraph = {
    nodes,
    order,
    diagnostics,

    predecessors(id: ContextId): readonly ContextEdge[] {
      return nodes.get(id)?.predecessors ?? [];
    },

    successors(id: ContextId): readonly ContextEdge[] {
      return successorMap.get(id) ?? [];
    },

    forEachBlock(id: ContextId, cb: (blockId: string, ref: BlockRef) => void): void {
      const node = nodes.get(id);
      if (!node) return;
      const cfg = linked.cfgs[node.cfgId];
      if (!cfg) return;

      let blockOrder = blockOrderCache.get(node.cfgId);
      if (!blockOrder) {
        blockOrder = topologicalBlockOrder(cfg.blocks, cfg.edges);
        blockOrderCache.set(node.cfgId, blockOrder);
      }

      for (const blockId of blockOrder) {
        const ref = cfg.blocks[blockId];
        if (ref) cb(blockId, ref);
      }
    },
  };

  return graph;
};

const topoSort = (nodes: Map<ContextId, ContextNode>): ContextId[] => {
  const inDegree = new Map<ContextId, number>();
  const succs = new Map<ContextId, Set<ContextId>>();

  for (const [hash] of nodes) inDegree.set(hash, 0);

  for (const [hash, node] of nodes) {
    for (const pred of node.predecessors) {
      if (!nodes.has(pred.from)) continue;
      let s = succs.get(pred.from);
      if (!s) { s = new Set(); succs.set(pred.from, s); }
      if (!s.has(hash)) {
        s.add(hash);
        inDegree.set(hash, (inDegree.get(hash) ?? 0) + 1);
      }
    }
  }

  const queue: ContextId[] = [];
  for (const [hash, deg] of inDegree) {
    if (deg === 0) queue.push(hash);
  }

  const order: ContextId[] = [];
  const inOrder = new Set<ContextId>();
  let qi = 0;
  while (qi < queue.length) {
    const hash = queue[qi++];
    order.push(hash);
    inOrder.add(hash);
    for (const succ of succs.get(hash) ?? []) {
      const newDeg = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }

  for (const [hash] of nodes) {
    if (!inOrder.has(hash)) order.push(hash);
  }

  return order;
};
