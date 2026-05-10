import "../../../bootstrap";
import { readInlineCfg, readStatements, BlockResolver, sceneOf } from "../cfg-io";
import { BlockRef, Transition, isChoiceOptionEdge } from "../data";
import { Statement } from "../../../parser/statements";
import { outPath, getIO } from "../../../out-dir";

interface RawScene {
  name: string;
  content: string;
}

const cfg = readInlineCfg(outPath("inline-cfg.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));
const rawScenes: RawScene[] = JSON.parse(
  getIO().readFile(outPath("raw-scenes.json"))
);

const targetScene = process.argv[2];

interface DebugBlock {
  id: string;
  scene: string;
  statementIds: string[];
  entryType: string;
  exitType: string;
  label?: string;
  sourceBlockId?: string;
  unrolled?: boolean;
  inlined?: boolean;
  loopHeaderId?: string;
  iterationHeaderId?: string;
}

const toDebugBlock = (ref: BlockRef): DebugBlock => {
  const resolved = resolver.resolve(ref);
  return {
    id: ref.id,
    scene: sceneOf(ref.id),
    statementIds: resolved?.statementIds ?? [],
    entryType: resolved?.entryType ?? "SceneEntry",
    exitType: ref.exitType,
    label: resolved?.label,
    sourceBlockId: ref.sourceBlockId,
    loopHeaderId: ref.loopHeaderId,
    iterationHeaderId: ref.iterationHeaderId,
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
): { annotation: string; originalBlockId: string } => {
  const id = block.id;
  const origId = block.sourceBlockId;

  if (block.unrolled && origId) {
    const iterMatch = id.match(/\.iter_(\d+)$/);
    const iter = iterMatch ? parseInt(iterMatch[1], 10) + 1 : null;
    const headerNote = block.loopHeaderId
      ? ` loop=${block.loopHeaderId}`
      : "";
    return {
      annotation: iter !== null
        ? `iteration ${iter}${headerNote}`
        : `unrolled${headerNote}`,
      originalBlockId: origId,
    };
  }

  if (block.inlined && origId) {
    return {
      annotation: `inlined from ${origId}`,
      originalBlockId: origId,
    };
  }

  return { annotation: "", originalBlockId: id };
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

const renderScene = (sceneName: string, emit: (line: string) => void) => {
  const rawScene = rawScenes.find((r) => r.name === sceneName);
  if (!rawScene) return;

  const blocks = sceneBlocks.get(sceneName);
  if (!blocks) return;

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

    if (block.unrolled) {
      unrolledBlocks++;
      if (block.loopHeaderId) loopHeaders.add(block.loopHeaderId);
    } else if (block.inlined) {
      inlinedBlocks++;
      if (block.sourceBlockId) inlinedSources.add(block.sourceBlockId);
    } else {
      originalBlocks++;
    }
  }

  const edges = sceneEdges.get(sceneName) ?? [];
  const exitEdges = edges.filter(
    (e) => e.kind === "SceneProgression" || e.kind === "SceneExit" || e.kind === "GameEnd"
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
  emit(`  ${sourceLines.length} source lines, ${stmtCount} statements`);
  emit(`  ${blocks.length} blocks (${originalBlocks} original, ${unrolledBlocks} unrolled, ${inlinedBlocks} inlined), ${edges.length} edges`);
  if (labels.size > 0) {
    emit(`  ${labels.size} labels: ${[...labels].join(", ")}`);
  }
  if (loopHeaders.size > 0) {
    emit(`  ${loopHeaders.size} unrolled loops: ${[...loopHeaders].join(", ")}`);
  }
  if (inlinedSources.size > 0) {
    emit(`  ${inlinedSources.size} inlined subroutines: ${[...inlinedSources].join(", ")}`);
  }
  if (gotoEdges.length > 0 || choiceEdges.length > 0 || exitEdges.length > 0) {
    const parts: string[] = [];
    if (gotoEdges.length > 0) parts.push(`${gotoEdges.length} gotos`);
    if (choiceEdges.length > 0) parts.push(`${choiceEdges.length} choice options`);
    if (exitEdges.length > 0) parts.push(`${exitEdges.length} exits`);
    emit(`  ${parts.join(", ")}`);
  }
  emit("─".repeat(60));

  const blockStartLines = new Map<number, string[]>();
  const blockEndLines = new Map<number, string[]>();

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

  for (let i = 0; i < sourceLines.length; i++) {
    const starts = blockStartLines.get(i);
    if (starts) {
      for (const s of starts) emit(s);
    }

    const lineNum = String(i).padStart(4, " ");
    const source = sourceLines[i].replace(/\r$/, "");
    emit(`${lineNum} │ ${source}`);

    const ends = blockEndLines.get(i);
    if (ends) {
      for (const e of ends) emit(e);
    }
  }
};

const outDir = outPath("cfg-debug");
getIO().mkdir(outDir);

for (const sceneName of cfg.sceneOrder) {
  if (targetScene && sceneName !== targetScene) continue;

  const lines: string[] = [];
  renderScene(sceneName, (line) => {
    console.log(line);
    lines.push(line);
  });

  const filePath = `${outDir}/${sceneName}.txt`;
  getIO().writeFile(filePath, lines.join("\n") + "\n");
  console.log(`Wrote ${filePath}`);
}
