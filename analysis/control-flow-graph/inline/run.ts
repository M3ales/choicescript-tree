import "../../../bootstrap";
import { existsSync } from "fs";
import { inlineCfg } from "./inline-cfg";
import { readCfg, readStatements, serialiseInlineCfg, BlockResolver } from "../cfg-io";
import { writeNdjson } from "../../ndjson";
import { outPath, getIO } from "../../../out-dir";

const cfg = readCfg(outPath("cfg.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));

const originalBlocks = Object.keys(cfg.blocks).length;
const originalEdges = cfg.edges.length;

console.log(`Inline CFG: starting with ${originalBlocks} blocks, ${originalEdges} edges`);

const { flatten: flattened, inline: inlined, unroll: unrolled, loopResult } = inlineCfg(cfg, statements, resolver);

console.log(`  Flatten: ${flattened.totalEntries} subroutines, ${flattened.totalLoopsUnrolled} loops unrolled in subroutine bodies`);
console.log(`  Gosub inlining: ${inlined.gosubsInlined} call sites inlined`);

const unresolvedGosubs = inlined.errors.filter(e => e.kind === "unresolved-gosub");
if (unresolvedGosubs.length > 0) {
  console.error(`  ERROR: ${unresolvedGosubs.length} gosub call(s) could not be inlined:`);
  for (const e of unresolvedGosubs) {
    if (e.kind === "unresolved-gosub") {
      const target = e.label ?? e.targetBlockId ?? "(dynamic)";
      console.error(`    ${e.callerBlockId} -> ${target}`);
    }
  }
  process.exit(1);
}

const inlinedOriginals = inlined.errors.filter(e => e.kind === "inlined-original");
const unreachableErrors = inlined.errors.filter(e => e.kind === "unreachable-block");
if (inlinedOriginals.length > 0) {
  console.log(`  ${inlinedOriginals.length} original subroutine block(s) pruned (inlined)`);
}
if (unreachableErrors.length > 0) {
  console.log(`  ${unreachableErrors.length} unreachable block(s) pruned`);
}

const boundedLoops = loopResult.loops.filter(l => l.tripCount !== null);
console.log(`  Loop analysis: ${loopResult.loops.length} loops detected, ${boundedLoops.length} bounded`);
console.log(`  Loop unrolling: ${unrolled.loopsUnrolled} loops unrolled, +${unrolled.blocksAdded} blocks, +${unrolled.edgesAdded} edges`);

const serializable: any[] = loopResult.loops.map(loop => ({
  headerId: loop.headerId,
  bodySize: loop.bodyBlockIds.length,
  backEdgeCount: loop.backEdges.length,
  tripCount: loop.tripCount,
  bounds: loop.bounds,
}));

const finalCfg = unrolled.cfg;
console.log(`  Result: ${Object.keys(finalCfg.blocks).length} blocks, ${finalCfg.edges.length} edges`);

const blockRefIds = new Set(Object.keys(finalCfg.blocks));
const danglingEdges = finalCfg.edges.filter(
  e => e.targetBlockId && !blockRefIds.has(e.targetBlockId),
);
if (danglingEdges.length > 0) {
  console.log(`  ${danglingEdges.length} dangling edges (target block not found):`);
  for (const e of danglingEdges.slice(0, 10)) {
    console.log(`    ${e.id}: ${e.sourceBlockId} -> ${e.targetBlockId} [${e.kind}]`);
  }
}

const remainingGosubCalls = finalCfg.edges.filter(
  e => e.kind === "GoSubCall" || e.kind === "GoSubSceneCall",
).length;
const remainingReturns = finalCfg.edges.filter(e => e.kind === "Return").length;
if (remainingGosubCalls > 0 || remainingReturns > 0) {
  console.log(`  Remaining: ${remainingGosubCalls} gosub calls, ${remainingReturns} return edges (unresolved)`);
}

const inlinedCalls = finalCfg.edges.filter(
  e => e.kind === "InlinedGoSubCall" || e.kind === "InlinedGoSubSceneCall",
).length;
const inlinedReturns = finalCfg.edges.filter(e => e.kind === "InlinedReturn").length;
if (inlinedCalls > 0 || inlinedReturns > 0) {
  console.log(`  Inlined: ${inlinedCalls} gosub calls, ${inlinedReturns} return edges`);
}

const recordCount = writeNdjson(outPath("inline-cfg.ndjson"), serialiseInlineCfg({
  blockRefs: Object.values(finalCfg.blocks),
  edges: finalCfg.edges,
  statementIndex: finalCfg.statementIndex,
  entryBlockId: finalCfg.entryBlockId,
  sceneOrder: finalCfg.sceneOrder,
}));
console.log(`Wrote inline-cfg.ndjson (${recordCount} records)`);

if (inlined.errors.length > 0) {
  getIO().writeFile(
    outPath("inline-cfg-errors.json"),
    JSON.stringify(inlined.errors, null, 2),
  );
  console.log(`Wrote inline-cfg-errors.json (${inlined.errors.length} errors)`);
}

const statsCfgPath = outPath("cfg-stats.ndjson");
if (existsSync(statsCfgPath)) {
  const statsCfg = readCfg(statsCfgPath);
  console.log(`\nStats CFG: starting with ${Object.keys(statsCfg.blocks).length} blocks, ${statsCfg.edges.length} edges`);

  const statsResult = inlineCfg(statsCfg, statements, resolver);
  const statsFinalCfg = statsResult.unroll.cfg;

  const statsLoops = statsResult.loopResult.loops.map(loop => ({
    headerId: loop.headerId,
    bodySize: loop.bodyBlockIds.length,
    backEdgeCount: loop.backEdges.length,
    tripCount: loop.tripCount,
    bounds: loop.bounds,
  }));
  serializable.push(...statsLoops);

  const statsRecordCount = writeNdjson(outPath("inline-cfg-stats.ndjson"), serialiseInlineCfg({
    blockRefs: Object.values(statsFinalCfg.blocks),
    edges: statsFinalCfg.edges,
    statementIndex: statsFinalCfg.statementIndex,
    entryBlockId: statsFinalCfg.entryBlockId,
    sceneOrder: statsFinalCfg.sceneOrder,
  }));
  console.log(`Wrote inline-cfg-stats.ndjson (${statsRecordCount} records)`);
  console.log(`  Result: ${Object.keys(statsFinalCfg.blocks).length} blocks, ${statsFinalCfg.edges.length} edges`);
}

getIO().writeFile(outPath("loop-analysis.json"), JSON.stringify(serializable, null, 2));
