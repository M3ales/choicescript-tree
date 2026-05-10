import "../../bootstrap";
import { ControlFlowGraph } from "../control-flow-graph/data";
import { Statement } from "../../parser/statements";
import { solve } from "./solve";
import { resolveEdges } from "./resolve-edges";
import { VariableSummary } from "./dataflow-result";
import { AbstractValue, join as joinValue, equals as valueEquals, bottom } from "./abstract-value";
import { VariableState } from "./variable-state";
import { writeBlockStates } from "./block-states";
import { readInlineCfg, readStatements, BlockResolver, sceneOf } from "../control-flow-graph/cfg-io";
import { outPath, getIO } from "../../out-dir";

const cfg = readInlineCfg(outPath("inline-cfg.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));

console.log("Starting dataflow analysis...");
console.log(
  `  ${Object.keys(cfg.blocks).length} blocks, ${cfg.edges.length} edges`
);

const { entryStates, exitStates, iterations } = solve(cfg, statements, resolver);

console.log(`  Walk completed in ${iterations} steps`);
console.log(`  ${exitStates.size} blocks with computed states`);

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

// Write per-block states as NDJSON (entry + delta to exit)
const blockEntries = new Map<
  string,
  { scene: string; entryState: VariableState; exitState: VariableState }
>();
for (const [blockId, exitState] of exitStates) {
  if (!cfg.blocks[blockId]) continue;
  const entry = entryStates.get(blockId);
  if (!entry) continue;
  blockEntries.set(blockId, { scene: sceneOf(blockId), entryState: entry, exitState });
}

const blockCount = writeBlockStates(
  outPath("block-states.ndjson"),
  blockEntries,
  cfg,
  statements,
  resolver
);
console.log(`  Wrote ${blockCount} block states to block-states.ndjson`);

// Build variable summary from per-block entry/exit states
const variableSummary = buildVariableSummary(cfg, entryStates, exitStates, statements);
console.log(
  `  ${Object.keys(variableSummary).length} variables tracked`
);

// Write NDJSON: meta, resolved edges, unresolved edges, variables
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

function buildVariableSummary(
  cfg: ControlFlowGraph,
  entryStates: Map<string, VariableState>,
  exitStates: Map<string, VariableState>,
  statements: Record<string, Statement>
): Record<string, VariableSummary> {
  const summary: Record<string, VariableSummary> = {};

  for (const [, stmt] of Object.entries(statements)) {
    if (stmt.kind !== "DeclareVariable") continue;
    const decl = stmt as any;
    const name = decl.variable?.value;
    if (!name || summary[name]) continue;
    summary[name] = {
      name,
      scope: decl.scope ?? "Global",
      possibleValues: bottom,
      perScene: {},
    };
  }

  // Track which scenes actually change each variable (entry != exit)
  const changedScenes = new Map<string, Set<string>>();

  for (const [blockId, exitState] of exitStates) {
    if (!cfg.blocks[blockId]) continue;
    const scene = sceneOf(blockId);
    const entryState = entryStates.get(blockId);

    for (const [name, exitValue] of exitState.globals) {
      if (!summary[name]) {
        summary[name] = { name, scope: "Global", possibleValues: bottom, perScene: {} };
      }
      summary[name].possibleValues = joinValue(
        summary[name].possibleValues,
        exitValue
      );
      summary[name].perScene[scene] = summary[name].perScene[scene]
        ? joinValue(summary[name].perScene[scene], exitValue)
        : exitValue;

      const entryValue = entryState?.globals.get(name) ?? bottom;
      if (!valueEquals(entryValue, exitValue)) {
        if (!changedScenes.has(name)) changedScenes.set(name, new Set());
        changedScenes.get(name)!.add(scene);
      }
    }
    for (const [tempScene, temps] of exitState.temps) {
      for (const [name, exitValue] of temps) {
        const key = `${tempScene}:${name}`;
        if (!summary[key]) {
          summary[key] = {
            name,
            scope: "Temporary",
            scene: tempScene,
            possibleValues: bottom,
            perScene: {},
          };
        }
        summary[key].possibleValues = joinValue(
          summary[key].possibleValues,
          exitValue
        );
        summary[key].perScene[tempScene] = summary[key].perScene[tempScene]
          ? joinValue(summary[key].perScene[tempScene], exitValue)
          : exitValue;

        const entryValue = entryState?.temps.get(tempScene)?.get(name) ?? bottom;
        if (!valueEquals(entryValue, exitValue)) {
          if (!changedScenes.has(key)) changedScenes.set(key, new Set());
          changedScenes.get(key)!.add(tempScene);
        }
      }
    }
  }

  // Filter perScene to only scenes that change the variable
  for (const [key, vs] of Object.entries(summary)) {
    const changed = changedScenes.get(key);
    if (!changed) {
      vs.perScene = {};
      continue;
    }
    for (const scene of Object.keys(vs.perScene)) {
      if (!changed.has(scene)) delete vs.perScene[scene];
    }
  }

  return summary;
}
