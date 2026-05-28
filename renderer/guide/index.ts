import "../../bootstrap";
import { readInlineCfgRefs, readStatements, BlockResolver, sceneOf } from "../../analysis/control-flow-graph/cfg-io";
import { readPathAnalysis, readChoiceMap, ChoiceMapEntry } from "../../analysis/path-analysis";
import { writeNdjson } from "../../analysis/ndjson";
import { Transition, isChoiceOptionEdge, CodeBlock } from "../../analysis/control-flow-graph/data";
import {
  SetVariableStatement,
  AchieveStatement,
  AchievementStatement,
  ProseStatement,
  LabelStatement,
  ChoiceOptionStatement,
  IfStatement,
  ElseIfStatement,
  Statement,
} from "../../parser/statements";
import {
  Expression,
  Binary,
  Unary,
  Literal,
  Identifier,
} from "../../parser/expressions";
import { AbstractValue, join as joinValues } from "../../analysis/dataflow/abstract-value";
import { BlockRecord, BlockVariableEntry } from "../../analysis/dataflow/block-states";
import { outPath, getIO } from "../../out-dir";

console.log("Loading CFG...");
const cfg = readInlineCfgRefs(outPath("inline-cfg.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));
console.log(`  ${Object.keys(cfg.refs).length} block refs, ${cfg.edges.length} edges`);

console.log("Loading statements...");
const statements = readStatements(outPath("game-statements.ndjson"));
console.log(`  ${Object.keys(statements).length} statements`);

const achievementTitles = new Map<string, string>();
for (const stmt of Object.values(statements)) {
  if (stmt.kind === "Achievement") {
    const a = stmt as AchievementStatement;
    achievementTitles.set(a.codename.value, a.title.content);
  }
}
if (achievementTitles.size > 0) {
  console.log(`  ${achievementTitles.size} achievement definitions`);
}

const edgesBySource = new Map<string, Transition[]>();
for (const edge of cfg.edges) {
  const list = edgesBySource.get(edge.sourceBlockId) ?? [];
  list.push(edge);
  edgesBySource.set(edge.sourceBlockId, list);
}

const canonicalBlockId = (id: string) => cfg.refs[id]?.sourceBlockId ?? id;

const choiceBlockIds = new Set<string>();
for (const id of Object.keys(cfg.refs)) {
  const outEdges = edgesBySource.get(id) ?? [];
  if (outEdges.some((e) => isChoiceOptionEdge(e.kind))) {
    choiceBlockIds.add(id);
  }
}
console.log(`  ${choiceBlockIds.size} choice blocks`);

const loopAnalysis: { headerId: string }[] = JSON.parse(getIO().readFile(outPath("loop-analysis.json")));
const loopHeaderIds = new Set(loopAnalysis.map((l) => l.headerId));
const hubChoiceIds = new Set([...choiceBlockIds].filter((id) => loopHeaderIds.has(id)));
console.log(`  ${hubChoiceIds.size} hub choices (loop headers)`);

console.log("Loading path analysis...");
const pathAnalysis = readPathAnalysis(outPath("path-analysis.ndjson"));
console.log(`  ${Object.keys(pathAnalysis.divergences).length} divergence records`);

const blockStates = new Map<string, BlockRecord>();
const blockStatesPath = outPath("block-states.ndjson");
if (getIO().exists(blockStatesPath)) {
  for (const line of getIO().readFile(blockStatesPath).split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as BlockRecord;
    blockStates.set(record.id, record);
  }
  console.log(`  ${blockStates.size} block states loaded`);
} else {
  console.log("  No block-states.ndjson found, skipping dataflow annotations");
}

// --- Helpers ---

const isEntryExit = (
  entry: BlockVariableEntry
): entry is { entry: AbstractValue; exit: AbstractValue } =>
  typeof entry === "object" && entry !== null && "entry" in entry && "exit" in entry;

const getEntryValue = (entry: BlockVariableEntry): AbstractValue =>
  isEntryExit(entry) ? entry.entry : entry as AbstractValue;

const formatExpr = (expr: Expression): string => {
  switch (expr.kind) {
    case "Literal": {
      const lit = expr as Literal;
      if (lit.value.type === "StringLiteral") return `"${lit.value.value}"`;
      return String(lit.value.value);
    }
    case "Identifier":
      return (expr as Identifier).token.value;
    case "Binary": {
      const bin = expr as Binary;
      const l = formatExpr(bin.left);
      const op = (bin.operator as { rawValue?: string }).rawValue ?? bin.operator.type;
      const r = formatExpr(bin.right);
      return `${l} ${op} ${r}`;
    }
    case "Unary": {
      const un = expr as Unary;
      const op = un.operator.rawValue;
      return `${op}(${formatExpr(un.value)})`;
    }
    case "Grouping":
    case "Dereference":
      return formatExpr(expr.expression);
    default:
      return "?";
  }
};

const formatValueChange = (stmtId: string, varName: string, blockId: string): string | null => {
  const record = blockStates.get(blockId);
  if (!record) return null;
  const stmtRec = record.stmts?.[stmtId];
  if (!stmtRec?.write || stmtRec.write.variable !== varName) return null;
  const { before, after } = stmtRec.write;
  if (before.kind === "bottom" && after.kind === "bottom") return null;
  return `[${formatAbstractValue(before)} → ${formatAbstractValue(after)}]`;
};

const getWriteValues = (stmtId: string, varName: string, blockId: string): { before: AbstractValue; after: AbstractValue } | null => {
  const record = blockStates.get(blockId);
  if (!record) return null;
  const stmtRec = record.stmts?.[stmtId];
  if (!stmtRec?.write || stmtRec.write.variable !== varName) return null;
  const { before, after } = stmtRec.write;
  if (before.kind === "bottom" && after.kind === "bottom") return null;
  return { before, after };
};

const formatSetValue = (stmt: Statement, stmtId: string, blockId: string): string | null => {
  if (stmt.kind !== "SetVariable") return null;
  const setStmt = stmt as SetVariableStatement;
  const expr = setStmt.expression;
  if (!expr) return null;

  if (expr.kind === "Identifier") {
    const name = (expr as Identifier).token.value;
    const val = formatExpr(setStmt.assignment);
    const change = formatValueChange(stmtId, name, blockId);
    return change ? `${name} ${val} ${change}` : `${name} ${val}`;
  }

  if (expr.kind === "Binary") {
    const bin = expr as Binary;
    if (bin.left.kind === "Identifier") {
      const name = (bin.left as Identifier).token.value;
      const op = (bin.operator as { rawValue?: string }).rawValue ?? bin.operator.type;
      const right = formatExpr(bin.right);
      const change = formatValueChange(stmtId, name, blockId);
      return change ? `${name} ${op} ${right} ${change}` : `${name} ${op} ${right}`;
    }
  }

  return null;
};

const formatAchieve = (stmt: AchieveStatement): string => {
  const codename = stmt.codename.value;
  const title = achievementTitles.get(codename);
  return title ? `achieve ${codename} (${title})` : `achieve ${codename}`;
};

const formatAbstractValue = (v: AbstractValue): string => {
  switch (v.kind) {
    case "constant": return typeof v.value === "string" ? `"${v.value}"` : String(v.value);
    case "set": {
      if (v.values.every((x) => typeof x === "number")) {
        const nums = v.values as number[];
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const rangeStr = min === max ? String(min) : `${min}–${max}`;
        return v.hasUserInput ? `${rangeStr}, user input` : rangeStr;
      }
      const vals = v.values.map((x) => typeof x === "string" ? `"${x}"` : String(x));
      return v.hasUserInput ? `${vals.join(", ")}, user input` : vals.join(", ");
    }
    case "range": return `${v.min}-${v.max}`;
    case "input": return "user input";
    case "loop": return "varies (loop)";
    case "top": return "anything";
    case "bottom": return "not yet set";
  }
};

const extractConditionVars = (expr: Expression): string[] => {
  const vars: string[] = [];
  const walk = (node: Expression): void => {
    if (!node) return;
    switch (node.kind) {
      case "Identifier":
        vars.push((node as Identifier).token.value);
        break;
      case "Binary": {
        const bin = node as Binary;
        walk(bin.left);
        walk(bin.right);
        break;
      }
      case "Unary":
        walk((node as Unary).value);
        break;
      case "Grouping":
      case "Dereference":
        walk(node.expression);
        break;
    }
  };
  walk(expr);
  return [...new Set(vars)];
};

const formatProse = (stmt: ProseStatement): string => {
  const segs = (stmt as any).parsedSegments as any[] | undefined;
  if (segs) {
    let text = "";
    for (const seg of segs) {
      if (seg.kind === "Text") text += seg.text ?? "";
      else if (seg.kind === "Print" && seg.expression) text += `\${${formatExpr(seg.expression)}}`;
      else if (seg.kind === "PrintCapitaliseFirst" && seg.expression) text += `\$!{${formatExpr(seg.expression)}}`;
      else if (seg.kind === "PrintCapitaliseAll" && seg.expression) text += `\$!!{${formatExpr(seg.expression)}}`;
      else if (seg.kind === "MultiReplace") text += `[multi]`;
    }
    return text;
  }
  let text = "";
  for (const seg of stmt.content ?? []) {
    text += seg.content ?? "";
  }
  return text;
};

const getLastProse = (block: CodeBlock): string | null => {
  for (let i = block.statementIds.length - 1; i >= 0; i--) {
    const stmt = statements[block.statementIds[i]];
    if (!stmt) continue;
    if (stmt.kind === "FakeChoice" || stmt.kind === "Choice") continue;
    if (stmt.kind === "LineBreak" || stmt.kind === "PageBreak") continue;
    if (stmt.kind === "Prose") {
      const text = formatProse(stmt as ProseStatement).trim();
      if (text.length > 0) {
        const lines = text.split("\n");
        const lastLines = lines.slice(-3).join("\n").trim();
        if (lastLines.length > 200) {
          const truncated = lastLines.slice(-200);
          const spaceIdx = truncated.indexOf(" ");
          return "…" + (spaceIdx > 0 ? truncated.slice(spaceIdx + 1) : truncated);
        }
        return lastLines;
      }
    }
    break;
  }
  return null;
};

const getNearestLabel = (block: CodeBlock): string | null => {
  if (block.label) return block.label;
  for (let i = block.statementIds.length - 1; i >= 0; i--) {
    const stmt = statements[block.statementIds[i]];
    if (stmt?.kind === "Label") return (stmt as LabelStatement).label?.value ?? null;
  }
  return null;
};

// --- Walk from option target to next choice, collecting sets ---

type SetEntry = string | { branches: { condition: string | null; isElse: boolean; sets: SetEntry[] }[] };

const setEntryKey = (entry: SetEntry): string => {
  if (typeof entry === "string") return entry;
  const parts = entry.branches.map((b) =>
    `[${b.condition ?? "else"}:${b.sets.map(setEntryKey).join(";")}]`
  );
  return `cond(${parts.join(",")})`;
};

interface WriteInfo {
  varName: string;
  before: AbstractValue;
  after: AbstractValue;
  formatted: string;
}

interface ConditionalChoice {
  condition: string | null;
  isElse: boolean;
  blockId: string;
}

interface OptionConsequences {
  sets: SetEntry[];
  writes: WriteInfo[];
  destination: { kind: "choice" | "end" | "dead"; blockId: string };
  conditionalChoices: ConditionalChoice[];
}

const collectSetWithMeta = (
  stmt: Statement, stmtId: string, blockId: string,
  sets: SetEntry[], writes: WriteInfo[],
): void => {
  const formatted = formatSetValue(stmt, stmtId, blockId);
  if (!formatted) return;
  sets.push(formatted);

  const setStmt = stmt as SetVariableStatement;
  const expr = setStmt.expression;
  if (!expr) return;
  let varName: string | null = null;
  if (expr.kind === "Identifier") varName = (expr as Identifier).token.value;
  else if (expr.kind === "Binary" && (expr as Binary).left.kind === "Identifier") {
    varName = ((expr as Binary).left as Identifier).token.value;
  }
  if (varName) {
    const wv = getWriteValues(stmtId, varName, blockId);
    if (wv) writes.push({ varName, before: wv.before, after: wv.after, formatted });
  }
};

const collectConsequences = (startBlockId: string): OptionConsequences => {
  const sets: SetEntry[] = [];
  const writes: WriteInfo[] = [];
  const conditionalChoices: ConditionalChoice[] = [];
  const visited = new Set<string>();
  let destination: { kind: "choice" | "end" | "dead"; blockId: string } | null = null;

  const collectBlockSets = (blockId: string, block: { statementIds: string[] }): void => {
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      if (stmt.kind === "SetVariable") {
        collectSetWithMeta(stmt, stmtId, blockId, sets, writes);
      } else if (stmt.kind === "Achieve") {
        sets.push(formatAchieve(stmt as AchieveStatement));
      }
    }
  };

  const collectBranch = (
    entryId: string,
    stopAt: string | null,
    sharedTargets?: Set<string>,
  ): SetEntry[] => {
    const branchSets: SetEntry[] = [];
    const branchVisited = new Set<string>();
    const queue = [entryId];

    while (queue.length > 0) {
      const blockId = queue.shift()!;
      if (stopAt && blockId === stopAt) continue;
      if (sharedTargets?.has(blockId) && blockId !== entryId) continue;
      if (branchVisited.has(blockId) || visited.has(blockId)) continue;
      branchVisited.add(blockId);

      if (!cfg.refs[blockId]) continue;
      const block = resolver.get(blockId, cfg.refs);
      if (!block) continue;

      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (!stmt) continue;
        if (stmt.kind === "SetVariable") {
          collectSetWithMeta(stmt, stmtId, blockId, branchSets, writes);
        } else if (stmt.kind === "Achieve") {
          branchSets.push(formatAchieve(stmt as AchieveStatement));
        }
      }

      const outEdges = edgesBySource.get(blockId) ?? [];
      const ifBranches = outEdges.filter((e) =>
        e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch"
      );

      if (ifBranches.length > 0) {
        const div = pathAnalysis.divergences[blockId];
        const contId = div?.convergeBlockId ?? null;
        const condGroup = buildConditionalGroup(ifBranches, contId);
        if (condGroup) branchSets.push(condGroup);
        if (contId && contId !== stopAt && !branchVisited.has(contId)) queue.push(contId);
      } else if (outEdges.some((e) => isChoiceOptionEdge(e.kind))) {
        // Choice block — stop here; the choice will be processed separately
      } else {
        for (const e of outEdges) {
          if (e.targetBlockId && e.kind !== "GameEnd" && !isChoiceOptionEdge(e.kind)) {
            queue.push(e.targetBlockId);
          }
        }
      }
    }

    return branchSets;
  };

  const findBranchGotoTargets = (entryId: string, stopAt: string | null): Set<string> => {
    const targets = new Set<string>();
    const vis = new Set<string>();
    const q = [entryId];
    while (q.length > 0) {
      const id = q.shift()!;
      if (vis.has(id) || (stopAt && id === stopAt)) continue;
      vis.add(id);
      for (const e of edgesBySource.get(id) ?? []) {
        if (!e.targetBlockId) continue;
        if (e.kind === "Goto" || e.kind === "GotoScene") {
          targets.add(e.targetBlockId);
        } else if (!isChoiceOptionEdge(e.kind) && e.kind !== "IfBranch" && e.kind !== "ElseIfBranch" && e.kind !== "ElseBranch") {
          q.push(e.targetBlockId);
        }
      }
    }
    return targets;
  };

  const buildConditionalGroup = (
    branchEdges: Transition[],
    continuationId: string | null,
  ): SetEntry | null => {
    const branches: { condition: string | null; isElse: boolean; sets: SetEntry[] }[] = [];

    const targetCounts = new Map<string, number>();
    for (const edge of branchEdges) {
      if (!edge.targetBlockId) continue;
      const targets = findBranchGotoTargets(edge.targetBlockId, continuationId);
      for (const t of targets) {
        targetCounts.set(t, (targetCounts.get(t) ?? 0) + 1);
      }
    }
    const sharedTargets = new Set(
      [...targetCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id)
    );

    for (const edge of branchEdges) {
      if (!edge.targetBlockId) continue;
      let condition: string | null = null;
      if (edge.kind === "IfBranch" || edge.kind === "ElseIfBranch") {
        const condStmtId = edge.metadata.conditionStatementId;
        const condStmt = condStmtId ? statements[condStmtId] as any : null;
        if (condStmt?.expression) condition = formatExpr(condStmt.expression);
      }
      const isElse = edge.kind === "ElseIfBranch" || edge.kind === "ElseBranch";
      const branchSets = collectBranch(edge.targetBlockId, continuationId, sharedTargets);
      branches.push({ condition, isElse, sets: branchSets });
    }

    const nonEmpty = branches.filter((b) => b.sets.length > 0);
    if (nonEmpty.length === 0) return null;
    return { branches };
  };

  const queue = [startBlockId];

  while (queue.length > 0) {
    const blockId = queue.shift()!;
    if (visited.has(blockId)) continue;
    visited.add(blockId);

    const ref = cfg.refs[blockId];
    if (!ref) { destination = { kind: "dead", blockId }; break; }

    const block = resolver.get(blockId, cfg.refs);
    if (block) collectBlockSets(blockId, block);

    if (choiceBlockIds.has(blockId) && sceneOf(blockId) !== "choicescript_stats") {
      destination = { kind: "choice", blockId: canonicalBlockId(blockId) };
      break;
    }
    if (pathAnalysis.splitPoints.has(blockId)) {
      destination = { kind: "choice", blockId };
      break;
    }

    let outEdges = edgesBySource.get(blockId) ?? [];
    if (outEdges.length === 0 && ref.sourceBlockId) {
      outEdges = edgesBySource.get(ref.sourceBlockId) ?? [];
    }
    if (outEdges.length === 0) { destination = { kind: "dead", blockId }; break; }
    if (outEdges.some((e) => e.kind === "GameEnd")) { destination = { kind: "end", blockId }; break; }
    if (outEdges.some((e) => e.kind === "GotoScene" && !e.targetBlockId)) { destination = { kind: "end", blockId }; break; }

    const ifBranches = outEdges.filter((e) =>
      e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch"
    );

    if (ifBranches.length > 0) {
      const div = pathAnalysis.divergences[blockId];
      const contId = div?.convergeBlockId ?? null;
      const condGroup = buildConditionalGroup(ifBranches, contId);
      if (condGroup) sets.push(condGroup);

      // Collect embedded choices from all branches via path analysis
      const branchChoices: { edge: Transition; choiceId: string }[] = [];
      if (div) {
        for (const edge of ifBranches) {
          if (!edge.targetBlockId) continue;
          const branchRec = div.branches.find((b) => b.entryBlockId === edge.targetBlockId);
          if (branchRec && branchRec.embeddedChoices.length > 0) {
            branchChoices.push({ edge, choiceId: branchRec.embeddedChoices[0] });
          }
        }
      }

      if (contId) {
        // Filter to choices not reachable from the continuation
        let contReachable: Set<string> | null = null;
        const isReachableFromCont = (choiceId: string): boolean => {
          if (choiceId === contId) return true;
          if (!contReachable) {
            contReachable = new Set<string>();
            const q = [contId];
            while (q.length > 0) {
              const id = q.shift()!;
              if (contReachable.has(id)) continue;
              contReachable.add(id);
              for (const e of edgesBySource.get(id) ?? []) {
                if (e.targetBlockId && !contReachable.has(e.targetBlockId) && e.kind !== "GameEnd") {
                  q.push(e.targetBlockId);
                }
              }
            }
          }
          return contReachable.has(choiceId);
        };
        const unreachable = branchChoices.filter(
          (bc) => !isReachableFromCont(bc.choiceId)
        );

        if (unreachable.length > 0) {
          destination = { kind: "choice", blockId: canonicalBlockId(unreachable[0].choiceId) };
          for (const { edge, choiceId } of unreachable.slice(1)) {
            let condition: string | null = null;
            if (edge.kind === "IfBranch" || edge.kind === "ElseIfBranch") {
              const condStmtId = edge.metadata.conditionStatementId;
              const condStmt = condStmtId ? statements[condStmtId] as any : null;
              if (condStmt?.expression) condition = formatExpr(condStmt.expression);
            }
            const isElse = edge.kind === "ElseBranch" || edge.kind === "ElseIfBranch";
            conditionalChoices.push({ condition, isElse, blockId: canonicalBlockId(choiceId) });
          }
          break;
        }
        queue.push(contId);
      } else {
        // No continuation — branches diverge
        if (branchChoices.length > 0) {
          const uniqueChoices = new Set(branchChoices.map((bc) => canonicalBlockId(bc.choiceId)));
          destination = { kind: "choice", blockId: canonicalBlockId(branchChoices[0].choiceId) };
          if (uniqueChoices.size > 1) {
            for (const { edge, choiceId } of branchChoices.slice(1)) {
              if (canonicalBlockId(choiceId) === canonicalBlockId(branchChoices[0].choiceId)) continue;
              let condition: string | null = null;
              if (edge.kind === "IfBranch" || edge.kind === "ElseIfBranch") {
                const condStmtId = edge.metadata.conditionStatementId;
                const condStmt = condStmtId ? statements[condStmtId] as any : null;
                if (condStmt?.expression) condition = formatExpr(condStmt.expression);
              }
              const isElse = edge.kind === "ElseBranch" || edge.kind === "ElseIfBranch";
              conditionalChoices.push({ condition, isElse, blockId: canonicalBlockId(choiceId) });
            }
          }
        }
        if (!destination) {
          const anyTerminates = div?.branches.some((b) => b.terminates) ?? false;
          if (anyTerminates) destination = { kind: "end", blockId };
        }
        if (destination) break;
      }
    } else {
      const isStatsChoice = choiceBlockIds.has(blockId) && sceneOf(blockId) === "choicescript_stats";
      for (const e of outEdges) {
        if (e.targetBlockId && e.kind !== "GameEnd") {
          if (isChoiceOptionEdge(e.kind) && !isStatsChoice) continue;
          queue.push(e.targetBlockId);
        }
      }
    }
  }

  return { sets, writes, destination: destination ?? { kind: "dead", blockId: startBlockId }, conditionalChoices };
};

// --- Build guide tree (driven by choice map) ---

console.log("Loading choice map...");
const choiceMap = readChoiceMap(getIO().readFile(outPath("choice-map.json")));
console.log(`  ${choiceMap.choiceCount} choices loaded`);

const choiceLabels = new Map<string, string>();
for (const [canonical, num] of choiceMap.numByCanonical) {
  choiceLabels.set(canonical, String(num));
}


interface GuideOption {
  label: string;
  conditions: string[];
  dataflow: Record<string, string>;
  sets: SetEntry[];
  entryBlockId: string;
  destBlockId: string | null;
  destKind: "choice" | "end" | "dead";
  conditionalChoices: ConditionalChoice[];
}

interface GuideChoice {
  kind: "choice";
  blockId: string;
  num: number;
  scene: string;
  label: string | null;
  isHub: boolean;
  prose: string | null;
  options: GuideOption[];
  commonSets: SetEntry[];
  perOptionSets: SetEntry[][];
}

interface GuideBranch {
  kind: "branch";
  labels: string[];
  fromChoice: number;
  convergeBlockId: string | null;
  children: GuideEntry[];
}

interface GuideRef {
  kind: "ref";
  blockId: string;
}

interface GuideConditionalContinuation {
  kind: "conditional-continuation";
  num: number;
  blockId: string;
  scene: string;
  branches: {
    condition: string | null;
    isElse: boolean;
    choiceId: string;
    children: GuideEntry[];
  }[];
}

type GuideEntry = GuideChoice | GuideBranch | GuideRef | GuideConditionalContinuation;

const getConditionExpr = (stmt: Statement): Expression | null => {
  if (stmt.kind === "ChoiceOption") {
    const opt = stmt as ChoiceOptionStatement;
    return opt.selectableIf ?? null;
  }
  if (stmt.kind === "If") return (stmt as IfStatement).expression;
  if (stmt.kind === "ElseIf") return (stmt as ElseIfStatement).expression;
  return null;
};

const buildChoiceNode = (blockId: string, num: number, isHub: boolean): GuideChoice => {
  const block = resolver.get(blockId, cfg.refs);
  const label = block ? getNearestLabel(block) : null;
  const prose = block ? getLastProse(block) : null;
  const outEdges = edgesBySource.get(blockId) ?? [];
  const choiceEdges = outEdges.filter((e) => isChoiceOptionEdge(e.kind) && e.targetBlockId);

  const options: GuideOption[] = [];
  const optionWrites: WriteInfo[][] = [];

  for (const edge of choiceEdges) {
    const optId = edge.metadata.optionStatementId;
    const condId = edge.metadata.conditionStatementId;
    const optStmt = optId ? statements[optId] : null;
    const optAsChoice = optStmt?.kind === "ChoiceOption" ? optStmt as ChoiceOptionStatement : null;
    const optLabel = optAsChoice?.token?.rawText ?? edge.targetBlockId ?? "?";

    const conditions: string[] = [];
    if (optAsChoice?.selectableIf) {
      conditions.push(`selectable_if ${formatExpr(optAsChoice.selectableIf)}`);
    }
    const visCondId = edge.metadata.choiceConditionId;
    if (visCondId) {
      const visStmt = statements[visCondId];
      if (visStmt) {
        const visExpr = getConditionExpr(visStmt);
        if (visExpr) conditions.push(`if ${formatExpr(visExpr)}`);
      }
    }
    if (condId && condId !== optId && condId !== visCondId) {
      const condStmt = statements[condId];
      if (condStmt) {
        const condExpr = getConditionExpr(condStmt);
        if (condExpr) conditions.push(`if ${formatExpr(condExpr)}`);
      }
    }

    const dataflow: Record<string, string> = {};
    if (conditions.length > 0) {
      const blockRecord = blockStates.get(blockId);
      if (blockRecord) {
        const condVars: string[] = [];
        if (optAsChoice?.selectableIf) {
          condVars.push(...extractConditionVars(optAsChoice.selectableIf));
        }
        if (visCondId) {
          const visStmt = statements[visCondId];
          if (visStmt) {
            const visExpr = getConditionExpr(visStmt);
            if (visExpr) condVars.push(...extractConditionVars(visExpr));
          }
        }
        if (condId && condId !== optId && condId !== visCondId) {
          const condStmt = statements[condId];
          if (condStmt) {
            const condExpr = getConditionExpr(condStmt);
            if (condExpr) condVars.push(...extractConditionVars(condExpr));
          }
        }
        for (const varName of new Set(condVars)) {
          const varEntry = blockRecord.vars[varName];
          if (varEntry) {
            const val = getEntryValue(varEntry);
            if (val.kind !== "bottom") dataflow[varName] = formatAbstractValue(val);
          }
        }
      }
    }

    const consequences = collectConsequences(edge.targetBlockId!);
    options.push({
      label: optLabel,
      conditions,
      dataflow,
      sets: consequences.sets,
      entryBlockId: edge.targetBlockId!,
      destBlockId: consequences.destination.kind === "choice" ? consequences.destination.blockId : null,
      destKind: consequences.destination.kind,
      conditionalChoices: consequences.conditionalChoices,
    });
    optionWrites.push(consequences.writes);
  }

  const commonKeys =
    options.length > 1
      ? options[0].sets
          .map(setEntryKey)
          .filter((k) => options.every((o) => o.sets.some((s) => setEntryKey(s) === k)))
      : [];
  const commonKeySet = new Set(commonKeys);
  const common = options.length > 1
    ? options[0].sets.filter((s) => commonKeySet.has(setEntryKey(s)))
    : [];

  // For per-option sets, widen "after" to include "before" for variables not
  // modified by all options (other options leave the variable unchanged).
  const allOptionVars = new Set(optionWrites.flat().map((w) => w.varName));
  const varsInAllOptions = new Set(
    [...allOptionVars].filter((v) =>
      optionWrites.every((writes) => writes.some((w) => w.varName === v))
    )
  );

  const widenSetEntry = (entry: SetEntry, writes: WriteInfo[]): SetEntry => {
    if (typeof entry !== "string") return entry;
    for (const w of writes) {
      if (varsInAllOptions.has(w.varName)) continue;
      if (entry !== w.formatted) continue;
      const widened = joinValues(w.before, w.after);
      const narrow = `[${formatAbstractValue(w.before)} → ${formatAbstractValue(w.after)}]`;
      const wide = `[${formatAbstractValue(w.before)} → ${formatAbstractValue(widened)}]`;
      if (narrow !== wide) return entry.replace(narrow, wide);
    }
    return entry;
  };

  const perOptionSets = options.map((o, i) =>
    o.sets
      .filter((s) => !commonKeySet.has(setEntryKey(s)))
      .map((s) => widenSetEntry(s, optionWrites[i]))
  );

  return {
    kind: "choice",
    blockId,
    num,
    scene: sceneOf(blockId),
    label,
    isHub,
    prose,
    options,
    commonSets: common,
    perOptionSets,
  };
};


const enrichEntries = (mapEntries: ChoiceMapEntry[]): GuideEntry[] => {
  const entries: GuideEntry[] = [];
  for (const m of mapEntries) {
    switch (m.kind) {
      case "choice":
        entries.push(buildChoiceNode(m.blockId, m.num, m.isHub));
        break;
      case "branch":
        entries.push({
          kind: "branch",
          labels: m.optionLabels,
          fromChoice: m.fromChoiceNum,
          convergeBlockId: m.convergeBlockId,
          children: enrichEntries(m.children),
        });
        break;
      case "ref":
        entries.push({ kind: "ref", blockId: m.blockId });
        break;
      case "conditional-split":
        entries.push({
          kind: "conditional-continuation",
          num: m.num,
          blockId: m.blockId,
          scene: sceneOf(m.blockId),
          branches: m.branches.map(b => {
            let condition: string | null = null;
            if (b.conditionStatementId) {
              const condStmt = statements[b.conditionStatementId] as any;
              if (condStmt?.expression) condition = formatExpr(condStmt.expression);
            }
            return {
              condition,
              isElse: b.isElse,
              choiceId: b.choiceBlockId,
              children: enrichEntries(b.children),
            };
          }),
        });
        break;
    }
  }
  return entries;
};

// --- Render ---

const choiceLink = (num: string): string => `[Choice ${num}](#choice-${num})`;

const findLabeledChoice = (startBlockId: string): string | null => {
  const visited = new Set<string>();
  const queue = [startBlockId];
  while (queue.length > 0) {
    const blockId = queue.shift()!;
    if (visited.has(blockId)) continue;
    visited.add(blockId);
    if (choiceBlockIds.has(blockId) && sceneOf(blockId) !== "choicescript_stats") {
      const num = choiceLabels.get(canonicalBlockId(blockId));
      if (num) return num;
    }
    const outEdges = edgesBySource.get(blockId) ?? [];
    for (const e of outEdges) {
      if (e.targetBlockId && !visited.has(e.targetBlockId) && !isChoiceOptionEdge(e.kind)) {
        queue.push(e.targetBlockId);
      }
    }
  }
  return null;
};

const splitLink = (num: number): string => `[Branch Split ${num}](#branch-split-${num})`;

const destLabel = (opt: GuideOption): string => {
  if (opt.destKind === "end") return "end";
  if (opt.destKind === "dead") return "dead end";
  if (opt.destBlockId) {
    if (choiceMap.splitBlockIds.has(opt.destBlockId)) {
      const num = choiceLabels.get(opt.destBlockId);
      if (num) return splitLink(Number(num));
    }
    const num = choiceLabels.get(canonicalBlockId(opt.destBlockId));
    if (num) return choiceLink(num);
    const nextNum = findLabeledChoice(opt.destBlockId);
    if (nextNum) return choiceLink(nextNum);
    return opt.destBlockId;
  }
  return "?";
};

const getImplicitNextId = (entries: GuideEntry[], idx: number): string | null => {
  for (let i = idx + 1; i < entries.length; i++) {
    const next = entries[i];
    if (next.kind === "choice") return next.blockId;
    if (next.kind === "conditional-continuation") return next.blockId;
    if (next.kind === "branch" && next.children.length > 0) {
      const first = next.children[0];
      if (first.kind === "choice") return first.blockId;
      if (first.kind === "conditional-continuation") return first.blockId;
    }
  }
  return null;
};

const renderSetEntries = (sets: SetEntry[], prefix: string): string[] => {
  const lines: string[] = [];
  for (const entry of sets) {
    if (typeof entry === "string") {
      lines.push(`${prefix}- \`${entry}\``);
    } else {
      const hasNonEmpty = entry.branches.some((b) => b.sets.length > 0);
      if (!hasNonEmpty) continue;
      for (const branch of entry.branches) {
        const prefix2 = branch.isElse ? "else " : "";
        const label = branch.condition ? `${prefix2}if ${branch.condition}` : "else";
        lines.push(`${prefix}- *${label}:*`);
        if (branch.sets.length > 0) {
          lines.push(...renderSetEntries(branch.sets, prefix + "  "));
        } else {
          lines.push(`${prefix}  - *(no changes)*`);
        }
      }
    }
  }
  return lines;
};

const render = (entries: GuideEntry[], lastRef: { value: string | null } = { value: null }): string[] => {
  const lines: string[] = [];

  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];

    if (entry.kind === "ref") {
      const num = choiceLabels.get(canonicalBlockId(entry.blockId));
      if (num) {
        const line = `*→ continues at ${choiceLink(num)}*`;
        if (lastRef.value !== line) {
          lines.push("", line);
          lastRef.value = line;
        }
      }
      continue;
    }

    if (entry.kind === "conditional-continuation") {
      const splitId = `branch-split-${entry.num}`;
      lines.push("");
      lines.push(`## <a id="${splitId}"></a>Branch Split ${entry.num} — ${entry.scene}`);
      for (const branch of entry.branches) {
        const prefix = branch.isElse ? "else " : "";
        const label = branch.condition ? `${prefix}if ${branch.condition}` : "else";
        const num = choiceLabels.get(canonicalBlockId(branch.choiceId));
        const link = num ? choiceLink(num) : branch.choiceId;
        lines.push(`- *${label}:* → ${link}`);
      }
      for (const branch of entry.branches) {
        if (branch.children.length > 0) {
          lines.push(...render(branch.children, lastRef));
        }
      }
      continue;
    }

    if (entry.kind === "branch") {
      const meaningful = entry.children.filter((c) => c.kind === "choice" || c.kind === "conditional-continuation" || (c.kind === "branch" && c.children.length > 0));
      if (meaningful.length === 0) continue;
      lines.push("", "---", "");
      const convergeNum = entry.convergeBlockId ? choiceLabels.get(canonicalBlockId(entry.convergeBlockId)) : null;
      const convergeStr = convergeNum ? `, converges at ${choiceLink(convergeNum)}` : "";
      lines.push(`### Path: ${entry.labels.join(" / ")} *(from ${choiceLink(String(entry.fromChoice))}${convergeStr})*`);
      lines.push(...render(entry.children, lastRef));
      continue;
    }

    lines.push("");
    const hubTag = entry.isHub ? " [HUB]" : "";
    lines.push(`## <a id="choice-${entry.num}"></a>Choice ${entry.num}${hubTag} — ${entry.scene}${entry.label ? ` (${entry.label})` : ""}`);
    if (entry.prose) {
      lines.push("");
      lines.push(`> ${entry.prose.replace(/\n/g, "\n> ")}`);
    }
    lines.push("");

    const implicitNextId = getImplicitNextId(entries, ei);
    const allConverge = entry.options.every((o) => o.destBlockId === implicitNextId);

    // First choice in the game: skip routes (loop-backs) first, main path last
    let optionOrder = entry.options.map((_, i) => i);
    if (entry.num === 1 && entry.isHub) {
      const div = pathAnalysis.divergences[entry.blockId];
      if (div) {
        const loopBackEntries = new Set(
          div.branches.filter(b => b.isLoopBack).map(b => b.entryBlockId),
        );
        const skipIndices = optionOrder.filter(i => loopBackEntries.has(entry.options[i].entryBlockId));
        const mainIndices = optionOrder.filter(i => !loopBackEntries.has(entry.options[i].entryBlockId));
        optionOrder = [...skipIndices, ...mainIndices];
      }
    }

    for (let oi = 0; oi < optionOrder.length; oi++) {
      const i = optionOrder[oi];
      const opt = entry.options[i];
      const condStr = opt.conditions.length > 0 ? ` [${opt.conditions.join("; ")}]` : "";
      lines.push(`${oi + 1}. **${opt.label}**${condStr}`);
      if (Object.keys(opt.dataflow).length > 0) {
        for (const [varName, val] of Object.entries(opt.dataflow)) {
          lines.push(`   - *${varName}* could be ${val}`);
        }
      }
      if (entry.perOptionSets[i].length > 0) {
        lines.push(...renderSetEntries(entry.perOptionSets[i], "   "));
      } else if (entry.commonSets.length === 0) {
        lines.push(`   - *(no variable changes)*`);
      }
      const isImplicit = allConverge && opt.destBlockId === implicitNextId;
      if (!isImplicit) {
        lines.push(`   - → ${destLabel(opt)}`);
      }
    }

    if (entry.commonSets.length > 0) {
      lines.push("");
      lines.push(`**All options:**`);
      lines.push(...renderSetEntries(entry.commonSets, ""));
    }
  }

  return lines;
};

// --- Generate ---

console.log(`\nEnriching guide tree...`);
const tree = enrichEntries(choiceMap.entries);
console.log(`  ${choiceMap.choiceCount} choices enriched`);

const branchCount = (function countBranches(entries: GuideEntry[]): number {
  let n = 0;
  for (const e of entries) {
    if (e.kind === "branch") { n++; n += countBranches(e.children); }
  }
  return n;
})(tree);
const refCount = (function countRefs(entries: GuideEntry[]): number {
  let n = 0;
  for (const e of entries) {
    if (e.kind === "ref") n++;
    if (e.kind === "branch") n += countRefs(e.children);
  }
  return n;
})(tree);
console.log(`  ${branchCount} branches, ${refCount} back-references`);

function* guideRecords(entries: GuideEntry[], path: string[] = []): Iterable<Record<string, unknown>> {
  for (const entry of entries) {
    if (entry.kind === "choice") {
      yield {
        kind: "choice",
        num: entry.num,
        blockId: entry.blockId,
        scene: entry.scene,
        label: entry.label,
        isHub: entry.isHub,
        prose: entry.prose,
        path,
        options: entry.options.map((o, i) => ({
          label: o.label,
          conditions: o.conditions,
          dataflow: o.dataflow,
          sets: entry.perOptionSets[i],
          destBlockId: o.destBlockId,
          destKind: o.destKind,
          destLabel: destLabel(o),
        })),
        commonSets: entry.commonSets,
      };
    } else if (entry.kind === "branch") {
      const convergeNum = entry.convergeBlockId
        ? choiceLabels.get(canonicalBlockId(entry.convergeBlockId))
        : null;
      yield {
        kind: "branch",
        labels: entry.labels,
        fromChoice: entry.fromChoice,
        convergeBlockId: entry.convergeBlockId,
        convergeChoice: convergeNum ? Number(convergeNum) : null,
        path,
      };
      yield* guideRecords(entry.children, [...path, entry.labels.join(" / ")]);
    } else if (entry.kind === "ref") {
      const num = choiceLabels.get(canonicalBlockId(entry.blockId));
      yield {
        kind: "ref",
        blockId: entry.blockId,
        targetChoice: num ? Number(num) : null,
        path,
      };
    } else if (entry.kind === "conditional-continuation") {
      yield {
        kind: "conditional-continuation",
        num: entry.num,
        blockId: entry.blockId,
        scene: entry.scene,
        branches: entry.branches.map((b) => ({
          condition: b.condition,
          isElse: b.isElse,
          choiceId: b.choiceId,
          targetChoice: Number(choiceLabels.get(canonicalBlockId(b.choiceId)) ?? 0),
        })),
        path,
      };
      for (const b of entry.branches) {
        const label = b.isElse ? (b.condition ? `else if ${b.condition}` : "else") : `if ${b.condition}`;
        yield* guideRecords(b.children, [...path, label]);
      }
    }
  }
}

console.log("Writing guide.ndjson...");
const guideNdjsonCount = writeNdjson(outPath("guide.ndjson"), guideRecords(tree));
console.log(`  ${guideNdjsonCount} records`);

console.log("Rendering...");
const out = render(tree);

const guide = `# Choice Guide\n\n${out.join("\n")}\n`;
getIO().writeFile(outPath("guide.md"), guide);

console.log(`Wrote guide.md (${(new Blob([guide]).size / 1024).toFixed(0)} KB)`);
