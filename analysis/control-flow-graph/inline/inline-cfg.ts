import { ControlFlowGraph } from "../data";
import { Statement } from "../../../parser/statements";
import { analyseLoops, LoopAnalysisResult } from "../loop-analysis";
import { unrollLoops, UnrollResult } from "./unroll-loops";
import { inlineFlattened, InlineResult } from "./inline-gosubs";
import { flattenSubroutines, FlattenResult } from "./flatten-gosubs";
import { BlockResolver } from "../cfg-io";

export interface InlineCfgResult {
  flatten: FlattenResult;
  inline: InlineResult;
  unroll: UnrollResult;
  loopResult: LoopAnalysisResult;
}

export const inlineCfg = (
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): InlineCfgResult => {
  const flatten = flattenSubroutines(cfg, statements, resolver);
  const inline = inlineFlattened(cfg, flatten.subroutines);

  const inlinedCfg: ControlFlowGraph = {
    blocks: Object.fromEntries(inline.blockRefs.map(r => [r.id, r])),
    edges: inline.edges,
    statementIndex: inline.statementIndex,
    entryBlockId: inline.entryBlockId,
    sceneOrder: inline.sceneOrder,
  };

  const loopResult = analyseLoops(inlinedCfg, statements, resolver);
  const unroll = unrollLoops(inlinedCfg, loopResult.loops);

  return { flatten, inline, unroll, loopResult };
};
