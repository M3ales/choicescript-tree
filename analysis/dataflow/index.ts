import "../../bootstrap";
import { Transition } from "../control-flow-graph/data";
import { Statement } from "../../parser/statements";
import { solve } from "./solve";
import { resolveEdges } from "./resolve-edges";
import { VariableSummary } from "./dataflow-result";
import { AbstractValue, join as joinValue, equals as valueEquals, bottom } from "./abstract-value";
import { VariableState } from "./variable-state";
import { buildEdgeMaps, computeBlockRecord } from "./block-states";
import { readInlineCfg, readStatements, BlockResolver, sceneOf } from "../control-flow-graph/cfg-io";
import { outPath, getIO } from "../../out-dir";

const cfg = readInlineCfg(outPath("inline-cfg.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));

console.log("Starting dataflow analysis...");
console.log(
  `  ${Object.keys(cfg.blocks).length} blocks, ${cfg.edges.length} edges`
);

const { incoming: incomingEdges, outgoing: outgoingEdges } = buildEdgeMaps(cfg);

const variableSummary: Record<string, VariableSummary> = {};
const changedScenes = new Map<string, Set<string>>();
const blockStateChunks: string[] = [];

for (const [, stmt] of Object.entries(statements)) {
  if (stmt.kind !== "DeclareVariable") continue;
  const decl = stmt as any;
  const name = decl.variable?.value;
  if (!name || variableSummary[name]) continue;
  variableSummary[name] = {
    name,
    scope: decl.scope ?? "Global",
    possibleValues: bottom,
    perScene: {},
  };
}

const onBlock = (blockId: string, entryState: VariableState, exitState: VariableState) => {
  if (!cfg.blocks[blockId]) return;
  const scene = sceneOf(blockId);

  for (const [name, exitValue] of exitState.globals) {
    if (!variableSummary[name]) {
      variableSummary[name] = { name, scope: "Global", possibleValues: bottom, perScene: {} };
    }
    variableSummary[name].possibleValues = joinValue(
      variableSummary[name].possibleValues,
      exitValue
    );
    variableSummary[name].perScene[scene] = variableSummary[name].perScene[scene]
      ? joinValue(variableSummary[name].perScene[scene], exitValue)
      : exitValue;

    const entryValue = entryState.globals.get(name) ?? bottom;
    if (!valueEquals(entryValue, exitValue)) {
      if (!changedScenes.has(name)) changedScenes.set(name, new Set());
      changedScenes.get(name)!.add(scene);
    }
  }
  for (const [tempScene, temps] of exitState.temps) {
    for (const [name, exitValue] of temps) {
      const key = `${tempScene}:${name}`;
      if (!variableSummary[key]) {
        variableSummary[key] = {
          name,
          scope: "Temporary",
          scene: tempScene,
          possibleValues: bottom,
          perScene: {},
        };
      }
      variableSummary[key].possibleValues = joinValue(
        variableSummary[key].possibleValues,
        exitValue
      );
      variableSummary[key].perScene[tempScene] = variableSummary[key].perScene[tempScene]
        ? joinValue(variableSummary[key].perScene[tempScene], exitValue)
        : exitValue;

      const entryValue = entryState.temps.get(tempScene)?.get(name) ?? bottom;
      if (!valueEquals(entryValue, exitValue)) {
        if (!changedScenes.has(key)) changedScenes.set(key, new Set());
        changedScenes.get(key)!.add(tempScene);
      }
    }
  }

  const record = computeBlockRecord(
    blockId, scene, entryState, exitState, cfg, statements, resolver,
    incomingEdges.get(blockId) ?? [], outgoingEdges.get(blockId) ?? [],
  );
  if (record) blockStateChunks.push(JSON.stringify(record));
};

const pinnedBlocks = new Set<string>();
for (const edge of cfg.edges) {
  if (edge.targetBlockId === null && edge.metadata.dynamicExpression) {
    pinnedBlocks.add(edge.sourceBlockId);
  }
}

const { exitStates, iterations } = solve(cfg, statements, resolver, { onBlock, pinnedBlocks });

console.log(`  Walk completed in ${iterations} steps`);
console.log(`  ${exitStates.size} retained exit states`);

const { resolved, unresolved } = resolveEdges(
  cfg,
  exitStates,
  statements,
  resolver
);

console.log(`  Resolved ${resolved.length} dynamic edges`);
console.log(`  ${unresolved.length} edges remain unresolved`);

for (const edgeId of unresolved) {
  const edge = cfg.edges.find((e) => e.id === edgeId);
  if (!edge) continue;
  const targetScene = edge.metadata.targetScene ?? "";
  const targetLabel = edge.metadata.targetSceneLabel ?? edge.metadata.label ?? "";
  const dynamic = edge.metadata.dynamicExpression ? " [dynamic]" : "";
  console.log(
    `    ${edge.kind}: ${edge.sourceBlockId} → ${targetScene}${targetLabel ? "#" + targetLabel : ""}${dynamic}`
  );
}

for (const edge of resolved) {
  const targets = edge.resolvedTargets.map(
    (t) => `${t.value} → ${t.targetBlockId}`
  );
  console.log(`    ${edge.sourceBlockId}: ${targets.join(", ")}`);
}

getIO().writeFile(
  outPath("block-states.ndjson"),
  blockStateChunks.join("\n") + "\n",
);
console.log(`  Wrote ${blockStateChunks.length} block states to block-states.ndjson`);

for (const [key, vs] of Object.entries(variableSummary)) {
  const changed = changedScenes.get(key);
  if (!changed) {
    vs.perScene = {};
    continue;
  }
  for (const scene of Object.keys(vs.perScene)) {
    if (!changed.has(scene)) delete vs.perScene[scene];
  }
}

console.log(
  `  ${Object.keys(variableSummary).length} variables tracked`
);

const lines: string[] = [];
lines.push(JSON.stringify({ type: "meta", iterations }));
for (const edge of resolved) {
  lines.push(JSON.stringify({ type: "resolvedEdge", ...edge }));
}
for (const edgeId of unresolved) {
  lines.push(JSON.stringify({ type: "unresolvedEdge", edgeId }));
}
for (const vs of Object.values(variableSummary)) {
  lines.push(JSON.stringify({ type: "variable", ...vs }));
}
getIO().writeFile(outPath("dataflow.ndjson"), lines.join("\n") + "\n");
console.log(`Wrote dataflow.ndjson (${lines.length} records)`);
