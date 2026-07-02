import { CfgTransfer, Guard } from "../cfg-transfer";
import { CodeBlock } from "../../control-flow-graph/data/code-block";
import { Statement } from "../../../parser/statements";
import { State, StateStore, resolveStates, EntryProvenance } from "../dataflow";
import { VariableState, cloneState, joinStatesMut, materialize, getVariable, isTempVariable, setVariableMut, updateVariableMut } from "../../dataflow/variable-state";
import { AbstractValue, top, bottom } from "../../dataflow/abstract-value";
import { evaluateExpression } from "../../dataflow/evaluate-expression";
import { extractEffect } from "../../dataflow/extract-definitions";
import { isConditionalBranch, isChoiceOptionEdge } from "../../control-flow-graph/data/transition-kind";
import { narrowStateByGuard, narrowStateByGuardNegation } from "../narrow-guard";

export interface DataflowBlockContext {
  cfgId: string;
  scene: string;
  blockId: string;
  block: CodeBlock;
  guards: Guard[];
  state: VariableState;
  dead: boolean;
  deadReason?: "condition-false" | "condition-true-elsewhere" | "selectable-if-false";
  deadConditionStatementId?: string;
  provenance?: EntryProvenance[];
}

export interface DataflowVisitor<T> {
  onBlock(ctx: DataflowBlockContext): void;
  finish(): T;
}

export interface DataflowWalkInput {
  transfers: Map<string, CfgTransfer>;
  dataflowStates: State[];
  stateStore: StateStore;
  blockIndex: Record<string, CodeBlock>;
  statements: Record<string, Statement>;
  cfgScenes: Map<string, string>;
}

export const runDataflowVisitors = <T extends unknown[]>(
  input: DataflowWalkInput,
  visitors: { [K in keyof T]: DataflowVisitor<T[K]> },
): T => {
  const statesByCfg = new Map<string, State[]>();
  for (const s of input.dataflowStates) {
    const list = statesByCfg.get(s.cfgId);
    if (list) list.push(s);
    else statesByCfg.set(s.cfgId, [s]);
  }

  for (const [cfgId, transfer] of input.transfers) {
    const dfStates = statesByCfg.get(cfgId);
    if (!dfStates) continue;

    const scene = input.cfgScenes.get(cfgId);
    if (!scene) continue;

    for (const dfState of dfStates) {
      const entries = resolveStates(input.stateStore, dfState.entryIds);
      for (let ei = 0; ei < entries.length; ei++) {
        const entryState = deserializeState(entries[ei]);
        const provenance = dfState.entryProvenance?.[ei];
        walkTransfer(cfgId, scene, transfer, entryState, input.blockIndex, input.statements, visitors, provenance);
      }
    }
  }

  return visitors.map(v => v.finish()) as unknown as T;
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

const walkTransfer = (
  cfgId: string,
  scene: string,
  transfer: CfgTransfer,
  entryState: VariableState,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  visitors: DataflowVisitor<unknown>[],
  provenance?: EntryProvenance[],
): void => {
  const deadBlocks = new Set<string>();
  let state = cloneState(entryState);

  for (const ge of transfer.effects) {
    const block = blockIndex[ge.blockId];
    if (!block) continue;

    const isDead = isBlockDead(ge.blockId, ge.guards, deadBlocks);

    if (isDead) {
      deadBlocks.add(ge.blockId);
      const ctx: DataflowBlockContext = {
        cfgId, scene, blockId: ge.blockId, block, guards: ge.guards, state, dead: true, provenance,
      };
      for (const v of visitors) v.onBlock(ctx);
      continue;
    }

    let deadReason: DataflowBlockContext["deadReason"];
    let deadConditionStatementId: string | undefined;

    if (ge.guards.length > 0) {
      const lastGuard = ge.guards[ge.guards.length - 1];

      if (isConditionalBranch(lastGuard.edgeKind) || isChoiceOptionEdge(lastGuard.edgeKind)) {
        const condValue = evaluateGuardCondition(lastGuard, state, scene, statements);

        if (condValue && isProvablyFalse(condValue)) {
          deadBlocks.add(ge.blockId);
          deadReason = lastGuard.metadata.choiceConditionKind === "selectable_if"
            ? "selectable-if-false"
            : "condition-false";
          deadConditionStatementId = lastGuard.metadata.conditionStatementId
            ?? lastGuard.metadata.choiceConditionId;

          const ctx: DataflowBlockContext = {
            cfgId, scene, blockId: ge.blockId, block, guards: ge.guards, state,
            dead: true, deadReason, deadConditionStatementId, provenance,
          };
          for (const v of visitors) v.onBlock(ctx);
          continue;
        }


        if (lastGuard.edgeKind === "ElseBranch" || lastGuard.edgeKind === "IfFallThrough") {
          const allPriorTrue = checkAllPriorBranchesTrue(
            ge.guards, lastGuard, state, scene, statements,
          );
          if (allPriorTrue) {
            deadBlocks.add(ge.blockId);
            const ctx: DataflowBlockContext = {
              cfgId, scene, blockId: ge.blockId, block, guards: ge.guards, state,
              dead: true,
              deadReason: "condition-true-elsewhere",
              deadConditionStatementId: lastGuard.metadata.conditionStatementId,
              provenance,
            };
            for (const v of visitors) v.onBlock(ctx);
            continue;
          }
        }
      }
    }

    let blockState = state;
    if (ge.guards.length > 0) {
      const lastGuard = ge.guards[ge.guards.length - 1];
      if (lastGuard.edgeKind === "IfBranch" || lastGuard.edgeKind === "ElseIfBranch"
          || lastGuard.edgeKind === "ElseBranch" || lastGuard.edgeKind === "IfFallThrough") {
        const narrowed = narrowStateByGuard(lastGuard, state, scene, statements);
        if (narrowed) blockState = narrowed;
      }
    }

    const ctx: DataflowBlockContext = {
      cfgId, scene, blockId: ge.blockId, block, guards: ge.guards, state: blockState, dead: false, provenance,
    };
    for (const v of visitors) v.onBlock(ctx);

    if (ge.guards.length === 0) {
      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (stmt) applyStatementEffect(stmt, state, scene);
      }
    } else {
      const lastGuard = ge.guards[ge.guards.length - 1];
      const narrowed = narrowStateByGuard(lastGuard, state, scene, statements);
      const modified = cloneState(narrowed ?? state);
      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (stmt) applyStatementEffect(stmt, modified, scene);
      }
      const negNarrowed = narrowStateByGuardNegation(lastGuard, state, scene, statements);
      if (negNarrowed) state = negNarrowed;
      joinStatesMut(state, modified);
      state = materialize(state);
    }
  }
};

export const isTruthy = (value: string | number | boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "";
  return true;
};

export const isProvablyFalse = (value: AbstractValue): boolean =>
  value.kind === "constant" && !isTruthy(value.value);

export const isProvablyTrue = (value: AbstractValue): boolean =>
  value.kind === "constant" && isTruthy(value.value);

export const evaluateGuardCondition = (
  guard: Guard,
  state: VariableState,
  scene: string,
  statements: Record<string, Statement>,
): AbstractValue | null => {
  const stmtId = guard.metadata.conditionStatementId
    ?? guard.metadata.choiceConditionId;
  if (!stmtId) return null;

  const stmt = statements[stmtId] as any;
  if (!stmt) return null;

  const expr = stmt.expression ?? stmt.selectableIf;
  if (!expr) return null;

  return evaluateExpression(expr, state, scene);
};

const applyStatementEffect = (
  stmt: Statement,
  state: VariableState,
  scene: string,
): void => {
  if (stmt.kind === "Parameters") {
    const params = stmt as any;
    for (const id of params.identifiers) {
      const existing = getVariable(state, id.value, scene);
      if (existing.kind === "bottom") {
        setVariableMut(state, id.value, top, "Temporary", scene);
      }
    }
    return;
  }

  const effect = extractEffect(stmt);
  if (!effect.defines) return;

  const { variable, scope, valueExpression, isCompoundAssignment, compoundExpression } = effect.defines;

  let value: AbstractValue;
  if (stmt.kind === "InputText" || stmt.kind === "InputNumber") {
    value = { kind: "input" };
  } else if (stmt.kind === "GenerateRandom") {
    const s = stmt as any;
    const minVal = evaluateExpression(s.min, state, scene);
    const maxVal = evaluateExpression(s.max, state, scene);
    if (minVal.kind === "constant" && typeof minVal.value === "number" &&
        maxVal.kind === "constant" && typeof maxVal.value === "number") {
      value = { kind: "range", min: minVal.value, max: maxVal.value };
    } else {
      value = top;
    }
  } else if (isCompoundAssignment && compoundExpression) {
    value = evaluateExpression(compoundExpression, state, scene);
  } else if (valueExpression) {
    value = evaluateExpression(valueExpression, state, scene);
  } else {
    value = scope === "Global" ? { kind: "constant", value: false } : { kind: "constant", value: "" };
  }

  if (scope === "Temporary") {
    setVariableMut(state, variable, value, "Temporary", scene);
  } else {
    updateVariableMut(state, variable, value, scene);
  }
};

const isBlockDead = (
  blockId: string,
  guards: Guard[],
  deadBlocks: Set<string>,
): boolean => {
  for (const guard of guards) {
    if (deadBlocks.has(guard.branchBlockId)) return true;
  }
  return false;
};

const checkAllPriorBranchesTrue = (
  guards: Guard[],
  elseGuard: Guard,
  state: VariableState,
  scene: string,
  statements: Record<string, Statement>,
): boolean => {
  const branchBlock = elseGuard.branchBlockId;

  const siblingGuards = guards.filter(
    g => g.branchBlockId === branchBlock
      && (g.edgeKind === "IfBranch" || g.edgeKind === "ElseIfBranch"),
  );

  if (siblingGuards.length === 0) return false;

  for (const g of siblingGuards) {
    const condValue = evaluateGuardCondition(g, state, scene, statements);
    if (!condValue || !isProvablyTrue(condValue)) return false;
  }

  return true;
};

