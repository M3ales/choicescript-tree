import "../../bootstrap";
import { readInlineCfgRefs, readStatements, BlockResolver } from "../control-flow-graph/cfg-io";
import { buildChoiceTraces } from "./choice-trace";
import { analysePaths } from "./analyse-paths";
import { buildChoiceMap, ChoiceMapEntry } from "./choice-map";
import { DivergenceRecord } from "./divergence-record";
import { writeNdjson } from "../ndjson";
import { outPath, getIO } from "../../out-dir";

console.log("Loading CFG...");
const cfg = readInlineCfgRefs(outPath("inline-cfg.ndjson"));
console.log(
  `  ${Object.keys(cfg.refs).length} block refs, ${cfg.edges.length} edges`,
);

console.log("Loading loop analysis...");
const loopAnalysis: { headerId: string }[] = JSON.parse(
  getIO().readFile(outPath("loop-analysis.json")),
);
const loopHeaderIds = new Set(loopAnalysis.map((l) => l.headerId));
console.log(`  ${loopHeaderIds.size} loop headers`);

console.log("Analysing paths...");
const result = analysePaths(cfg, loopHeaderIds);

const divergences = Object.values(result.divergences);
const choices = divergences.filter((d) => d.kind === "choice");
const conditionals = divergences.filter((d) => d.kind === "conditional");
const withConverge = divergences.filter((d) => d.convergeBlockId !== null);
const loops = choices.filter((d) => d.isLoop);

console.log(`  ${divergences.length} divergence points`);
console.log(
  `    ${choices.length} choices (${loops.length} loops), ${conditionals.length} conditionals`,
);
console.log(
  `    ${withConverge.length} with convergence, ${divergences.length - withConverge.length} without`,
);

let condWithDivergingChoices = 0;
for (const d of conditionals) {
  const choiceSets = d.branches
    .map((b) => b.embeddedChoices)
    .filter((c) => c.length > 0);
  if (choiceSets.length >= 2) {
    const allSame =
      choiceSets.every((s) => s[0] === choiceSets[0][0]) &&
      choiceSets.every((s) => s.length === 1);
    if (!allSame) condWithDivergingChoices++;
  }
}
console.log(
  `    ${condWithDivergingChoices} conditionals with diverging embedded choices`,
);

let maxDepth = 0;
const depthOf = (blockId: string, seen: Set<string>): number => {
  if (seen.has(blockId)) return 0;
  seen.add(blockId);
  const d = result.divergences[blockId];
  if (!d) return 0;
  let childMax = 0;
  for (const branch of d.branches) {
    for (const nestedId of branch.nested) {
      childMax = Math.max(childMax, depthOf(nestedId, seen));
    }
  }
  return 1 + childMax;
};
for (const d of divergences) {
  maxDepth = Math.max(maxDepth, depthOf(d.blockId, new Set()));
}
console.log(`  Max nesting depth: ${maxDepth}`);

const count = writeNdjson(outPath("path-analysis.ndjson"), divergences);
console.log(`Wrote path-analysis.ndjson (${count} records)`);

// --- Pass 2: Choice map ---

console.log("\nLoading statements...");
const statements = readStatements(outPath("game-statements.ndjson"));
console.log(`  ${Object.keys(statements).length} statements`);

console.log("Building choice map...");
const choiceMap = buildChoiceMap(cfg, result, loopHeaderIds, statements);
console.log(`  ${choiceMap.choiceCount} choices mapped`);

const countKinds = (entries: ChoiceMapEntry[]): { branches: number; refs: number; splits: number } => {
  let branches = 0, refs = 0, splits = 0;
  for (const e of entries) {
    if (e.kind === "branch") {
      branches++;
      const r = countKinds(e.children);
      branches += r.branches; refs += r.refs; splits += r.splits;
    }
    if (e.kind === "ref") refs++;
    if (e.kind === "conditional-split") {
      splits++;
      for (const b of e.branches) {
        const r = countKinds(b.children);
        branches += r.branches; refs += r.refs; splits += r.splits;
      }
    }
  }
  return { branches, refs, splits };
};
const counts = countKinds(choiceMap.entries);
console.log(`  ${counts.branches} branches, ${counts.refs} back-references, ${counts.splits} conditional splits`);

if (choiceMap.warnings.length > 0) {
  console.log(`\n  ${choiceMap.warnings.length} warning(s):`);
  for (const w of choiceMap.warnings) console.log(`    ${w}`);
}

function* flattenEntries(entries: ChoiceMapEntry[], path: string[] = []): Iterable<Record<string, unknown>> {
  for (const e of entries) {
    if (e.kind === "choice") {
      yield { ...e, path };
    } else if (e.kind === "branch") {
      yield { kind: e.kind, optionLabels: e.optionLabels, fromChoiceNum: e.fromChoiceNum, convergeBlockId: e.convergeBlockId, length: e.length, path };
      yield* flattenEntries(e.children, [...path, e.optionLabels.join(" / ")]);
    } else if (e.kind === "ref") {
      yield { ...e, path };
    } else if (e.kind === "conditional-split") {
      yield { kind: e.kind, blockId: e.blockId, branchCount: e.branches.length, length: e.length, path };
      for (const b of e.branches) {
        const label = b.isElse ? "else" : `if (${b.conditionStatementId ?? "?"})`;
        yield* flattenEntries(b.children, [...path, label]);
      }
    }
  }
}

const choiceMapCount = writeNdjson(outPath("choice-map.ndjson"), flattenEntries(choiceMap.entries));
console.log(`Wrote choice-map.ndjson (${choiceMapCount} records)`);

const choiceMapJson = {
  entries: choiceMap.entries,
  choiceCount: choiceMap.choiceCount,
  numByCanonical: Object.fromEntries(choiceMap.numByCanonical),
  splitBlockIds: [...choiceMap.splitBlockIds],
  warnings: choiceMap.warnings,
};
getIO().writeFile(outPath("choice-map.json"), JSON.stringify(choiceMapJson));
console.log(`Wrote choice-map.json`);

// --- Pass 3: Choice traces ---

console.log("\nBuilding choice traces...");
const resolver = new BlockResolver(outPath("block-index.ndjson"));
const traceResult = buildChoiceTraces(cfg, resolver, statements, result, choiceMap, loopHeaderIds);
console.log(`  ${traceResult.choices.length} choice traces, ${traceResult.splits.length} split traces`);

getIO().writeFile(outPath("choice-trace.json"), JSON.stringify(traceResult));
console.log(`Wrote choice-trace.json`);
