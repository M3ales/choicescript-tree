import "../../bootstrap";
import { readInlineCfg, readBlockIndex, readStatements, sceneOf } from "../control-flow-graph/cfg-io";
import { BlockRef, Transition, isChoiceOptionEdge } from "../control-flow-graph/data";
import { AbstractValue } from "../dataflow/abstract-value";
import { BlockRecord, readBlockStates } from "../dataflow/block-states";
import { extractVariableReads } from "../dataflow/evaluate-expression";
import { readNdjsonSync } from "../ndjson";
import { outPath, getIO } from "../../out-dir";

interface RawScene {
  name: string;
  content: string;
}

const cfg = readInlineCfg(outPath("inline-cfg.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));
const rawScenes: RawScene[] = JSON.parse(
  getIO().readFile(outPath("raw-scenes.json"))
);

interface ReachabilityRecord {
  type: string;
  id?: string;
  scene?: string;
  kind?: string;
  sourceBlockId?: string;
  targetBlockId?: string;
  label?: string;
}

const blockIndex = readBlockIndex(outPath("block-index.ndjson"));
const reachabilityRecords = readNdjsonSync<ReachabilityRecord>(outPath("reachability.ndjson"));
const unreachableBlockIds = new Set<string>();
for (const rec of reachabilityRecords) {
  if (rec.type === "unreachable-block" && rec.id) unreachableBlockIds.add(rec.id);
}

const unreachableEdgeRecords = reachabilityRecords.filter(
  (r) => r.type === "unreachable-edge"
);

const targetScene = process.argv[2];

console.log("Loading block states...");
const blockStates = readBlockStates(outPath("block-states.ndjson"));
console.log(`  ${blockStates.size} blocks with dataflow`);

interface DebugBlock {
  id: string;
  sourceBlockId?: string;
  clonePurpose?: string;
  loopHeaderId?: string;
  iterationHeaderId?: string;
  exitType: string;
  scene: string;
  statementIds: string[];
  entryType: string;
  label?: string;
}

const toDebugBlock = (ref: BlockRef): DebugBlock => {
  const full = blockIndex[ref.id];
  return {
    id: ref.id,
    sourceBlockId: ref.sourceBlockId,
    clonePurpose: ref.clonedFrom?.purpose,
    loopHeaderId: ref.loopHeaderId,
    iterationHeaderId: ref.iterationHeaderId,
    exitType: ref.exitType,
    scene: full?.scene ?? sceneOf(ref.id),
    statementIds: full?.statementIds ?? [],
    entryType: full?.entryType ?? "SceneEntry",
    label: full?.label,
  };
};

const edgesBySource = new Map<string, Transition[]>();
for (const edge of cfg.edges) {
  let list = edgesBySource.get(edge.sourceBlockId);
  if (!list) {
    list = [];
    edgesBySource.set(edge.sourceBlockId, list);
  }
  list.push(edge);
}

const getLineNumber = (stmt: any): number | null => {
  return stmt.token?.lineNumber ?? stmt.content?.[0]?.lineNumber ?? null;
};

const parseBlockOrigin = (
  block: DebugBlock
): { annotation: string } => {
  const id = block.id;
  const src = block.sourceBlockId;

  if (block.clonePurpose === "unroll") {
    const iterMatch = id.match(/\.iter_(\d+)$/);
    const iter = iterMatch ? parseInt(iterMatch[1], 10) + 1 : null;
    const headerNote = block.loopHeaderId ? ` loop=${block.loopHeaderId}` : "";
    return {
      annotation: iter !== null
        ? `iteration ${iter}${headerNote}`
        : `unrolled${headerNote}`,
    };
  }

  if (block.clonePurpose === "inline" && src) {
    return { annotation: `inlined from ${src}` };
  }

  return { annotation: "" };
};

const formatAbstractValue = (av: AbstractValue): string => {
  switch (av.kind) {
    case "constant":
      return typeof av.value === "string" ? `"${av.value}"` : String(av.value);
    case "set": {
      const vals = av.values.map((v) =>
        typeof v === "string" ? `"${v}"` : String(v)
      );
      const suffix = av.hasUserInput ? " | input" : "";
      return `{${vals.join(", ")}${suffix}}`;
    }
    case "range": {
      const lo = av.min === -Infinity ? "-∞" : String(av.min);
      const hi = av.max === Infinity ? "∞" : String(av.max);
      return `[${lo}..${hi}]`;
    }
    case "input":
      return "input";
    case "loop":
      return "loop";
    case "top":
      return "⊤";
    case "bottom":
      return "⊥";
  }
};


const formatEdge = (e: Transition): string => {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(e.metadata)) {
    if (v != null) parts.push(`${k}=${v}`);
  }
  const meta = parts.join(", ");
  return `  │  → ${e.targetBlockId ?? "null"} [${e.kind}]${meta ? " " + meta : ""}`;
};

const formatBlockHeader = (
  block: DebugBlock,
  annotation: string,
  suffix: string = ""
): string => {
  const label = block.label ? ` [${block.label}]` : "";
  const note = annotation ? ` {${annotation}}` : "";
  return `  ┌─ ${block.id} (${block.entryType}${label})${note}${suffix}`;
};

const stmtToBlock = new Map<string, string>();
for (const block of Object.values(blockIndex)) {
  for (const stmtId of block.statementIds) {
    stmtToBlock.set(stmtId, block.id);
  }
}

const buildStmtAnnotations = (
  block: DebugBlock,
  blockRecord: BlockRecord | undefined
): Map<string, string[]> => {
  const result = new Map<string, string[]>();
  if (!blockRecord) return result;

  const stmts = blockRecord.stmts;
  if (!stmts) return result;

  for (const stmtId of block.statementIds) {
    const rec = stmts[stmtId];
    if (!rec) continue;

    const annotations: string[] = [];

    if (rec.reads) {
      for (const [name, val] of Object.entries(rec.reads)) {
        annotations.push(`${name} = ${formatAbstractValue(val)}`);
      }
    }

    if (rec.write) {
      const { variable, before, after } = rec.write;
      if (before.kind === "bottom") {
        annotations.push(`${variable} := ${formatAbstractValue(after)}`);
      } else {
        annotations.push(
          `${variable}: ${formatAbstractValue(before)} → ${formatAbstractValue(after)}`
        );
      }
    }

    if (annotations.length > 0) {
      result.set(stmtId, annotations);
    }
  }

  return result;
};

const sceneBlocks = new Map<string, DebugBlock[]>();
for (const ref of Object.values(cfg.blocks)) {
  const block = toDebugBlock(ref);
  let list = sceneBlocks.get(block.scene);
  if (!list) {
    list = [];
    sceneBlocks.set(block.scene, list);
  }
  list.push(block);
}

const sceneEdges = new Map<string, Transition[]>();
for (const edge of cfg.edges) {
  const scene = sceneOf(edge.sourceBlockId);
  let list = sceneEdges.get(scene);
  if (!list) {
    list = [];
    sceneEdges.set(scene, list);
  }
  list.push(edge);
}

const unreachableByScene = new Map<string, Set<number>>();
for (const blockId of unreachableBlockIds) {
  const block = blockIndex[blockId];
  if (!block) continue;
  for (const stmtId of block.statementIds) {
    const stmt = statements[stmtId];
    if (!stmt) continue;
    const line = getLineNumber(stmt);
    if (line === null) continue;
    let set = unreachableByScene.get(block.scene);
    if (!set) { set = new Set(); unreachableByScene.set(block.scene, set); }
    set.add(line);
  }
}

const edgeById = new Map<string, Transition>();
for (const edge of cfg.edges) edgeById.set(edge.id, edge);

const unreachableEdgeByScene = new Map<string, Map<number, string[]>>();
const seenEdgeAnnotations = new Set<string>();
for (const rec of unreachableEdgeRecords) {
  if (!rec.sourceBlockId) continue;
  const sourceScene = sceneOf(rec.sourceBlockId);

  const edge = rec.id ? edgeById.get(rec.id) : undefined;
  const condStmtId = edge?.metadata.conditionStatementId;
  if (!condStmtId) continue;
  const condStmt = statements[condStmtId];
  if (!condStmt) continue;
  const line = getLineNumber(condStmt);
  if (line === null) continue;

  const targetSourceId = rec.targetBlockId
    ? (cfg.blocks[rec.targetBlockId]?.sourceBlockId ?? rec.targetBlockId)
    : "?";
  const reason = rec.label
    ? `unreachable: "${rec.label}"`
    : `unreachable ${rec.kind ?? "edge"} → ${targetSourceId}`;

  const dedupKey = `${sourceScene}:${line}:${reason}`;
  if (seenEdgeAnnotations.has(dedupKey)) continue;
  seenEdgeAnnotations.add(dedupKey);

  let sceneMap = unreachableEdgeByScene.get(sourceScene);
  if (!sceneMap) { sceneMap = new Map(); unreachableEdgeByScene.set(sourceScene, sceneMap); }
  let list = sceneMap.get(line);
  if (!list) { list = []; sceneMap.set(line, list); }
  list.push(reason);
}

const renderScene = (sceneName: string, emit: (line: string) => void) => {
  const rawScene = rawScenes.find((r) => r.name === sceneName);
  if (!rawScene) return;

  const blocks = sceneBlocks.get(sceneName);
  if (!blocks) return;

  const unreachableLines = unreachableByScene.get(sceneName);
  const sourceLines = rawScene.content.split("\n");

  let originalBlocks = 0;
  let unrolledBlocks = 0;
  let inlinedBlocks = 0;
  const labels = new Set<string>();
  const loopHeaders = new Set<string>();
  const inlinedSources = new Set<string>();
  let stmtCount = 0;

  for (const block of blocks) {
    stmtCount += block.statementIds.length;
    if (block.label && !block.sourceBlockId) labels.add(block.label);

    if (block.clonePurpose === "unroll") {
      unrolledBlocks++;
      if (block.loopHeaderId) loopHeaders.add(block.loopHeaderId);
    } else if (block.clonePurpose === "inline") {
      inlinedBlocks++;
      if (block.sourceBlockId) inlinedSources.add(block.sourceBlockId);
    } else {
      originalBlocks++;
    }
  }

  const edges = sceneEdges.get(sceneName) ?? [];
  const exitEdges = edges.filter(
    (e) =>
      e.kind === "SceneProgression" ||
      e.kind === "SceneExit" ||
      e.kind === "GameEnd"
  );
  const gotoEdges = edges.filter((e) => e.kind === "Goto");
  const choiceEdges = edges.filter((e) => isChoiceOptionEdge(e.kind));

  const blockFirstLine = new Map<string, number>();
  for (const block of blocks) {
    if (block.statementIds.length === 0) continue;
    const firstStmtId = block.statementIds[0];
    const stmt = statements[firstStmtId];
    if (!stmt) continue;
    const line = getLineNumber(stmt);
    if (line !== null) blockFirstLine.set(block.id, line);
  }

  for (const block of blocks) {
    if (block.statementIds.length > 0) continue;
    const outEdges = edgesBySource.get(block.id);
    if (!outEdges) continue;
    for (const e of outEdges) {
      if (e.targetBlockId && blockFirstLine.has(e.targetBlockId)) {
        blockFirstLine.set(block.id, blockFirstLine.get(e.targetBlockId)!);
        break;
      }
    }
  }

  emit("");
  emit("=".repeat(60));
  emit(`Scene: ${sceneName}`);
  emit("=".repeat(60));
  emit(
    `  ${sourceLines.length} source lines, ${stmtCount} statements`
  );
  emit(
    `  ${blocks.length} blocks (${originalBlocks} original, ${unrolledBlocks} unrolled, ${inlinedBlocks} inlined), ${edges.length} edges`
  );
  if (labels.size > 0) {
    emit(`  ${labels.size} labels: ${[...labels].join(", ")}`);
  }
  if (loopHeaders.size > 0) {
    emit(
      `  ${loopHeaders.size} unrolled loops: ${[...loopHeaders].join(", ")}`
    );
  }
  if (inlinedSources.size > 0) {
    emit(
      `  ${inlinedSources.size} inlined subroutines: ${[...inlinedSources].join(", ")}`
    );
  }
  if (
    gotoEdges.length > 0 ||
    choiceEdges.length > 0 ||
    exitEdges.length > 0
  ) {
    const parts: string[] = [];
    if (gotoEdges.length > 0) parts.push(`${gotoEdges.length} gotos`);
    if (choiceEdges.length > 0)
      parts.push(`${choiceEdges.length} choice options`);
    if (exitEdges.length > 0) parts.push(`${exitEdges.length} exits`);
    emit(`  ${parts.join(", ")}`);
  }
  emit("─".repeat(60));

  const blockStartLines = new Map<number, string[]>();
  const blockEndLines = new Map<number, string[]>();
  const stmtAnnotationLines = new Map<number, string[]>();

  for (const block of blocks) {
    const { annotation } = parseBlockOrigin(block);
    const line = blockFirstLine.get(block.id);
    if (line === undefined) continue;

    const outEdges = edgesBySource.get(block.id) ?? [];

    if (block.statementIds.length === 0) {
      if (!blockStartLines.has(line)) blockStartLines.set(line, []);
      const bucket = blockStartLines.get(line)!;
      bucket.push(formatBlockHeader(block, annotation, " ── empty"));
      for (const e of outEdges) bucket.push(formatEdge(e));
      bucket.push("  └─");
      continue;
    }

    if (!blockStartLines.has(line)) blockStartLines.set(line, []);
    blockStartLines
      .get(line)!
      .push(formatBlockHeader(block, annotation));

    const blockRecord = blockStates.get(block.id);
    const stmtAnns = buildStmtAnnotations(block, blockRecord);

    for (const [stmtId, anns] of stmtAnns) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      const stmtLine = getLineNumber(stmt);
      if (stmtLine === null) continue;
      if (!stmtAnnotationLines.has(stmtLine))
        stmtAnnotationLines.set(stmtLine, []);
      for (const a of anns) {
        stmtAnnotationLines.get(stmtLine)!.push(`     ╰ ${a}`);
      }
    }

    const lastStmtId = block.statementIds[block.statementIds.length - 1];
    const lastStmt = statements[lastStmtId];
    const lastLine = lastStmt ? getLineNumber(lastStmt) : null;
    const endLine = lastLine ?? line;

    const edgeLines: string[] = [];
    for (const e of outEdges) edgeLines.push(formatEdge(e));
    edgeLines.push("  └─");

    if (!blockEndLines.has(endLine)) blockEndLines.set(endLine, []);
    blockEndLines.get(endLine)!.push(...edgeLines);
  }

  for (const edge of edges) {
    if (!isChoiceOptionEdge(edge.kind)) continue;
    const condStmtId = edge.metadata.conditionStatementId;
    if (!condStmtId) continue;
    const condStmt = statements[condStmtId] as any;
    if (!condStmt?.selectableIf) continue;
    const condLine = getLineNumber(condStmt);
    if (condLine === null) continue;

    const readVars = extractVariableReads(condStmt.selectableIf);
    if (readVars.length === 0) continue;

    const sourceRecord = blockStates.get(edge.sourceBlockId);
    if (!sourceRecord) continue;

    const anns: string[] = [];
    for (const name of readVars) {
      const entry = sourceRecord.vars[name];
      if (!entry) continue;
      const val: AbstractValue = "kind" in entry ? entry : entry.exit;
      if (val.kind === "bottom") continue;
      anns.push(`${name} = ${formatAbstractValue(val)}`);
    }
    if (anns.length > 0) {
      if (!stmtAnnotationLines.has(condLine)) stmtAnnotationLines.set(condLine, []);
      for (const a of anns) {
        stmtAnnotationLines.get(condLine)!.push(`     ╰ ${a}`);
      }
    }
  }

  for (let i = 0; i < sourceLines.length; i++) {
    const starts = blockStartLines.get(i);
    if (starts) {
      for (const s of starts) emit(s);
    }

    const lineNum = String(i).padStart(4, " ");
    const source = sourceLines[i].replace(/\r$/, "");
    const unreachable = unreachableLines?.has(i) ? " [UNREACHABLE CODE]" : "";
    emit(`${lineNum} │ ${source}${unreachable}`);

    const anns = stmtAnnotationLines.get(i);
    if (anns) {
      for (const a of anns) emit(a);
    }

    const edgeAnns = unreachableEdgeByScene.get(sceneName)?.get(i);
    if (edgeAnns) {
      for (const a of edgeAnns) emit(`     ╰ ${a}`);
    }

    const ends = blockEndLines.get(i);
    if (ends) {
      for (const e of ends) emit(e);
    }
  }
};

const enrichedOutDir = outPath("enriched-source");
getIO().mkdir(enrichedOutDir);

for (const sceneName of cfg.sceneOrder) {
  if (targetScene && sceneName !== targetScene) continue;

  const lines: string[] = [];
  renderScene(sceneName, (line) => {
    lines.push(line);
  });

  const filePath = `${enrichedOutDir}/${sceneName}.txt`;
  getIO().writeFile(filePath, lines.join("\n") + "\n");
  console.log(`Wrote ${filePath} (${lines.length} lines)`);
}
