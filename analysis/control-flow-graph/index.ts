import "../../bootstrap";
import { SceneAstWithSymbolTable } from "../symbol-table/scene-ast-with-symbol-table";
import { buildControlFlow, SceneControlFlowGraph } from "./build-scene";
import { mergeScenes } from "./merge-scenes";
import { writeNdjson, NdjsonWriter } from "../ndjson";
import { serialiseCfg } from "./cfg-io";
import { outPath, ensureOutDir, getIO } from '../../out-dir';


const scenes = JSON.parse(getIO().readFile(outPath('symbol-table.json'))) as SceneAstWithSymbolTable[];

ensureOutDir();
const blockWriter = new NdjsonWriter(outPath('block-index.ndjson'));

const cfgs = new Map<string, SceneControlFlowGraph>();
for (const scene of scenes) {
  cfgs.set(scene.name, buildControlFlow(scene, blockWriter));
}

let totalBlocks = 0, totalEdges = 0, totalUnresolved = 0;
for (const [, cfg] of cfgs) {
  totalBlocks += Object.keys(cfg.blocks).length;
  totalEdges += cfg.edges.length;
  totalUnresolved += cfg.unresolvedEdges.length;
}

console.log(`Per-scene CFG: ${cfgs.size} scenes, ${totalBlocks} blocks, ${totalEdges} edges, ${totalUnresolved} unresolved`);

for (const [name, cfg] of cfgs) {
  const blocks = Object.keys(cfg.blocks).length;
  const edges = cfg.edges.length;
  const labels = Object.keys(cfg.labelToBlockId).length;
  console.log(`  ${name}: ${blocks} blocks, ${edges} edges, ${labels} labels`);
}

const cfg = mergeScenes(scenes, cfgs);

writeNdjson(outPath('cfg.ndjson'), serialiseCfg(cfg));

const totalBlocks2 = Object.keys(cfg.blocks).length;
const totalEdges2 = cfg.edges.length;
const totalStatements = Object.keys(cfg.statementIndex).length;
const progressionEdges = cfg.edges.filter(e => e.kind === "SceneProgression").length;
const resolvedGotoScene = cfg.edges.filter(e => e.kind === "GotoScene" && e.targetBlockId !== null).length;
const unresolvedGotoScene = cfg.edges.filter(e => e.kind === "GotoScene" && e.targetBlockId === null).length;

console.log(`Merged CFG: ${totalBlocks2} blocks, ${totalEdges2} edges, ${totalStatements} statements indexed`);
console.log(`  Scene order: ${cfg.sceneOrder.join(' → ')}`);
console.log(`  Scene progressions: ${progressionEdges}`);
console.log(`  Cross-scene gotos: ${resolvedGotoScene} resolved, ${unresolvedGotoScene} unresolved`);

if (unresolvedGotoScene > 0) {
  const unresolved = cfg.edges.filter(e => e.kind === "GotoScene" && e.targetBlockId === null);
  for (const edge of unresolved) {
    const target = edge.metadata.targetScene ?? '(dynamic)';
    const label = edge.metadata.targetSceneLabel ? `#${edge.metadata.targetSceneLabel}` : '';
    const dynamic = edge.metadata.dynamicExpression ? ' [dynamic]' : '';
    console.log(`    ✗ ${edge.sourceBlockId} → ${target}${label}${dynamic}`);
  }
}

console.log(`  Entry: ${cfg.entryBlockId}`);
