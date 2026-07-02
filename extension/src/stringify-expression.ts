import {
  Expression,
  Binary,
  Unary,
  Grouping,
  Identifier,
  Literal,
  Dereference,
} from "../../parser/expressions";

export function stringifyExpression(expr: Expression): string {
  switch (expr.kind) {
    case "Literal": return formatLiteral((expr as Literal).value.value);
    case "Identifier": return (expr as Identifier).token.value;
    case "Binary": {
      const b = expr as Binary;
      const op = (b.operator as any).rawValue ?? "?";
      return `${stringifyExpression(b.left)} ${op} ${stringifyExpression(b.right)}`;
    }
    case "Unary": {
      const u = expr as Unary;
      return `${u.operator.rawValue} ${stringifyExpression(u.value)}`;
    }
    case "Grouping": return `(${stringifyExpression((expr as Grouping).expression)})`;
    case "Dereference": return `{${stringifyExpression((expr as Dereference).expression)}}`;
    default: return "(expr)";
  }
}

export function formatLiteral(v: string | number | boolean): string {
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}
