import { Expression } from "./expression";
import { Binary } from "./binary";
import { Unary } from "./unary";
import { Grouping } from "./grouping";
import { Identifier } from "./identifier";
import { Literal } from "./literal";

const COMPARISON_FLIP: Record<string, string> = {
  ">": "<=",
  "<": ">=",
  ">=": "<",
  "<=": ">",
  "=": "!=",
  "!=": "=",
};

const COMPARISON_TYPE: Record<string, string> = {
  ">": "GreaterThanOperator",
  ">=": "GreaterThanEqualsOperator",
  "<": "LessThanOperator",
  "<=": "LessThanEqualsOperator",
  "=": "EqualityOperator",
  "!=": "NotEqualityOperator",
};

const LOGICAL_FLIP: Record<string, string> = {
  and: "or",
  or: "and",
};

const LOGICAL_TYPE: Record<string, string> = {
  and: "LogicalAnd",
  or: "LogicalOr",
};

function syntheticToken(base: any, rawValue: string): any {
  const type = COMPARISON_TYPE[rawValue] ?? LOGICAL_TYPE[rawValue] ?? base.type;
  return { ...base, rawValue, type };
}

function wrapNot(expr: Expression): Unary {
  return {
    kind: "Unary",
    operator: { rawValue: "not", type: "NotOperator" } as any,
    value: expr,
  } as Unary;
}

export function invertExpression(expr: Expression): Expression {
  switch (expr.kind) {
    case "Binary": {
      const b = expr as Binary;
      const raw = (b.operator as any).rawValue as string;

      if (LOGICAL_FLIP[raw]) {
        return {
          kind: "Binary",
          left: invertExpression(b.left),
          right: invertExpression(b.right),
          operator: syntheticToken(b.operator, LOGICAL_FLIP[raw]),
        } as Binary;
      }

      if (COMPARISON_FLIP[raw]) {
        return {
          kind: "Binary",
          left: b.left,
          right: b.right,
          operator: syntheticToken(b.operator, COMPARISON_FLIP[raw]),
        } as Binary;
      }

      return wrapNot(expr);
    }

    case "Unary": {
      const u = expr as Unary;
      if ((u.operator as any).rawValue === "not") {
        return u.value;
      }
      return wrapNot(expr);
    }

    case "Grouping": {
      const g = expr as Grouping;
      return {
        kind: "Grouping",
        expression: invertExpression(g.expression),
      } as Grouping;
    }

    default:
      return wrapNot(expr);
  }
}

export function combineWithAnd(expressions: Expression[]): Expression {
  const simplified = simplifyConjunction(expressions);
  if (simplified.length === 1) return simplified[0];

  return simplified.reduce((left, right) => ({
    kind: "Binary",
    left,
    right,
    operator: { rawValue: "and", type: "LogicalAnd" } as any,
  } as Binary));
}

export function combineWithOr(expressions: Expression[]): Expression {
  if (expressions.length === 1) return expressions[0];

  return expressions.reduce((left, right) => ({
    kind: "Binary",
    left,
    right,
    operator: { rawValue: "or", type: "LogicalOr" } as any,
  } as Binary));
}

interface Bound {
  variable: string;
  op: string;
  value: number;
  index: number;
}

function unwrapGrouping(expr: Expression): Expression {
  while (expr.kind === "Grouping") expr = (expr as Grouping).expression;
  return expr;
}

function extractBound(expr: Expression, index: number): Bound | null {
  const inner = unwrapGrouping(expr);
  if (inner.kind !== "Binary") return null;
  const b = inner as Binary;
  const op = (b.operator as any).rawValue as string;
  if (!["<", "<=", ">", ">="].includes(op)) return null;

  const left = unwrapGrouping(b.left);
  const right = unwrapGrouping(b.right);
  if (left.kind !== "Identifier" || right.kind !== "Literal") return null;

  const val = (right as Literal).value.value;
  if (typeof val !== "number") return null;

  return {
    variable: (left as Identifier).token.value.toLowerCase(),
    op,
    value: val,
    index,
  };
}

function isUpperBound(op: string) { return op === "<" || op === "<="; }
function isLowerBound(op: string) { return op === ">" || op === ">="; }

function subsumes(a: Bound, b: Bound): boolean {
  if (a.variable !== b.variable) return false;

  if (isUpperBound(a.op) && isUpperBound(b.op)) {
    if (a.value < b.value) return true;
    if (a.value === b.value && a.op === "<" && b.op === "<=") return true;
  }

  if (isLowerBound(a.op) && isLowerBound(b.op)) {
    if (a.value > b.value) return true;
    if (a.value === b.value && a.op === ">" && b.op === ">=") return true;
  }

  return false;
}

export function simplifyConjunction(exprs: Expression[]): Expression[] {
  const bounds: Bound[] = [];
  for (let i = 0; i < exprs.length; i++) {
    const b = extractBound(exprs[i], i);
    if (b) bounds.push(b);
  }

  const removed = new Set<number>();
  for (const a of bounds) {
    for (const b of bounds) {
      if (a.index !== b.index && !removed.has(a.index) && subsumes(a, b)) {
        removed.add(b.index);
      }
    }
  }

  if (removed.size === 0) return exprs;
  return exprs.filter((_, i) => !removed.has(i));
}

export function flattenConjunction(expr: Expression): Expression[] {
  const inner = unwrapGrouping(expr);
  if (inner.kind === "Binary") {
    const b = inner as Binary;
    if ((b.operator as any).rawValue === "and") {
      return [...flattenConjunction(b.left), ...flattenConjunction(b.right)];
    }
  }
  return [expr];
}

export function flattenDisjunction(expr: Expression): Expression[] {
  const inner = unwrapGrouping(expr);
  if (inner.kind === "Binary") {
    const b = inner as Binary;
    if ((b.operator as any).rawValue === "or") {
      return [...flattenDisjunction(b.left), ...flattenDisjunction(b.right)];
    }
  }
  return [expr];
}
