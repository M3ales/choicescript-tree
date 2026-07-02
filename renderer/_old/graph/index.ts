import "../../bootstrap";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { readInlineCfgRefs, readStatements, BlockResolver, sceneOf } from "../../analysis/control-flow-graph/cfg-io";
import { readPathAnalysis, readChoiceMap } from "../../analysis/path-analysis";
import { Transition, isChoiceOptionEdge } from "../../analysis/control-flow-graph/data";
import { ProseStatement } from "../../parser/statements";
import { outPath, getIO } from "../../out-dir";
import type { ChoiceTraceResult, ChoiceTrace, SplitTrace, TraceStep, TraceDest } from "../../analysis/path-analysis";

// --- CLI args ---
const args = process.argv.slice(2);
let scopeScene: string | null = null;
let scopeLabel: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scene" && args[i + 1]) { scopeScene = args[++i]; }
  else if (args[i] === "--label" && args[i + 1]) { scopeLabel = args[++i]; }
}
if (scopeScene) console.log(`Scope: scene=${scopeScene}${scopeLabel ? ` label=${scopeLabel}` : ""}`);

console.log("Loading CFG...");
const cfg = readInlineCfgRefs(outPath("inline-cfg.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));
console.log(`  ${Object.keys(cfg.refs).length} block refs, ${cfg.edges.length} edges`);

console.log("Loading statements...");
const statements = readStatements(outPath("game-statements.ndjson"));

console.log("Loading path analysis...");
const pathAnalysis = readPathAnalysis(outPath("path-analysis.ndjson"));

console.log("Loading choice map...");
const choiceMap = readChoiceMap(getIO().readFile(outPath("choice-map.json")));

const loopAnalysis: { headerId: string }[] = JSON.parse(getIO().readFile(outPath("loop-analysis.json")));
const loopHeaderIds = new Set(loopAnalysis.map((l) => l.headerId));

console.log("Loading choice traces...");
const traceResult: ChoiceTraceResult = JSON.parse(getIO().readFile(outPath("choice-trace.json")));
console.log(`  ${traceResult.choices.length} choice traces, ${traceResult.splits.length} split traces`);

const edgesBySource = new Map<string, Transition[]>();
for (const edge of cfg.edges) {
  const list = edgesBySource.get(edge.sourceBlockId) ?? [];
  list.push(edge);
  edgesBySource.set(edge.sourceBlockId, list);
}

const predsByBlock = new Map<string, string[]>();
for (const edge of cfg.edges) {
  if (!edge.targetBlockId) continue;
  const list = predsByBlock.get(edge.targetBlockId) ?? [];
  list.push(edge.sourceBlockId);
  predsByBlock.set(edge.targetBlockId, list);
}

const choiceBlockIds = new Set<string>();
for (const id of Object.keys(cfg.refs)) {
  const outEdges = edgesBySource.get(id) ?? [];
  if (outEdges.some((e) => isChoiceOptionEdge(e.kind))) {
    choiceBlockIds.add(id);
  }
}

const numByCanonical = choiceMap.numByCanonical;
const hubChoiceIds = new Set([...choiceBlockIds].filter((id) => loopHeaderIds.has(id)));

// --- Graph nodes and edges ---

interface DotNode {
  id: string;
  scene: string;
  label: string;
  shape: string;
  fillcolor: string;
}

interface DotEdge {
  from: string;
  to: string;
  label: string;
  color: string;
  style?: string;
}

const nodes: DotNode[] = [];
const dotEdges: DotEdge[] = [];
let seqId = 0;
const nextId = (prefix: string) => `${prefix}${++seqId}`;

// --- Helpers ---

function formatExpr(expr: any): string {
  if (!expr) return "?";
  switch (expr.kind) {
    case "Literal": return typeof expr.value?.value === "string" ? `"${expr.value.value}"` : String(expr.value?.value);
    case "Identifier": return expr.token?.value ?? "?";
    case "Binary": {
      const op = expr.operator?.rawValue ?? expr.operator?.type ?? "?";
      return `${formatExpr(expr.left)} ${op} ${formatExpr(expr.right)}`;
    }
    case "Unary": return `${expr.operator?.rawValue ?? "?"}(${formatExpr(expr.value)})`;
    case "Grouping":
    case "Dereference": return formatExpr(expr.expression);
    default: return "?";
  }
}

function formatProse(stmt: ProseStatement): string {
  const segs = (stmt as any).parsedSegments as any[] | undefined;
  if (segs) {
    let text = "";
    for (const seg of segs) {
      if (seg.kind === "Text") text += seg.text ?? "";
      else if (seg.kind === "Print" && seg.expression) text += `\${${formatExpr(seg.expression)}}`;
      else text += "…";
    }
    return text;
  }
  let text = "";
  for (const seg of stmt.content ?? []) text += seg.content ?? "";
  return text;
}

function lastWords(blockId: string, n: number): string | null {
  const visited = new Set<string>();
  const queue = [blockId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (id !== blockId && choiceBlockIds.has(id)) continue;
    const block = resolver.get(id, cfg.refs);
    if (!block) continue;
    for (let i = block.statementIds.length - 1; i >= 0; i--) {
      const stmt = statements[block.statementIds[i]];
      if (!stmt) continue;
      if (stmt.kind === "FakeChoice" || stmt.kind === "Choice") continue;
      if (stmt.kind === "LineBreak" || stmt.kind === "PageBreak") continue;
      if (stmt.kind === "Prose") {
        const text = formatProse(stmt as ProseStatement).trim().replace(/\s+/g, " ");
        if (text.length > 0) {
          const words = text.split(" ");
          return "…" + words.slice(-n).join(" ");
        }
      }
      break;
    }
    for (const pred of predsByBlock.get(id) ?? []) {
      if (!visited.has(pred)) queue.push(pred);
    }
  }
  return null;
}

function escDot(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/[{}|]/g, " ");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function destNodeId(dest: TraceDest): string {
  if (dest.kind === "choice") {
    const num = numByCanonical.get(dest.blockId);
    return num !== undefined ? `c${num}` : "DEAD";
  }
  if (dest.kind === "split") {
    const st = splitTraceMap.get(dest.blockId);
    return st ? st.nodeId : "DEAD";
  }
  if (dest.kind === "end") return "END";
  return "DEAD";
}

// --- Build trace chain as graph nodes ---

const condRenderCache = new Map<string, string>();

function renderConditional(step: TraceStep & { kind: "conditional" }, scene: string): string {
  const cacheKey = JSON.stringify({ step, scene });
  const cached = condRenderCache.get(cacheKey);
  if (cached) return cached;

  const condId = nextId("cond");
  nodes.push({ id: condId, scene, label: "if", shape: "diamond", fillcolor: "lightyellow" });

  for (const branch of step.branches) {
    let branchLabel: string;
    if (branch.condition) {
      branchLabel = branch.isElse
        ? `elseif ${truncate(branch.condition, 30)}`
        : `if ${truncate(branch.condition, 30)}`;
    } else {
      branchLabel = branch.isElse ? "else" : "";
    }
    const inner = renderSteps(branch.steps, scene);
    const branchDest = branch.dest ? scopedDestNodeId(branch.dest, scene) : null;
    if (inner && branchDest) {
      dotEdges.push({ from: condId, to: inner.first, label: branchLabel, color: "gray40", style: "dashed" });
      dotEdges.push({ from: inner.last, to: branchDest, label: "", color: "gray40", style: "dashed" });
    } else if (inner) {
      dotEdges.push({ from: condId, to: inner.first, label: branchLabel, color: "gray40", style: "dashed" });
    } else if (branchDest) {
      dotEdges.push({ from: condId, to: branchDest, label: branchLabel, color: "gray40", style: "dashed" });
    }
  }

  condRenderCache.set(cacheKey, condId);
  return condId;
}

function renderSteps(steps: TraceStep[], scene: string): { first: string; last: string } | null {
  if (steps.length === 0) return null;

  let firstNodeId: string | null = null;
  let lastNodeId: string | null = null;
  for (const step of steps) {
    if (step.kind === "sets") {
      const nodeId = nextId("q");
      const label = step.values.map(v => truncate(v, 50)).join("\n");
      nodes.push({ id: nodeId, scene, label, shape: "note", fillcolor: "gray93" });
      if (lastNodeId) dotEdges.push({ from: lastNodeId, to: nodeId, label: "", color: "gray40" });
      if (!firstNodeId) firstNodeId = nodeId;
      lastNodeId = nodeId;
    } else if (step.kind === "conditional") {
      const condId = renderConditional(step, scene);
      if (lastNodeId) dotEdges.push({ from: lastNodeId, to: condId, label: "", color: "gray40" });
      if (!firstNodeId) firstNodeId = condId;
      lastNodeId = condId;
    }
  }

  if (!firstNodeId || !lastNodeId) return null;
  return { first: firstNodeId, last: lastNodeId };
}

const chainCache = new Map<string, { first: string; last: string }>();

function renderTraceChain(steps: TraceStep[], dest: TraceDest, scene: string, fromId: string, edgeLabel: string, edgeColor: string): void {
  const targetId = destNodeId(dest);

  if (steps.length === 0) {
    dotEdges.push({ from: fromId, to: targetId, label: edgeLabel, color: edgeColor });
    return;
  }

  const cacheKey = JSON.stringify({ steps, dest, scene });
  let chain = chainCache.get(cacheKey);
  if (!chain) {
    chain = renderSteps(steps, scene) ?? undefined;
    if (chain) {
      chainCache.set(cacheKey, chain);
      dotEdges.push({ from: chain.last, to: targetId, label: "", color: edgeColor });
    }
  }

  if (chain) {
    dotEdges.push({ from: fromId, to: chain.first, label: edgeLabel, color: edgeColor });
  } else {
    dotEdges.push({ from: fromId, to: targetId, label: edgeLabel, color: edgeColor });
  }
}

// --- Scope filtering ---

function isInScope(scene: string, blockId: string): boolean {
  if (!scopeScene) return true;
  if (scene !== scopeScene) return false;
  if (!scopeLabel) return true;
  const block = resolver.get(blockId, cfg.refs);
  if (!block) return false;
  for (const stmtId of block.statementIds) {
    const stmt = statements[stmtId];
    if (stmt?.kind === "Label" && (stmt as any).label?.value === scopeLabel) return true;
  }
  return false;
}

const scopedChoiceNums = new Set<number>();
const scopedSplitBlockIds = new Set<string>();

if (scopeScene) {
  let inLabel = !scopeLabel;
  for (const ct of traceResult.choices) {
    if (ct.scene !== scopeScene) continue;
    if (scopeLabel) {
      const block = resolver.get(ct.blockId, cfg.refs);
      if (block) {
        for (const stmtId of block.statementIds) {
          const stmt = statements[stmtId];
          if (stmt?.kind === "Label" && (stmt as any).label?.value === scopeLabel) { inLabel = true; break; }
        }
      }
    }
    if (inLabel) scopedChoiceNums.add(ct.num);
  }
  for (const st of traceResult.splits) {
    if (st.scene === scopeScene) scopedSplitBlockIds.add(st.blockId);
  }
}

const filteredChoices = scopeScene
  ? traceResult.choices.filter(ct => scopedChoiceNums.has(ct.num))
  : traceResult.choices;
const filteredSplits = scopeScene
  ? traceResult.splits.filter(st => scopedSplitBlockIds.has(st.blockId))
  : traceResult.splits;

// Track which choice nums and split blockIds are in scope for entry/exit detection
const inScopeChoiceNums = new Set(filteredChoices.map(ct => ct.num));
const inScopeSplitIds = new Set(filteredSplits.map(st => st.blockId));

// --- Build split trace lookup ---

interface SplitNodeInfo { nodeId: string; trace: SplitTrace }
const splitTraceMap = new Map<string, SplitNodeInfo>();
let splitNum = 0;
for (const st of filteredSplits) {
  splitNum++;
  const nodeId = `s${splitNum}`;
  splitTraceMap.set(st.blockId, { nodeId, trace: st });
}

// --- Entry/exit stubs for scoped mode ---

const entryStubs = new Map<string, string>();
const exitStubs = new Map<string, string>();

function getEntryStub(label: string, scene: string): string {
  if (entryStubs.has(label)) return entryStubs.get(label)!;
  const id = nextId("entry");
  nodes.push({ id, scene, label: `← ${label}`, shape: "cds", fillcolor: "palegreen" });
  entryStubs.set(label, id);
  return id;
}

function getExitStub(label: string, scene: string): string {
  if (exitStubs.has(label)) return exitStubs.get(label)!;
  const id = nextId("exit");
  nodes.push({ id, scene, label: `→ ${label}`, shape: "cds", fillcolor: "lightsalmon" });
  exitStubs.set(label, id);
  return id;
}

// Override destNodeId for scoped mode
const origDestNodeId = destNodeId;
if (scopeScene) {
  (globalThis as any).__destNodeIdOverride = true;
}

function scopedDestNodeId(dest: TraceDest, fromScene: string): string {
  if (!scopeScene) return destNodeId(dest);
  if (dest.kind === "choice") {
    const num = numByCanonical.get(dest.blockId);
    if (num !== undefined && inScopeChoiceNums.has(num)) return `c${num}`;
    const targetScene = sceneOf(dest.blockId);
    return getExitStub(`Choice ${num ?? "?"}  (${targetScene})`, fromScene);
  }
  if (dest.kind === "split") {
    if (inScopeSplitIds.has(dest.blockId)) {
      const st = splitTraceMap.get(dest.blockId);
      return st ? st.nodeId : "DEAD";
    }
    const targetScene = sceneOf(dest.blockId);
    return getExitStub(`Split (${targetScene})`, fromScene);
  }
  if (dest.kind === "end") return "END";
  return "DEAD";
}

function scopedRenderTraceChain(steps: TraceStep[], dest: TraceDest, scene: string, fromId: string, edgeLabel: string, edgeColor: string): void {
  const targetId = scopedDestNodeId(dest, scene);

  if (steps.length === 0) {
    dotEdges.push({ from: fromId, to: targetId, label: edgeLabel, color: edgeColor });
    return;
  }

  const cacheKey = JSON.stringify({ steps, dest, scene });
  let chain = chainCache.get(cacheKey);
  if (!chain) {
    chain = renderSteps(steps, scene) ?? undefined;
    if (chain) {
      chainCache.set(cacheKey, chain);
      dotEdges.push({ from: chain.last, to: targetId, label: "", color: edgeColor });
    }
  }

  if (chain) {
    dotEdges.push({ from: fromId, to: chain.first, label: edgeLabel, color: edgeColor });
  } else {
    dotEdges.push({ from: fromId, to: targetId, label: edgeLabel, color: edgeColor });
  }
}

// --- Build entry nodes from out-of-scope traces pointing into scope ---

if (scopeScene) {
  const allChoices = traceResult.choices;
  const allSplits = traceResult.splits;

  function findInboundDests(steps: TraceStep[], dests: TraceDest[]): void {
    for (const s of steps) {
      if (s.kind === "conditional") {
        for (const b of s.branches) {
          findInboundDests(b.steps, dests);
          if (b.dest) dests.push(b.dest);
        }
      }
    }
  }

  for (const ct of allChoices) {
    if (inScopeChoiceNums.has(ct.num)) continue;
    for (const opt of ct.options) {
      const allDests: TraceDest[] = [opt.dest];
      findInboundDests(opt.steps, allDests);
      for (const d of allDests) {
        if (d.kind === "choice") {
          const num = numByCanonical.get(d.blockId);
          if (num !== undefined && inScopeChoiceNums.has(num)) {
            const entryId = getEntryStub(`Choice ${ct.num} (${ct.scene})`, scopeScene);
            dotEdges.push({ from: entryId, to: `c${num}`, label: "", color: "forestgreen" });
          }
        }
        if (d.kind === "split" && inScopeSplitIds.has(d.blockId)) {
          const st = splitTraceMap.get(d.blockId);
          if (st) {
            const entryId = getEntryStub(`Choice ${ct.num} (${ct.scene})`, scopeScene);
            dotEdges.push({ from: entryId, to: st.nodeId, label: "", color: "forestgreen" });
          }
        }
      }
    }
  }

  for (const st of allSplits) {
    if (inScopeSplitIds.has(st.blockId)) continue;
    for (const branch of st.branches) {
      const allDests: TraceDest[] = [branch.dest];
      findInboundDests(branch.steps, allDests);
      for (const d of allDests) {
        if (d.kind === "choice") {
          const num = numByCanonical.get(d.blockId);
          if (num !== undefined && inScopeChoiceNums.has(num)) {
            const entryId = getEntryStub(`Split (${st.scene})`, scopeScene);
            dotEdges.push({ from: entryId, to: `c${num}`, label: "", color: "forestgreen" });
          }
        }
      }
    }
  }
}

// --- Build choice nodes ---

for (const ct of filteredChoices) {
  const blockId = ct.blockId;
  const scene = ct.scene;
  const isHub = hubChoiceIds.has(blockId);
  const shape = isHub ? "doubleoctagon" : "box";

  const labelParts = [`Choice ${ct.num}`];
  const resolved = resolver.get(blockId, cfg.refs);
  if (resolved) {
    for (const stmtId of resolved.statementIds) {
      const stmt = statements[stmtId];
      if (stmt?.kind === "Label") {
        const lbl = (stmt as any).label?.value;
        if (lbl) labelParts.push(truncate(lbl, 30));
        break;
      }
    }
    const prose = lastWords(blockId, 5);
    if (prose) labelParts.push(truncate(prose, 40));
  }

  const choiceNodeId = `c${ct.num}`;
  nodes.push({ id: choiceNodeId, scene, label: labelParts.join("\n"), shape, fillcolor: "white" });

  for (const opt of ct.options) {
    const optLabel = truncate(opt.optionLabel, 40);

    if (opt.conditions.length > 0) {
      const optNodeId = nextId("opt");
      nodes.push({ id: optNodeId, scene, label: optLabel, shape: "box", fillcolor: "lavender" });
      const condLabel = opt.conditions.map(c => truncate(c, 40)).join("\n");
      dotEdges.push({ from: choiceNodeId, to: optNodeId, label: condLabel, color: "purple" });
      scopedRenderTraceChain(opt.steps, opt.dest, scene, optNodeId, "", "black");
    } else {
      scopedRenderTraceChain(opt.steps, opt.dest, scene, choiceNodeId, optLabel, "black");
    }
  }
}

console.log(`  ${filteredChoices.length} choice nodes`);

// --- Build split nodes ---

for (const [, info] of splitTraceMap) {
  const st = info.trace;
  const condLabels = st.branches.map(b => b.condition ?? "else");
  const nodeLabel = `Split\n${truncate(condLabels.join(" / "), 40)}`;
  nodes.push({ id: info.nodeId, scene: st.scene, label: nodeLabel, shape: "diamond", fillcolor: "lightyellow" });

  for (const branch of st.branches) {
    const branchLabel = branch.condition
      ? (branch.isElse ? `else ${truncate(branch.condition, 40)}` : `if ${truncate(branch.condition, 40)}`)
      : "else";
    scopedRenderTraceChain(branch.steps, branch.dest, st.scene, info.nodeId, branchLabel, "chocolate4");
  }
}

console.log(`  ${splitTraceMap.size} split nodes`);
console.log(`  ${nodes.length} total nodes, ${dotEdges.length} edges`);

// --- Render DOT ---

const scenes = new Map<string, DotNode[]>();
for (const n of nodes) {
  if (!scenes.has(n.scene)) scenes.set(n.scene, []);
  scenes.get(n.scene)!.push(n);
}

const lines: string[] = [];
lines.push("digraph Choices {");
lines.push("  rankdir=TB;");
lines.push('  node [fontname="Helvetica" fontsize=10 style=filled fillcolor=white];');
lines.push('  edge [fontname="Helvetica" fontsize=9];');
lines.push("");

for (const [scene, sceneNodes] of scenes) {
  lines.push(`  subgraph "cluster_${escDot(scene)}" {`);
  lines.push(`    label="${escDot(scene)}";`);
  lines.push("    style=dashed;");
  lines.push("    color=gray70;");
  for (const n of sceneNodes) {
    lines.push(`    "${n.id}" [label="${escDot(n.label)}" shape=${n.shape} fillcolor=${n.fillcolor}];`);
  }
  lines.push("  }");
  lines.push("");
}

lines.push('  "END" [label="END" shape=doublecircle fillcolor=gray90];');
lines.push('  "DEAD" [label="DEAD END" shape=octagon fillcolor=mistyrose];');
lines.push("");

const seenEdges = new Set<string>();
for (const e of dotEdges) {
  const style = e.style ? ` style=${e.style}` : (e.color === "gray50" ? " style=dashed" : "");
  const line = `  "${e.from}" -> "${e.to}" [label="${escDot(e.label)}" color=${e.color} fontcolor=${e.color}${style}];`;
  if (seenEdges.has(line)) continue;
  seenEdges.add(line);
  lines.push(line);
}

lines.push("}");

const dot = lines.join("\n") + "\n";
const suffix = scopeScene ? `-${scopeScene}${scopeLabel ? `-${scopeLabel}` : ""}` : "";
getIO().writeFile(outPath(`graph${suffix}.dot`), dot);
console.log(`Wrote ${outPath(`graph${suffix}.dot`)}`);

console.log("Rendering SVG...");
const graphviz = await Graphviz.load();
const svg = graphviz.dot(dot, "svg");
getIO().writeFile(outPath(`graph${suffix}.svg`), svg);
console.log(`Wrote ${outPath(`graph${suffix}.svg`)} (${(new Blob([svg]).size / 1024 / 1024).toFixed(1)} MB)`);
