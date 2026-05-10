import { Expression } from "../../parser/expressions";
import {
  AbstractValue,
  narrowToValue,
  excludeValue,
  narrowToRange,
  top,
} from "./abstract-value";
import { evaluateExpression } from "./evaluate-expression";
import {
  VariableState,
  cloneState,
  getVariable,
  updateVariable,
} from "./variable-state";

export const narrowState = (
  state: VariableState,
  condition: Expression,
  branchTaken: boolean,
  scene: string
): VariableState => {
  if (!condition) return state;
  return applyNarrowing(state, condition, branchTaken, scene);
};

const isBinary = (expr: any): boolean =>
  expr && expr.left && expr.operator && expr.right;

const isUnary = (expr: any): boolean =>
  expr && expr.operator && expr.value && !expr.left;

const isIdentifier = (expr: any): boolean =>
  expr && expr.token && expr.token.type === "Identifier";

const isGrouping = (expr: any): boolean =>
  expr && expr.expression && !expr.identifier && !expr.operator && !expr.left;

const applyNarrowing = (
  state: VariableState,
  expr: any,
  taken: boolean,
  scene: string
): VariableState => {
  if (!expr) return state;

  if (isBinary(expr)) {
    return narrowBinary(state, expr, taken, scene);
  }

  if (isUnary(expr) && expr.operator?.type === "NotOperator") {
    return applyNarrowing(state, expr.value, !taken, scene);
  }

  if (isGrouping(expr)) {
    return applyNarrowing(state, expr.expression, taken, scene);
  }

  return state;
};

const narrowBinary = (
  state: VariableState,
  expr: any,
  taken: boolean,
  scene: string
): VariableState => {
  const opType = expr.operator?.type;
  if (!opType) return state;

  if (opType === "LogicalAnd") {
    if (taken) {
      let narrowed = applyNarrowing(state, expr.left, true, scene);
      return applyNarrowing(narrowed, expr.right, true, scene);
    } else {
      return state;
    }
  }

  if (opType === "LogicalOr") {
    if (!taken) {
      let narrowed = applyNarrowing(state, expr.left, false, scene);
      return applyNarrowing(narrowed, expr.right, false, scene);
    } else {
      return state;
    }
  }

  return narrowComparison(state, expr, opType, taken, scene);
};

const narrowComparison = (
  state: VariableState,
  expr: any,
  opType: string,
  taken: boolean,
  scene: string
): VariableState => {
  const leftIsVar = isIdentifier(expr.left);
  const rightIsVar = isIdentifier(expr.right);

  if (leftIsVar) {
    const varName = expr.left.token?.value;
    if (!varName) return state;
    const rightVal = evaluateExpression(expr.right, state, scene);
    return narrowVariable(state, varName, rightVal, opType, taken, scene);
  }

  if (rightIsVar) {
    const varName = expr.right.token?.value;
    if (!varName) return state;
    const leftVal = evaluateExpression(expr.left, state, scene);
    const flippedOp = flipOperator(opType);
    if (!flippedOp) return state;
    return narrowVariable(state, varName, leftVal, flippedOp, taken, scene);
  }

  return state;
};

const narrowVariable = (
  state: VariableState,
  varName: string,
  compareValue: AbstractValue,
  opType: string,
  taken: boolean,
  scene: string
): VariableState => {
  if (compareValue.kind !== "constant") return state;

  const currentVal = getVariable(state, varName, scene);
  let narrowed: AbstractValue;

  const effectiveOp = taken ? opType : negateOperator(opType);

  switch (effectiveOp) {
    case "EqualityOperator":
      narrowed = narrowToValue(currentVal, compareValue.value);
      break;
    case "NotEqualityOperator":
      narrowed = excludeValue(currentVal, compareValue.value);
      break;
    case "GreaterThanOperator":
      if (typeof compareValue.value === "number") {
        narrowed = narrowToRange(currentVal, compareValue.value + 1, Infinity);
      } else {
        return state;
      }
      break;
    case "LessThanOperator":
      if (typeof compareValue.value === "number") {
        narrowed = narrowToRange(currentVal, -Infinity, compareValue.value - 1);
      } else {
        return state;
      }
      break;
    case "GreaterThanEqualsOperator":
      if (typeof compareValue.value === "number") {
        narrowed = narrowToRange(currentVal, compareValue.value, Infinity);
      } else {
        return state;
      }
      break;
    case "LessThanEqualsOperator":
      if (typeof compareValue.value === "number") {
        narrowed = narrowToRange(currentVal, -Infinity, compareValue.value);
      } else {
        return state;
      }
      break;
    default:
      return state;
  }

  return updateVariable(state, varName, narrowed, scene);
};

const negateOperator = (opType: string): string => {
  switch (opType) {
    case "EqualityOperator": return "NotEqualityOperator";
    case "NotEqualityOperator": return "EqualityOperator";
    case "GreaterThanOperator": return "LessThanEqualsOperator";
    case "LessThanOperator": return "GreaterThanEqualsOperator";
    case "GreaterThanEqualsOperator": return "LessThanOperator";
    case "LessThanEqualsOperator": return "GreaterThanOperator";
    default: return opType;
  }
};

const flipOperator = (opType: string): string | null => {
  switch (opType) {
    case "EqualityOperator": return "EqualityOperator";
    case "NotEqualityOperator": return "NotEqualityOperator";
    case "GreaterThanOperator": return "LessThanOperator";
    case "LessThanOperator": return "GreaterThanOperator";
    case "GreaterThanEqualsOperator": return "LessThanEqualsOperator";
    case "LessThanEqualsOperator": return "GreaterThanEqualsOperator";
    default: return null;
  }
};
