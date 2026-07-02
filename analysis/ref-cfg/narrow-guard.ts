import { Guard } from "./cfg-transfer";
import { Statement } from "../../parser/statements";
import { VariableState, cloneState, getVariable, setVariableMut, isTempVariable } from "../dataflow/variable-state";
import { AbstractValue, bottom, top, narrowToValue, set as mkSet } from "../dataflow/abstract-value";
import { evaluateExpression } from "../dataflow/evaluate-expression";
import { invertExpression } from "../../parser/expressions/expression-logic";

export const narrowStateByGuard = (
  guard: Guard,
  state: VariableState,
  scene: string,
  statements: Record<string, Statement>,
): VariableState | null => {
  const stmtId = guard.metadata.conditionStatementId
    ?? guard.metadata.choiceConditionId;
  if (!stmtId) return null;

  const stmt = statements[stmtId] as any;
  if (!stmt) return null;

  let expr: any;
  if (guard.edgeKind === "ElseBranch") {
    expr = stmt.invertedCondition;
  } else if (guard.edgeKind === "ElseIfBranch") {
    expr = stmt.effectiveCondition ?? stmt.expression;
  } else if (guard.edgeKind === "IfFallThrough") {
    const base = stmt.expression;
    expr = base ? invertExpression(base) : null;
  } else {
    expr = stmt.expression ?? stmt.selectableIf;
  }

  if (!expr) return null;
  return narrowStateByExpression(expr, state, scene);
};

export const narrowStateByGuardNegation = (
  guard: Guard,
  state: VariableState,
  scene: string,
  statements: Record<string, Statement>,
): VariableState | null => {
  const stmtId = guard.metadata.conditionStatementId
    ?? guard.metadata.choiceConditionId;
  if (!stmtId) return null;

  const stmt = statements[stmtId] as any;
  if (!stmt) return null;

  let expr: any;
  if (guard.edgeKind === "IfBranch") {
    const base = stmt.expression;
    expr = base ? invertExpression(base) : null;
  } else if (guard.edgeKind === "ElseIfBranch") {
    const base = stmt.effectiveCondition ?? stmt.expression;
    expr = base ? invertExpression(base) : null;
  } else {
    return null;
  }

  if (!expr) return null;
  return narrowStateByExpression(expr, state, scene);
};

const narrowStateByExpression = (
  expr: any,
  state: VariableState,
  scene: string,
): VariableState | null => {
  if (expr.left && expr.operator && expr.right
      && expr.operator.type === "LogicalAnd") {
    let current = state;
    let changed = false;
    const leftResult = narrowStateByExpression(expr.left, current, scene);
    if (leftResult) { current = leftResult; changed = true; }
    const rightResult = narrowStateByExpression(expr.right, current, scene);
    if (rightResult) { current = rightResult; changed = true; }
    return changed ? current : null;
  }

  if (!expr.left || !expr.operator || !expr.right) return null;

  const constraint = decomposeComparison(expr, state, scene);
  if (!constraint) return null;

  const { varName, varValue, threshold, op } = constraint;
  const narrowed = narrowAbstractByOp(varValue, threshold, op);
  if (!narrowed || narrowed === varValue) return null;

  const result = cloneState(state);
  const scope = isTempVariable(state, varName, scene) ? "Temporary" : "Global";
  setVariableMut(result, varName, narrowed, scope, scene);
  return result;
};

interface Constraint {
  varName: string;
  varValue: AbstractValue;
  threshold: number;
  op: ">" | ">=" | "<" | "<=" | "=" | "!=";
}

const decomposeComparison = (
  expr: any,
  state: VariableState,
  scene: string,
): Constraint | null => {
  const opMap: Record<string, ">" | ">=" | "<" | "<=" | "=" | "!="> = {
    GreaterThanOperator: ">",
    GreaterThanEqualsOperator: ">=",
    LessThanOperator: "<",
    LessThanEqualsOperator: "<=",
    EqualityOperator: "=",
    NotEqualityOperator: "!=",
  };
  const op = opMap[expr.operator?.type];
  if (!op) return null;

  const leftVar = soleIdentifierName(expr.left);
  const rightVar = soleIdentifierName(expr.right);

  if (leftVar !== null) {
    const rightVal = evaluateExpression(expr.right, state, scene);
    if (rightVal.kind === "constant" && typeof rightVal.value === "number") {
      return { varName: leftVar, varValue: getVariable(state, leftVar, scene), threshold: rightVal.value, op };
    }
  }

  if (rightVar !== null) {
    const leftVal = evaluateExpression(expr.left, state, scene);
    if (leftVal.kind === "constant" && typeof leftVal.value === "number") {
      const flipped: Record<string, ">" | ">=" | "<" | "<=" | "=" | "!="> = {
        ">": "<", ">=": "<=", "<": ">", "<=": ">=", "=": "=", "!=": "!=",
      };
      return { varName: rightVar, varValue: getVariable(state, rightVar, scene), threshold: leftVal.value, op: flipped[op] };
    }
  }

  return null;
};

const soleIdentifierName = (expr: any): string | null => {
  if (!expr) return null;
  if (expr.token?.type === "Identifier") return expr.token.value;
  if (expr.expression && !expr.left && !expr.right) return soleIdentifierName(expr.expression);
  return null;
};

const narrowAbstractByOp = (
  value: AbstractValue,
  threshold: number,
  op: ">" | ">=" | "<" | "<=" | "=" | "!=",
): AbstractValue | null => {
  switch (op) {
    case "=":
      return narrowToValue(value, threshold);
    case "!=":
      if (value.kind === "constant" && value.value === threshold) return top;
      if (value.kind === "set") {
        const filtered = value.values.filter(v => v !== threshold);
        if (filtered.length === 0) return value.hasUserInput ? { kind: "input" } : top;
        return mkSet(filtered, value.hasUserInput);
      }
      return null;
    case ">":
      return narrowNumeric(value, threshold + 1, Infinity);
    case ">=":
      return narrowNumeric(value, threshold, Infinity);
    case "<":
      return narrowNumeric(value, -Infinity, threshold - 1);
    case "<=":
      return narrowNumeric(value, -Infinity, threshold);
  }
};

const constraintFallback = (min: number, max: number): AbstractValue => {
  if (min === max) return { kind: "constant", value: min };
  return { kind: "range", min, max };
};

const narrowNumeric = (
  value: AbstractValue,
  min: number,
  max: number,
): AbstractValue | null => {
  const fallback = constraintFallback(min, max);
  if (value.kind === "constant") {
    if (typeof value.value !== "number") return null;
    return value.value >= min && value.value <= max ? value : fallback;
  }
  if (value.kind === "set") {
    const filtered = value.values.filter(v =>
      typeof v === "number" && v >= min && v <= max);
    if (filtered.length === 0) return value.hasUserInput ? { kind: "input" } : fallback;
    return mkSet(filtered, value.hasUserInput);
  }
  if (value.kind === "range") {
    const newMin = Math.max(value.min, min);
    const newMax = Math.min(value.max, max === Infinity ? value.max : max);
    if (newMin > newMax) return fallback;
    if (newMin === newMax) return { kind: "constant", value: newMin };
    return { kind: "range", min: newMin, max: newMax };
  }
  return null;
};
