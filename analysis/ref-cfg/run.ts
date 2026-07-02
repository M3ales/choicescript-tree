import "../../bootstrap";
import { SceneAst } from "../../parser/scene";
import { NdjsonWriter, writeNdjson } from "../ndjson";
import { outPath, ensureOutDir, getIO } from "../../out-dir";
import { serialiseLinkedCfgs } from "./serialize";
import { serializeSymbolTable } from "./extract-symbols";
import { SceneCfgCache } from "./scene-cache";
import { CfgResultCache } from "./cfg-cache";
import { CfgReconciler } from "./reconcile";
import {
  linkInterSceneControlFlow, analyseLoops, buildGraph,
  buildGlobalSymbolTable, attachDataflow,
  verifyControlFlowFromResult, verifySetDeclarationsFromResult,
} from "./api";
import { buildContextGraph } from "./context-graph";
import { solveDominatorDataflow } from "./dominator-walk";

const scenes = JSON.parse(getIO().readFile(outPath("parsed.json"))) as SceneAst[];

ensureOutDir();

const sceneCache = new SceneCfgCache(outPath("ref-cfg-cache.json"));
const cfgCache = new CfgResultCache(outPath("ref-cfg-result-cache.json"));

const reconciler = new CfgReconciler({
  sceneCache,
  cfgCache,
  blockWriter: new NdjsonWriter(outPath("ref-block-index.ndjson")),
});

const plan = reconciler.reconcile(scenes);
const extracted = linkInterSceneControlFlow(scenes, plan);
sceneCache.save();
cfgCache.save();

const rs = reconciler.stats();
console.log(`Built per-scene CFGs for ${rs.scenes.total} scenes (${rs.scenes.cached} cached, ${rs.scenes.built} built)`);
console.log(`CFG visitor cache: ${rs.cfgs.cached} hits, ${rs.cfgs.computed} computed`);

const { linked, transfers, scopes } = extracted;

const cfgCount = Object.keys(linked.cfgs).length;
let totalBlocks = 0;
let totalInternalEdges = 0;
let totalExits = 0;
let resolvedExits = 0;

for (const cfg of Object.values(linked.cfgs)) {
  totalBlocks += Object.keys(cfg.blocks).length;
  totalInternalEdges += cfg.edges.length;
  totalExits += cfg.exits.length;
  resolvedExits += cfg.exits.filter(e => e.target.type === "cfg").length;
}

console.log(`\nLinked CFGs: ${cfgCount} cfgs, ${totalBlocks} blocks, ${totalInternalEdges} internal edges`);
console.log(`  Exits: ${totalExits} total, ${resolvedExits} resolved, ${totalExits - resolvedExits} terminal`);
console.log(`  Unresolved cross-scene: ${linked.unresolvedExits.length}`);
console.log(`  Scene order: ${linked.sceneOrder.join(" → ")}`);
console.log(`  Entry CFG: ${linked.entryCfgId}`);

const exitsByKind = new Map<string, number>();
for (const cfg of Object.values(linked.cfgs)) {
  for (const exit of cfg.exits) {
    exitsByKind.set(exit.kind, (exitsByKind.get(exit.kind) ?? 0) + 1);
  }
}
console.log(`\nExits by kind:`);
for (const [kind, count] of [...exitsByKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind}: ${count}`);
}

console.log(`\nCFG analysis (transfer + scope):`);
let totalEffects = 0;
let totalExitGuards = 0;
let maxGuardDepth = 0;
let noEffectCfgs = 0;
let choiceGuards = 0;
let reuseGuards = 0;
let selectableIfGuards = 0;
const transferStats: Array<{ id: string; effects: number; exits: number; maxDepth: number; blocks: number }> = [];

for (const [cfgId, transfer] of transfers) {
  totalEffects += transfer.effects.length;
  totalExitGuards += transfer.exits.length;
  if (transfer.effects.length === 0) noEffectCfgs++;

  let cfgMaxDepth = 0;
  for (const e of [...transfer.effects, ...transfer.exits]) {
    if (e.guards.length > cfgMaxDepth) cfgMaxDepth = e.guards.length;
    for (const g of e.guards) {
      if (g.edgeKind === "ChoiceOption" || g.edgeKind === "ChoiceOptionCheck") {
        choiceGuards++;
        if (g.metadata.effectiveReuse) reuseGuards++;
        if (g.metadata.choiceConditionId) selectableIfGuards++;
      }
    }
  }
  if (cfgMaxDepth > maxGuardDepth) maxGuardDepth = cfgMaxDepth;

  const cfg = linked.cfgs[cfgId];
  transferStats.push({
    id: cfgId,
    effects: transfer.effects.length,
    exits: transfer.exits.length,
    maxDepth: cfgMaxDepth,
    blocks: cfg ? Object.keys(cfg.blocks).length : 0,
  });
}

transferStats.sort((a, b) => b.effects - a.effects);

console.log(`  Total guarded effects: ${totalEffects}`);
console.log(`  Total exit guards: ${totalExitGuards}`);
console.log(`  No-effect CFGs: ${noEffectCfgs} / ${cfgCount}`);
console.log(`  Max guard depth: ${maxGuardDepth}`);
console.log(`  Choice guards: ${choiceGuards} (reuse: ${reuseGuards}, selectable_if: ${selectableIfGuards})`);

let totalDefs = 0, totalRefs = 0, totalExternal = 0, totalDeletes = 0;
for (const scope of scopes.values()) {
  totalDefs += scope.defs.length;
  totalRefs += scope.refs.length;
  totalExternal += scope.externalRefs.length;
  totalDeletes += scope.deletes.length;
}
console.log(`  Scope: ${totalDefs} defs, ${totalRefs} refs (${totalExternal} external), ${totalDeletes} deletes`);

const loopAnalysis = analyseLoops(extracted);
console.log(`\nLoop analysis: ${loopAnalysis.loops.length} loops detected`);
for (const loop of loopAnalysis.loops) {
  const c = loop.classification;
  const trips = c.tripCount !== null ? `×${c.tripCount}` : "×?";
  const inf = c.infinite ? `, ${c.infinite.toUpperCase()}` : "";
  console.log(`  Header: ${loop.headerCfgId} (${loop.bodyCfgIds.length} body cfgs) [${c.mechanism}, ${c.pure ? "pure" : "effectful"}, ${c.bound} ${trips}${inf}]`);
}

const recordCount = writeNdjson(outPath("ref-cfg.ndjson"), serialiseLinkedCfgs(linked));
console.log(`\nWrote ref-cfg.ndjson (${recordCount} records)`);

const cfgGraph = buildGraph(extracted);
console.log(`\nCFG graph: ${cfgGraph.edges.length} edges, ${cfgGraph.order.length} CFGs in order`);

const contextGraph = buildContextGraph(extracted.linked, loopAnalysis, extracted.blockToCfg);
console.log(`\nContext graph: ${contextGraph.nodes.size} nodes`);

// Analyse context distribution
const ctxPerCfg = new Map<string, number>();
const ctxPerScene = new Map<string, number>();
let maxCallDepth = 0;
const loopIterCounts = new Map<number, number>();
for (const [, node] of contextGraph.nodes) {
  ctxPerCfg.set(node.cfgId, (ctxPerCfg.get(node.cfgId) ?? 0) + 1);
  ctxPerScene.set(node.scene, (ctxPerScene.get(node.scene) ?? 0) + 1);
  if (node.callDepth > maxCallDepth) maxCallDepth = node.callDepth;
  if (node.loopIteration !== undefined) {
    loopIterCounts.set(node.loopIteration, (loopIterCounts.get(node.loopIteration) ?? 0) + 1);
  }
}
console.log(`  Max call depth: ${maxCallDepth}`);
console.log(`  Scenes with contexts: ${ctxPerScene.size}`);
const topScenes = [...ctxPerScene].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [scene, count] of topScenes) console.log(`    ${scene}: ${count} contexts`);
console.log(`  CFGs with most contexts (top 10):`);
const topCfgs = [...ctxPerCfg].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [cfgId, count] of topCfgs) console.log(`    ${cfgId}: ${count}`);
if (loopIterCounts.size > 0) {
  console.log(`  Loop iteration distribution:`);
  for (const [iter, count] of [...loopIterCounts].sort((a, b) => a[0] - b[0])) {
    console.log(`    iteration ${iter}: ${count} nodes`);
  }
}

const t0 = performance.now();
const dataflow = solveDominatorDataflow(contextGraph, extracted.linked, extracted.transfers, extracted.blockIndex, extracted.statements);
const t1 = performance.now();

console.log(`\nDataflow (dom): ${dataflow.cfgStates.length} states, ${dataflow.stateStore.size} unique [${(t1 - t0).toFixed(1)}ms]`);

const diag = dataflow.diagnostics;
if (diag.unresolvedExits.length > 0) {
  console.log(`  Unresolved exits: ${diag.unresolvedExits.length}`);
}
if (diag.missingCfgs.length > 0) {
  console.log(`  Missing CFGs: ${diag.missingCfgs.join(", ")}`);
}
if (diag.droppedContexts.length > 0) {
  const byReason = new Map<string, number>();
  const byCfg = new Map<string, { total: number; reasons: Record<string, number> }>();
  const byScene = new Map<string, { total: number; reasons: Record<string, number> }>();
  for (const d of diag.droppedContexts) {
    byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
    const entry = byCfg.get(d.cfgId) ?? { total: 0, reasons: {} };
    entry.total++;
    entry.reasons[d.reason] = (entry.reasons[d.reason] ?? 0) + 1;
    byCfg.set(d.cfgId, entry);
    const scene = d.cfgId.split(":")[0];
    const se = byScene.get(scene) ?? { total: 0, reasons: {} };
    se.total++;
    se.reasons[d.reason] = (se.reasons[d.reason] ?? 0) + 1;
    byScene.set(scene, se);
  }
  const parts = [...byReason].map(([r, c]) => `${r}: ${c}`);
  console.log(`  Dropped contexts: ${parts.join(", ")}`);
  console.log(`  By scene (top 15):`);
  const sortedScenes = [...byScene].sort((a, b) => b[1].total - a[1].total);
  for (const [scene, info] of sortedScenes.slice(0, 15)) {
    const reasons = Object.entries(info.reasons).map(([r, c]) => `${r}=${c}`).join(" ");
    console.log(`    ${scene}: ${info.total} dropped (${reasons})`);
  }
  console.log(`  By CFG (top 20):`);
  const sortedCfgs = [...byCfg].sort((a, b) => b[1].total - a[1].total);
  for (const [cfgId, info] of sortedCfgs.slice(0, 20)) {
    const reasons = Object.entries(info.reasons).map(([r, c]) => `${r}=${c}`).join(" ");
    console.log(`    ${cfgId}: ${info.total} (${reasons})`);
  }
}
const dfRecords = [
  ...dataflow.cfgStates.map(cs => ({ type: "cfgState", ...cs })),
  ...[...dataflow.stateStore].map(([id, state]) => ({ type: "state", id, ...state })),
];
writeNdjson(outPath("ref-dataflow.ndjson"), dfRecords);
console.log(`  Wrote ref-dataflow.ndjson (${dfRecords.length} records, ${dataflow.stateStore.size} unique states)`);

const controlFlowViolations = verifyControlFlowFromResult(extracted, dataflow);
console.log(`\nControl flow verification: ${controlFlowViolations.length} violations`);
if (controlFlowViolations.length > 0) {
  const byKind = new Map<string, number>();
  for (const v of controlFlowViolations) byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1);
  for (const [kind, count] of byKind) {
    console.log(`  ${kind}: ${count}`);
  }
  for (const v of controlFlowViolations.slice(0, 20)) {
    console.log(`  ${v.scene}/${v.blockId}: ${v.kind}`);
  }
  if (controlFlowViolations.length > 20) {
    console.log(`  ... (${controlFlowViolations.length - 20} more)`);
  }
}

const undeclaredViolations = verifySetDeclarationsFromResult(extracted, dataflow);
const setViolations = undeclaredViolations.filter(v => v.kind === "set");
const refViolations = undeclaredViolations.filter(v => v.kind === "reference");
console.log(`\nUndeclared variable verification: ${undeclaredViolations.length} violations (${setViolations.length} writes, ${refViolations.length} reads)`);
if (undeclaredViolations.length > 0) {
  const byScene = new Map<string, number>();
  for (const v of undeclaredViolations) byScene.set(v.scene, (byScene.get(v.scene) ?? 0) + 1);
  for (const [scene, count] of [...byScene].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${scene}: ${count}`);
  }
  for (const v of undeclaredViolations.slice(0, 20)) {
    const tag = v.kind === "set" ? "*set" : "ref";
    console.log(`  ${v.scene}/${v.blockId}: ${tag} ${v.variable} (${v.statementKind})`);
  }
  if (undeclaredViolations.length > 20) {
    console.log(`  ... (${undeclaredViolations.length - 20} more)`);
  }
}

const symbolTable = buildGlobalSymbolTable(extracted, cfgGraph.order);
console.log(`\nSymbol table:`);
const refBeforeDef: string[] = [];
const refNoDef: string[] = [];
const refOrderDef: string[] = [];
for (const [name, summary] of symbolTable.variables) {
  if (summary.firstRef && summary.firstDef &&
      summary.firstRef.cfgOrder < summary.firstDef.cfgOrder) {
    refBeforeDef.push(name);
    refOrderDef.push(`${name}: ref@${summary.firstRef.cfgId}[${summary.firstRef.cfgOrder}] def@${summary.firstDef.cfgId}[${summary.firstDef.cfgOrder}]`);
  }
  if (summary.firstRef && !summary.firstDef) {
    refBeforeDef.push(name);
    refNoDef.push(name);
  }
}
console.log(`  ${symbolTable.variables.size} variables, ${symbolTable.sites.length} sites`);
console.log(`  ${refBeforeDef.length} variables referenced before definition`);
if (refBeforeDef.length > 0) {
  console.log(`  ref-before-def: ${refBeforeDef.slice(0, 20).join(", ")}${refBeforeDef.length > 20 ? ` ... (${refBeforeDef.length - 20} more)` : ""}`);
  if (refNoDef.length > 0) console.log(`  ref-no-def (${refNoDef.length}): ${refNoDef.slice(0, 20).join(", ")}`);
  if (refOrderDef.length > 0) {
    console.log(`  ref-order-before-def (${refOrderDef.length}):`);
    for (const d of refOrderDef.slice(0, 20)) console.log(`    ${d}`);
  }
}
const deleted = [...symbolTable.variables.values()].filter(v => v.deleted);
if (deleted.length > 0) {
  console.log(`  ${deleted.length} variables explicitly deleted: ${deleted.map(v => v.variable).join(", ")}`);
}
const symRecords = serializeSymbolTable(symbolTable);
writeNdjson(outPath("ref-symbols.ndjson"), symRecords);
console.log(`  Wrote ref-symbols.ndjson (${symRecords.length} records)`);

attachDataflow(extracted, dataflow);
const locationIndex = extracted.locationIndex;
console.log(`\nLocation index:`);
const locStats = locationIndex.stats();
console.log(`  ${locStats.statements} statements, ${locStats.lines} unique lines indexed, ${locStats.cfgsWithDataflow} cfgs with dataflow`);

const sampleLine = locationIndex.queryLocation({ scene: "startup", line: 42 });
if (sampleLine.entries.length > 0) {
  const e = sampleLine.entries[0];
  console.log(`  Sample: startup:42 → ${e.statementKind} (${e.cfgId})`);
}

const sampleVar = locationIndex.queryVariable({ variable: "first_name" });
console.log(`  Variable 'first_name': ${sampleVar.definitions.length} defs, ${sampleVar.references.length} refs, ${sampleVar.deletes.length} deletes`);


getIO().writeFile(outPath("location-index.json"), JSON.stringify(locStats, null, 2));
