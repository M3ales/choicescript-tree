import { CfgTransfer } from "../cfg-transfer";
import { CodeBlock } from "../../control-flow-graph/data/code-block";
import { Statement } from "../../../parser/statements";
import { State, StateStore } from "../dataflow";
import { VariableState, cloneState } from "../../dataflow/variable-state";
import { DataflowVisitor, DataflowBlockContext, DataflowWalkInput, runDataflowVisitors } from "./dataflow-visitor";
import { EntryProvenance } from "../dataflow";

export interface DeadBranch {
  cfgId: string;
  blockId: string;
  scene: string;
  reason: "condition-false" | "condition-true-elsewhere" | "selectable-if-false";
  conditionStatementId: string | undefined;
}

export class BranchReachabilityPass implements DataflowVisitor<DeadBranch[]> {
  private dead: DeadBranch[] = [];

  onBlock(ctx: DataflowBlockContext): void {
    if (!ctx.dead || !ctx.deadReason) return;

    this.dead.push({
      cfgId: ctx.cfgId,
      blockId: ctx.blockId,
      scene: ctx.scene,
      reason: ctx.deadReason,
      conditionStatementId: ctx.deadConditionStatementId,
    });
  }

  finish(): DeadBranch[] {
    return this.dead;
  }
}

export interface BlockState {
  blockId: string;
  scene: string;
  state: VariableState;
  provenance?: EntryProvenance[];
}

export class BlockStateCollector implements DataflowVisitor<BlockState[]> {
  private states: BlockState[] = [];

  onBlock(ctx: DataflowBlockContext): void {
    if (ctx.dead) return;
    this.states.push({
      blockId: ctx.blockId,
      scene: ctx.scene,
      state: cloneState(ctx.state),
      provenance: ctx.provenance,
    });
  }

  finish(): BlockState[] {
    return this.states;
  }
}

export const analyseBranchReachability = (
  transfers: Map<string, CfgTransfer>,
  dataflowStates: State[],
  stateStore: StateStore,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  cfgScenes: Map<string, string>,
): { deadBranches: DeadBranch[]; blockStates: BlockState[] } => {
  const input: DataflowWalkInput = { transfers, dataflowStates, stateStore, blockIndex, statements, cfgScenes };
  const [dead, blockStates] = runDataflowVisitors<[DeadBranch[], BlockState[]]>(
    input, [new BranchReachabilityPass(), new BlockStateCollector()],
  );
  return { deadBranches: dead, blockStates };
};
