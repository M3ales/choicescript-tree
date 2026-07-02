import { ProseSegmentStatement } from "../../parser/statements/parsed-prose-segment";
import { ProseStatement } from "../../parser/statements/prose";
import { ChoiceOptionStatement } from "../../parser/statements/choice-option";
import { Expression } from "../../parser/expressions";
import { VarMap } from "./page-model";
import type { VarSlot } from "./generate-html";

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const convertBBCode = (html: string): string =>
  html.replace(/\[i\]/g, "<em>").replace(/\[\/i\]/g, "</em>")
    .replace(/\[b\]/g, "<strong>").replace(/\[\/b\]/g, "</strong>");

const extractSimpleVarName = (expr: Expression): string | null => {
  const e = expr as any;
  if (e.kind === "Identifier" && e.token) {
    return (e.token.value ?? e.token.content ?? "").toLowerCase();
  }
  return null;
};

export const expressionToJs = (expr: Expression, varMap: VarMap): string => {
  if (!expr) return "true";
  const e = expr as any;
  switch (e.kind) {
    case "Identifier": {
      const name = (e.token?.value ?? e.token?.content ?? "").toLowerCase();
      const key = varMap.nameToKey.get(name) ?? name;
      return `S[${JSON.stringify(key)}]`;
    }
    case "Literal": {
      const val = e.value?.value;
      return JSON.stringify(val);
    }
    case "Binary": {
      const l = expressionToJs(e.left, varMap);
      const r = expressionToJs(e.right, varMap);
      const op = e.operator?.type ?? "";
      if (op === "And" || op === "and") return `(${l}&&${r})`;
      if (op === "Or" || op === "or") return `(${l}||${r})`;
      if (op === "Equal" || op === "=") return `(${l}==${r})`;
      if (op === "NotEqual" || op === "!=") return `(${l}!=${r})`;
      if (op === "GreaterThan" || op === ">") return `(${l}>${r})`;
      if (op === "LessThan" || op === "<") return `(${l}<${r})`;
      if (op === "GreaterThanOrEqual" || op === ">=") return `(${l}>=${r})`;
      if (op === "LessThanOrEqual" || op === "<=") return `(${l}<=${r})`;
      if (op === "Plus" || op === "+") return `((parseFloat(${l})||0)+(parseFloat(${r})||0))`;
      if (op === "Minus" || op === "-") return `((parseFloat(${l})||0)-(parseFloat(${r})||0))`;
      if (op === "Modulo" || op === "modulo" || op === "%") return `((parseFloat(${l})||0)%(parseFloat(${r})||0))`;
      if (op === "Multiply" || op === "*") return `((parseFloat(${l})||0)*(parseFloat(${r})||0))`;
      if (op === "Divide" || op === "/") return `((parseFloat(${r})||0)!==0?(parseFloat(${l})||0)/(parseFloat(${r})||0):0)`;
      if (op === "Concatenate" || op === "&") return `(String(${l})+String(${r}))`;
      return `(${l}==${r})`;
    }
    case "Unary":
      return `(!(${expressionToJs(e.value ?? e.expression, varMap)}))`;
    case "Invert":
      return `(!(${expressionToJs(e.value ?? e.expression, varMap)}))`;
    case "Grouping":
      return `(${expressionToJs(e.expression ?? e.value, varMap)})`;
    default:
      if (!expr) return "true";
      return "true";
  }
};

interface RenderCtx {
  nextId: number;
  dbgAttr?: (name: string) => string;
}

interface ProseRenderResult {
  html: string;
  varSlots: VarSlot[];
}

const renderSegments = (
  segments: ProseSegmentStatement[],
  varMap: VarMap,
  ctx: RenderCtx,
): ProseRenderResult => {
  const parts: string[] = [];
  const varSlots: VarSlot[] = [];

  for (const seg of segments) {
    switch (seg.kind) {
      case "Text":
        parts.push(convertBBCode(escapeHtml(seg.text)));
        break;
      case "Print":
      case "PrintCapitaliseFirst":
      case "PrintCapitaliseAll": {
        const varName = extractSimpleVarName(seg.expression);
        if (varName) {
          const key = varMap.nameToKey.get(varName) ?? varName;
          const id = `v${ctx.nextId++}`;
          const transform = seg.kind === "PrintCapitaliseFirst" ? "cap-first"
            : seg.kind === "PrintCapitaliseAll" ? "cap-all"
            : null;
          const dbg = ctx.dbgAttr?.(varName) ?? "";
          parts.push(`<span id="${id}"${dbg}>\${${escapeHtml(varName)}}</span>`);
          varSlots.push({ id, key, name: varName, transform });
        } else {
          parts.push(`\${${escapeHtml(serializeExpression(seg.expression))}}`);
        }
        break;
      }
      case "MultiReplace": {
        const selectorName = extractSimpleVarName(seg.selector);
        const key = selectorName ? (varMap.nameToKey.get(selectorName) ?? selectorName) : null;
        const mrDbg = selectorName ? (ctx.dbgAttr?.(selectorName) ?? "") : "";
        const mrId = `mr${ctx.nextId++}`;
        const altIds: string[] = [];
        const altParts: string[] = [];

        for (let i = 0; i < seg.alternatives.length; i++) {
          const altId = `${mrId}_${i}`;
          altIds.push(altId);
          const inner = renderSegments(seg.alternatives[i].segments, varMap, ctx);
          varSlots.push(...inner.varSlots);
          altParts.push(`<span id="${altId}" style="display:none" aria-hidden="true">${inner.html}</span>`);
        }

        parts.push(`<span id="${mrId}"${mrDbg}>${altParts.join("")}</span>`);

        // Generate JS to pick correct alt
        if (key) {
          const valExpr = `S[${JSON.stringify(key)}]`;
          const lines: string[] = [];
          lines.push(`(function(){var v=${valExpr},idx=0;`);
          lines.push(`if(v===true||v==="true")idx=0;else if(v===false||v==="false")idx=1;else{var n=parseInt(v,10);if(!isNaN(n))idx=n;}`);
          lines.push(`idx=Math.max(0,Math.min(idx,${altIds.length - 1}));`);
          for (let i = 0; i < altIds.length; i++) {
            lines.push(`if(idx===${i})show("${altIds[i]}");`);
          }
          lines.push(`})();`);
          // Store as a var slot so the caller can add it
          // Actually we need to push to jsLines, but we return varSlots...
          // Use a special marker
          varSlots.push({ id: `__mr_${mrId}`, key: lines.join(""), name: "", transform: "__multiReplace" });
        } else {
          // Show all with separator
          for (const altId of altIds) {
            varSlots.push({ id: `__show_${altId}`, key: `show("${altId}");`, name: "", transform: "__multiReplace" });
          }
        }
        break;
      }
    }
  }

  return { html: parts.join(""), varSlots };
};

const serializeExpression = (expr: Expression): string => {
  const e = expr as any;
  switch (e.kind) {
    case "Identifier":
      return e.token?.value ?? e.token?.content ?? "?";
    case "Literal":
      return String(e.value?.value ?? "?");
    case "Binary":
      return `${serializeExpression(e.left)} ${e.operator?.type ?? "?"} ${serializeExpression(e.right)}`;
    case "Grouping":
      return `(${serializeExpression(e.expression)})`;
    default:
      return "?";
  }
};

export const renderProseStatement = (
  stmt: ProseStatement,
  varMap: VarMap,
  ctx: RenderCtx,
): ProseRenderResult => {
  if (stmt.parsedSegments && stmt.parsedSegments.length > 0) {
    return renderSegments(stmt.parsedSegments, varMap, ctx);
  }
  const html = stmt.content.map(t => convertBBCode(escapeHtml((t as any).content ?? ""))).join("");
  return { html, varSlots: [] };
};

export const renderOptionLabel = (
  stmt: ChoiceOptionStatement,
  varMap: VarMap,
  ctx: RenderCtx,
): ProseRenderResult => {
  if (stmt.parsedSegments && stmt.parsedSegments.length > 0) {
    return renderSegments(stmt.parsedSegments, varMap, ctx);
  }
  return { html: convertBBCode(escapeHtml(stmt.token.rawText ?? "???")), varSlots: [] };
};
