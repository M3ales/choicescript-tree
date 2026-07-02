import { CfgTransfer } from "../cfg-transfer";
import { CodeBlock } from "../../control-flow-graph/data/code-block";
import { Statement } from "../../../parser/statements";
import { LinkedCfgs, Cfg } from "../data";
import { State, StateStore, resolveMergedEntry, resolveMergedExit } from "../dataflow";
import { VariableState, cloneState, getVariable } from "../../dataflow/variable-state";
import { AbstractValue } from "../../dataflow/abstract-value";
import {
  DataflowVisitor, DataflowBlockContext, DataflowWalkInput, runDataflowVisitors,
  isTruthy,
} from "./dataflow-visitor";

export type ControlFlowViolationKind =
  | "branch-fallthrough"
  | "choice-fallthrough"
  | "implicit-end";

export interface ControlFlowViolation {
  cfgId: string;
  blockId: string;
  scene: string;
  kind: ControlFlowViolationKind;
  displayBlockId?: string;
}

const isIcfProvablyTrue = (state: VariableState, scene: string): boolean => {
  const value = getVariable(state, "implicit_control_flow", scene);
  if (value.kind === "constant") return isTruthy(value.value);
  return false;
};

const deserializeState = (
  s: { globals: Record<string, AbstractValue>; temps: Record<string, Record<string, AbstractValue>> },
): VariableState => ({
  parent: null,
  globals: new Map(Object.entries(s.globals)),
  temps: new Map(
    Object.entries(s.temps).map(([scene, vars]) => [scene, new Map(Object.entries(vars))]),
  ),
});

export class VerifyControlFlowPass implements DataflowVisitor<Map<string, VariableState>> {
  private blockStates = new Map<string, VariableState>();

  onBlock(ctx: DataflowBlockContext): void {
    if (ctx.dead) return;
    this.blockStates.set(ctx.blockId, cloneState(ctx.state));
  }

  finish(): Map<string, VariableState> {
    return this.blockStates;
  }
}

export const postProcessControlFlow = (
  linked: LinkedCfgs,
  blockStates: Map<string, VariableState>,
  dataflowStates: State[],
  stateStore: StateStore,
  blockIndex: Record<string, CodeBlock>,
): ControlFlowViolation[] => {
  const statesByCfg = new Map<string, State>();
  for (const s of dataflowStates) statesByCfg.set(s.cfgId, s);

  const violations: ControlFlowViolation[] = [];
  const cfgsWithBranchViolations = new Set<string>();

  for (const cfg of Object.values(linked.cfgs)) {
    if (cfg.scene === "choicescript_stats") continue;
    const cfgState = statesByCfg.get(cfg.id);
    const cfgVarState = cfgState ? deserializeState(resolveMergedEntry(stateStore, cfgState)) : undefined;
    const before = violations.length;
    checkCfgEdges(cfg, blockIndex, blockStates, cfgVarState, violations);
    if (violations.length > before) cfgsWithBranchViolations.add(cfg.id);
    checkCfgExits(cfg, blockIndex, blockStates, cfgState, stateStore, cfgsWithBranchViolations, violations);
  }

  return violations;
};

export const verifyControlFlow = (
  linked: LinkedCfgs,
  transfers: Map<string, CfgTransfer>,
  dataflowStates: State[],
  stateStore: StateStore,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): ControlFlowViolation[] => {
  const cfgScenes = new Map<string, string>();
  for (const cfg of Object.values(linked.cfgs)) {
    cfgScenes.set(cfg.id, cfg.scene);
  }

  const input: DataflowWalkInput = { transfers, dataflowStates, stateStore, blockIndex, statements, cfgScenes };
  const [blockStates] = runDataflowVisitors<[Map<string, VariableState>]>(
    input, [new VerifyControlFlowPass()],
  );

  return postProcessControlFlow(linked, blockStates, dataflowStates, stateStore, blockIndex);
};

const checkCfgEdges = (
  cfg: Cfg,
  blockIndex: Record<string, CodeBlock>,
  blockStates: Map<string, VariableState>,
  cfgEntryState: VariableState | undefined,
  violations: ControlFlowViolation[],
): void => {
  const seen = new Set<string>();

  for (const edge of cfg.edges) {
    if (edge.kind !== "FallThrough") continue;

    const source = blockIndex[edge.sourceBlockId];
    const target = edge.targetBlockId ? blockIndex[edge.targetBlockId] : undefined;
    if (!source) continue;

    const state = blockStates.get(edge.sourceBlockId) ?? cfgEntryState;
    if (!state) continue;

    if (edge.metadata.implicitControlFlow) {
      if (!isIcfProvablyTrue(state, cfg.scene) && !seen.has(edge.sourceBlockId)) {
        seen.add(edge.sourceBlockId);
        let displayBlockId: string | undefined;
        if (source.statementIds.length === 0) {
          let targetId = edge.sourceBlockId;
          for (let i = 0; i < 5; i++) {
            const pred = cfg.edges.find(e => e.targetBlockId === targetId);
            if (!pred) break;
            const predBlock = blockIndex[pred.sourceBlockId];
            if (predBlock && predBlock.statementIds.length > 0) {
              displayBlockId = pred.sourceBlockId;
              break;
            }
            targetId = pred.sourceBlockId;
          }
        }
        violations.push({
          cfgId: cfg.id,
          blockId: edge.sourceBlockId,
          scene: cfg.scene,
          kind: "choice-fallthrough",
          displayBlockId,
        });
      }
      continue;
    }

    if (source.entryType === "ConditionalBody"
      && source.exitType === "FallThrough"
      && target?.entryType === "Continuation"
      && !seen.has(edge.sourceBlockId)
    ) {
      if (!isIcfProvablyTrue(state, cfg.scene)) {
        seen.add(edge.sourceBlockId);
        violations.push({
          cfgId: cfg.id,
          blockId: edge.sourceBlockId,
          scene: cfg.scene,
          kind: "branch-fallthrough",
        });
      }
    }
  }
};

const checkCfgExits = (
  cfg: Cfg,
  blockIndex: Record<string, CodeBlock>,
  blockStates: Map<string, VariableState>,
  cfgState: State | undefined,
  stateStore: StateStore,
  cfgsWithBranchViolations: Set<string>,
  violations: ControlFlowViolation[],
): void => {
  if (cfgsWithBranchViolations.has(cfg.id)) return;
  for (const exit of cfg.exits) {
    if (exit.kind !== "SceneExit") continue;

    const block = blockIndex[exit.blockId];
    if (!block || block.exitType !== "ImplicitEnd") continue;

    const state = blockStates.get(exit.blockId)
      ?? (cfgState ? deserializeState(resolveMergedExit(stateStore, cfgState)) : undefined);
    if (!state) continue;

    if (!isIcfProvablyTrue(state, cfg.scene)) {
      violations.push({
        cfgId: cfg.id,
        blockId: exit.blockId,
        scene: cfg.scene,
        kind: "implicit-end",
      });
    }
  }
};
