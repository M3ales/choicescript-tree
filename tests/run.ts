import fs from "node:fs";
import path from "node:path";
import { setIO } from "../out-dir";
import { MemoryIO } from "../io/memory-io";
import { Scene } from "../scanner/scene";
import { scanLabelNames } from "../scanner/scan-label-names";
import { scanScene } from "../scanner/scanner";
import { flattenProse } from "../scanner/flatten-prose";
import { ChoiceOptionToken, ProseToken, Token } from "../scanner/tokens";
import { Parser } from "../parser/parser";
import { SceneAst } from "../parser/scene";
import { Statement } from "../parser/statements";
import { buildControlFlow } from "../analysis/control-flow-graph/build-scene/build-control-flow";
import { NdjsonWriter } from "../analysis/ndjson";
import { CodeBlock } from "../analysis/control-flow-graph/data/code-block";
import { SceneControlFlowGraph } from "../analysis/control-flow-graph/build-scene/scene-control-flow-graph";
import { Cfg } from "../analysis/ref-cfg/data";
import { extractCfgs, runCfgVisitors } from "../analysis/ref-cfg/extract-cfgs";
import { linkCfgs } from "../analysis/ref-cfg/link-cfgs";
import { TransferPass } from "../analysis/ref-cfg/passes/transfer-pass";
import { getOrSet } from "../analysis/control-flow-graph/graph-utils";
import { analyseCfgLoops, refineTripCounts, LoopAnalysis } from "../analysis/ref-cfg/loop-analysis";
import { buildContextGraph } from "../analysis/ref-cfg/context-graph";
import { DataflowResult } from "../analysis/ref-cfg/dataflow";
import { solveDominatorDataflow } from "../analysis/ref-cfg/dominator-walk";
import { CfgTransfer } from "../analysis/ref-cfg/cfg-transfer";
import { buildSegments } from "../analysis/segments/build-segments";
import { analyseSegmentLoops } from "../analysis/segments/segment-loop-analysis";
import { solveSegmentDataflow } from "../analysis/segments/segment-dataflow";
import { bridgeSegmentDataflow } from "../analysis/segments/bridge-dataflow";

const SNIPPETS_DIR = path.resolve(import.meta.dirname, "snippets");
const UPDATE_SNAPSHOTS = process.argv.includes("--update");

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface SnapshotDef {
  filename: string;
  data: unknown;
}

const buildScenes = (snippetDir: string): Scene[] => {
  const files = fs.readdirSync(snippetDir).filter(f => f.endsWith(".txt"));
  return files.map(f => ({
    sourceUrl: `test://${f}`,
    name: f.replace(/\.txt$/, ""),
    content: fs.readFileSync(path.join(snippetDir, f), "utf-8"),
    error: undefined,
    flow: [],
  }));
};

const scanAndParse = (scenes: Scene[]): { tokens: Token[][]; asts: SceneAst[] } => {
  const knownLabels = scenes.flatMap(s => scanLabelNames(s));
  const sceneNames = scenes.map(s => s.name);

  const allTokens: Token[][] = [];
  let tokenId = 0;

  for (const scene of scenes) {
    const { tokens: raw } = scanScene(scene, knownLabels, sceneNames);
    const expanded = expandProse(raw, knownLabels, sceneNames);
    for (const t of expanded) {
      t.id = tokenId++;
    }
    allTokens.push(expanded);
  }

  const asts: SceneAst[] = [];
  for (const sceneTokens of allTokens) {
    if (sceneTokens.length === 0) continue;
    const parser = new Parser(sceneTokens);
    const ast = parser.parseScene();
    if (ast) asts.push(ast);
  }

  return { tokens: allTokens, asts };
};

const expandProse = (
  sceneTokens: Token[],
  knownLabels: string[],
  sceneNames: string[],
): Token[] => {
  const out: Token[] = [];
  for (const token of sceneTokens) {
    if (token.type === "Prose") {
      const prose = token as ProseToken;
      const flat = flattenProse(prose.content, {
        sceneName: token.sceneName,
        lineNumber: token.lineNumber,
        position: token.position,
        indent: token.indent,
        knownLabels,
        sceneNames,
      });
      if (flat.length > 0 && flat[0].type !== "Prose") {
        out.push({
          type: "Prose",
          sceneName: token.sceneName,
          lineNumber: token.lineNumber,
          position: token.position,
          indent: token.indent,
          content: "",
        } as ProseToken);
      }
      out.push(...flat);
    } else if (token.type === "ChoiceOption") {
      const opt = token as ChoiceOptionToken;
      out.push(opt);
      if (opt.rawText && opt.rawText.length > 0) {
        const flat = flattenProse(opt.rawText, {
          sceneName: token.sceneName,
          lineNumber: token.lineNumber,
          position: token.position + 1,
          indent: token.indent,
          knownLabels,
          sceneNames,
        });
        out.push(...flat);
      }
    } else {
      out.push(token);
    }
  }
  return out;
};

const stripVolatile = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(stripVolatile);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "id" || k === "statementId") continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return obj;
};

const collectStatements = (parsedScenes: SceneAst[]): Record<string, Statement> => {
  const stmtById: Record<string, Statement> = {};
  for (const scene of parsedScenes) {
    const walk = (stmts: Statement[]) => {
      for (const stmt of stmts) {
        stmtById[`${scene.name}:${stmt.statementId}`] = stmt;
        if ("body" in stmt && Array.isArray((stmt as any).body)) walk((stmt as any).body);
        if ("options" in stmt && Array.isArray((stmt as any).options)) {
          for (const opt of (stmt as any).options) if (opt.body) walk(opt.body);
        }
        if ("elseIfBranches" in stmt && Array.isArray((stmt as any).elseIfBranches)) {
          for (const branch of (stmt as any).elseIfBranches) if (branch.body) walk(branch.body);
        }
        if ("elseBranch" in stmt && (stmt as any).elseBranch?.body) walk((stmt as any).elseBranch.body);
      }
    };
    walk(scene.statements);
  }
  return stmtById;
};

const buildLinkedCfg = (
  parsedScenes: SceneAst[],
  sceneCfgs: Map<string, SceneControlFlowGraph>,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
) => {
  const allCfgs: Record<string, Cfg> = {};
  const transfers = new Map<string, CfgTransfer>();

  for (const scene of parsedScenes) {
    const sceneCfg = sceneCfgs.get(scene.name);
    if (!sceneCfg) continue;
    for (const extracted of extractCfgs(scene.name, sceneCfg, statements)) {
      allCfgs[extracted.cfg.id] = extracted.cfg;
      const pass = new TransferPass();
      runCfgVisitors(extracted.cfg, blockIndex, statements, [pass]);
      transfers.set(extracted.cfg.id, pass.finish(extracted.cfg));
    }
  }

  if (Object.keys(allCfgs).length === 0) return null;

  const linked = linkCfgs(parsedScenes, allCfgs, sceneCfgs);

  const blockToCfg = new Map<string, string>();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      blockToCfg.set(blockId, cfg.id);
    }
  }

  const cfgSuccessors = new Map<string, Set<string>>();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type === "cfg") {
        getOrSet(cfgSuccessors, cfg.id, () => new Set()).add(exit.target.cfgId);
      }
      if (exit.continuation) {
        const contCfgId = linked.cfgs[exit.continuation]
          ? exit.continuation
          : blockToCfg.get(exit.continuation);
        if (contCfgId) {
          getOrSet(cfgSuccessors, cfg.id, () => new Set()).add(contCfgId);
        }
      }
    }
  }

  return { linked, transfers, blockToCfg, cfgSuccessors, blockIndex, statements };
};

const buildLoopSnapshot = (ctx: NonNullable<ReturnType<typeof buildLinkedCfg>>) => {
  const loopAnalysis = analyseCfgLoops(ctx.linked, ctx.transfers, ctx.blockToCfg, ctx.cfgSuccessors, ctx.blockIndex, ctx.statements);
  return {
    loopAnalysis,
    snapshot: loopAnalysis.loops.map(loop => ({
      headerCfgId: loop.headerCfgId,
      bodyCfgIds: loop.bodyCfgIds.sort(),
      backEdgeCount: loop.backEdges.length,
      exitCount: loop.exitLinks.length,
      mechanism: loop.classification.mechanism,
      pure: loop.classification.pure,
      bound: loop.classification.bound,
      tripCount: loop.classification.tripCount,
      unrollDepth: loop.classification.unrollDepth,
      infinite: loop.classification.infinite,
      ...(loop.classification.infiniteCondition ? { infiniteCondition: loop.classification.infiniteCondition } : {}),
    })),
  };
};

const formatValue = (v: { kind: string; value?: unknown; values?: unknown[]; min?: number; max?: number }): string => {
  if (v.kind === "constant") return String(v.value);
  if (v.kind === "set" && v.values) return `{${[...v.values].sort().join(",")}}`;
  if (v.kind === "range") return `[${v.min}..${v.max}]`;
  return v.kind;
};

const buildDataflowSnapshot = (
  ctx: NonNullable<ReturnType<typeof buildLinkedCfg>>,
  loopAnalysis: LoopAnalysis,
) => {
  let graph = buildContextGraph(ctx.linked, loopAnalysis, ctx.blockToCfg);
  let dataflow = solveDominatorDataflow(graph, ctx.linked, ctx.transfers, ctx.blockIndex, ctx.statements);

  for (let pass = 0; pass < 10; pass++) {
    const changed = refineTripCounts(loopAnalysis, dataflow, ctx.linked, ctx.statements);
    if (!changed) break;
    graph = buildContextGraph(ctx.linked, loopAnalysis, ctx.blockToCfg);
    dataflow = solveDominatorDataflow(graph, ctx.linked, ctx.transfers, ctx.blockIndex, ctx.statements);
  }

  return {
    states: dataflow.cfgStates.map(cs => {
      const entries = cs.entryIds.map(id => dataflow.stateStore.get(id)!);
      const exits = cs.exitIds.map(id => dataflow.stateStore.get(id)!);
      return {
        cfgId: cs.cfgId,
        entryGlobals: entries.map(e => Object.fromEntries(
          Object.entries(e.globals).map(([k, v]) => [k, formatValue(v as any)]),
        )),
        exitGlobals: exits.map(e => Object.fromEntries(
          Object.entries(e.globals).map(([k, v]) => [k, formatValue(v as any)]),
        )),
      };
    }),
    diagnostics: {
      unresolvedExits: graph.diagnostics.unresolvedExits.length,
      droppedContexts: graph.diagnostics.droppedContexts.length,
      missingCfgs: graph.diagnostics.missingCfgs,
    },
  };
};

const checkSnapshot = (
  snippetDir: string,
  filename: string,
  actual: string,
): { passed: boolean; error?: string } => {
  const expectedPath = path.join(snippetDir, filename);

  if (UPDATE_SNAPSHOTS) {
    fs.writeFileSync(expectedPath, actual, "utf-8");
    return { passed: true };
  }

  if (!fs.existsSync(expectedPath)) {
    fs.writeFileSync(expectedPath, actual, "utf-8");
    return { passed: true, error: `${filename} created (first run)` };
  }

  const expected = fs.readFileSync(expectedPath, "utf-8");
  if (expected.trimEnd() === actual.trimEnd()) {
    return { passed: true };
  }

  return {
    passed: false,
    error: `${filename} mismatch — run with --update to accept`,
  };
};

const runSnippet = (snippetDir: string, name: string): TestResult => {
  try {
    const io = new MemoryIO();
    setIO(io);

    const scenes = buildScenes(snippetDir);
    const { tokens, asts } = scanAndParse(scenes);

    const snapshots: SnapshotDef[] = [
      { filename: "expected-tokens.json", data: stripVolatile(tokens) },
      { filename: "expected.json", data: stripVolatile(asts) },
    ];

    const hasParseErrors = asts.some(a => a.parseErrors.length > 0);

    if (asts.length > 0 && !hasParseErrors) {
      const blockWriter = new NdjsonWriter("test://blocks.ndjson");
      const sceneCfgs = new Map<string, SceneControlFlowGraph>();
      const cfgs = asts.map(ast => {
        const cfg = buildControlFlow(ast, blockWriter);
        sceneCfgs.set(ast.name, cfg);
        return cfg;
      });
      blockWriter.flush();
      snapshots.push({ filename: "expected-cfg.json", data: stripVolatile(cfgs) });

      const blockIndex: Record<string, CodeBlock> = {};
      for (const [, sceneCfg] of sceneCfgs) {
        for (const [blockId, block] of Object.entries(sceneCfg.blockIndex)) {
          blockIndex[blockId] = block;
        }
      }

      const statements = collectStatements(asts);
      const ctx = buildLinkedCfg(asts, sceneCfgs, blockIndex, statements);
      if (ctx) {
        const { loopAnalysis, snapshot: loopSnapshot } = buildLoopSnapshot(ctx);

        const dataflowSnapshot = buildDataflowSnapshot(ctx, loopAnalysis);

        // Loop snapshot after dataflow so refineTripCounts is reflected
        const refinedLoopSnapshot = loopAnalysis.loops.map(loop => ({
          headerCfgId: loop.headerCfgId,
          bodyCfgIds: loop.bodyCfgIds.sort(),
          backEdgeCount: loop.backEdges.length,
          exitCount: loop.exitLinks.length,
          mechanism: loop.classification.mechanism,
          pure: loop.classification.pure,
          bound: loop.classification.bound,
          tripCount: loop.classification.tripCount,
          unrollDepth: loop.classification.unrollDepth,
          infinite: loop.classification.infinite,
          ...(loop.classification.infiniteCondition ? { infiniteCondition: loop.classification.infiniteCondition } : {}),
        }));
        snapshots.push({ filename: "expected-loops.json", data: refinedLoopSnapshot });
        snapshots.push({ filename: "expected-dataflow.json", data: dataflowSnapshot });

        const segmentGraph = buildSegments(ctx.linked, ctx.blockIndex, ctx.statements);
        const segmentLoops = analyseSegmentLoops(segmentGraph);

        const segmentSnapshot = {
          segmentCount: Object.keys(segmentGraph.segments).length,
          edgeCount: segmentGraph.edges.length,
          entrySegmentId: segmentGraph.entrySegmentId,
          segments: Object.fromEntries(
            Object.entries(segmentGraph.segments).map(([id, seg]) => [id, {
              cfgId: seg.cfgId,
              entries: seg.entries.map(e => ({
                kind: e.kind,
                ...(e.metadata?.effectiveReuse ? { reuse: e.metadata.effectiveReuse } : {}),
              })),
              exits: seg.exits.map(e => ({ kind: e.kind })),
              blockCount: seg.blockIds.length,
              gosubCount: seg.gosubBindings.length,
            }]),
          ),
          edges: segmentGraph.edges.map(e => ({
            source: e.sourceSegmentId,
            target: e.targetSegmentId,
            ...(e.metadata?.effectiveReuse ? { reuse: e.metadata.effectiveReuse } : {}),
            ...(e.metadata?.conditionStatementId ? { hasCondition: true } : {}),
          })),
        };

        const segmentLoopSnapshot = {
          loopCount: segmentLoops.loops.length,
          loops: segmentLoops.loops.map(loop => ({
            bound: loop.bound,
            infinite: loop.infinite,
            iterCap: loop.iterCap,
            memberCount: loop.memberIds.length,
            headerIds: loop.headerIds.sort(),
            backEdgeCount: loop.backEdges.length,
            exitEdgeCount: loop.exitEdges.length,
            allHideReuse: loop.allHideReuse,
            choiceOptionCount: loop.choiceOptionCount,
          })),
        };

        snapshots.push({ filename: "expected-segments.json", data: segmentSnapshot });
        snapshots.push({ filename: "expected-segment-loops.json", data: segmentLoopSnapshot });

        if (Object.keys(segmentGraph.segments).length > 0) {
          const segDf = solveSegmentDataflow(segmentGraph, ctx.linked, ctx.blockIndex, ctx.statements);
          const segDfSnapshot = {
            totalIterations: segDf.totalIterations,
            widenedSccs: segDf.widenedSccs,
            stateCount: segDf.segmentStates.size,
            cfgEntryStateCount: segDf.cfgEntryStates.size,
            blockDeltaCount: segDf.blockDeltas.size,
            blockMappedCount: segDf.blockToSegment.size,
            states: Object.fromEntries(
              [...segDf.segmentStates.entries()].map(([id, s]) => [id, {
                entryGlobals: Object.fromEntries(
                  Object.entries(s.entry.globals).map(([k, v]) => [k, formatValue(v as any)]),
                ),
                exitGlobals: Object.fromEntries(
                  Object.entries(s.exit.globals).map(([k, v]) => [k, formatValue(v as any)]),
                ),
              }]),
            ),
            cfgEntryStates: Object.fromEntries(
              [...segDf.cfgEntryStates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cfgId, s]) => [cfgId, {
                globals: Object.fromEntries(
                  Object.entries(s.globals).map(([k, v]) => [k, formatValue(v as any)]),
                ),
              }]),
            ),
          };
          snapshots.push({ filename: "expected-segment-dataflow.json", data: segDfSnapshot });

          const analysisSnapshot = {
            deadBranchCount: segDf.deadBranches.length,
            deadBranches: segDf.deadBranches
              .sort((a, b) => a.blockId.localeCompare(b.blockId))
              .map(d => ({ blockId: d.blockId, scene: d.scene, reason: d.reason })),
            controlFlowViolationCount: segDf.controlFlowViolations.length,
            controlFlowViolations: segDf.controlFlowViolations
              .sort((a, b) => a.blockId.localeCompare(b.blockId))
              .map(v => ({ blockId: v.blockId, scene: v.scene, kind: v.kind })),
            undeclaredSetCount: segDf.undeclaredSets.length,
            undeclaredSets: segDf.undeclaredSets
              .sort((a, b) => `${a.variable}:${a.statementId}`.localeCompare(`${b.variable}:${b.statementId}`))
              .map(u => ({ variable: u.variable, scene: u.scene, kind: u.kind, statementKind: u.statementKind })),
            multiReplaceViolationCount: segDf.multiReplaceViolations.length,
            multiReplaceViolations: segDf.multiReplaceViolations
              .sort((a, b) => `${a.scene}:${a.line}`.localeCompare(`${b.scene}:${b.line}`))
              .map(v => ({ scene: v.scene, line: v.line, kind: v.kind, selectorValue: v.selectorValue, alternativeCount: v.alternativeCount })),
          };
          snapshots.push({ filename: "expected-analysis.json", data: analysisSnapshot });

          const bridged = bridgeSegmentDataflow(segDf, ctx.linked);
          const bridgedSnapshot = {
            cfgCount: bridged.cfgStates.length,
            states: bridged.cfgStates
              .sort((a, b) => a.cfgId.localeCompare(b.cfgId))
              .map(cs => {
                const entries = cs.entryIds.map(id => bridged.stateStore.get(id)!);
                return {
                  cfgId: cs.cfgId,
                  entryGlobals: entries.map(e => Object.fromEntries(
                    Object.entries(e.globals).map(([k, v]) => [k, formatValue(v as any)]),
                  )),
                };
              }),
          };
          snapshots.push({ filename: "expected-bridged-dataflow.json", data: bridgedSnapshot });
        }
      }
    }

    const errors: string[] = [];
    for (const snap of snapshots) {
      const json = JSON.stringify(snap.data, null, 2);
      const result = checkSnapshot(snippetDir, snap.filename, json);
      if (!result.passed) errors.push(result.error!);
      else if (result.error) errors.push(result.error);
    }

    const failed = errors.some(e => e.includes("mismatch"));
    return {
      name,
      passed: !failed,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

const main = () => {
  const snippetDirs = fs.readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const filter = process.argv.find(a => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);

  const toRun = filter
    ? snippetDirs.filter(d => d.includes(filter))
    : snippetDirs;

  console.log(`Running ${toRun.length} snippet test(s)...\n`);

  const results: TestResult[] = [];
  for (const dir of toRun) {
    const result = runSnippet(path.join(SNIPPETS_DIR, dir), dir);
    const icon = result.passed ? "PASS" : "FAIL";
    const suffix = result.error ? ` (${result.error})` : "";
    console.log(`  ${icon}  ${result.name}${suffix}`);
    results.push(result);
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) process.exit(1);
};

main();
