import { Transition, isChoiceOptionEdge } from "../control-flow-graph/data";
import { InlineCfg, BlockResolver, sceneOf } from "../control-flow-graph/cfg-io";
import { ChoiceOptionStatement, IfStatement, ElseIfStatement, SetVariableStatement, AchieveStatement, Statement } from "../../parser/statements";
import { Expression, Binary, Unary, Literal, Identifier } from "../../parser/expressions";
import { PathAnalysis } from "./path-analysis-result";
import { ChoiceMap } from "./choice-map";

export type TraceStep =
  | { kind: "sets"; values: string[] }
  | { kind: "conditional"; blockId: string; branches: TraceBranch[] };

export interface TraceBranch {
  condition: string | null;
  isElse: boolean;
  steps: TraceStep[];
  dest: TraceDest | null;
}

export type TraceDest =
  | { kind: "choice"; blockId: string }
  | { kind: "split"; blockId: string }
  | { kind: "end" }
  | { kind: "dead" };

export interface OptionTrace {
  optionLabel: string;
  conditions: string[];
  steps: TraceStep[];
  dest: TraceDest;
}

export interface ChoiceTrace {
  blockId: string;
  num: number;
  scene: string;
  options: OptionTrace[];
}

export interface SplitTrace {
  blockId: string;
  scene: string;
  branches: {
    condition: string | null;
    isElse: boolean;
    steps: TraceStep[];
    dest: TraceDest;
  }[];
}

export interface ChoiceTraceResult {
  choices: ChoiceTrace[];
  splits: SplitTrace[];
}

function formatExpr(expr: Expression): string {
  switch (expr.kind) {
    case "Literal": {
      const lit = expr as Literal;
      if (lit.value.type === "StringLiteral") return `"${lit.value.value}"`;
      return String(lit.value.value);
    }
    case "Identifier": return (expr as Identifier).token.value;
    case "Binary": {
      const bin = expr as Binary;
      const op = (bin.operator as { rawValue?: string }).rawValue ?? bin.operator.type;
      return `${formatExpr(bin.left)} ${op} ${formatExpr(bin.right)}`;
    }
    case "Unary": {
      const un = expr as Unary;
      return `${un.operator.rawValue}(${formatExpr(un.value)})`;
    }
    case "Grouping":
    case "Dereference": return formatExpr(expr.expression);
    default: return "?";
  }
}

function formatSet(stmt: SetVariableStatement): string | null {
  const expr = stmt.expression;
  if (!expr) return null;
  if (expr.kind === "Identifier") {
    return `${(expr as Identifier).token.value} ${formatExpr(stmt.assignment)}`;
  }
  if (expr.kind === "Binary") {
    const bin = expr as Binary;
    if (bin.left.kind === "Identifier") {
      const name = (bin.left as Identifier).token.value;
      const op = (bin.operator as { rawValue?: string }).rawValue ?? bin.operator.type;
      return `${name} ${op} ${formatExpr(bin.right)}`;
    }
  }
  return null;
}

function getConditionExpr(stmt: Statement): Expression | null {
  if (stmt.kind === "If") return (stmt as IfStatement).expression;
  if (stmt.kind === "ElseIf") return (stmt as ElseIfStatement).expression;
  return null;
}

export function buildChoiceTraces(
  cfg: InlineCfg,
  resolver: BlockResolver,
  statements: Record<string, Statement>,
  pathAnalysis: PathAnalysis,
  choiceMap: ChoiceMap,
  loopHeaderIds: Set<string>,
): ChoiceTraceResult {
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

  const splitBlockIds = choiceMap.splitBlockIds;

  function collectBlockSets(blockId: string): string[] {
    const sets: string[] = [];
    const block = resolver.get(blockId, cfg.refs);
    if (!block) return sets;
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      if (stmt.kind === "SetVariable") {
        const formatted = formatSet(stmt as SetVariableStatement);
        if (formatted) sets.push(formatted);
      } else if (stmt.kind === "Achieve") {
        sets.push(`achieve ${(stmt as AchieveStatement).codename.value}`);
      }
    }
    return sets;
  }

  const condStepCache = new Map<string, TraceStep | null>();
  const walkBranchCache = new Map<string, { steps: TraceStep[]; dest: TraceDest | null }>();

  function collectTrace(startBlockId: string): { steps: TraceStep[]; dest: TraceDest } {
    const steps: TraceStep[] = [];
    const visited = new Set<string>();
    let pendingSets: string[] = [];

    function flushSets() {
      if (pendingSets.length > 0) {
        steps.push({ kind: "sets", values: [...pendingSets] });
        pendingSets = [];
      }
    }

    interface WalkBranchResult { steps: TraceStep[]; dest: TraceDest | null }

    function walkBranch(entryId: string, stopAt: string | null): WalkBranchResult {
      const cacheKey = `${entryId}:${stopAt ?? ""}`;
      const cached = walkBranchCache.get(cacheKey);
      if (cached) return cached;

      const branchSteps: TraceStep[] = [];
      const branchSets: string[] = [];
      const branchVisited = new Set<string>();
      const queue = [entryId];
      let branchDest: TraceDest | null = null;

      while (queue.length > 0) {
        const blockId = queue.shift()!;
        if (stopAt && blockId === stopAt) continue;
        if (branchVisited.has(blockId) || visited.has(blockId)) continue;
        branchVisited.add(blockId);

        if (!cfg.refs[blockId]) continue;

        if (choiceBlockIds.has(blockId) && sceneOf(blockId) !== "choicescript_stats") {
          branchDest = { kind: "choice", blockId: canonicalBlockId(blockId) };
          continue;
        }
        if (splitBlockIds.has(blockId)) {
          branchDest = { kind: "split", blockId };
          continue;
        }

        const sets = collectBlockSets(blockId);
        branchSets.push(...sets);

        const outEdges = edgesBySource.get(blockId) ?? [];
        const ifBranches = outEdges.filter((e) =>
          e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch" || e.kind === "IfFallThrough"
        );

        if (ifBranches.length > 0) {
          if (branchSets.length > 0) {
            branchSteps.push({ kind: "sets", values: [...branchSets] });
            branchSets.length = 0;
          }
          const div = pathAnalysis.divergences[blockId];
          const contId = div?.convergeBlockId ?? null;
          const condStep = buildConditionalStep(blockId, ifBranches, contId);
          if (condStep) branchSteps.push(condStep);
          if (contId && contId !== stopAt && !branchVisited.has(contId)) queue.push(contId);
        } else if (outEdges.some((e) => isChoiceOptionEdge(e.kind))) {
          branchDest = { kind: "choice", blockId: canonicalBlockId(blockId) };
        } else {
          if (outEdges.some((e) => e.kind === "GameEnd")) {
            branchDest = { kind: "end" };
          } else if (outEdges.some((e) => e.kind === "GotoScene" && !e.targetBlockId)) {
            branchDest = { kind: "end" };
          } else {
            for (const e of outEdges) {
              if (e.targetBlockId && e.kind !== "GameEnd" && !isChoiceOptionEdge(e.kind)) {
                queue.push(e.targetBlockId);
              }
            }
          }
        }
      }

      if (branchSets.length > 0) {
        branchSteps.push({ kind: "sets", values: branchSets });
      }
      const result = { steps: branchSteps, dest: branchDest };
      walkBranchCache.set(cacheKey, result);
      return result;
    }

    function buildConditionalStep(blockId: string, branchEdges: Transition[], contId: string | null): TraceStep | null {
      const cacheKey = `${blockId}:${contId ?? ""}`;
      if (condStepCache.has(cacheKey)) return condStepCache.get(cacheKey)!;

      const branches: TraceBranch[] = [];
      for (const edge of branchEdges) {
        if (!edge.targetBlockId) continue;
        let condition: string | null = null;
        if (edge.kind === "IfBranch" || edge.kind === "ElseIfBranch") {
          const condStmtId = edge.metadata.conditionStatementId;
          const condStmt = condStmtId ? statements[condStmtId] : null;
          if (condStmt) {
            const condExpr = getConditionExpr(condStmt);
            if (condExpr) condition = formatExpr(condExpr);
          }
        }
        const isElse = edge.kind === "ElseBranch" || edge.kind === "ElseIfBranch" || edge.kind === "IfFallThrough";
        const branchResult = walkBranch(edge.targetBlockId, contId);
        branches.push({ condition, isElse, steps: branchResult.steps, dest: branchResult.dest });
      }
      const hasContent = branches.some(b => b.steps.length > 0 || b.dest !== null);
      const result = hasContent ? { kind: "conditional" as const, blockId, branches } : null;
      condStepCache.set(cacheKey, result);
      return result;
    }

    const queue = [startBlockId];

    while (queue.length > 0) {
      const blockId = queue.shift()!;
      if (visited.has(blockId)) continue;
      visited.add(blockId);

      const ref = cfg.refs[blockId];
      if (!ref) { flushSets(); return { steps, dest: { kind: "dead" } }; }

      if (choiceBlockIds.has(blockId) && sceneOf(blockId) !== "choicescript_stats") {
        flushSets();
        return { steps, dest: { kind: "choice", blockId: canonicalBlockId(blockId) } };
      }
      if (splitBlockIds.has(blockId)) {
        flushSets();
        return { steps, dest: { kind: "split", blockId } };
      }

      pendingSets.push(...collectBlockSets(blockId));

      let outEdges = edgesBySource.get(blockId) ?? [];
      if (outEdges.length === 0 && ref.sourceBlockId) {
        outEdges = edgesBySource.get(ref.sourceBlockId) ?? [];
      }
      if (outEdges.length === 0) { flushSets(); return { steps, dest: { kind: "dead" } }; }
      if (outEdges.some((e) => e.kind === "GameEnd")) { flushSets(); return { steps, dest: { kind: "end" } }; }
      if (outEdges.some((e) => e.kind === "GotoScene" && !e.targetBlockId)) { flushSets(); return { steps, dest: { kind: "end" } }; }

      const ifBranches = outEdges.filter((e) =>
        e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch" || e.kind === "IfFallThrough"
      );

      if (ifBranches.length > 0) {
        flushSets();
        const div = pathAnalysis.divergences[blockId];
        const contId = div?.convergeBlockId ?? null;
        const condStep = buildConditionalStep(blockId, ifBranches, contId);
        if (condStep) steps.push(condStep);
        if (contId) {
          queue.push(contId);
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

    flushSets();
    return { steps, dest: { kind: "dead" } };
  }

  // Build choice traces
  const choiceTraces: ChoiceTrace[] = [];
  for (const [canonical, num] of choiceMap.numByCanonical) {
    if (!choiceBlockIds.has(canonical)) continue;
    const outEdges = edgesBySource.get(canonical) ?? [];
    const choiceEdges = outEdges.filter((e) => isChoiceOptionEdge(e.kind) && e.targetBlockId);

    const options: OptionTrace[] = [];
    for (const edge of choiceEdges) {
      const optId = edge.metadata.optionStatementId;
      const optStmt = optId ? statements[optId] : null;
      const optAsChoice = optStmt?.kind === "ChoiceOption" ? optStmt as ChoiceOptionStatement : null;
      const optionLabel = optAsChoice?.token?.rawText ?? "?";

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

      const { steps, dest } = collectTrace(edge.targetBlockId!);
      options.push({ optionLabel, conditions, steps, dest });
    }

    choiceTraces.push({ blockId: canonical, num, scene: sceneOf(canonical), options });
  }

  // Build split traces
  const splitTraces: SplitTrace[] = [];
  for (const splitBlockId of splitBlockIds) {
    const div = pathAnalysis.divergences[splitBlockId];
    if (!div) continue;

    const outEdges = edgesBySource.get(splitBlockId) ?? [];
    const ifBranches = outEdges.filter((e) =>
      e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch" || e.kind === "IfFallThrough"
    );

    const branches: SplitTrace["branches"] = [];
    for (const edge of ifBranches) {
      if (!edge.targetBlockId) continue;
      let condition: string | null = null;
      if (edge.kind === "IfBranch" || edge.kind === "ElseIfBranch") {
        const condStmtId = edge.metadata.conditionStatementId;
        const condStmt = condStmtId ? statements[condStmtId] : null;
        if (condStmt) {
          const condExpr = getConditionExpr(condStmt);
          if (condExpr) condition = formatExpr(condExpr);
        }
      }
      const isElse = edge.kind === "ElseBranch" || edge.kind === "ElseIfBranch" || edge.kind === "IfFallThrough";
      const { steps, dest } = collectTrace(edge.targetBlockId);
      branches.push({ condition, isElse, steps, dest });
    }

    splitTraces.push({ blockId: splitBlockId, scene: sceneOf(splitBlockId), branches });
  }

  return { choices: choiceTraces, splits: splitTraces };
}
