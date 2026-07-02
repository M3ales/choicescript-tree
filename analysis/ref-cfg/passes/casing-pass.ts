import {
  Statement,
  DeclareVariableStatement,
  DeclareArrayStatement,
  LabelStatement,
  InputNumberStatement,
  InputTextStatement,
  GenerateRandomStatement,
  StatChartStatement,
  GotoLabelStatement,
  GotoSceneStatement,
  GoSubStatement,
  GoSubSceneStatement,
  ParametersStatement,
} from "../../../parser/statements";
import { Expression } from "../../../parser/expressions";
import { IdentifierToken } from "../../../scanner/tokens";
import { Cfg } from "../data";
import { CfgVisitor, BlockContext } from "../cfg-visitor";
import { extractExpressions } from "../collect-refs";

export interface CasingIssue {
  stmtId: string;
  token: IdentifierToken;
  kind: "definition" | "reference";
  category: "variable" | "label";
}

const collectIdentifierTokens = (expr: Expression): IdentifierToken[] => {
  const tokens: IdentifierToken[] = [];
  const walk = (e: any) => {
    if (!e) return;
    if (e.kind === "Identifier" && e.token) {
      tokens.push(e.token);
      return;
    }
    if (e.left) walk(e.left);
    if (e.right) walk(e.right);
    if (e.value && typeof e.value === "object" && e.operator) walk(e.value);
    if (e.expression) walk(e.expression);
    if (e.identifier && e.kind === "ArrayIndexer") {
      tokens.push(e.identifier);
      walk(e.expression);
      return;
    }
  };
  walk(expr);
  return tokens;
};

const isMiscased = (token: IdentifierToken): boolean =>
  !!token.rawValue && token.rawValue !== token.value;

export class CasingPass implements CfgVisitor<CasingIssue[]> {
  private issues: CasingIssue[] = [];

  onStatement(_ctx: BlockContext, stmtId: string, stmt: Statement): void {
    this.checkDefinitions(stmtId, stmt);
    this.checkReferences(stmtId, stmt);
  }

  finish(_cfg: Cfg): CasingIssue[] {
    return this.issues;
  }

  private addIssue(stmtId: string, token: IdentifierToken, kind: "definition" | "reference", category: "variable" | "label"): void {
    if (isMiscased(token)) {
      this.issues.push({ stmtId, token, kind, category });
    }
  }

  private checkDefinitions(stmtId: string, stmt: Statement): void {
    if (stmt.kind === "Label") {
      this.addIssue(stmtId, (stmt as LabelStatement).label, "definition", "label");
    } else if (stmt.kind === "DeclareVariable") {
      this.addIssue(stmtId, (stmt as DeclareVariableStatement).variable, "definition", "variable");
    } else if (stmt.kind === "DeclareArray") {
      const arr = stmt as DeclareArrayStatement;
      this.addIssue(stmtId, arr.variable, "definition", "variable");
      for (const sub of arr.declarations) {
        this.addIssue(stmtId, sub.variable, "definition", "variable");
      }
    } else if (stmt.kind === "Parameters") {
      for (const id of (stmt as ParametersStatement).identifiers) {
        this.addIssue(stmtId, id, "definition", "variable");
      }
    }
  }

  private checkReferences(stmtId: string, stmt: Statement): void {
    for (const expr of extractExpressions(stmt)) {
      for (const token of collectIdentifierTokens(expr)) {
        this.addIssue(stmtId, token, "reference", token.isLabelName ? "label" : "variable");
      }
    }

    this.checkDirectTokens(stmtId, stmt);
  }

  private checkDirectTokens(stmtId: string, stmt: Statement): void {
    const s = stmt as any;
    switch (stmt.kind) {
      case "InputNumber": {
        const inp = stmt as InputNumberStatement;
        this.addIssue(stmtId, inp.storeInto, "reference", "variable");
        break;
      }
      case "InputText":
        this.addIssue(stmtId, (stmt as InputTextStatement).storeInto, "reference", "variable");
        break;
      case "GenerateRandom":
        this.addIssue(stmtId, (stmt as GenerateRandomStatement).identifier, "reference", "variable");
        break;
      case "GotoLabel":
        this.checkLabelToken(stmtId, (stmt as GotoLabelStatement).label as any);
        break;
      case "GotoScene":
        this.checkLabelToken(stmtId, (stmt as GotoSceneStatement).label as any);
        break;
      case "GoSub":
        this.checkLabelToken(stmtId, (stmt as GoSubStatement).label as any);
        break;
      case "GoSubScene":
        this.checkLabelToken(stmtId, (stmt as GoSubSceneStatement).label as any);
        break;
      case "StatChart": {
        const chart = stmt as StatChartStatement;
        for (const stat of chart.stats) {
          this.addIssue(stmtId, stat.variable, "reference", "variable");
        }
        break;
      }
    }
  }

  private checkLabelToken(stmtId: string, ref: any): void {
    if (ref && "type" in ref && ref.type === "Identifier") {
      this.addIssue(stmtId, ref as IdentifierToken, "reference", "label");
    }
  }
}
