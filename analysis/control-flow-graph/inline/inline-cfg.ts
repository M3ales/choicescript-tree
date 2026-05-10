import { ControlFlowGraph } from "../data";
import { Statement } from "../../../parser/statements";
import { analyseLoops, LoopAnalysisResult } from "../loop-analysis";
import { unrollLoops, UnrollResult } from "./unroll-loops";
import { inlineGosubs, InlineResult } from "./inline-gosubs";
import { BlockResolver } from "../cfg-io";

export interface InlineCfgResult {
  inline: InlineResult;
  unroll: UnrollResult;
  loopResult: LoopAnalysisResult;
}

/**
 * Full inline pipeline: gosub inlining (bottom-up, leaf-first) followed by
 * loop unrolling on the fully-flattened graph.
 */
export const inlineCfg = (
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): InlineCfgResult => {
  const inline = inlineGosubs(cfg);

  const inlinedCfg: ControlFlowGraph = {
    blocks: Object.fromEntries(inline.blockRefs.map(r => [r.id, r])),
    edges: inline.edges,
    statementIndex: inline.statementIndex,
    entryBlockId: inline.entryBlockId,
    sceneOrder: inline.sceneOrder,
  };

  const loopResult = analyseLoops(inlinedCfg, statements, resolver);
  const unroll = unrollLoops(inlinedCfg, loopResult.loops);

  return { inline, unroll, loopResult };
};
