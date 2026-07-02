import "./bootstrap";
import { CfgReconciler, runPipeline } from "./api";
import type { Scene, PipelineResult } from "./api";
import { outPath, ensureOutDir, getIO } from "./out-dir";
import { writeNdjson } from "./analysis/ndjson";
import { serialiseLinkedCfgs } from "./analysis/ref-cfg/serialize";
import { serializeSymbolTable } from "./analysis/ref-cfg/extract-symbols";
import { simulateDelta } from "./pipeline/simulate-delta";
import type { ScanResult } from "./pipeline/scan";
import type { ParseResult } from "./pipeline/parse";

const CACHE_DIR = outPath("cache");

const jsonReplacer = (_key: string, value: unknown) =>
  value instanceof Map ? { __map: [...value.entries()] }
  : value instanceof Set ? { __set: [...value] }
  : value;

const jsonReviver = (_key: string, value: unknown) => {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.__map) return new Map(v.__map as [unknown, unknown][]);
    if (v.__set) return new Set(v.__set as unknown[]);
  }
  return value;
};

const sceneCachePath = (name: string) => `${CACHE_DIR}/${name}.ndjson`;

type CacheLine =
  | { type: "content"; content: string }
  | { type: "tokens"; tokens: import("./scanner/tokens/token").Token[] }
  | { type: "checkpoints"; checkpoints: import("./scanner/scanner-checkpoint").ScannerCheckpoint[] }
  | { type: "hashes"; hashes: import("./scanner/token-hash").SceneHashes }
  | { type: "ast"; ast: import("./parser/scene").SceneAst };

const loadCache = (sceneNames: string[]): {
  previousScenes: Map<string, string>;
  previousResult: Pick<PipelineResult, "scanResult" | "parseResult">;
  loaded: number;
} | null => {
  const io = getIO();
  if (!io.exists(CACHE_DIR)) return null;

  const previousScenes = new Map<string, string>();
  const tokens = new Map<string, import("./scanner/tokens/token").Token[]>();
  const checkpoints = new Map<string, import("./scanner/scanner-checkpoint").ScannerCheckpoint[]>();
  const sceneHashes = new Map<string, import("./scanner/token-hash").SceneHashes>();
  const asts: import("./parser/scene").SceneAst[] = [];
  let loaded = 0;

  for (const name of sceneNames) {
    const path = sceneCachePath(name);
    if (!io.exists(path)) continue;
    try {
      const raw = io.readFile(path);
      for (const line of raw.split("\n")) {
        if (!line) continue;
        const record = JSON.parse(line, jsonReviver) as CacheLine;
        switch (record.type) {
          case "content": previousScenes.set(name, record.content); break;
          case "tokens": tokens.set(name, record.tokens); break;
          case "checkpoints": checkpoints.set(name, record.checkpoints); break;
          case "hashes": sceneHashes.set(name, record.hashes); break;
          case "ast": asts.push(record.ast); break;
        }
      }
      loaded++;
    } catch {
      continue;
    }
  }

  if (loaded === 0) return null;

  return {
    previousScenes,
    previousResult: {
      scanResult: {
        tokens,
        checkpoints,
        sceneHashes,
        knownLabels: [],
        sceneNames: [...previousScenes.keys()],
        timing: { preScan: 0, scan: 0, total: 0, scenesScanned: 0, scenesReused: 0 },
      },
      parseResult: { asts, timing: { parse: 0, scenesParsed: 0, scenesReused: 0 } },
    } as PipelineResult,
    loaded,
  };
};

const saveCache = (scenes: Scene[], result: PipelineResult, diff: import("./diff").DiffResult | null) => {
  const io = getIO();
  io.mkdir(CACHE_DIR);

  let written = 0;
  for (const scene of scenes) {
    const change = diff?.scenes.get(scene.name);
    if (diff && change?.kind === "unchanged") continue;

    const sceneTokens = result.scanResult.tokens.get(scene.name);
    const chk = result.scanResult.checkpoints.get(scene.name);
    const hashes = result.scanResult.sceneHashes.get(scene.name);
    const ast = result.parseResult.asts.find(a => a.name === scene.name) ?? null;
    if (!sceneTokens || !chk || !hashes) continue;

    const lines: string[] = [
      JSON.stringify({ type: "content", content: scene.content }),
      JSON.stringify({ type: "tokens", tokens: sceneTokens }, jsonReplacer),
      JSON.stringify({ type: "checkpoints", checkpoints: chk }, jsonReplacer),
      JSON.stringify({ type: "hashes", hashes }, jsonReplacer),
    ];
    if (ast) lines.push(JSON.stringify({ type: "ast", ast }, jsonReplacer));
    io.writeFile(sceneCachePath(scene.name), lines.join("\n") + "\n");
    written++;
  }
  return written;
};

const args = process.argv.slice(2);
const deltaFlag = args.includes("--delta");
const noCacheFlag = args.includes("--no-cache");
const deltaScenes = parseInt(args[args.indexOf("--delta-scenes") + 1] || "1", 10);
const deltaLines = parseInt(args[args.indexOf("--delta-lines") + 1] || "3", 10);
const deltaSeed = args.includes("--delta-seed")
  ? parseInt(args[args.indexOf("--delta-seed") + 1], 10)
  : undefined;

let scenes = JSON.parse(getIO().readFile(outPath("raw-scenes.json"))) as Scene[];
console.log(`Loaded ${scenes.length} scenes`);

if (deltaFlag) {
  const delta = simulateDelta(scenes, {
    maxScenes: deltaScenes,
    maxLinesPerScene: deltaLines,
    seed: deltaSeed,
  });
  scenes = delta.scenes;
  console.log(`\nSimulated delta: ${delta.mutations.length} mutations`);
  for (const m of delta.mutations) {
    console.log(`  ${m.scene}:${m.line} [${m.kind}] "${m.original}" → "${m.mutated}"`);
  }
  console.log();
}

ensureOutDir();

const cached = noCacheFlag ? null : loadCache(scenes.map(s => s.name));
if (cached) {
  console.log(`Loaded pipeline cache (${cached.loaded}/${scenes.length} scenes)`);
} else {
  console.log("No pipeline cache (cold run)");
}

const reconciler = new CfgReconciler({});

const result = runPipeline(scenes, {
  reconciler,
  previousScenes: cached?.previousScenes,
  previousResult: cached?.previousResult as PipelineResult | undefined,
});

const rs = reconciler.stats();
console.log(`Scene CFGs: ${rs.scenes.total} total (${rs.scenes.cached} cached, ${rs.scenes.built} built)`);
console.log(`CFG visitors: ${rs.cfgs.cached} cached, ${rs.cfgs.computed} computed`);

const dirty = result.plan.dirty;
console.log(`Dirty: ${dirty.scenes.size} scenes, ${dirty.cfgIds.size} cfgs, ${dirty.blockIds.size} blocks, ${dirty.statementIds.size} stmts`);

const { linked } = result.extracted;

const cfgCount = Object.keys(linked.cfgs).length;
let totalBlocks = 0;
let totalExits = 0;
for (const cfg of Object.values(linked.cfgs)) {
  totalBlocks += Object.keys(cfg.blocks).length;
  totalExits += cfg.exits.length;
}
console.log(`Linked: ${cfgCount} cfgs, ${totalBlocks} blocks, ${totalExits} exits`);
if (result.navigationErrors.length > 0) {
  console.log(`Navigation errors: ${result.navigationErrors.length}`);
  for (const err of result.navigationErrors) {
    console.log(`  ${err.severity}: ${err.message}`);
  }
}
console.log(`Loops: ${result.loopAnalysis.loops.length}`);
console.log(`CFG graph: ${result.cfgGraph.edges.length} edges, ${result.cfgGraph.order.length} ordered`);

const { segmentGraph, segmentDataflow: segDataflow } = result;
const segCount = Object.keys(segmentGraph.segments).length;
let segTotalBlocks = 0;
let segTotalGosubs = 0;
const segCfgIds = new Set<string>();
for (const seg of Object.values(segmentGraph.segments)) {
  segTotalBlocks += seg.blockIds.length;
  segTotalGosubs += seg.gosubBindings.length;
  segCfgIds.add(seg.cfgId);
}
console.log(`Segments: ${segCount} segments, ${segmentGraph.edges.length} edges, ${segTotalBlocks} blocks, ${segCfgIds.size} owning cfgs, ${segTotalGosubs} gosub bindings`);

const sl = segDataflow.segmentLoops;
console.log(`Segment loops: ${sl.loops.length} cyclic SCCs (${sl.loops.filter(l => l.bound === "choice-bounded").length} choice-bounded, ${sl.loops.filter(l => l.bound === "condition-bounded").length} condition-bounded, ${sl.loops.filter(l => l.bound === "unbounded").length} unbounded)`);
console.log(`Segment dataflow: ${segDataflow.segmentStates.size} states, ${segDataflow.totalIterations} iters, ${segDataflow.widenedSccs} widened`);
console.log(`Block deltas: ${segDataflow.blockDeltas.size} blocks with deltas, ${segDataflow.blockToSegment.size} blocks mapped`);

console.log(`Dataflow: ${segDataflow.cfgEntryStates.size} cfg entry states, ${segDataflow.deadBranches.length} dead branches, ${segDataflow.controlFlowViolations.length} cf violations, ${segDataflow.undeclaredSets.length} undeclared sets`);
console.log(`Symbols: ${result.symbolTable.variables.size} variables, ${result.symbolTable.sites.length} sites`);

const locStats = result.locationIndex.stats();
console.log(`Location index: ${locStats.statements} statements, ${locStats.lines} lines, ${locStats.cfgsWithDataflow} cfgs with dataflow`);

writeNdjson(outPath("ref-cfg.ndjson"), serialiseLinkedCfgs(linked));
writeNdjson(outPath("ref-symbols.ndjson"), serializeSymbolTable(result.symbolTable));
getIO().writeFile(outPath("location-index.json"), JSON.stringify(locStats, null, 2));

const t = result.timing;
const fmt = (ms: number) => `${ms.toFixed(0)}ms`;
const pct = (ms: number) => `${((ms / t.total) * 100).toFixed(1)}%`;
console.log(`\nTiming breakdown:`);
console.log(`  scan:           ${fmt(t.scan).padStart(8)}  ${pct(t.scan)}`);
const sd = t.scanDetail;
console.log(`    pre-scan:     ${fmt(sd.preScan).padStart(8)}  ${pct(sd.preScan)}`);
console.log(`    scan:         ${fmt(sd.scan).padStart(8)}  ${pct(sd.scan)}`);
console.log(`    scanned:      ${sd.scenesScanned}, reused: ${sd.scenesReused}`);
console.log(`  parse:          ${fmt(t.parse).padStart(8)}  ${pct(t.parse)}`);
const pd = t.parseDetail;
console.log(`    parsed:       ${pd.scenesParsed}, reused: ${pd.scenesReused}`);
console.log(`  reconcile:      ${fmt(t.reconcile).padStart(8)}  ${pct(t.reconcile)}`);
console.log(`  link cfgs:      ${fmt(t.linkCfgs).padStart(8)}  ${pct(t.linkCfgs)}`);
console.log(`  navigation:     ${fmt(t.navigation).padStart(8)}  ${pct(t.navigation)}`);
console.log(`  loop analysis:  ${fmt(t.loopAnalysis).padStart(8)}  ${pct(t.loopAnalysis)}`);
console.log(`  cfg graph:      ${fmt(t.cfgGraph).padStart(8)}  ${pct(t.cfgGraph)}`);
console.log(`  segments:       ${fmt(t.segments).padStart(8)}  ${pct(t.segments)}`);
console.log(`  seg dataflow:   ${fmt(t.segmentDataflow).padStart(8)}  ${pct(t.segmentDataflow)}`);
const sdt = segDataflow.timing;
console.log(`    seed:         ${fmt(sdt.seed).padStart(8)}`);
console.log(`    layout:       ${fmt(sdt.layout).padStart(8)}`);
console.log(`    solve:        ${fmt(sdt.solve).padStart(8)}`);
console.log(`    serialize:    ${fmt(sdt.serialize).padStart(8)}`);
console.log(`    stats+xcfg:   ${fmt(sdt.statsXcfg).padStart(8)}`);
console.log(`    cfg entries:  ${fmt(sdt.cfgEntrySerialize).padStart(8)}`);
console.log(`    analysis:     ${fmt(sdt.analysis).padStart(8)}`);
console.log(`  symbol table:   ${fmt(t.symbolTable).padStart(8)}  ${pct(t.symbolTable)}`);
console.log(`  location index: ${fmt(t.locationIndex).padStart(8)}  ${pct(t.locationIndex)}`);
console.log(`    seg deltas:   ${fmt(t.segDeltaAttach).padStart(8)}`);
console.log(`    attach df:    ${fmt(t.attachDataflow).padStart(8)}`);
console.log(`    reachability: ${fmt(t.reachability).padStart(8)}`);
console.log(`    branches:     ${fmt(t.branches).padStart(8)}`);
console.log(`    cf verify:    ${fmt(t.controlFlowVerify).padStart(8)}`);
console.log(`    set decl:     ${fmt(t.setDeclVerify).padStart(8)}`);
console.log(`    unreachable:  ${fmt(t.unreachable).padStart(8)}`);
console.log(`  total:          ${fmt(t.total).padStart(8)}`);

const written = saveCache(scenes, result, result.diff);
console.log(`Cache: ${written} scenes written to ${CACHE_DIR}`);
