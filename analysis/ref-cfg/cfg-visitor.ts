import { TransitionKind } from "../control-flow-graph/data/transition-kind";
import { TransitionMetadata } from "../control-flow-graph/data/transition-metadata";
import { Statement } from "../../parser/statements";
import { Cfg, CfgExit } from "./data";
import { ScopeNode } from "./scope-types";

export interface Guard {
  branchBlockId: string;
  edgeKind: TransitionKind;
  metadata: TransitionMetadata;
}

export interface BlockContext {
  blockId: string;
  guards: Guard[];
  guarded: boolean;
  scopeNode: ScopeNode;
}

export interface ExitContext {
  exitIndex: number;
  exit: CfgExit;
  guards: Guard[];
  conditional: boolean;
  scopeNode: ScopeNode | null;
}

export interface CfgVisitor<T> {
  onStatement(ctx: BlockContext, stmtId: string, stmt: Statement): void;
  onExit?(ctx: ExitContext): void;
  finish(cfg: Cfg): T;
}
