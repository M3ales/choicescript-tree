import type { ConditionExpr } from "./loop-analysis";
import { BlockRef } from "../control-flow-graph/data/block-ref";
import { TransitionKind } from "../control-flow-graph/data/transition-kind";
import { TransitionMetadata } from "../control-flow-graph/data/transition-metadata";
import { Transition } from "../control-flow-graph/data/transition";
export interface RefStatementIndexEntry {
  scene: string;
  localStatementId: string;
  blockId: string;
}

export type CfgExitTarget =
  | { type: "cfg"; cfgId: string }
  | { type: "return" }
  | { type: "unresolved" }
  | { type: "terminal" };

export interface CfgExit {
  blockId: string;
  kind: TransitionKind;
  target: CfgExitTarget;
  metadata: TransitionMetadata;
  continuation?: string;
}

export interface Cfg {
  id: string;
  scene: string;
  entryBlockId: string;
  blocks: Record<string, BlockRef>;
  edges: Transition[];
  exits: CfgExit[];
}

export interface LoopRef {
  id: string;
  headerCfgId: string;
  bodyCfgIds: string[];
  backEdges: CfgExit[];
  exits: CfgExit[];
  mechanism: string;
  pure: boolean;
  bound: string;
  tripCount: number | null;
  unrollDepth: number | null;
  infinite: string | false;
  infiniteCondition: ConditionExpr | null;
}

export interface LinkedCfgs {
  cfgs: Record<string, Cfg>;
  loops: Record<string, LoopRef>;
  unresolvedExits: CfgExit[];
  sceneOrder: string[];
  entryCfgId: string;
  statementIndex: Record<string, RefStatementIndexEntry>;
  statsCfgIds: string[];
}