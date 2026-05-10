import "../bootstrap";
import { readInlineCfgRefs, readStatements, BlockResolver, sceneOf } from "./control-flow-graph/cfg-io";
import { isChoiceOptionEdge, Transition } from "./control-flow-graph/data";
import { ChoiceOptionStatement } from "../parser/statements";
import { outPath, getIO } from "../out-dir";

const cfg = readInlineCfgRefs(outPath("inline-cfg.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));

const guideLines = getIO().readFile(outPath("guide.ndjson")).split("\n").filter(Boolean);
const guideRecords = guideLines.map((line) => JSON.parse(line));
const guideChoices = guideRecords.filter((r: any) => r.kind === "choice");

const edgesBySource = new Map<string, Transition[]>();
for (const edge of cfg.edges) {
  let list = edgesBySource.get(edge.sourceBlockId);
  if (!list) { list = []; edgesBySource.set(edge.sourceBlockId, list); }
  list.push(edge);
}

let errors = 0;
let warnings = 0;
let checked = 0;

const error = (msg: string) => { console.error(`  ERROR: ${msg}`); errors++; };
const warn = (msg: string) => { console.warn(`  WARN: ${msg}`); warnings++; };

for (const choice of guideChoices) {
  checked++;
  const { num, blockId, scene, options } = choice;
  console.log(`\nChoice ${num} — ${scene} (${blockId})`);

  const ref = cfg.refs[blockId];
  if (!ref) {
    error(`Block ${blockId} not found in CFG`);
    continue;
  }

  const blockScene = sceneOf(blockId);
  if (blockScene !== scene) {
    error(`Scene mismatch: guide says "${scene}", block says "${blockScene}"`);
  }

  const outEdges = edgesBySource.get(blockId) ?? [];
  const choiceEdges = outEdges.filter((e) => isChoiceOptionEdge(e.kind) && e.targetBlockId);

  if (choiceEdges.length !== options.length) {
    error(`Option count mismatch: guide has ${options.length} options, CFG has ${choiceEdges.length} choice edges`);
  }

  for (let i = 0; i < choiceEdges.length; i++) {
    const edge = choiceEdges[i];
    const guideOpt = options[i];
    if (!guideOpt) {
      error(`Edge ${i} has no corresponding guide option`);
      continue;
    }

    const optStmtId = edge.metadata.optionStatementId;
    if (!optStmtId) {
      error(`Edge ${i} to ${edge.targetBlockId} has no optionStatementId`);
      continue;
    }

    const optStmt = statements[optStmtId];
    if (!optStmt) {
      error(`Statement ${optStmtId} not found in statement index`);
      continue;
    }

    if (optStmt.kind !== "ChoiceOption") {
      error(`Statement ${optStmtId} is ${optStmt.kind}, expected ChoiceOption`);
      continue;
    }

    const choiceOpt = optStmt as ChoiceOptionStatement;
    const stmtLabel = choiceOpt.token?.rawText ?? "";

    if (stmtLabel !== guideOpt.label) {
      error(`Option ${i} label mismatch:\n    guide:  "${guideOpt.label}"\n    source: "${stmtLabel}"`);
    }

    // Check conditions: selectable_if
    const hasSelectableIf = !!choiceOpt.selectableIf;
    const guideHasSelectableIf = guideOpt.conditions.some((c: string) => c.startsWith("selectable_if "));
    if (hasSelectableIf !== guideHasSelectableIf) {
      error(`Option ${i} "${stmtLabel}" selectable_if mismatch: source=${hasSelectableIf}, guide=${guideHasSelectableIf}`);
    }

    // Check conditions: choiceConditionId (visibility condition)
    const hasVisCondition = !!edge.metadata.choiceConditionId;
    const guideHasIfCond = guideOpt.conditions.some((c: string) => c.startsWith("if "));
    if (hasVisCondition !== guideHasIfCond) {
      warn(`Option ${i} "${stmtLabel}" visibility condition mismatch: edge has choiceConditionId=${hasVisCondition}, guide has if-condition=${guideHasIfCond}`);
    }

    // Verify target block exists
    if (!edge.targetBlockId) {
      error(`Edge ${i} to option "${stmtLabel}" has null target`);
    } else if (!cfg.refs[edge.targetBlockId]) {
      error(`Edge ${i} target ${edge.targetBlockId} not found in CFG`);
    }

    // Verify destination kind
    if (guideOpt.destKind === "choice" && guideOpt.destBlockId) {
      const destRef = cfg.refs[guideOpt.destBlockId];
      if (!destRef) {
        const stripped = guideOpt.destBlockId.replace(/^(unrolled|inlined): /, "");
        const found = Object.keys(cfg.refs).some((id) => {
          const r = cfg.refs[id];
          return id === stripped || r.sourceBlockId === guideOpt.destBlockId ||
            (r.sourceBlockId && r.sourceBlockId.replace(/^(unrolled|inlined): /, "") === stripped);
        });
        if (!found) {
          warn(`Option ${i} "${stmtLabel}" destBlockId "${guideOpt.destBlockId}" not found (may be canonical)`);
        }
      }
    }
  }

  // Check for extra guide options beyond CFG edges
  if (options.length > choiceEdges.length) {
    for (let i = choiceEdges.length; i < options.length; i++) {
      error(`Guide has extra option ${i}: "${options[i].label}" with no matching CFG edge`);
    }
  }
}

// Check enriched source consistency: verify each guide choice block appears in the enriched source
console.log("\n--- Enriched source cross-check ---");

for (const choice of guideChoices) {
  const { num, blockId, scene } = choice;
  const enrichedPath = outPath(`enriched-source/${scene}.txt`);

  if (!getIO().exists(enrichedPath)) {
    error(`Choice ${num}: enriched source file missing for scene "${scene}"`);
    continue;
  }

  const enrichedContent = getIO().readFile(enrichedPath);

  // Check block header appears
  if (!enrichedContent.includes(blockId)) {
    error(`Choice ${num}: block ${blockId} not mentioned in enriched source for ${scene}`);
  }

  // Check that each option's ChoiceOption edge appears in enriched source
  const outEdges = edgesBySource.get(blockId) ?? [];
  const choiceEdges = outEdges.filter((e) => isChoiceOptionEdge(e.kind) && e.targetBlockId);

  for (const edge of choiceEdges) {
    const optStmtId = edge.metadata.optionStatementId;
    if (!optStmtId) continue;

    const edgePattern = `${edge.targetBlockId} [${edge.kind}]`;
    if (!enrichedContent.includes(edge.targetBlockId!)) {
      warn(`Choice ${num}: edge target ${edge.targetBlockId} not in enriched source for ${scene}`);
    }
  }

  // Check that option labels from the guide appear as #-prefixed lines in enriched source
  for (const opt of choice.options) {
    const labelText = opt.label.trim();
    if (labelText.length === 0) continue;

    // In ChoiceScript source, options are prefixed with #
    // The enriched source preserves this as "  NNN │ ...#Label..."
    const hasInSource = enrichedContent.includes(`#${labelText}`) ||
      enrichedContent.includes(`# ${labelText}`);

    if (!hasInSource) {
      warn(`Choice ${num}: option label "${labelText.slice(0, 60)}…" not found as #-line in enriched source`);
    }
  }
}

// Check for choice blocks in CFG that are NOT in the guide
console.log("\n--- Coverage check: CFG choices not in guide ---");

const guideBlockIds = new Set(guideChoices.map((c: any) => c.blockId));
const allChoiceBlocks: string[] = [];

for (const blockId of Object.keys(cfg.refs)) {
  if (sceneOf(blockId) === "choicescript_stats") continue;
  const outEdges = edgesBySource.get(blockId) ?? [];
  if (outEdges.some((e) => isChoiceOptionEdge(e.kind))) {
    allChoiceBlocks.push(blockId);
  }
}

const missingFromGuide = allChoiceBlocks.filter((id) => !guideBlockIds.has(id));
const resolveCanonical = (id: string): string => {
  let current = id;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const r = cfg.refs[current];
    if (r?.sourceBlockId) current = r.sourceBlockId;
    else break;
  }
  return current;
};

const guideCanonicals = new Set(guideChoices.map((c: any) => resolveCanonical(c.blockId)));

let truelyMissing = 0;
for (const id of missingFromGuide) {
  const canonical = resolveCanonical(id);
  if (guideCanonicals.has(canonical)) continue;
  const block = resolver.get(id, cfg.refs);
  console.log(`  Missing: ${id} (${sceneOf(id)}${block?.label ? `, label=${block.label}` : ""})`);
  truelyMissing++;
}

if (truelyMissing === 0) {
  console.log("  All CFG choice blocks are covered by the guide (or their canonical source is).");
}

// Summary
console.log(`\n${"=".repeat(50)}`);
console.log(`Checked ${checked} guide choices`);
console.log(`Total CFG choice blocks: ${allChoiceBlocks.length} (excl. stats, ${Object.keys(cfg.refs).length} total refs)`);
console.log(`Guide covers: ${guideBlockIds.size} blocks (${guideCanonicals.size} canonical)`);
console.log(`Missing from guide: ${truelyMissing}`);
console.log(`Errors: ${errors}`);
console.log(`Warnings: ${warnings}`);
console.log(`${"=".repeat(50)}`);

process.exit(errors > 0 ? 1 : 0);
