import { Expression } from "../../parser/expressions";
import { AbstractValue, constant, top, bottom, range, set, join, input } from "./abstract-value";
import { VariableState, getVariable } from "./variable-state";

type ExprType = "Literal" | "Identifier" | "Binary" | "Unary" | "Grouping" | "ArrayIndexer" | "Dereference" | "Unknown";

const classifyExpression = (expr: any): ExprType => {
  if (!expr) return "Unknown";
  // Binary: has left, operator, right
  if (expr.left && expr.operator && expr.right) return "Binary";
  // Literal: has value field that is a token with a literal type
  if (expr.value && typeof expr.value === "object" && !expr.operator) {
    const vtype = expr.value.type;
    if (vtype === "StringLiteral" || vtype === "NumberLiteral" || vtype === "BooleanLiteral") {
      return "Literal";
    }
  }
  // Unary: has operator (unary type) and value but no left/right
  if (expr.operator && expr.value && !expr.left) return "Unary";
  // Identifier: has token field with type "Identifier"
  if (expr.token && expr.token.type === "Identifier") return "Identifier";
  // ArrayIndexer: has identifier and expression
  if (expr.identifier && expr.expression) return "ArrayIndexer";
  // Grouping or Dereference: has expression only
  if (expr.expression && !expr.identifier) return "Grouping";
  return "Unknown";
};

export const evaluateExpression = (
  expr: Expression,
  state: VariableState,
  scene: string
): AbstractValue => {
  if (!expr) return top;

  const type = classifyExpression(expr);

  switch (type) {
    case "Literal":
      return evaluateLiteral(expr);
    case "Identifier":
      return evaluateIdentifier(expr, state, scene);
    case "Binary":
      return evaluateBinary(expr, state, scene);
    case "Unary":
      return evaluateUnary(expr, state, scene);
    case "Grouping":
      return evaluateExpression((expr as any).expression, state, scene);
    case "ArrayIndexer":
      return top;
    case "Dereference":
      return top;
    default:
      return top;
  }
};

const evaluateLiteral = (expr: any): AbstractValue => {
  const token = expr.value;
  if (!token) return top;
  if (token.type === "StringLiteral") return constant(token.value);
  if (token.type === "NumberLiteral") return constant(token.value);
  if (token.type === "BooleanLiteral") return constant(token.value);
  return top;
};

const evaluateIdentifier = (
  expr: any,
  state: VariableState,
  scene: string
): AbstractValue => {
  const name = expr.token?.value;
  if (!name) return top;
  if (name === "choice_randomtest" || name === "choice_quicktest" || name === "choice_randomscene") {
    return top;
  }
  return getVariable(state, name, scene);
};

const evaluateBinary = (
  expr: any,
  state: VariableState,
  scene: string
): AbstractValue => {
  const left = evaluateExpression(expr.left, state, scene);
  const right = evaluateExpression(expr.right, state, scene);
  const opType = expr.operator?.type;

  if (!opType) return top;

  if (opType === "LogicalAnd" || opType === "LogicalOr") {
    return evaluateLogical(left, right, opType);
  }

  if (isComparisonOperator(opType)) {
    return evaluateComparison(left, right, opType);
  }

  return evaluateArithmetic(left, right, opType);
};

const evaluateUnary = (
  expr: any,
  state: VariableState,
  scene: string
): AbstractValue => {
  const opType = expr.operator?.type;
  const operand = evaluateExpression(expr.value, state, scene);

  if (!opType) return top;

  switch (opType) {
    case "NotOperator":
      if (operand.kind === "constant") return constant(!isTruthy(operand.value));
      return top;
    case "RoundOperator":
      if (operand.kind === "constant" && typeof operand.value === "number")
        return constant(Math.round(operand.value));
      if (operand.kind === "range")
        return range(Math.round(operand.min), Math.round(operand.max));
      return top;
    case "LengthOperator":
      if (operand.kind === "constant" && typeof operand.value === "string")
        return constant(operand.value.length);
      return top;
    default:
      return top;
  }
};

const isComparisonOperator = (opType: string): boolean =>
  opType === "EqualityOperator" ||
  opType === "NotEqualityOperator" ||
  opType === "GreaterThanOperator" ||
  opType === "LessThanOperator" ||
  opType === "GreaterThanEqualsOperator" ||
  opType === "LessThanEqualsOperator";

const evaluateComparison = (
  left: AbstractValue,
  right: AbstractValue,
  opType: string
): AbstractValue => {
  if (left.kind !== "constant" || right.kind !== "constant") return top;

  const l = left.value;
  const r = right.value;

  switch (opType) {
    case "EqualityOperator":
      return constant(l === r);
    case "NotEqualityOperator":
      return constant(l !== r);
    case "GreaterThanOperator":
      return constant(l > r);
    case "LessThanOperator":
      return constant(l < r);
    case "GreaterThanEqualsOperator":
      return constant(l >= r);
    case "LessThanEqualsOperator":
      return constant(l <= r);
    default:
      return top;
  }
};

const evaluateLogical = (
  left: AbstractValue,
  right: AbstractValue,
  opType: string
): AbstractValue => {
  if (left.kind === "constant" && right.kind === "constant") {
    const l = isTruthy(left.value);
    const r = isTruthy(right.value);
    if (opType === "LogicalAnd") return constant(l && r);
    if (opType === "LogicalOr") return constant(l || r);
  }
  return top;
};

const isTruthy = (value: string | number | boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "";
  return true;
};

const evaluateArithmetic = (
  left: AbstractValue,
  right: AbstractValue,
  opType: string
): AbstractValue => {
  if (left.kind === "bottom" || right.kind === "bottom") return bottom;

  if (opType === "FairmathAdditionOperator" || opType === "FairmathSubtractionOperator") {
    const isAdd = opType === "FairmathAdditionOperator";
    const baseNums = toNumericValues(left);
    const modNums = toNumericValues(right);
    if (baseNums && modNums) {
      const results = baseNums.flatMap((b) =>
        modNums.map((m) => fairmath(b, m, isAdd))
      );
      const lo = Math.min(...results);
      const hi = Math.max(...results);
      return lo === hi ? constant(lo) : range(lo, hi);
    }
    const baseRange = toRange(left);
    const modRange = toRange(right);
    if (baseRange && modRange) {
      return computeFairmathRange(baseRange, modRange, isAdd);
    }
    return range(0, 100);
  }

  if (left.kind === "constant" && right.kind === "constant") {
    return computeConstant(left.value, right.value, opType);
  }

  if (opType === "ConcatenationOperator" && (left.kind === "range" || right.kind === "range")) {
    const formatRange = (r: { min: number; max: number }) => r.min === r.max ? String(r.min) : `${r.min}-${r.max}`;
    const leftStr = left.kind === "range" ? formatRange(left) : left.kind === "constant" ? String(left.value) : null;
    const rightStr = right.kind === "range" ? formatRange(right) : right.kind === "constant" ? String(right.value) : null;
    if (leftStr !== null && rightStr !== null) return constant(leftStr + rightStr);
  }

  if (opType === "ConcatenationOperator" || opType === "Indexer" || opType === "StringIndexerOperator") {
    const leftVals = toStringValues(left);
    const rightVals = toStringValues(right);
    if (leftVals && rightVals) {
      const hasInput = leftVals.includes(INPUT_SENTINEL) || rightVals.includes(INPUT_SENTINEL);
      if (opType === "ConcatenationOperator") {
        const concreteLeft = leftVals.filter((v) => v !== INPUT_SENTINEL);
        const concreteRight = rightVals.filter((v) => v !== INPUT_SENTINEL);
        const results = concreteLeft.flatMap((l) =>
          concreteRight.map((r) => String(l) + String(r))
        );
        return set(results, hasInput || undefined);
      } else {
        const results: (string | number | boolean)[] = [];
        for (const l of leftVals) {
          if (l === INPUT_SENTINEL) continue;
          for (const r of rightVals) {
            if (r === INPUT_SENTINEL) continue;
            if (typeof l === "string" && typeof r === "number") {
              const idx = r - 1;
              if (idx >= 0 && idx < l.length) results.push(l[idx]);
            }
          }
        }
        return results.length > 0 ? set(results, hasInput || undefined) : (hasInput ? input : top);
      }
    }
  }

  if (isNumericArithmeticOp(opType)) {
    const leftRange = toRange(left);
    const rightRange = toRange(right);
    if (leftRange && rightRange) {
      return computeRange(leftRange, rightRange, opType);
    }
  }

  return top;
};

const isNumericArithmeticOp = (opType: string): boolean =>
  opType === "AdditionOperator" ||
  opType === "SubtractionOperator" ||
  opType === "MultiplicationOperator" ||
  opType === "DivisionOperator" ||
  opType === "ModulusOperator";

const INPUT_SENTINEL = "__USER_INPUT__";

const toStringValues = (av: AbstractValue): (string | number | boolean)[] | null => {
  if (av.kind === "constant") return [av.value];
  if (av.kind === "set") return av.hasUserInput ? [...av.values, INPUT_SENTINEL] : av.values;
  if (av.kind === "input") return [INPUT_SENTINEL];
  return null;
};

const toNumericValues = (av: AbstractValue): number[] | null => {
  if (av.kind === "constant" && typeof av.value === "number") {
    return [av.value];
  }
  if (av.kind === "set" && av.values.every((v) => typeof v === "number")) {
    return av.values as number[];
  }
  return null;
};

const toRange = (
  av: AbstractValue
): { min: number; max: number } | null => {
  if (av.kind === "constant" && typeof av.value === "number") {
    return { min: av.value, max: av.value };
  }
  if (av.kind === "set" && av.values.every((v) => typeof v === "number")) {
    const nums = av.values as number[];
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }
  if (av.kind === "range") return { min: av.min, max: av.max };
  if (av.kind === "top" || av.kind === "input" || av.kind === "loop") return { min: -Infinity, max: Infinity };
  return null;
};

const computeConstant = (
  l: string | number | boolean,
  r: string | number | boolean,
  opType: string
): AbstractValue => {
  if (opType === "ConcatenationOperator") {
    return constant(String(l) + String(r));
  }
  if (opType === "StringIndexerOperator") {
    if (typeof l === "string" && typeof r === "number") {
      const idx = r - 1;
      if (idx >= 0 && idx < l.length) return constant(l[idx]);
    }
    return top;
  }
  if (typeof l !== "number" || typeof r !== "number") return top;

  switch (opType) {
    case "AdditionOperator":
      return constant(l + r);
    case "SubtractionOperator":
      return constant(l - r);
    case "MultiplicationOperator":
      return constant(l * r);
    case "DivisionOperator":
      return r === 0 ? top : constant(Math.floor(l / r));
    case "ModulusOperator":
      return r === 0 ? top : constant(l % r);
    default:
      return top;
  }
};

const computeRange = (
  l: { min: number; max: number },
  r: { min: number; max: number },
  opType: string
): AbstractValue => {
  switch (opType) {
    case "AdditionOperator":
      return range(l.min + r.min, l.max + r.max);
    case "SubtractionOperator":
      return range(l.min - r.max, l.max - r.min);
    case "MultiplicationOperator": {
      const products = [l.min * r.min, l.min * r.max, l.max * r.min, l.max * r.max];
      return range(Math.min(...products), Math.max(...products));
    }
    case "DivisionOperator":
      if (r.min <= 0 && r.max >= 0) return top;
      const divs = [l.min / r.min, l.min / r.max, l.max / r.min, l.max / r.max];
      return range(Math.floor(Math.min(...divs)), Math.floor(Math.max(...divs)));
    case "ModulusOperator":
      if (r.min <= 0 && r.max >= 0) return top;
      return range(0, Math.max(Math.abs(r.min), Math.abs(r.max)) - 1);
    default:
      return top;
  }
};

const computeFairmathRange = (
  base: { min: number; max: number },
  mod: { min: number; max: number },
  isAdd: boolean
): AbstractValue => {
  const bMin = Math.max(0, base.min);
  const bMax = Math.min(100, base.max);
  const mMin = Math.max(0, mod.min);
  const mMax = Math.min(100, mod.max);

  const corners = [
    fairmath(bMin, mMin, isAdd),
    fairmath(bMin, mMax, isAdd),
    fairmath(bMax, mMin, isAdd),
    fairmath(bMax, mMax, isAdd),
  ];

  const lo = Math.max(0, Math.min(...corners));
  const hi = Math.min(100, Math.max(...corners));
  if (lo === hi) return constant(lo);
  return range(lo, hi);
};

const fairmath = (base: number, modifier: number, isAdd: boolean): number => {
  if (isAdd) {
    return Math.round(base + ((100 - base) * modifier) / 100);
  } else {
    return Math.round(base - (base * modifier) / 100);
  }
};

export const extractVariableReads = (expr: Expression): string[] => {
  if (!expr) return [];
  const reads: string[] = [];
  collectReads(expr, reads);
  return reads;
};

const collectReads = (expr: any, reads: string[]): void => {
  if (!expr) return;
  const type = classifyExpression(expr);
  switch (type) {
    case "Identifier":
      if (expr.token?.value) reads.push(expr.token.value);
      break;
    case "Binary":
      collectReads(expr.left, reads);
      collectReads(expr.right, reads);
      break;
    case "Unary":
      collectReads(expr.value, reads);
      break;
    case "Grouping":
      collectReads(expr.expression, reads);
      break;
    case "ArrayIndexer":
      if (expr.identifier?.value) reads.push(expr.identifier.value);
      collectReads(expr.expression, reads);
      break;
  }
};
