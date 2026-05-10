import { Statement } from "../../parser/statements";
import { Expression } from "../../parser/expressions";

export interface StatementEffect {
  defines?: {
    variable: string;
    scope: "Global" | "Temporary";
    valueExpression: Expression | null;
    isCompoundAssignment: boolean;
    compoundExpression?: Expression;
  };
}

export const extractEffect = (stmt: Statement): StatementEffect => {
  switch (stmt.kind) {
    case "DeclareVariable":
      return extractDeclareVariable(stmt as any);
    case "SetVariable":
      return extractSetVariable(stmt as any);
    case "GenerateRandom":
      return extractGenerateRandom(stmt as any);
    case "InputText":
      return extractInputText(stmt as any);
    case "InputNumber":
      return extractInputNumber(stmt as any);
    default:
      return {};
  }
};

const extractDeclareVariable = (stmt: any): StatementEffect => {
  const name = stmt.variable?.value;
  if (!name) return {};
  return {
    defines: {
      variable: name,
      scope: stmt.scope ?? "Global",
      valueExpression: stmt.expression ?? null,
      isCompoundAssignment: false,
    },
  };
};

const extractSetVariable = (stmt: any): StatementEffect => {
  if (stmt.assignment) {
    const name = extractIdentifierName(stmt.expression);
    if (!name) return {};
    return {
      defines: {
        variable: name,
        scope: "Global",
        valueExpression: stmt.assignment,
        isCompoundAssignment: false,
      },
    };
  } else {
    const name = extractIdentifierFromBinaryLeft(stmt.expression);
    if (!name) return {};
    return {
      defines: {
        variable: name,
        scope: "Global",
        valueExpression: null,
        isCompoundAssignment: true,
        compoundExpression: stmt.expression,
      },
    };
  }
};

const extractGenerateRandom = (stmt: any): StatementEffect => {
  const name = stmt.identifier?.value;
  if (!name) return {};
  return {
    defines: {
      variable: name,
      scope: "Global",
      valueExpression: null,
      isCompoundAssignment: false,
    },
  };
};

const extractInputText = (stmt: any): StatementEffect => {
  const name = stmt.storeInto?.value;
  if (!name) return {};
  return {
    defines: {
      variable: name,
      scope: "Global",
      valueExpression: null,
      isCompoundAssignment: false,
    },
  };
};

const extractInputNumber = (stmt: any): StatementEffect => {
  const name = stmt.storeInto?.value;
  if (!name) return {};
  return {
    defines: {
      variable: name,
      scope: "Global",
      valueExpression: null,
      isCompoundAssignment: false,
    },
  };
};

const isIdentifier = (expr: any): boolean =>
  expr && expr.token && expr.token.type === "Identifier";

const isBinary = (expr: any): boolean =>
  expr && expr.left && expr.operator && expr.right;

const extractIdentifierName = (expr: any): string | null => {
  if (!expr) return null;
  if (isIdentifier(expr)) return expr.token.value ?? null;
  return null;
};

const extractIdentifierFromBinaryLeft = (expr: any): string | null => {
  if (!expr || !isBinary(expr)) return null;
  return extractIdentifierName(expr.left);
};
