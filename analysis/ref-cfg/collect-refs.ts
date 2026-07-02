import { Statement } from "../../parser/statements";
import { Expression } from "../../parser/expressions";
import { extractVariableReads } from "../dataflow/evaluate-expression";

export const collectRefsFromStatement = (stmt: Statement): string[] => {
  const exprs = extractExpressions(stmt);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const expr of exprs) {
    for (const v of extractVariableReads(expr)) {
      if (!seen.has(v)) {
        seen.add(v);
        result.push(v);
      }
    }
  }
  return result;
};

const walkSegments = (segments: any[], push: (e: any) => void): void => {
  for (const seg of segments) {
    push(seg.expression);
    push(seg.selector);
    if (seg.alternatives) {
      for (const alt of seg.alternatives) {
        if (alt.segments) walkSegments(alt.segments, push);
      }
    }
  }
};

export const extractExpressions = (stmt: Statement): Expression[] => {
  const s = stmt as any;
  const exprs: Expression[] = [];
  const push = (e: any) => { if (e) exprs.push(e); };

  switch (stmt.kind) {
    case "SetVariable":
      push(s.expression);
      push(s.assignment);
      break;
    case "DeclareVariable":
      push(s.expression);
      break;
    case "If":
    case "ElseIf":
    case "SelectableIf":
    case "Expression":
      push(s.expression);
      break;
    case "ChoiceOption":
      push(s.selectableIf);
      if (s.parsedSegments) walkSegments(s.parsedSegments, push);
      break;
    case "GenerateRandom":
      push(s.min);
      push(s.max);
      break;
    case "InputNumber":
      push(s.min);
      push(s.max);
      break;
    case "Round":
    case "Length":
      push(s.expression);
      break;
    case "GoSub":
    case "GoSubScene":
      if (s.label && typeof s.label === "object" && !s.label.type) push(s.label);
      if (s.args) for (const a of s.args) push(a);
      break;
    case "GotoLabel":
    case "GotoScene":
      if (s.label && typeof s.label === "object" && !s.label.type) push(s.label);
      break;
    case "Prose":
      if (s.parsedSegments) walkSegments(s.parsedSegments, push);
      break;
    default:
      if (s.expression) push(s.expression);
      if (s.selector) push(s.selector);
      break;
  }

  return exprs;
};
