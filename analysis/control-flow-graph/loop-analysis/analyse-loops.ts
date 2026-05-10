import { ControlFlowGraph, isChoiceOptionEdge, isConditionalBranch, isGoSubCall } from "../data";
import { Statement } from "../../../parser/statements";
import { extractEffect } from "../../dataflow/extract-definitions";
import { buildSuccessorMap, buildPredecessorMap, detectBackEdges, walkGraph, getOrSet } from "../graph-utils";
import { BlockResolver, sceneOf } from "../cfg-io";
import { LoopInfo, LoopBound, LoopAnalysisResult } from "./loop-info";

export const analyseLoops = (
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): LoopAnalysisResult => {
  const successors = buildSuccessorMap(cfg, true);
  const { loopHeaders, backEdges } = detectBackEdges(cfg.entryBlockId, successors, Object.keys(cfg.blocks));

  const predecessors = buildPredecessorMap(successors);
  const blockToLoop = new Map<string, string>();

  const loopBodies = new Map<string, Set<string>>();
  for (const header of loopHeaders) {
    const tails = backEdges.filter((e) => e.to === header);
    loopBodies.set(header, computeNaturalLoopBody(header, tails, predecessors, successors));
  }

  const sortedHeaders = [...loopHeaders].sort(
    (a, b) => (loopBodies.get(a)!.size) - (loopBodies.get(b)!.size)
  );

  for (const header of sortedHeaders) {
    const body = loopBodies.get(header)!;
    for (const bid of body) {
      if (!blockToLoop.has(bid)) blockToLoop.set(bid, header);
    }
  }

  const loops: LoopInfo[] = [];
  for (const header of loopHeaders) {
    const body = loopBodies.get(header)!;
    const tails = backEdges.filter((e) => e.to === header);
    const bounds = detectBounds(header, body, tails, cfg, statements, successors, blockToLoop, resolver);

    const tripCounts: number[] = [];
    for (const b of bounds) {
      if (b.type !== "unbounded") tripCounts.push(b.tripCount);
    }
    const tripCount = tripCounts.length > 0 ? Math.min(...tripCounts) : null;

    loops.push({
      headerId: header,
      bodyBlockIds: [...body],
      backEdges: tails,
      bounds,
      tripCount,
    });
  }

  return { loops, loopHeaderSet: loopHeaders, blockToLoop };
};

const computeNaturalLoopBody = (
  header: string,
  tails: Array<{ from: string; to: string }>,
  predecessors: Map<string, string[]>,
  successors: Map<string, Set<string>>
): Set<string> => {
  const { visited: forwardReachable } = walkGraph(
    header,
    id => successors.get(id) ?? [],
    { dfs: true },
  );

  const tailNodes = tails.map(t => t.from).filter(t => forwardReachable.has(t));
  const { visited: body } = walkGraph(
    [header, ...tailNodes],
    id => (predecessors.get(id) ?? []).filter(p => forwardReachable.has(p)),
    { dfs: true, exitWhen: id => id === header },
  );

  return body;
};

const DEFAULT_FALLBACK_TRIP_COUNT = 10;

const detectBounds = (
  header: string,
  body: Set<string>,
  backEdgeTails: Array<{ from: string; to: string }>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  successors: Map<string, Set<string>>,
  blockToLoop: Map<string, string>,
  resolver: BlockResolver,
): LoopBound[] => {
  const bounds: LoopBound[] = [];

  const counterBound = detectCounterBound(header, body, cfg, statements, successors, resolver);
  if (counterBound) bounds.push(counterBound);

  const reuseBounds = detectReuseBounds(header, body, cfg, statements, blockToLoop);
  bounds.push(...reuseBounds);

  const sequencedBounds = detectSequencedSelectableBounds(header, body, cfg, statements, blockToLoop, resolver);
  bounds.push(...sequencedBounds);

  const choiceExitBounds = detectChoiceExitBounds(header, body, cfg, statements, blockToLoop);
  bounds.push(...choiceExitBounds);

  const confirmInputBounds = detectConfirmInputBounds(header, body, backEdgeTails, cfg, statements, blockToLoop, resolver);
  bounds.push(...confirmInputBounds);

  const conditionalExitBound = detectConditionalExitBound(body, cfg);
  if (conditionalExitBound) bounds.push(conditionalExitBound);

  const statsMenuBound = detectStatsMenuBound(header, body, cfg, statements, blockToLoop, resolver);
  if (statsMenuBound) bounds.push(statsMenuBound);

  if (bounds.length === 0) {
    bounds.push({ type: "fallback", tripCount: DEFAULT_FALLBACK_TRIP_COUNT });
  }

  return bounds;
};

const detectCounterBound = (
  header: string,
  body: Set<string>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  successors: Map<string, Set<string>>,
  resolver: BlockResolver,
): LoopBound | null => {
  const increments = findIncrements(body, cfg, statements, resolver);
  if (increments.length === 0) return null;

  const exitConditions = findExitConditions(header, body, cfg, statements, successors);

  for (const inc of increments) {
    for (const cond of exitConditions) {
      if (cond.variable !== inc.variable) continue;
      if (cond.operator === "EqualityOperator" && typeof cond.compareValue === "number") {
        const tripCount = Math.ceil((cond.compareValue - (inc.initialGuess ?? 0)) / inc.step);
        if (tripCount > 0 && tripCount <= 1000) {
          return {
            type: "counter",
            variable: inc.variable,
            step: inc.step,
            exitValue: cond.compareValue,
            tripCount,
          };
        }
      }
      if (cond.operator === "GreaterThanEqualsOperator" && typeof cond.compareValue === "number") {
        const tripCount = Math.ceil((cond.compareValue - (inc.initialGuess ?? 0)) / inc.step);
        if (tripCount > 0 && tripCount <= 1000) {
          return {
            type: "counter",
            variable: inc.variable,
            step: inc.step,
            exitValue: cond.compareValue,
            tripCount,
          };
        }
      }
      if (cond.operator === "GreaterThanOperator" && typeof cond.compareValue === "number") {
        const tripCount = Math.ceil((cond.compareValue + 1 - (inc.initialGuess ?? 0)) / inc.step);
        if (tripCount > 0 && tripCount <= 1000) {
          return {
            type: "counter",
            variable: inc.variable,
            step: inc.step,
            exitValue: cond.compareValue,
            tripCount,
          };
        }
      }
    }
  }

  return null;
};

interface IncrementInfo {
  variable: string;
  step: number;
  initialGuess: number | null;
}

const findIncrements = (
  body: Set<string>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): IncrementInfo[] => {
  const result: IncrementInfo[] = [];
  const seen = new Set<string>();

  for (const bid of body) {
    const ref = cfg.blocks[bid];
    if (!ref) continue;
    const block = resolver.resolve(ref);
    if (!block) continue;

    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt || stmt.kind !== "SetVariable") continue;

      const effect = extractEffect(stmt);
      if (!effect.defines || !effect.defines.isCompoundAssignment) continue;
      if (!effect.defines.compoundExpression) continue;

      const expr = effect.defines.compoundExpression as any;
      if (!expr.left || !expr.operator || !expr.right) continue;

      const opType = expr.operator.type;
      if (opType !== "AdditionOperator" && opType !== "SubtractionOperator") continue;

      const varName = effect.defines.variable;
      if (seen.has(varName)) continue;

      const rightVal = extractConstantNumber(expr.right);
      if (rightVal === null) continue;

      const step = opType === "AdditionOperator" ? rightVal : -rightVal;
      if (step === 0) continue;

      seen.add(varName);
      result.push({ variable: varName, step, initialGuess: 0 });
    }
  }

  return result;
};

interface ExitCondition {
  variable: string;
  operator: string;
  compareValue: number;
}

const findExitConditions = (
  header: string,
  body: Set<string>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  successors: Map<string, Set<string>>
): ExitCondition[] => {
  const conditions: ExitCondition[] = [];

  for (const edge of cfg.edges) {
    if (!body.has(edge.sourceBlockId)) continue;
    if (!isConditionalBranch(edge.kind)) continue;

    const targetOutside = edge.targetBlockId && !body.has(edge.targetBlockId);
    if (!targetOutside) continue;

    const condStmtId = edge.metadata.conditionStatementId;
    if (condStmtId == null) continue;

    const condStmt = statements[condStmtId] as any;
    if (!condStmt?.expression) continue;

    const cond = extractComparisonCondition(condStmt.expression, edge.kind);
    if (cond) conditions.push(cond);
  }

  return conditions;
};

const extractComparisonCondition = (
  expr: any,
  edgeKind: string
): ExitCondition | null => {
  if (!expr || !expr.left || !expr.operator || !expr.right) return null;

  const opType = expr.operator.type;
  const isTaken = edgeKind === "IfBranch" || edgeKind === "ElseIfBranch";

  if (opType === "EqualityOperator" || opType === "NotEqualityOperator" ||
      opType === "GreaterThanOperator" || opType === "LessThanOperator" ||
      opType === "GreaterThanEqualsOperator" || opType === "LessThanEqualsOperator") {

    const leftVar = extractIdentifierName(expr.left);
    const rightConst = extractConstantNumber(expr.right);
    if (leftVar && rightConst !== null) {
      const effectiveOp = isTaken ? opType : negateOperator(opType);
      return { variable: leftVar, operator: effectiveOp, compareValue: rightConst };
    }

    const rightVar = extractIdentifierName(expr.right);
    const leftConst = extractConstantNumber(expr.left);
    if (rightVar && leftConst !== null) {
      const flipped = flipOperator(opType);
      if (!flipped) return null;
      const effectiveOp = isTaken ? flipped : negateOperator(flipped);
      return { variable: rightVar, operator: effectiveOp, compareValue: leftConst };
    }
  }

  return null;
};

const detectReuseBounds = (
  header: string,
  body: Set<string>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  blockToLoop: Map<string, string>
): LoopBound[] => {
  const bounds: LoopBound[] = [];

  for (const bid of body) {
    const block = cfg.blocks[bid];
    if (!block || block.exitType !== "Choice") continue;

    if (blockToLoop.get(bid) !== header) continue;

    const optionEdges = cfg.edges.filter(
      (e) => e.sourceBlockId === bid && isChoiceOptionEdge(e.kind) && e.targetBlockId
    );

    let reuseCount = 0;
    for (const edge of optionEdges) {
      const er = edge.metadata.effectiveReuse;
      if (er === "hide_reuse" || er === "disable_reuse") {
        reuseCount++;
      }
    }

    if (reuseCount > 0 && optionEdges.length > 0) {
      bounds.push({
        type: "reuse",
        choiceBlockId: bid,
        optionCount: optionEdges.length,
        reuseCount,
        tripCount: reuseCount + 1,
      });
    }
  }

  return bounds;
};

const detectSequencedSelectableBounds = (
  header: string,
  body: Set<string>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  blockToLoop: Map<string, string>,
  resolver: BlockResolver,
): LoopBound[] => {
  const bounds: LoopBound[] = [];
  const labelToBlockId = buildLabelIndex(cfg, resolver);

  for (const bid of body) {
    const ref = cfg.blocks[bid];
    if (!ref || ref.exitType !== "Choice") continue;
    if (blockToLoop.get(bid) !== header) continue;
    const block = resolver.resolve(ref);
    if (!block) continue;

    let choiceStmt: any = null;
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (stmt?.kind === "Choice") { choiceStmt = stmt; break; }
    }
    if (!choiceStmt?.body) continue;

    const allOptions = collectAllOptions(choiceStmt);
    if (allOptions.length < 2) continue;

    const byVariable = new Map<string, Array<{ value: number; option: any }>>();
    for (const opt of allOptions) {
      const guard = extractEqualityGuard(opt.selectableIf);
      if (!guard) continue;
      let group = byVariable.get(guard.variable);
      if (!group) { group = []; byVariable.set(guard.variable, group); }
      group.push({ value: guard.value, option: opt });
    }

    for (const [variable, group] of byVariable) {
      if (group.length < 2) continue;

      group.sort((a, b) => a.value - b.value);

      let sequential = true;
      for (let i = 0; i < group.length; i++) {
        if (group[i].value !== i) { sequential = false; break; }
      }
      if (!sequential) continue;

      let allIncrement = true;
      for (let i = 0; i < group.length - 1; i++) {
        if (!optionIncrementsVariable(group[i].option, variable)) {
          allIncrement = false;
          break;
        }
      }
      if (!allIncrement) continue;

      const lastOption = group[group.length - 1].option;
      const exitLabel = extractGotoLabel(lastOption);
      if (!exitLabel) continue;

      const targetBlockId = labelToBlockId.get(`${sceneOf(bid)}:${exitLabel}`);
      if (targetBlockId && body.has(targetBlockId)) continue;

      const maxValue = group[group.length - 1].value;
      bounds.push({
        type: "sequenced-selectable",
        choiceBlockId: bid,
        variable,
        maxValue,
        tripCount: maxValue + 1,
      });
    }
  }

  return bounds;
};

const collectAllOptions = (choiceStmt: any): any[] => {
  const options: any[] = [];
  for (const child of choiceStmt.body) {
    if (child.kind === "ChoiceOption") {
      options.push(child);
    } else if (child.kind === "If") {
      for (const inner of child.body) {
        if (inner.kind === "ChoiceOption") options.push(inner);
      }
      if (child.elseIfBranches) {
        for (const branch of child.elseIfBranches) {
          for (const inner of branch.body) {
            if (inner.kind === "ChoiceOption") options.push(inner);
          }
        }
      }
      if (child.elseBranch?.body) {
        for (const inner of child.elseBranch.body) {
          if (inner.kind === "ChoiceOption") options.push(inner);
        }
      }
    }
  }
  return options;
};

const extractEqualityGuard = (
  selectableIf: any
): { variable: string; value: number } | null => {
  if (!selectableIf?.expression) return null;
  const expr = selectableIf.expression;
  if (expr.operator?.type !== "EqualityOperator") return null;

  const leftVar = extractIdentifierName(expr.left);
  const rightConst = extractConstantNumber(expr.right);
  if (leftVar && rightConst !== null) return { variable: leftVar, value: rightConst };

  const rightVar = extractIdentifierName(expr.right);
  const leftConst = extractConstantNumber(expr.left);
  if (rightVar && leftConst !== null) return { variable: rightVar, value: leftConst };

  return null;
};

const optionIncrementsVariable = (option: any, variable: string): boolean => {
  if (!option.body) return false;
  for (const stmt of option.body) {
    if (stmt.kind !== "SetVariable") continue;
    const effect = extractEffect(stmt);
    if (!effect.defines?.isCompoundAssignment) continue;
    if (effect.defines.variable !== variable) continue;
    const expr = effect.defines.compoundExpression as any;
    if (expr?.operator?.type === "AdditionOperator") {
      const val = extractConstantNumber(expr.right);
      if (val !== null && val > 0) return true;
    }
  }
  return false;
};

const extractGotoLabel = (option: any): string | null => {
  if (!option.body) return null;
  for (let i = option.body.length - 1; i >= 0; i--) {
    const stmt = option.body[i];
    if (stmt.kind === "GotoLabel") return stmt.label?.value ?? null;
    if (stmt.kind === "GotoScene") return null;
  }
  return null;
};

const buildLabelIndex = (cfg: ControlFlowGraph, resolver: BlockResolver): Map<string, string> => {
  const index = new Map<string, string>();
  for (const [blockId, ref] of Object.entries(cfg.blocks)) {
    const block = resolver.resolve(ref);
    if (block?.label) {
      index.set(`${sceneOf(blockId)}:${block.label}`, blockId);
    }
  }
  return index;
};

const detectChoiceExitBounds = (
  header: string,
  body: Set<string>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  blockToLoop: Map<string, string>
): LoopBound[] => {
  const bounds: LoopBound[] = [];
  const canExit = computeCanExitLoop(body, cfg);

  for (const bid of body) {
    const block = cfg.blocks[bid];
    if (!block || block.exitType !== "Choice") continue;
    if (blockToLoop.get(bid) !== header) continue;

    const optionEdges = cfg.edges.filter(
      (e) => e.sourceBlockId === bid && isChoiceOptionEdge(e.kind) && e.targetBlockId
    );

    const hasReuse = optionEdges.some((e) => {
      const er = e.metadata.effectiveReuse;
      return er === "hide_reuse" || er === "disable_reuse";
    });
    if (hasReuse) continue;

    let totalOptions = 0;
    let exitOptions = 0;
    for (const edge of optionEdges) {
      totalOptions++;
      if (canExit.has(edge.targetBlockId!)) exitOptions++;
    }

    if (exitOptions > 0 && totalOptions > 0) {
      bounds.push({
        type: "choice-exit",
        choiceBlockId: bid,
        optionCount: totalOptions,
        exitOptionCount: exitOptions,
        tripCount: totalOptions,
      });
    }
  }

  return bounds;
};

const detectConfirmInputBounds = (
  header: string,
  body: Set<string>,
  backEdgeTails: Array<{ from: string; to: string }>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  blockToLoop: Map<string, string>,
  resolver: BlockResolver,
): LoopBound[] => {
  const bounds: LoopBound[] = [];
  const backEdgeTailSet = new Set(backEdgeTails.map((be) => be.from));

  const canReachBackEdge = computeCanReachTargets(body, cfg, backEdgeTailSet);
  const canExit = computeCanExitLoop(body, cfg);

  for (const bid of body) {
    const ref = cfg.blocks[bid];
    if (!ref) continue;
    if (ref.exitType !== "Choice") continue;
    if (blockToLoop.get(bid) !== header) continue;
    const block = resolver.resolve(ref);
    if (!block) continue;

    let choiceStmt: any = null;
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (stmt?.kind === "Choice" || stmt?.kind === "FakeChoice") {
        choiceStmt = stmt;
        break;
      }
    }
    if (!choiceStmt?.body) continue;

    const optionEdges = cfg.edges.filter(
      (e) => e.sourceBlockId === bid && isChoiceOptionEdge(e.kind) && e.targetBlockId
    );
    if (optionEdges.length < 2) continue;

    let hasRetryOption = false;
    let hasExitOption = false;
    for (const edge of optionEdges) {
      const target = edge.targetBlockId!;
      const inBody = body.has(target);
      if (inBody && canReachBackEdge.has(target)) hasRetryOption = true;
      if (!inBody || (canExit.has(target) && !canReachBackEdge.has(target))) hasExitOption = true;
    }

    if (hasRetryOption && hasExitOption) {
      bounds.push({
        type: "confirm-input",
        choiceBlockId: bid,
        tripCount: 2,
      });
    }
  }

  return bounds;
};

const computeCanReachTargets = (
  loopBody: Set<string>,
  cfg: ControlFlowGraph,
  targets: Set<string>,
): Set<string> => {
  const bodyPreds = new Map<string, string[]>();
  for (const edge of cfg.edges) {
    if (!loopBody.has(edge.sourceBlockId)) continue;
    if (!edge.targetBlockId || !loopBody.has(edge.targetBlockId)) continue;
    if (isGoSubCall(edge.kind)) continue;
    getOrSet(bodyPreds, edge.targetBlockId, () => []).push(edge.sourceBlockId);
  }

  const { visited } = walkGraph(targets, id => bodyPreds.get(id) ?? []);
  return visited;
};

const computeCanExitLoop = (
  loopBody: Set<string>,
  cfg: ControlFlowGraph,
): Set<string> => {
  const bodyPreds = new Map<string, string[]>();
  const directExits = new Set<string>();

  for (const edge of cfg.edges) {
    if (!loopBody.has(edge.sourceBlockId)) continue;
    if (isGoSubCall(edge.kind)) continue;

    if (!edge.targetBlockId || !loopBody.has(edge.targetBlockId)) {
      directExits.add(edge.sourceBlockId);
      continue;
    }
    getOrSet(bodyPreds, edge.targetBlockId, () => []).push(edge.sourceBlockId);
  }

  for (const bid of loopBody) {
    const block = cfg.blocks[bid];
    if (block && (block.exitType === "Finish" || block.exitType === "Ending" ||
        block.exitType === "Return")) {
      directExits.add(bid);
    }
  }

  const { visited } = walkGraph(directExits, id => bodyPreds.get(id) ?? []);
  return visited;
};

const detectConditionalExitBound = (
  body: Set<string>,
  cfg: ControlFlowGraph,
): LoopBound | null => {
  let exitEdgeCount = 0;

  for (const edge of cfg.edges) {
    if (!body.has(edge.sourceBlockId)) continue;
    if (!edge.targetBlockId || body.has(edge.targetBlockId)) continue;
    if (isConditionalBranch(edge.kind)) {
      exitEdgeCount++;
    }
  }

  if (exitEdgeCount === 0) return null;

  return {
    type: "conditional-exit",
    exitEdgeCount,
    tripCount: 2,
  };
};

const detectStatsMenuBound = (
  header: string,
  body: Set<string>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  blockToLoop: Map<string, string>,
  resolver: BlockResolver,
): LoopBound | null => {
  if (sceneOf(header) !== "choicescript_stats") return null;

  const canExit = computeCanExitLoop(body, cfg);
  if (canExit.size > 0) return null;

  for (const bid of body) {
    const ref = cfg.blocks[bid];
    if (!ref || ref.exitType !== "Choice") continue;
    if (blockToLoop.get(bid) !== header) continue;
    const block = resolver.resolve(ref);
    if (!block) continue;

    let choiceStmt: any = null;
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (stmt?.kind === "Choice" || stmt?.kind === "FakeChoice") {
        choiceStmt = stmt;
        break;
      }
    }
    if (!choiceStmt?.body) continue;

    const optionEdges = cfg.edges.filter(
      (e) => e.sourceBlockId === bid && isChoiceOptionEdge(e.kind) && e.targetBlockId
    );
    if (optionEdges.length < 2) continue;

    const allInBody = optionEdges.every((e) => body.has(e.targetBlockId!));
    if (!allInBody) continue;

    return {
      type: "stats-menu",
      choiceBlockId: bid,
      optionCount: optionEdges.length,
      tripCount: 1,
    };
  }

  return null;
};

const extractIdentifierName = (expr: any): string | null => {
  if (!expr) return null;
  if (expr.token && expr.token.type === "Identifier") return expr.token.value ?? null;
  return null;
};

const extractConstantNumber = (expr: any): number | null => {
  if (!expr) return null;
  if (expr.value && typeof expr.value === "object") {
    if (expr.value.type === "NumberLiteral" && typeof expr.value.value === "number") {
      return expr.value.value;
    }
  }
  return null;
};

const negateOperator = (opType: string): string => {
  switch (opType) {
    case "EqualityOperator": return "NotEqualityOperator";
    case "NotEqualityOperator": return "EqualityOperator";
    case "GreaterThanOperator": return "LessThanEqualsOperator";
    case "LessThanOperator": return "GreaterThanEqualsOperator";
    case "GreaterThanEqualsOperator": return "LessThanOperator";
    case "LessThanEqualsOperator": return "GreaterThanOperator";
    default: return opType;
  }
};

const flipOperator = (opType: string): string | null => {
  switch (opType) {
    case "EqualityOperator": return "EqualityOperator";
    case "NotEqualityOperator": return "NotEqualityOperator";
    case "GreaterThanOperator": return "LessThanOperator";
    case "LessThanOperator": return "GreaterThanOperator";
    case "GreaterThanEqualsOperator": return "LessThanEqualsOperator";
    case "LessThanEqualsOperator": return "GreaterThanEqualsOperator";
    default: return null;
  }
};
