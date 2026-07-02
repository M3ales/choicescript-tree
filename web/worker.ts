import { CfgReconciler, runPipeline } from "../api";
import type { Scene, PipelineResult } from "../api";
import { serialiseLinkedCfgs } from "../analysis/ref-cfg/serialize";
import { serializeSymbolTable } from "../analysis/ref-cfg/extract-symbols";
import { ndjsonToString } from "../analysis/ndjson";

function postLog(level: string, text: string) {
  self.postMessage({ type: "log", level, text });
}

function postStage(name: string) {
  self.postMessage({ type: "stage", name });
}

console.log = (...args: unknown[]) => postLog("info", args.map(String).join(" "));
console.info = (...args: unknown[]) => postLog("info", args.map(String).join(" "));
console.warn = (...args: unknown[]) => postLog("warn", args.map(String).join(" "));
console.error = (...args: unknown[]) => postLog("error", args.map(String).join(" "));

const timers = new Map<string, number>();
console.time = (label?: string) => { timers.set(label ?? "default", performance.now()); };
console.timeEnd = (label?: string) => {
  const key = label ?? "default";
  const start = timers.get(key);
  if (start !== undefined) {
    postLog("info", `${key}: ${(performance.now() - start).toFixed(1)}ms`);
    timers.delete(key);
  }
};

const jsonReplacer = (_key: string, value: unknown) =>
  value instanceof Map ? { __map: [...value.entries()] }
  : value instanceof Set ? { __set: [...value] }
  : value;

function serializeResults(result: PipelineResult): Record<string, string> {
  const files: Record<string, string> = {};

  files["out/raw-scenes.json"] = JSON.stringify(
    result.scenes.map(s => ({ name: s.name, statementCount: s.statements.length })),
    null, 2,
  );

  const { linked } = result.extracted;

  files["out/ref-cfg.ndjson"] = ndjsonToString(serialiseLinkedCfgs(linked));
  files["out/ref-dataflow.ndjson"] = ndjsonToString(
    [...result.segmentDataflow.cfgEntryStates].map(([cfgId, state]) => ({ type: "cfgEntry", cfgId, ...state })),
  );
  files["out/ref-symbols.ndjson"] = ndjsonToString(serializeSymbolTable(result.symbolTable));

  files["out/location-index.json"] = JSON.stringify(result.locationIndex.stats(), null, 2);

  if (result.navigationErrors.length > 0) {
    files["out/navigation-errors.json"] = JSON.stringify(result.navigationErrors, null, 2);
  }

  files["out/loop-analysis.json"] = JSON.stringify(result.loopAnalysis, jsonReplacer, 2);

  files["out/cfg-graph.json"] = JSON.stringify({
    edges: result.cfgGraph.edges.length,
    order: result.cfgGraph.order,
  }, null, 2);

  files["out/symbol-table.json"] = JSON.stringify({
    variables: [...result.symbolTable.variables.entries()],
    sites: result.symbolTable.sites.length,
  }, jsonReplacer, 2);

  const t = result.timing;
  const fmt = (ms: number) => `${ms.toFixed(0)}ms`;
  files["out/timing.json"] = JSON.stringify(t, null, 2);

  const summaryLines = [
    `# Analysis Summary`,
    ``,
    `## Pipeline`,
    `- Scenes: ${result.scenes.length}`,
    `- CFGs: ${Object.keys(linked.cfgs).length}`,
    `- Blocks: ${Object.values(linked.cfgs).reduce((n, c) => n + Object.keys(c.blocks).length, 0)}`,
    `- Exits: ${Object.values(linked.cfgs).reduce((n, c) => n + c.exits.length, 0)}`,
    `- Navigation errors: ${result.navigationErrors.length}`,
    `- Loops: ${result.loopAnalysis.loops.length}`,
    `- Graph edges: ${result.cfgGraph.edges.length}`,
    `- Dataflow states: ${result.segmentDataflow.cfgEntryStates.size}`,
    `- Variables: ${result.symbolTable.variables.size}`,
    `- Symbol sites: ${result.symbolTable.sites.length}`,
    ``,
    `## Timing`,
    `- Scan: ${fmt(t.scan)}`,
    `- Parse: ${fmt(t.parse)}`,
    `- Reconcile: ${fmt(t.reconcile)}`,
    `- Link CFGs: ${fmt(t.linkCfgs)}`,
    `- Navigation: ${fmt(t.navigation)}`,
    `- Loop analysis: ${fmt(t.loopAnalysis)}`,
    `- CFG graph: ${fmt(t.cfgGraph)}`,
    `- Segments: ${fmt(t.segments)}`,
    `- Segment dataflow: ${fmt(t.segmentDataflow)}`,
    `- Symbol table: ${fmt(t.symbolTable)}`,
    `- Location index: ${fmt(t.locationIndex)}`,
    `- **Total: ${fmt(t.total)}**`,
  ];
  files["out/summary.md"] = summaryLines.join("\n");

  return files;
}

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type !== "run") return;

  const t0 = performance.now();

  try {
    const scenes = msg.scenes as Scene[];
    if (!scenes || scenes.length === 0) {
      self.postMessage({ type: "error", text: "No scenes provided" });
      return;
    }

    postLog("info", `Running pipeline on ${scenes.length} scenes`);

    postStage("Pipeline");
    const reconciler = new CfgReconciler({});
    const result = runPipeline(scenes, { reconciler });

    const rs = reconciler.stats();
    postLog("info", `Scene CFGs: ${rs.scenes.total} (${rs.scenes.cached} cached, ${rs.scenes.built} built)`);
    postLog("info", `CFG visitors: ${rs.cfgs.cached} cached, ${rs.cfgs.computed} computed`);

    const { linked } = result.extracted;
    postLog("info", `Linked: ${Object.keys(linked.cfgs).length} cfgs`);
    if (result.navigationErrors.length > 0) {
      postLog("warn", `Navigation errors: ${result.navigationErrors.length}`);
      for (const err of result.navigationErrors) {
        postLog("warn", `  ${err.severity}: ${err.message}`);
      }
    }

    postStage("Serialize");
    const files = serializeResults(result);

    const elapsed = Math.round(performance.now() - t0);
    self.postMessage({ type: "done", elapsed, files });
  } catch (err) {
    self.postMessage({ type: "error", text: String(err) });
  }
};
