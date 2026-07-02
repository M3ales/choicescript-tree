import { BlockRef } from "../control-flow-graph/data";
import { LinkedCfgs, Cfg, CfgExit } from "./data";
import { ContextGraph, ContextId, ContextNode } from "./context-graph";

export { FNV_OFFSET, fnvMixStr, fnvMixInt, blockContextKey } from "./context-graph";

export interface CallFrame {
  callerCfgId: string;
  callerHash: number;
  callerBlockId: string;
  continuationBlockId: string;
  continuationCfgId: string;
}

export interface WalkContext {
  readonly cfgId: string;
  readonly contextHash: number;
  readonly callDepth: number;
  readonly loopIteration: number | undefined;
}

export interface WalkVisitor {
  onBlock(ctx: WalkContext, blockId: string, ref: BlockRef): void;
  onEnterCfg?(ctx: WalkContext, cfg: Cfg): void;
  onLeaveCfg?(ctx: WalkContext, cfg: Cfg): void;
}

export const walkContextGraph = (
  graph: ContextGraph,
  linked: LinkedCfgs,
  visitor: WalkVisitor,
): void => {
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const cfg = linked.cfgs[node.cfgId];
    if (!cfg) continue;

    const ctx: WalkContext = {
      cfgId: node.cfgId,
      contextHash: id,
      callDepth: node.callDepth,
      loopIteration: node.loopIteration,
    };

    visitor.onEnterCfg?.(ctx, cfg);
    graph.forEachBlock(id, (blockId, ref) => visitor.onBlock(ctx, blockId, ref));
    visitor.onLeaveCfg?.(ctx, cfg);
  }
};
