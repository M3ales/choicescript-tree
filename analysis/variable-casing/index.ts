import "../../bootstrap";
import {
  DeclareVariableStatement,
  GoSubSceneStatement,
  GoSubStatement,
  GotoLabelStatement,
  GotoSceneStatement,
  LabelStatement,
  SetVariableStatement,
  InputNumberStatement,
  InputTextStatement,
  GenerateRandomStatement,
  StatChartStatement,
  ProseStatement,
  ChoiceOptionStatement,
  Statement,
} from "../../parser/statements";
import { Expression } from "../../parser/expressions";
import { Identifier } from "../../parser/expressions/identifier";
import { Binary } from "../../parser/expressions/binary";
import { Unary } from "../../parser/expressions/unary";
import { Grouping } from "../../parser/expressions/grouping";
import { Dereference } from "../../parser/expressions/derefererence";
import { ArrayIndexer } from "../../parser/expressions/array-indexer";
import {
  PrintParsedProseSegment,
  MultiReplaceParsedProseSegment,
  ProseSegmentStatement,
} from "../../parser/statements/parsed-prose-segment";
import { IdentifierToken } from "../../scanner/tokens";
import { AnalysisError } from "../errors";
import { Visitor, walk } from "../traversal";
import { SceneAstWithSymbolTable } from "../symbol-table/scene-ast-with-symbol-table";
import { tokenPosition } from "../debug";
import { outPath, getIO } from "../../out-dir";

interface CasingIssue {
  token: IdentifierToken;
  kind: "definition" | "reference";
  category: "variable" | "label";
  statement: Statement;
}

const collectIdentifiersFromExpression = (expr: Expression | null | undefined): IdentifierToken[] => {
  if (!expr) return [];
  switch (expr.kind) {
    case "Identifier":
      return [(expr as Identifier).token];
    case "Binary": {
      const bin = expr as Binary;
      return [
        ...collectIdentifiersFromExpression(bin.left),
        ...collectIdentifiersFromExpression(bin.right),
      ];
    }
    case "Unary":
      return collectIdentifiersFromExpression((expr as Unary).value as Expression);
    case "Grouping":
      return collectIdentifiersFromExpression((expr as Grouping).expression);
    case "Dereference":
      return collectIdentifiersFromExpression((expr as Dereference).expression);
    case "ArrayIndexer": {
      const arr = expr as ArrayIndexer;
      return [arr.identifier, ...collectIdentifiersFromExpression(arr.expression)];
    }
    default:
      return [];
  }
};

const collectIdentifiersFromProseSegments = (segments: ProseSegmentStatement[] | undefined): IdentifierToken[] => {
  if (!segments) return [];
  const tokens: IdentifierToken[] = [];
  for (const seg of segments) {
    if (seg.kind === "Print" || seg.kind === "PrintCapitaliseFirst" || seg.kind === "PrintCapitaliseAll") {
      tokens.push(...collectIdentifiersFromExpression((seg as PrintParsedProseSegment).expression));
    } else if (seg.kind === "MultiReplace") {
      const mr = seg as MultiReplaceParsedProseSegment;
      tokens.push(...collectIdentifiersFromExpression(mr.selector));
      for (const alt of mr.alternatives) {
        tokens.push(...collectIdentifiersFromProseSegments(alt.segments));
      }
    }
  }
  return tokens;
};

const checkCasing = (scene: SceneAstWithSymbolTable): SceneAstWithSymbolTable => {
  const issues: CasingIssue[] = [];

  const labelDefinitionVisitor: Visitor = {
    predicate: (stmt) => stmt.kind === "Label",
    visit: (stmt) => {
      const label = stmt as LabelStatement;
      if (label.label.rawValue && label.label.rawValue !== label.label.value) {
        issues.push({ token: label.label, kind: "definition", category: "label", statement: stmt });
      }
    },
  };

  const variableDefinitionVisitor: Visitor = {
    predicate: (stmt) => stmt.kind === "DeclareVariable",
    visit: (stmt) => {
      const decl = stmt as DeclareVariableStatement;
      if (decl.variable.rawValue && decl.variable.rawValue !== decl.variable.value) {
        issues.push({ token: decl.variable, kind: "definition", category: "variable", statement: stmt });
      }
      for (const id of collectIdentifiersFromExpression(decl.expression)) {
        if (id.rawValue && id.rawValue !== id.value) {
          issues.push({ token: id, kind: "reference", category: "variable", statement: stmt });
        }
      }
    },
  };

  const referenceVisitor: Visitor = {
    predicate: (stmt) =>
      stmt.kind === "SetVariable" ||
      stmt.kind === "If" ||
      stmt.kind === "ElseIf" ||
      stmt.kind === "SelectableIf" ||
      stmt.kind === "InputNumber" ||
      stmt.kind === "InputText" ||
      stmt.kind === "GenerateRandom" ||
      stmt.kind === "GotoLabel" ||
      stmt.kind === "GotoScene" ||
      stmt.kind === "GoSub" ||
      stmt.kind === "GoSubScene" ||
      stmt.kind === "StatChart" ||
      stmt.kind === "Prose" ||
      stmt.kind === "ChoiceOption" ||
      stmt.kind === "Expression",
    visit: (stmt) => {
      const addRef = (token: IdentifierToken, category: "variable" | "label") => {
        if (token.rawValue && token.rawValue !== token.value) {
          issues.push({ token, kind: "reference", category, statement: stmt });
        }
      };

      const addExprRefs = (expr: Expression | null | undefined) => {
        for (const id of collectIdentifiersFromExpression(expr)) {
          addRef(id, id.isLabelName ? "label" : "variable");
        }
      };

      switch (stmt.kind) {
        case "SetVariable": {
          const set = stmt as SetVariableStatement;
          addExprRefs(set.expression);
          addExprRefs(set.assignment);
          break;
        }
        case "If":
        case "ElseIf":
        case "SelectableIf":
        case "Expression": {
          addExprRefs((stmt as any).expression);
          break;
        }
        case "InputNumber": {
          const inp = stmt as InputNumberStatement;
          addRef(inp.storeInto, "variable");
          addExprRefs(inp.min);
          addExprRefs(inp.max);
          break;
        }
        case "InputText": {
          addRef((stmt as InputTextStatement).storeInto, "variable");
          break;
        }
        case "GenerateRandom": {
          const gen = stmt as GenerateRandomStatement;
          addRef(gen.identifier, "variable");
          addExprRefs(gen.min);
          addExprRefs(gen.max);
          break;
        }
        case "GotoLabel": {
          const goto = stmt as GotoLabelStatement;
          if (goto.label && "type" in goto.label && goto.label.type === "Identifier") {
            addRef(goto.label as IdentifierToken, "label");
          } else {
            addExprRefs(goto.label as Expression);
          }
          break;
        }
        case "GotoScene": {
          const gotoScene = stmt as GotoSceneStatement;
          if (gotoScene.label && "type" in gotoScene.label && gotoScene.label.type === "Identifier") {
            addRef(gotoScene.label as IdentifierToken, "label");
          } else if (gotoScene.label) {
            addExprRefs(gotoScene.label as Expression);
          }
          break;
        }
        case "GoSub": {
          const gosub = stmt as GoSubStatement;
          if (gosub.label && "type" in gosub.label && gosub.label.type === "Identifier") {
            addRef(gosub.label as IdentifierToken, "label");
          } else {
            addExprRefs(gosub.label as Expression);
          }
          for (const arg of gosub.args) addExprRefs(arg);
          break;
        }
        case "GoSubScene": {
          const gosubScene = stmt as GoSubSceneStatement;
          if (gosubScene.label && "type" in gosubScene.label && (gosubScene.label as any).type === "Identifier") {
            addRef(gosubScene.label as IdentifierToken, "label");
          } else {
            addExprRefs(gosubScene.label as Expression);
          }
          for (const arg of gosubScene.args) addExprRefs(arg);
          break;
        }
        case "StatChart": {
          const chart = stmt as StatChartStatement;
          for (const stat of chart.stats) {
            addRef(stat.variable, "variable");
          }
          break;
        }
        case "Prose": {
          const prose = stmt as ProseStatement;
          for (const id of collectIdentifiersFromProseSegments(prose.parsedSegments)) {
            addRef(id, id.isLabelName ? "label" : "variable");
          }
          break;
        }
        case "ChoiceOption": {
          const option = stmt as ChoiceOptionStatement;
          addExprRefs(option.selectableIf);
          for (const id of collectIdentifiersFromProseSegments(option.parsedSegments)) {
            addRef(id, id.isLabelName ? "label" : "variable");
          }
          break;
        }
      }
    },
  };

  walk(scene.statements, [labelDefinitionVisitor, variableDefinitionVisitor, referenceVisitor]);

  for (const issue of issues) {
    const location = tokenPosition(issue.token);
    if (issue.kind === "definition") {
      scene.symbolTable.errors.push({
        message: `${issue.category === "variable" ? "Variable" : "Label"} '${issue.token.rawValue}' is defined with uppercase characters. Use '${issue.token.value}' instead`,
        statement: issue.statement,
        severity: "Warning",
        solutionCode: 2,
        context: { rawValue: issue.token.rawValue, expected: issue.token.value, location },
      });
    } else {
      scene.symbolTable.errors.push({
        message: `${issue.category === "variable" ? "Variable" : "Label"} reference '${issue.token.rawValue}' has mismatched casing. Use '${issue.token.value}' instead`,
        statement: issue.statement,
        severity: "Warning",
        solutionCode: 2,
        context: { rawValue: issue.token.rawValue, expected: issue.token.value, location },
      });
    }
  }

  return scene;
};

const scenes = JSON.parse(getIO().readFile(outPath('symbol-table.json'))) as SceneAstWithSymbolTable[];
let result = scenes
  .map((scene) => {
    if (scene.symbolTable.errors === undefined) {
      scene.symbolTable.errors = [];
    }
    return scene;
  })
  .map(checkCasing);

getIO().writeFile(outPath("symbol-table.json"), JSON.stringify(result, null, 2));
const allIssues = result.flatMap((r) => r.symbolTable.errors.filter((e) => e.solutionCode === 2));
console.log(`Variable Casing analysis completed for ${result.length} scenes, found ${allIssues.length} casing issues`);
