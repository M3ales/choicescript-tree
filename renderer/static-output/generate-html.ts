import { Page, PageContent, PageExit, PageSection, VarMap } from "./page-model";
import { SegmentGraph, VariableEffect } from "../../analysis/segments/data";
import { renderProseStatement, renderOptionLabel, expressionToJs } from "./render-prose";
import { extractEffect } from "../../analysis/dataflow/extract-definitions";
import { Expression } from "../../parser/expressions";
import { StatChartStatement, OpposedPairStat } from "../../parser/statements/stat-chart";
import { ProseValue } from "../../parser/statements/prose-value";
import { AbstractValue } from "../../analysis/dataflow/abstract-value";
import { SerializedVariableState } from "../../analysis/dataflow/variable-state";

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pooledExpressionToJs = (expr: Expression, varMap: VarMap, targetVarName: string): string => {
  const e = expr as any;
  if (e.kind === "Literal" && e.value?.value != null) {
    const pool = varMap.pools.get(targetVarName);
    if (pool) {
      const idx = pool.indexOf(e.value.value);
      if (idx >= 0) {
        const key = varMap.nameToKey.get(targetVarName) ?? targetVarName;
        return `D[${JSON.stringify(key)}].p[${idx}]`;
      }
    }
  }
  if (e.kind === "Identifier") {
    const srcName = (e.token?.value ?? e.token?.content ?? "").toLowerCase();
    const srcKey = varMap.nameToKey.get(srcName) ?? srcName;
    return `S[${JSON.stringify(srcKey)}]`;
  }
  return expressionToJs(expr, varMap);
};

const escapeAttr = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const formatAbstractValue = (av: AbstractValue): string => {
  switch (av.kind) {
    case "constant": return `= ${JSON.stringify(av.value)}`;
    case "set": {
      const vals = av.values.map(v => JSON.stringify(v)).join(", ");
      const suffix = av.hasUserInput ? " + input" : "";
      return `{${vals}${suffix}}`;
    }
    case "range": return `[${av.min}, ${av.max}]`;
    case "input": return "input";
    case "loop": return "loop";
    case "top": return "?";
    case "bottom": return "⊥";
  }
};

export interface RenderContext {
  varMap: VarMap;
  nextId: number;
  jsLines: string[];
  dfState?: SerializedVariableState;
  dbgAttr?: (name: string) => string;
}

const freshId = (ctx: RenderContext, prefix: string): string => {
  return `${prefix}${ctx.nextId++}`;
};

export const renderContentHtml = (content: PageContent[], ctx: RenderContext): string => {
  const parts: string[] = [];
  for (const item of content) {
    switch (item.kind) {
      case "prose": {
        const { html, varSlots } = renderProseStatement(item.statement, ctx.varMap, ctx);
        const paragraphs = html.split(/\n{2,}/);
        for (const para of paragraphs) {
          const trimmed = para.trim();
          if (trimmed) parts.push(`<p>${trimmed}</p>`);
        }
        for (const slot of varSlots) {
          ctx.jsLines.push(genVarSubstitution(slot, ctx));
        }
        break;
      }
      case "line-break":
        break;
      case "effect": {
        const eff = extractEffect(item.statement);
        if (eff.defines) {
          const varName = eff.defines.variable.toLowerCase();
          const key = ctx.varMap.nameToKey.get(varName) ?? varName;
          if (!eff.defines.isCompoundAssignment && eff.defines.valueExpression) {
            const jsVal = pooledExpressionToJs(eff.defines.valueExpression, ctx.varMap, varName);
            ctx.jsLines.push(`S[${JSON.stringify(key)}]=${jsVal};`);
          } else if (eff.defines.isCompoundAssignment && eff.defines.compoundExpression) {
            const ce = eff.defines.compoundExpression as any;
            if (ce.kind === "Binary") {
              const op = ce.operator?.type ?? "";
              const rhsJs = expressionToJs(ce.right, ctx.varMap);
              const cur = `(parseFloat(S[${JSON.stringify(key)}])||0)`;
              const rhs = `(parseFloat(${rhsJs})||0)`;
              let expr: string;
              if (op === "FairPlus" || op === "%+") expr = `${cur}+(100-${cur})*${rhs}/100`;
              else if (op === "FairMinus" || op === "%-") expr = `${cur}-${cur}*${rhs}/100`;
              else if (op === "Plus" || op === "+") expr = `${cur}+${rhs}`;
              else if (op === "Minus" || op === "-") expr = `${cur}-${rhs}`;
              else if (op === "Multiply" || op === "*") expr = `${cur}*${rhs}`;
              else if (op === "Divide" || op === "/") expr = `${rhs}!==0?${cur}/${rhs}:${cur}`;
              else if (op === "Modulo" || op === "%" || op === "modulo") expr = `${rhs}!==0?${cur}%${rhs}:${cur}`;
              else expr = `${cur}+${rhs}`;
              ctx.jsLines.push(`S[${JSON.stringify(key)}]=${expr};`);
            }
          }
        }
        break;
      }
      case "conditional": {
        const condJs = expressionToJs(item.expression, ctx.varMap);
        const ifId = freshId(ctx, "c");
        parts.push(`<div id="${ifId}" style="display:none" aria-hidden="true">`);
        parts.push(renderContentHtml(item.ifBody, ctx));
        parts.push("</div>");

        const branchIds: { id: string; condJs: string }[] = [{ id: ifId, condJs }];
        for (const branch of item.elseIfBranches) {
          const bId = freshId(ctx, "c");
          const bCondJs = expressionToJs(branch.expression, ctx.varMap);
          parts.push(`<div id="${bId}" style="display:none" aria-hidden="true">`);
          parts.push(renderContentHtml(branch.body, ctx));
          parts.push("</div>");
          branchIds.push({ id: bId, condJs: bCondJs });
        }

        let elseId: string | null = null;
        if (item.elseBranch) {
          elseId = freshId(ctx, "c");
          parts.push(`<div id="${elseId}" style="display:none" aria-hidden="true">`);
          parts.push(renderContentHtml(item.elseBranch, ctx));
          parts.push("</div>");
        }

        for (let i = 0; i < branchIds.length; i++) {
          const prefix = i === 0 ? "if" : "}else if";
          ctx.jsLines.push(`${prefix}(${branchIds[i].condJs}){show("${branchIds[i].id}");`);
        }
        if (elseId) {
          ctx.jsLines.push(`}else{show("${elseId}");`);
        }
        ctx.jsLines.push("}");
        break;
      }
      case "stat-chart": {
        parts.push(renderStatChartHtml(item.statement, ctx));
        break;
      }
    }
  }
  return parts.join("\n");
};

const renderProseValue = (pv: ProseValue | undefined): string => {
  if (!pv) return "";
  return escapeHtml(pv.content ?? "");
};

const renderStatChartHtml = (stmt: StatChartStatement, ctx: RenderContext): string => {
  const parts: string[] = [];
  for (const stat of stmt.stats) {
    const varName = (stat.variable?.value ?? "").toLowerCase();
    const key = ctx.varMap.nameToKey.get(varName) ?? varName;
    const label = stat.displayName ? renderProseValue(stat.displayName as any) : varName;

    switch (stat.kind) {
      case "Percent": {
        const barId = freshId(ctx, "bar");
        const valId = freshId(ctx, "bv");
        const dbg = ctx.dbgAttr?.(varName) ?? "";
        parts.push(`<div class="stat-row"><div class="stat-label"${dbg}>${label}</div><div class="stat-bar-wrap"><div id="${barId}" class="stat-bar" style="width:50%"></div></div><span id="${valId}" class="stat-val">50%</span></div>`);
        ctx.jsLines.push(`(function(){var v=parseFloat(S[${JSON.stringify(key)}])||0;v=Math.max(0,Math.min(100,v));document.getElementById("${barId}").style.width=v+"%";document.getElementById("${valId}").textContent=Math.round(v)+"%"})();`);
        break;
      }
      case "OpposedPair": {
        const op = stat as OpposedPairStat;
        const rightLabel = op.opposingDisplayName ? renderProseValue(op.opposingDisplayName as any) : "";
        const barId = freshId(ctx, "bar");
        const valId = freshId(ctx, "bv");
        const dbg = ctx.dbgAttr?.(varName) ?? "";
        parts.push(`<div class="stat-row opposed"><div class="stat-labels"><span${dbg}>${label}</span><span>${rightLabel}</span></div><div class="stat-bar-wrap"><div id="${barId}" class="stat-bar" style="width:50%"></div></div><span id="${valId}" class="stat-val">50%</span></div>`);
        ctx.jsLines.push(`(function(){var v=parseFloat(S[${JSON.stringify(key)}])||0;v=Math.max(0,Math.min(100,v));document.getElementById("${barId}").style.width=v+"%";document.getElementById("${valId}").textContent=Math.round(v)+"%"})();`);
        break;
      }
      case "Text": {
        const tvId = freshId(ctx, "tv");
        const dbg = ctx.dbgAttr?.(varName) ?? "";
        parts.push(`<div class="stat-row text-stat"><span class="stat-label">${label}</span><span id="${tvId}" class="stat-text-val"${dbg}>\${${escapeHtml(varName)}}</span></div>`);
        ctx.jsLines.push(`if(S[${JSON.stringify(key)}]!=null)document.getElementById("${tvId}").textContent=String(S[${JSON.stringify(key)}]);`);
        break;
      }
    }
  }
  return parts.join("\n");
};

export interface VarSlot {
  id: string;
  key: string;
  name: string;
  transform: string | null;
}

export const genVarSubstitution = (slot: VarSlot, _ctx: RenderContext): string => {
  if (slot.transform === "__multiReplace") {
    return slot.key;
  }
  const getter = `S[${JSON.stringify(slot.key)}]`;
  let valExpr: string;
  if (slot.transform === "cap-first") {
    valExpr = `(function(v){v=String(v);return v.charAt(0).toUpperCase()+v.slice(1)})(${getter})`;
  } else if (slot.transform === "cap-all") {
    valExpr = `String(${getter}).toUpperCase()`;
  } else {
    valExpr = `String(${getter})`;
  }
  return `if(S[${JSON.stringify(slot.key)}]!=null)document.getElementById("${slot.id}").textContent=${valExpr};`;
};

const dbgAttrForVar = (name: string, ctx: RenderContext): string => {
  if (!ctx.dfState) return "";
  const av = ctx.dfState.globals[name];
  if (!av) {
    for (const scene of Object.values(ctx.dfState.temps)) {
      if (scene[name]) return ` data-av="${escapeAttr(formatAbstractValue(scene[name]))}"`;
    }
    return "";
  }
  return ` data-av="${escapeAttr(formatAbstractValue(av))}"`;
};

const renderChoiceHtml = (exit: PageExit & { kind: "choice" }, ctx: RenderContext): string => {
  const options = exit.options.map((opt, i) => {
    let label: string;
    if (opt.optionStatement) {
      const result = renderOptionLabel(opt.optionStatement, ctx.varMap, ctx);
      label = result.html;
      for (const slot of result.varSlots) {
        ctx.jsLines.push(genVarSubstitution(slot, ctx));
      }
    } else {
      label = escapeHtml(opt.label);
    }
    const id = freshId(ctx, "opt");

    if (opt.selectableIf) {
      const condJs = expressionToJs(opt.selectableIf, ctx.varMap);
      ctx.jsLines.push(`if(!(${condJs})){var o=document.getElementById("${id}");o.querySelector("input").disabled=true;o.classList.add("disabled");}`);
    }

    return `<label id="${id}" class="choice-option">
  <input type="radio" name="choice" value="${i}" data-target="${escapeAttr(opt.targetPageId)}">
  <span class="choice-label">${label}</span>
</label>`;
  });

  return `<div id="choice-section" class="choice-list">
<form id="choice-form">
${options.join("\n")}
</form>
</div>`;
};

export const renderStateDefs = (varMap: VarMap): string => {
  const entries: string[] = [];
  for (const [key, name] of varMap.keyToName) {
    const def = varMap.defaults.get(name);
    const defVal = def ? JSON.stringify(def.value) : "null";
    const defType = def ? `"${def.type}"` : `"string"`;
    const pool = varMap.pools.get(name);
    let poolStr = "";
    if (pool) {
      poolStr = `,p:${JSON.stringify(pool)}`;
    }
    entries.push(`"${key}":{n:"${escapeAttr(name)}",d:${defVal},t:${defType}${poolStr}}`);
  }
  return `{${entries.join(",")}}`;
};

const INLINE_CSS = `
body{max-width:75ch;margin:0 auto;padding:0 1.5em 1.5em;font-family:Georgia,serif;font-size:1.2em;line-height:1.8;color:#222;background:#fafaf8}
header{padding:0.5em 0;margin-bottom:1em;border-bottom:1px solid #ddd;font-size:0.75em;background:#fafaf8}
header.sticky{position:sticky;top:0;z-index:10}
header a{color:#888;text-decoration:none}
header a:hover{color:#444}
main{padding:1em 0 0}
p{margin:0.8em 0}
.section{display:none}
.section.active{display:block}
.section.faded{opacity:0.35}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.section.fade-in{animation:fadeIn 0.4s ease-in}
.choice-list{margin:1.5em 0}
.choice-option{display:block;margin:0.5em 0;padding:0.5em;border:1px solid #ccc;border-radius:4px;cursor:pointer}
.choice-option:hover{background:#f0f0ea}
.choice-option input[type="radio"]{margin-right:0.5em}
.choice-option.disabled{opacity:0.5;cursor:not-allowed}
.btn-wrap{margin:1.5em 0}
.continue-btn{display:block;width:100%;padding:0.6em 2em;font-size:1em;border:1px solid #888;border-radius:4px;background:#f5f5f0;cursor:pointer}
.continue-btn:hover:not(:disabled){background:#e8e8e0}
.continue-btn:disabled{opacity:0.4;cursor:not-allowed}
.input-prompt{margin:1.5em 0}
.input-prompt label{font-weight:bold;display:block;margin-bottom:0.3em}
.input-field{font-family:inherit;font-size:1em;padding:0.4em 0.6em;border:1px solid #ccc;border-radius:4px;width:100%;box-sizing:border-box}
.terminal{text-align:center;margin:2em 0;font-style:italic;color:#666}
.stat-row{margin:0.6em 0}
.stat-label{font-weight:bold;margin-bottom:0.2em}
.stat-bar-wrap{background:#e0e0d8;border-radius:3px;height:1.2em;overflow:hidden;flex:1}
.stat-bar{background:#6a8f6a;height:100%;border-radius:3px;transition:width 0.3s}
.stat-val{min-width:3em;text-align:right;font-size:0.85em;color:#666}
.stat-row.opposed .stat-labels{display:flex;justify-content:space-between;font-weight:bold;margin-bottom:0.2em}
.stat-row:not(.text-stat){display:flex;align-items:center;gap:0.6em}
.stat-row:not(.text-stat) .stat-label{min-width:8em}
.stat-row.opposed{flex-wrap:wrap}
.stat-row.opposed .stat-labels{width:100%}
.text-stat{display:flex;gap:0.6em}
.stat-text-val{color:#555}
`;

const DECODE_JS = `
var B="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function fb(s){var n=0;for(var i=0;i<s.length;i++)n=n*62+B.indexOf(s[i]);return n}
function tb(n){if(n<62)return B[n];var r="";while(n>0){r=B[n%62]+r;n=Math.floor(n/62)}return r}
var D=window._D;
var S={};
for(var k in D)S[k]=D[k].d;
var sp=(new URLSearchParams(location.search)).get("s")||"";
if(sp){var pp=sp.split("-");for(var i=0;i<pp.length;i++){var dot=pp[i].indexOf(".");if(dot<0)continue;var pk=pp[i].substring(0,dot),pv=pp[i].substring(dot+1);if(D[pk]){if(D[pk].p){var pi=fb(pv);if(pi>=0&&pi<D[pk].p.length&&pv.split("").every(function(c){return B.indexOf(c)>=0})){S[pk]=D[pk].p[pi]}else{S[pk]=decodeURIComponent(pv)}}else if(D[pk].t==="bool")S[pk]=pv==="1";else if(D[pk].t==="number")S[pk]=parseFloat(pv);else S[pk]=decodeURIComponent(pv)}else S[pk]=decodeURIComponent(pv)}}
function show(id){var e=document.getElementById(id);if(e){e.style.display="";e.setAttribute("aria-hidden","false")}}
window.scrollTo(0,0);
`;

const NAV_JS = `
function encS(){var p=[];for(var k in S){if(!D[k])continue;if(S[k]===D[k].d)continue;var v;if(D[k].p){var pi=D[k].p.indexOf(S[k]);if(pi>=0){v=tb(pi)}else{v=encodeURIComponent(String(S[k]))}}else if(D[k].t==="bool")v=S[k]?"1":"0";else if(D[k].t==="number")v=String(S[k]);else v=encodeURIComponent(String(S[k]));p.push(k+"."+v)}return p.join("-")}
function nav(t){var s=encS();var pp=new URLSearchParams(location.search);var rp=pp.get("r")||"";var dbg=pp.get("dbg")||"";var q=[];if(s)q.push("s="+s);if(rp)q.push("r="+rp);if(dbg)q.push("dbg="+dbg);location.href=t+".html"+(q.length?"?"+q.join("&"):"")}
`;

export const generatePageHtml = (
  page: Page,
  segGraph: SegmentGraph,
  varMap: VarMap,
  isStats = false,
  dfState?: SerializedVariableState,
): string => {
  const ctx: RenderContext = { varMap, nextId: 0, jsLines: [], dfState };
  if (dfState) ctx.dbgAttr = (name: string) => dbgAttrForVar(name, ctx);

  // Render all sections, collect HTML, filter empty ones
  const rendered: { html: string; buttonText: string; isLast: boolean }[] = [];
  for (let i = 0; i < page.sections.length; i++) {
    const section = page.sections[i];
    const contentHtml = renderContentHtml(section.content, ctx);
    rendered.push({
      html: contentHtml,
      buttonText: section.buttonText || "Continue",
      isLast: i === page.sections.length - 1,
    });
  }

  const hasVisibleContent = (html: string) => html.replace(/<[^>]*>/g, "").trim().length > 0;
  const visibleSections = rendered.filter(r => hasVisibleContent(r.html));
  if (visibleSections.length === 0 && rendered.length > 0) {
    visibleSections.push(rendered[rendered.length - 1]);
  }

  const hasSections = visibleSections.length > 1;
  const sectionHtmls: string[] = [];

  for (let i = 0; i < visibleSections.length; i++) {
    const sec = visibleSections[i];
    const secId = `sec${i}`;
    const isLast = i === visibleSections.length - 1;

    if (hasSections) {
      const activeClass = i === 0 ? " active" : "";
      let sectionBody = sec.html;
      if (!isLast) {
        sectionBody += `\n<div class="btn-wrap"><button class="continue-btn section-btn" data-sec="${i}">${escapeHtml(sec.buttonText)}</button></div>`;
      }
      sectionHtmls.push(`<div id="${secId}" class="section${activeClass}">\n${sectionBody}\n</div>`);
    } else {
      sectionHtmls.push(sec.html);
    }
  }

  let exitHtml = "";
  let hasChoice = false;
  if (page.exit.kind === "choice") {
    hasChoice = true;
    exitHtml = renderChoiceHtml(page.exit, ctx);
    exitHtml += `\n<div class="btn-wrap"><button id="continue-btn" class="continue-btn" disabled>Continue</button></div>`;
    ctx.jsLines.push(`var _f=document.getElementById("choice-form");`);
    ctx.jsLines.push(`_f.querySelectorAll('input[type="radio"]').forEach(function(r){r.addEventListener("change",function(){document.getElementById("continue-btn").disabled=false})});`);
    ctx.jsLines.push(`document.getElementById("continue-btn").addEventListener("click",function(){`);
    ctx.jsLines.push(`  var s=_f.querySelector('input[type="radio"]:checked');`);
    ctx.jsLines.push(`  if(s)nav(s.getAttribute("data-target"));`);
    ctx.jsLines.push(`});`);
  } else if (page.exit.kind === "input") {
    const inp = page.exit;
    const varKey = ctx.varMap.nameToKey.get(inp.variable) ?? inp.variable;
    const inputId = freshId(ctx, "inp");
    const inputType = inp.inputKind === "number" ? "number" : "text";
    exitHtml = `<div id="input-section" class="input-prompt">
<input id="${inputId}" type="${inputType}" class="input-field" placeholder="Type here...">
<div class="btn-wrap"><button id="input-btn" class="continue-btn">Continue</button></div>
</div>`;
    if (inp.inputKind === "number" && (inp.min || inp.max)) {
      const minJs = inp.min ? expressionToJs(inp.min, ctx.varMap) : "null";
      const maxJs = inp.max ? expressionToJs(inp.max, ctx.varMap) : "null";
      ctx.jsLines.push(`(function(){var el=document.getElementById("${inputId}");var mn=${minJs},mx=${maxJs};if(mn!=null)el.min=mn;if(mx!=null)el.max=mx})();`);
    }
    ctx.jsLines.push(`document.getElementById("input-btn").addEventListener("click",function(){`);
    ctx.jsLines.push(`  var el=document.getElementById("${inputId}");`);
    if (inp.inputKind === "number") {
      ctx.jsLines.push(`  var v=parseFloat(el.value)||0;`);
      if (inp.min || inp.max) {
        const minJs = inp.min ? expressionToJs(inp.min, ctx.varMap) : "null";
        const maxJs = inp.max ? expressionToJs(inp.max, ctx.varMap) : "null";
        ctx.jsLines.push(`  var mn=${minJs},mx=${maxJs};if(mn!=null&&v<mn)v=mn;if(mx!=null&&v>mx)v=mx;`);
      }
      ctx.jsLines.push(`  S[${JSON.stringify(varKey)}]=v;`);
    } else {
      ctx.jsLines.push(`  S[${JSON.stringify(varKey)}]=el.value;`);
    }
    ctx.jsLines.push(`  nav(${JSON.stringify(inp.targetPageId)});`);
    ctx.jsLines.push(`});`);
  } else if (page.exit.kind === "terminal") {
    exitHtml = `<div class="terminal">The End</div>`;
  }

  const hasInput = page.exit.kind === "input";

  if (hasSections) {
    if (hasChoice) {
      ctx.jsLines.push(`document.getElementById("choice-section").style.display="none";`);
      ctx.jsLines.push(`document.getElementById("continue-btn").style.display="none";`);
    }
    if (hasInput) {
      ctx.jsLines.push(`document.getElementById("input-section").style.display="none";`);
    }

    ctx.jsLines.push(`document.querySelectorAll(".section-btn").forEach(function(btn){`);
    ctx.jsLines.push(`  btn.addEventListener("click",function(){`);
    ctx.jsLines.push(`    var idx=parseInt(this.getAttribute("data-sec"));`);
    ctx.jsLines.push(`    this.parentElement.style.display="none";`);
    ctx.jsLines.push(`    document.getElementById("sec"+idx).classList.add("faded");`);
    ctx.jsLines.push(`    var next=document.getElementById("sec"+(idx+1));`);
    ctx.jsLines.push(`    if(next){next.style.display="";next.classList.add("active","fade-in")}`);

    if (hasChoice) {
      ctx.jsLines.push(`    if(idx+1===${visibleSections.length - 1}){`);
      ctx.jsLines.push(`      var cs=document.getElementById("choice-section");cs.style.display="";cs.classList.add("fade-in");`);
      ctx.jsLines.push(`      document.getElementById("continue-btn").style.display="";`);
      ctx.jsLines.push(`    }`);
    }
    if (hasInput) {
      ctx.jsLines.push(`    if(idx+1===${visibleSections.length - 1}){`);
      ctx.jsLines.push(`      document.getElementById("input-section").style.display="";document.getElementById("input-section").classList.add("fade-in");`);
      ctx.jsLines.push(`    }`);
    }

    ctx.jsLines.push(`    next.scrollIntoView({behavior:"smooth"});`);
    ctx.jsLines.push(`  });`);
    ctx.jsLines.push(`});`);
  }

  const stateDefs = renderStateDefs(varMap);
  const pageJs = ctx.jsLines.join("\n");

  const headerClass = isStats ? ` class="sticky"` : "";
  const headerLink = isStats
    ? `<a id="return-link" href="index.html">Return to Game</a>`
    : `<a id="stats-link" href="stats.html">Show Stats</a>`;

  const headerJs = isStats
    ? `var _hp=new URLSearchParams(location.search);var rp=_hp.get("r")||"";var _hd=_hp.get("dbg")||"";var rl=document.getElementById("return-link");if(rp){var s=encS();var hq=[];if(s)hq.push("s="+s);if(_hd)hq.push("dbg="+_hd);rl.href=rp+".html"+(hq.length?"?"+hq.join("&"):"")}else{rl.style.display="none"}`
    : `(function(){var _hp=new URLSearchParams(location.search);var _hd=_hp.get("dbg")||"";var s=encS();var hq=["r=${page.id}"];if(s)hq.push("s="+s);if(_hd)hq.push("dbg="+_hd);document.getElementById("stats-link").href="stats.html?"+hq.join("&")}())`;

  const dbgCss = dfState
    ? `\nbody.dbg [data-av]{position:relative;outline:1px dashed rgba(180,100,0,0.4);outline-offset:1px}
body.dbg [data-av]::after{content:attr(data-av);position:absolute;left:0;top:100%;font-size:0.6em;line-height:1.2;color:#b06000;background:rgba(255,240,210,0.95);padding:0 3px;border-radius:2px;white-space:nowrap;pointer-events:none;z-index:5}`
    : "";

  const dbgJs = dfState
    ? `var _dbg=(new URLSearchParams(location.search)).get("dbg")==="1";if(_dbg)document.body.classList.add("dbg");`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.id)}</title>
<style>${INLINE_CSS}${dbgCss}</style>
</head>
<body>
<header${headerClass}>${headerLink}${dfState ? ' <button id="dbg-btn" style="float:right;font-size:0.75em;padding:2px 8px;cursor:pointer">dbg</button>' : ''}</header>
<main>
${sectionHtmls.join("\n")}
${exitHtml}
</main>
<script>
${dbgJs}
window._D=${stateDefs};
${DECODE_JS}
${pageJs}
${NAV_JS}
${headerJs}
${dfState ? `(function(){var b=document.getElementById("dbg-btn");if(!b)return;b.textContent=_dbg?"dbg ✓":"dbg";b.addEventListener("click",function(){_dbg=!_dbg;document.body.classList.toggle("dbg",_dbg);b.textContent=_dbg?"dbg ✓":"dbg";var u=new URL(location.href);if(_dbg)u.searchParams.set("dbg","1");else u.searchParams.delete("dbg");history.replaceState(null,"",u)})})();` : ''}
</script>
</body>
</html>`;
};

export const generateIndexHtml = (entryPageId: string): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${entryPageId}.html">
<title>Game Start</title>
</head>
<body>
<p>Redirecting to <a href="${entryPageId}.html">start</a>...</p>
</body>
</html>`;
};
