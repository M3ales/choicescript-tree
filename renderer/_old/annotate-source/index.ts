import "../../bootstrap";
import { readInlineCfg, readBlockIndex, readStatements, sceneOf } from "../../analysis/control-flow-graph/cfg-io";
import { isChoiceOptionEdge } from "../../analysis/control-flow-graph/data";
import { AbstractValue } from "../../analysis/dataflow/abstract-value";
import { BlockRecord, readBlockStates } from "../../analysis/dataflow/block-states";
import { extractVariableReads } from "../../analysis/dataflow/evaluate-expression";
import { readNdjsonSync } from "../../analysis/ndjson";
import { readPathAnalysis } from "../../analysis/path-analysis";
import { outPath, getIO } from "../../out-dir";

interface RawScene {
  name: string;
  content: string;
}

interface LoopBound {
  type: string;
  tripCount: number;
}

interface LoopInfo {
  headerId: string;
  bodySize: number;
  backEdgeCount: number;
  tripCount: number;
  bounds: LoopBound[];
}

const classifyLoop = (info: LoopInfo): "loop" | "hub" => {
  if (info.backEdgeCount === 0) return "loop";
  return info.bodySize / info.backEdgeCount > 5 ? "hub" : "loop";
};

const targetScene = process.argv[2];

const cfg = readInlineCfg(outPath("inline-cfg.ndjson"));
const blockIndex = readBlockIndex(outPath("block-index.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));
const blockStates = readBlockStates(outPath("block-states.ndjson"));
const rawScenes: RawScene[] = JSON.parse(getIO().readFile(outPath("raw-scenes.json")));
const loopInfos: LoopInfo[] = JSON.parse(getIO().readFile(outPath("loop-analysis.json")));
const pathAnalysis = readPathAnalysis(outPath("path-analysis.ndjson"));

const reachabilityRecords = readNdjsonSync<{
  type: string;
  id?: string;
  scene?: string;
  kind?: string;
  sourceBlockId?: string;
  targetBlockId?: string;
  label?: string;
}>(outPath("reachability.ndjson"));

const unreachableBlockIds = new Set<string>();
for (const rec of reachabilityRecords) {
  if (rec.type === "unreachable-block" && rec.id) unreachableBlockIds.add(rec.id);
}

const inlinedBlockStates = new Map<string, BlockRecord>();
const subroutineUsageCount = new Map<string, number>();
for (const ref of Object.values(cfg.blocks)) {
  if (!ref.sourceBlockId) continue;
  if (ref.clonedFrom?.purpose === "inline") {
    subroutineUsageCount.set(ref.sourceBlockId, (subroutineUsageCount.get(ref.sourceBlockId) ?? 0) + 1);
  }
  if (!inlinedBlockStates.has(ref.sourceBlockId)) {
    const record = blockStates.get(ref.id);
    if (record) inlinedBlockStates.set(ref.sourceBlockId, record);
  }
}

const loopByHeader = new Map<string, LoopInfo>();
for (const loop of loopInfos) loopByHeader.set(loop.headerId, loop);

const getLineNumber = (stmt: any): number | null =>
  stmt.token?.lineNumber ?? stmt.content?.[0]?.lineNumber ?? null;

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

const stringifyExpression = (expr: any): string => {
  if (!expr) return "?";
  if (expr.left && expr.operator && expr.right) {
    const left = stringifyExpression(expr.left);
    const right = stringifyExpression(expr.right);
    const op = expr.operator.rawValue ?? expr.operator.type ?? "?";
    return `${left} ${op} ${right}`;
  }
  if (expr.operator && expr.value && !expr.left) {
    const op = expr.operator.rawValue ?? "not";
    return `${op}(${stringifyExpression(expr.value)})`;
  }
  if (expr.token?.type === "Identifier") {
    return expr.token.value;
  }
  if (expr.value && typeof expr.value === "object" && !expr.operator) {
    const v = expr.value;
    if (v.type === "StringLiteral") return `"${v.value}"`;
    if (v.type === "NumberLiteral") return String(v.value);
    if (v.type === "BooleanLiteral") return String(v.value);
  }
  if (expr.identifier && expr.expression) {
    return `${expr.identifier.value}[${stringifyExpression(expr.expression)}]`;
  }
  if (expr.expression && !expr.identifier) {
    return `(${stringifyExpression(expr.expression)})`;
  }
  return "?";
};

const countBodyStatements = (ifStmt: any): number => {
  let count = ifStmt.body?.length ?? 0;
  if (ifStmt.elseIfBranches) {
    for (const branch of ifStmt.elseIfBranches) {
      count += 1 + (branch.body?.length ?? 0);
    }
  }
  return count;
};

interface StmtAnnotations {
  writes: Map<string, string[]>;
  conditionReads: Map<string, string>;
}

const buildStmtAnnotations = (
  blockStatementIds: string[],
  blockRecord: BlockRecord | undefined,
): StmtAnnotations => {
  const writes = new Map<string, string[]>();
  const conditionReads = new Map<string, string>();
  if (!blockRecord?.stmts) return { writes, conditionReads };

  for (const stmtId of blockStatementIds) {
    const stmt = statements[stmtId];
    if (!stmt || stmt.kind === "DeclareVariable") continue;

    const rec = blockRecord.stmts[stmtId];
    if (!rec) continue;

    if (rec.reads && (stmt.kind === "If" || stmt.kind === "ElseIf")) {
      const parts: string[] = [];
      for (const [name, val] of Object.entries(rec.reads)) {
        parts.push(`${name} := ${formatAbstractValue(val)}`);
      }
      if (parts.length > 0) {
        conditionReads.set(stmtId, `*comment | [if] (${parts.join(", ")})`);
      }
    }

    if (rec.write) {
      const { variable, before, after } = rec.write;
      const writeAnns: string[] = [];
      if (before.kind === "bottom") {
        writeAnns.push(`${variable} := ${formatAbstractValue(after)}`);
      } else {
        writeAnns.push(
          `${variable}: ${formatAbstractValue(before)} → ${formatAbstractValue(after)}`
        );
      }
      writes.set(stmtId, writeAnns);
    }
  }

  return { writes, conditionReads };
};

const stmtToBlock = new Map<string, string>();
for (const block of Object.values(blockIndex)) {
  for (const stmtId of block.statementIds) {
    stmtToBlock.set(stmtId, block.id);
  }
}

const edgeById = new Map<string, (typeof cfg.edges)[0]>();
for (const edge of cfg.edges) edgeById.set(edge.id, edge);

const loopIdByHeader = new Map<string, { id: string; kind: "loop" | "hub" }>();
let nextLoopId = 1;
let nextHubId = 1;

const renderAnnotatedScene = (sceneName: string): string[] => {
  const rawScene = rawScenes.find((r) => r.name === sceneName);
  if (!rawScene) return [];

  const sourceLines = rawScene.content.split("\n");
  const postAnnotationsByLine = new Map<number, Set<string>>();
  const preAnnotationsByLine = new Map<number, Set<string>>();
  const unreachableLines = new Set<number>();

  const addPost = (line: number, ann: string) => {
    let set = postAnnotationsByLine.get(line);
    if (!set) { set = new Set(); postAnnotationsByLine.set(line, set); }
    set.add(ann);
  };

  const addPre = (line: number, ann: string) => {
    let set = preAnnotationsByLine.get(line);
    if (!set) { set = new Set(); preAnnotationsByLine.set(line, set); }
    set.add(ann);
  };

  const sceneBlocks = Object.values(blockIndex).filter(
    (b) => b.scene === sceneName
  );

  for (const block of sceneBlocks) {
    const blockRecord = blockStates.get(block.id) ?? inlinedBlockStates.get(block.id);
    const { writes, conditionReads } = buildStmtAnnotations(block.statementIds, blockRecord);

    for (const [stmtId, anns] of writes) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      const line = getLineNumber(stmt);
      if (line === null) continue;
      for (const ann of anns) {
        addPost(line, `*comment | ${ann}`);
      }
    }

    const usageCount = subroutineUsageCount.get(block.id);
    if (usageCount && block.label && block.statementIds.length > 0) {
      const labelStmt = statements[block.statementIds[0]];
      if (labelStmt) {
        const line = getLineNumber(labelStmt);
        if (line !== null) {
          addPre(line, `*comment | [subroutine] ${usageCount} usage${usageCount > 1 ? "s" : ""}`);
        }
      }
    }

    if (!unreachableBlockIds.has(block.id)) {
      for (const [stmtId, ann] of conditionReads) {
        const stmt = statements[stmtId];
        if (!stmt) continue;
        const line = getLineNumber(stmt);
        if (line === null) continue;
        addPre(line, ann);
      }
    }

    if (unreachableBlockIds.has(block.id)) {
      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId] as any;
        if (!stmt) continue;
        const line = getLineNumber(stmt);
        if (line === null) continue;
        unreachableLines.add(line);

        if ((stmt.kind === "If" || stmt.kind === "ElseIf") && stmt.expression && blockRecord) {
          const readVars = [...new Set(extractVariableReads(stmt.expression))];
          const parts: string[] = [];
          for (const name of readVars) {
            const entry = blockRecord.vars[name];
            if (!entry) continue;
            const val: AbstractValue = "kind" in entry ? entry : entry.entry;
            if (val.kind === "bottom") continue;
            parts.push(`${name} := ${formatAbstractValue(val)}`);
          }
          if (parts.length > 0) {
            addPre(line, `*comment | [if] (${parts.join(", ")})`);
          }
        }
      }
    }

    const loopInfo = loopByHeader.get(block.id);
    if (loopInfo && block.statementIds.length > 0) {
      const firstStmt = statements[block.statementIds[0]];
      if (firstStmt) {
        const line = getLineNumber(firstStmt);
        if (line !== null) {
          let entry = loopIdByHeader.get(block.id);
          if (!entry) {
            const kind = classifyLoop(loopInfo);
            const id = kind === "hub" ? `hub#${nextHubId++}` : `loop#${nextLoopId++}`;
            entry = { id, kind };
            loopIdByHeader.set(block.id, entry);
          }
          const boundTypes = loopInfo.bounds.map((b) => b.type).join(", ");
          addPost(
            line,
            `*comment | [${entry.kind}:${entry.id}] ${entry.kind} header (trip count: ${loopInfo.tripCount}, exit: ${boundTypes})`
          );
        }
      }
    }
  }

  for (const stmtId of Object.keys(statements)) {
    if (!stmtId.startsWith(sceneName + ":")) continue;
    const stmt = statements[stmtId] as any;
    if (stmt.kind !== "If" || !stmt.elseBranch) continue;
    if (countBodyStatements(stmt) <= 6) continue;

    const elseLine = getLineNumber(stmt.elseBranch);
    if (elseLine === null) continue;

    const conditions: string[] = [];
    const ifCond = stringifyExpression(stmt.expression);
    conditions.push(`not(${ifCond})`);
    if (stmt.elseIfBranches) {
      for (const branch of stmt.elseIfBranches) {
        conditions.push(`not(${stringifyExpression(branch.expression)})`);
      }
    }
    addPre(elseLine, `*comment | [if] ${conditions.join(" and ")}`);
  }

  for (const edge of cfg.edges) {
    if (!isChoiceOptionEdge(edge.kind)) continue;
    if (sceneOf(edge.sourceBlockId) !== sceneName) continue;
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

    const parts: string[] = [];
    for (const name of readVars) {
      const entry = sourceRecord.vars[name];
      if (!entry) continue;
      const val: AbstractValue = "kind" in entry ? entry : entry.exit;
      if (val.kind === "bottom") continue;
      parts.push(`${name} := ${formatAbstractValue(val)}`);
    }
    if (parts.length > 0) {
      addPre(condLine, `*comment | [selectable_if] (${parts.join(", ")})`);
    }
  }



  for (const [blockId, div] of Object.entries(pathAnalysis.divergences)) {
    if (sceneOf(blockId) !== sceneName || !div.isLoop) continue;

    let entry = loopIdByHeader.get(blockId);
    if (!entry) {
      const loopInfo = loopByHeader.get(blockId);
      const kind = loopInfo ? classifyLoop(loopInfo) : "loop";
      const id = kind === "hub" ? `hub#${nextHubId++}` : `loop#${nextLoopId++}`;
      entry = { id, kind };
      loopIdByHeader.set(blockId, entry);
    }
    const tag = `${entry.kind}:${entry.id}`;

    for (const branch of div.branches) {
      if (branch.isLoopBack) {
        const entryBlock = blockIndex[branch.entryBlockId];
        if (!entryBlock) continue;
        const navStmtId = [...entryBlock.statementIds].reverse().find((sid) => {
          const s = statements[sid];
          return s && (s.kind === "GotoLabel" || s.kind === "GotoScene" || s.kind === "GoSub" || s.kind === "GoSubScene");
        });
        const targetStmtId = navStmtId ?? entryBlock.statementIds[entryBlock.statementIds.length - 1];
        if (!targetStmtId) continue;
        const stmt = statements[targetStmtId];
        if (!stmt) continue;
        const line = getLineNumber(stmt);
        if (line !== null) addPost(line, `*comment | [${tag}]`);
      } else if (!branch.terminates) {
        const entryBlock = blockIndex[branch.entryBlockId];
        if (!entryBlock || entryBlock.statementIds.length === 0) continue;
        const navStmtId = [...entryBlock.statementIds].reverse().find((sid) => {
          const s = statements[sid];
          return s && (s.kind === "GotoLabel" || s.kind === "GotoScene" || s.kind === "GoSub" || s.kind === "GoSubScene");
        });
        const targetStmtId = navStmtId ?? entryBlock.statementIds[entryBlock.statementIds.length - 1];
        const stmt = statements[targetStmtId];
        if (!stmt) continue;
        const line = getLineNumber(stmt);
        if (line !== null) addPost(line, `*comment | [${tag}] ${entry.kind} exit`);
      }
    }
  }

  for (const [, div] of Object.entries(pathAnalysis.divergences)) {
    if (!div.convergeBlockId) continue;
    const convergeBlock = blockIndex[div.convergeBlockId];
    if (!convergeBlock || convergeBlock.scene !== sceneName) continue;
    if (convergeBlock.statementIds.length === 0) continue;

    const firstStmt = statements[convergeBlock.statementIds[0]];
    if (!firstStmt) continue;
    const line = getLineNumber(firstStmt);
    if (line === null) continue;

    const blockRecord = blockStates.get(div.convergeBlockId);
    if (!blockRecord) continue;

    const parts: string[] = [];
    for (const [name, entry] of Object.entries(blockRecord.vars)) {
      const val: AbstractValue = "kind" in entry ? entry : entry.entry;
      if (val.kind === "bottom" || val.kind === "constant") continue;
      parts.push(`${name} := ${formatAbstractValue(val)}`);
    }
    if (parts.length > 0) {
      const existing = preAnnotationsByLine.get(line);
      const hasCondition = existing && [...existing].some(a => a.includes("[if]") || a.includes("[selectable_if]"));
      if (!hasCondition) {
        addPre(line, `*comment | [join] (${parts.join(", ")})`);
      }
    }
  }

  const output: string[] = [];
  for (let i = 0; i < sourceLines.length; i++) {
    const source = sourceLines[i].replace(/\r$/, "");
    const indent = source.match(/^(\s*)/)?.[1] ?? "";
    const isUnreachable = unreachableLines.has(i);

    const preAnns = preAnnotationsByLine.get(i);
    if (preAnns && !isUnreachable) {
      for (const ann of preAnns) {
        output.push(`${indent}${ann}`);
      }
    }

    if (isUnreachable) {
      const trimmed = source.trimStart();
      let condTag = "";
      if (preAnns) {
        for (const ann of preAnns) {
          const match = ann.match(/\*comment \| (\[(?:if|selectable_if)\]\s*\(.*?\))/);
          if (match) condTag += match[1];
        }
      }
      const postAnns = postAnnotationsByLine.get(i);
      let postTag = "";
      if (postAnns) {
        const parts: string[] = [];
        for (const ann of postAnns) {
          const match = ann.match(/\*comment \| (.+)/);
          if (match) parts.push(match[1]);
        }
        if (parts.length > 0) postTag = ` (${parts.join("; ")})`;
      }
      output.push(`${indent}*comment | [unreachable]${condTag} ${trimmed}${postTag}`);
    } else {
      output.push(source);
      const postAnns = postAnnotationsByLine.get(i);
      if (postAnns) {
        for (const ann of postAnns) {
          output.push(`${indent}${ann}`);
        }
      }
    }
  }

  return output;
};

const outDir = outPath("annotated-source");
getIO().mkdir(outDir);

for (const sceneName of cfg.sceneOrder) {
  if (targetScene && sceneName !== targetScene) continue;

  const lines = renderAnnotatedScene(sceneName);
  if (lines.length === 0) continue;

  const filePath = `${outDir}/${sceneName}.txt`;
  getIO().writeFile(filePath, lines.join("\n") + "\n");
  console.log(`Wrote ${filePath} (${lines.length} lines)`);
}
