import { LinkedCfgs, LoopRef, Cfg, CfgExit } from "./data";
import { isGoSubCall, isChoiceOptionEdge, isConditionalBranch } from "../control-flow-graph/data/transition-kind";
import { getOrSet } from "../control-flow-graph/graph-utils";
import { CfgTransfer, Guard } from "./cfg-transfer";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { extractEffect } from "../dataflow/extract-definitions";
import { VariableState, getVariable } from "../dataflow/variable-state";
import type { SerializedVariableState } from "../dataflow/variable-state";
import type { DataflowResult, State } from "./dataflow";

/**
 * How the loop's back-edge reaches the header CFG.
 *
 * - "direct"      — intra-scene *goto back to the header label
 * - "cross-scene" — *goto_scene or scene progression re-enters the header
 * - "call-chain"  — *gosub / *gosub_scene returns into the loop body
 * - "mixed"       — combination of goto_scene and gosub edges
 */
export type LoopMechanism = "direct" | "cross-scene" | "call-chain" | "mixed";

/**
 * What (if anything) limits the number of iterations.
 *
 * - "choice-bounded"    — a *hide_reuse or *disable_reuse option in the body
 *                         eliminates one path per iteration; tripCount = options + 1
 * - "condition-bounded" — a conditional branch plus variable mutation in the body
 *                         can eventually flip the branch
 * - "input-bounded"     — a *choice in the body with an exit path outside the loop;
 *                         the player can leave on every iteration; tripCount = 1
 * - "unbounded"         — none of the above; the loop may repeat indefinitely
 */
export type LoopBound =
  | "choice-bounded"
  | "condition-bounded"
  | "input-bounded"
  | "unbounded";

/**
 * Whether the loop traps the player with no reachable exit.
 *
 * - "unbounded-infinite" — no exit edges and no bound; the loop spins forever
 *                          (e.g. *goto back to same label, *if(true) *gosub self)
 * - "bounded-infinite"   — no exit edges but the loop has a bound; iterations
 *                          change (e.g. options disappear via *hide_reuse) but
 *                          the player can never leave — they eventually hit a
 *                          dead end with no selectable options
 * - false                — the loop has at least one exit edge; not infinite
 */
export type InfiniteKind = "unbounded-infinite" | "bounded-infinite" | false;

/**
 * Lightweight condition expression IR for describing when a loop becomes
 * infinite. Deliberately decoupled from the parser AST (no tokens/positions).
 */
export type ConditionExpr =
  | { type: "var"; name: string }
  | { type: "literal"; value: boolean | number | string }
  | { type: "comparison"; operator: string; left: ConditionExpr; right: ConditionExpr }
  | { type: "not"; operand: ConditionExpr }
  | { type: "and"; operands: ConditionExpr[] }
  | { type: "or"; operands: ConditionExpr[] }
  | { type: "unconditional" }
  | { type: "choice-exhaustion"; reuseKind: "hide_reuse" | "disable_reuse"; optionCount: number };

/**
 * Full classification of a detected loop.
 */
export interface LoopClassification {
  /** How the back-edge reaches the header. */
  mechanism: LoopMechanism;
  /** True if no variable assignments or side effects occur in the loop body. */
  pure: boolean;
  /** What limits iteration count, if anything. */
  bound: LoopBound;
  /** Minimum number of trips, or null if unbounded/unknown. */
  tripCount: number | null;
  /** How many iterations the dataflow analysis should unroll. */
  unrollDepth: number | null;
  /** Whether the player is trapped with no exit path. */
  infinite: InfiniteKind;
  /**
   * Condition under which the loop becomes infinite — the conjunction of
   * negated exit conditions. null when the loop is unconditionally infinite
   * (no exits at all) or unconditionally finite (an unconditional exit exists).
   */
  infiniteCondition: ConditionExpr | null;
}

/**
 * A single natural loop in the CFG.
 *
 * headerCfgId is the loop entry point — the target of all back-edges.
 * bodyCfgIds includes the header and all CFGs between the header and the
 * back-edge sources (found via reverse reachability from back-edge sources
 * to the header).
 */
export interface Loop {
  headerCfgId: string;
  bodyCfgIds: string[];
  /** Edges from body CFGs back to the header (these close the loop). */
  backEdges: CfgExit[];
  /** Edges from body CFGs to CFGs outside the loop (escape paths). */
  exitLinks: CfgExit[];
  classification: LoopClassification;
}

/**
 * Result of loop detection over the linked CFG.
 *
 * cfgToLoop maps every CFG that participates in a loop body to its Loop,
 * so downstream passes can check loop membership in O(1).
 */
export interface LoopAnalysis {
  loops: Loop[];
  loopHeaders: Set<string>;
  cfgToLoop: Map<string, Loop>;
}

export const analyseCfgLoops = (
  linked: LinkedCfgs,
  transfers: Map<string, CfgTransfer>,
  blockToCfg: Map<string, string>,
  cfgSuccessors: Map<string, Set<string>>,
  blockIndex: Record<string, CodeBlock> = {},
  statements: Record<string, Statement> = {},
): LoopAnalysis => {
  const { loopHeaders, backEdgeExits } = detectBackEdgeExits(linked, cfgSuccessors);

  const backEdgesByHeader = new Map<string, CfgExit[]>();
  for (const exit of backEdgeExits) {
    if (exit.target.type !== "cfg") continue;
    getOrSet(backEdgesByHeader, exit.target.cfgId, () => []).push(exit);
  }

  const loops: Loop[] = [];

  for (const headerId of loopHeaders) {
    const backEdges = backEdgesByHeader.get(headerId) ?? [];
    const body = findLoopBody(headerId, backEdges, linked, cfgSuccessors, blockToCfg);
    const exitLinks = findLoopExits(body, linked);

    const classification = classifyLoop(body, backEdges, exitLinks, linked, transfers, blockIndex, statements);

    loops.push({
      headerCfgId: headerId,
      bodyCfgIds: [...body],
      backEdges,
      exitLinks,
      classification,
    });
  }

  const cfgToLoop = new Map<string, Loop>();
  for (const loop of loops) {
    for (const cfgId of loop.bodyCfgIds) {
      cfgToLoop.set(cfgId, loop);
    }
  }

  for (const loop of loops) {
    const c = loop.classification;
    const ref: LoopRef = {
      id: loop.headerCfgId,
      headerCfgId: loop.headerCfgId,
      bodyCfgIds: loop.bodyCfgIds,
      backEdges: loop.backEdges,
      exits: loop.exitLinks,
      mechanism: c.mechanism,
      pure: c.pure,
      bound: c.bound,
      tripCount: c.tripCount,
      unrollDepth: c.unrollDepth,
      infinite: c.infinite,
      infiniteCondition: c.infiniteCondition,
    };
    linked.loops[ref.id] = ref;
  }

  return { loops, loopHeaders, cfgToLoop };
};

const detectBackEdgeExits = (
  linked: LinkedCfgs,
  successors: Map<string, Set<string>>,
): { loopHeaders: Set<string>; backEdgeExits: CfgExit[] } => {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const loopHeaders = new Set<string>();
  const backEdgePairs = new Set<string>();

  const stack: Array<{ cfgId: string; iter?: Iterator<string> }> = [];
  stack.push({ cfgId: linked.entryCfgId });

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame.iter) {
      if (visited.has(frame.cfgId)) {
        if (inStack.has(frame.cfgId)) {
          loopHeaders.add(frame.cfgId);
          const parent = stack.length >= 2 ? stack[stack.length - 2] : undefined;
          if (parent) backEdgePairs.add(`${parent.cfgId}->${frame.cfgId}`);
        }
        stack.pop();
        continue;
      }
      visited.add(frame.cfgId);
      inStack.add(frame.cfgId);
      const succs = successors.get(frame.cfgId);
      frame.iter = succs ? succs.values() : [][Symbol.iterator]();
    }
    const next = frame.iter.next();
    if (next.done) {
      inStack.delete(frame.cfgId);
      stack.pop();
    } else {
      stack.push({ cfgId: next.value });
    }
  }

  const backEdgeExits: CfgExit[] = [];
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type !== "cfg") continue;
      if (backEdgePairs.has(`${cfg.id}->${exit.target.cfgId}`)) {
        backEdgeExits.push(exit);
      }
    }
  }

  return { loopHeaders, backEdgeExits };
};

const findLoopBody = (
  headerId: string,
  backEdges: CfgExit[],
  linked: LinkedCfgs,
  successors: Map<string, Set<string>>,
  blockToCfg: Map<string, string>,
): Set<string> => {
  const reachableFromHeader = new Set<string>();
  const fwdQueue = [headerId];
  while (fwdQueue.length > 0) {
    const id = fwdQueue.pop()!;
    if (reachableFromHeader.has(id)) continue;
    reachableFromHeader.add(id);
    for (const succ of successors.get(id) ?? []) {
      fwdQueue.push(succ);
    }
  }

  const predecessors = new Map<string, Set<string>>();
  for (const [from, succs] of successors) {
    for (const to of succs) {
      getOrSet(predecessors, to, () => new Set()).add(from);
    }
  }

  const body = new Set<string>([headerId]);
  const queue: string[] = [];

  for (const be of backEdges) {
    const srcCfg = blockToCfg.get(be.blockId);
    if (srcCfg && !body.has(srcCfg) && reachableFromHeader.has(srcCfg)) {
      body.add(srcCfg);
      queue.push(srcCfg);
    }
  }

  while (queue.length > 0) {
    const cfgId = queue.pop()!;
    for (const pred of predecessors.get(cfgId) ?? []) {
      if (!body.has(pred) && reachableFromHeader.has(pred)) {
        body.add(pred);
        queue.push(pred);
      }
    }
  }

  return body;
};

const findLoopExits = (
  body: Set<string>,
  linked: LinkedCfgs,
): CfgExit[] => {
  const exits: CfgExit[] = [];
  for (const cfgId of body) {
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    for (const exit of cfg.exits) {
      if (exit.target.type === "terminal" || exit.target.type === "return") {
        exits.push(exit);
      } else if (exit.target.type === "cfg" && !body.has(exit.target.cfgId)) {
        exits.push(exit);
      }
    }
  }
  return exits;
};

// --- Condition expression helpers ---

const exprToCondition = (expr: any): ConditionExpr | null => {
  if (!expr) return null;
  if (expr.kind === "Grouping") return exprToCondition(expr.expression);

  if (expr.kind === "Binary") {
    const opType = expr.operator?.type;
    if (opType === "LogicalAnd") {
      const left = exprToCondition(expr.left);
      const right = exprToCondition(expr.right);
      if (!left || !right) return null;
      return simplifyCondition({ type: "and", operands: [left, right] });
    }
    if (opType === "LogicalOr") {
      const left = exprToCondition(expr.left);
      const right = exprToCondition(expr.right);
      if (!left || !right) return null;
      return simplifyCondition({ type: "or", operands: [left, right] });
    }
    const left = exprToCondition(expr.left);
    const right = exprToCondition(expr.right);
    if (!left || !right || !opType) return null;
    return { type: "comparison", operator: opType, left, right };
  }

  if (expr.kind === "Unary" && expr.operator?.type === "NotOperator") {
    const inner = exprToCondition(expr.value);
    if (!inner) return null;
    return simplifyCondition({ type: "not", operand: inner });
  }

  if (expr.kind === "Identifier" && expr.token?.value) {
    return { type: "var", name: expr.token.value };
  }

  if (expr.kind === "Literal") {
    const v = expr.value;
    if (v?.type === "BooleanLiteral") return { type: "literal", value: v.value };
    if (v?.type === "NumberLiteral") return { type: "literal", value: v.value };
    if (v?.type === "StringLiteral") return { type: "literal", value: v.value };
  }

  return null;
};

const negateComparisonOp = (op: string): string | null => {
  switch (op) {
    case "EqualityOperator": return "NotEqualityOperator";
    case "NotEqualityOperator": return "EqualityOperator";
    case "GreaterThanOperator": return "LessThanEqualsOperator";
    case "LessThanOperator": return "GreaterThanEqualsOperator";
    case "GreaterThanEqualsOperator": return "LessThanOperator";
    case "LessThanEqualsOperator": return "GreaterThanOperator";
    default: return null;
  }
};

const negateCondition = (c: ConditionExpr): ConditionExpr => {
  if (c.type === "literal" && typeof c.value === "boolean") {
    return { type: "literal", value: !c.value };
  }
  if (c.type === "comparison") {
    const neg = negateComparisonOp(c.operator);
    if (neg) return { type: "comparison", operator: neg, left: c.left, right: c.right };
  }
  if (c.type === "not") return c.operand;
  if (c.type === "and") return simplifyCondition({ type: "or", operands: c.operands.map(negateCondition) });
  if (c.type === "or") return simplifyCondition({ type: "and", operands: c.operands.map(negateCondition) });
  if (c.type === "unconditional") return { type: "literal", value: false };
  return { type: "not", operand: c };
};

const simplifyCondition = (c: ConditionExpr): ConditionExpr => {
  if (c.type === "and") {
    const flat: ConditionExpr[] = [];
    for (const op of c.operands) {
      const s = simplifyCondition(op);
      if (s.type === "literal" && s.value === false) return { type: "literal", value: false };
      if (s.type === "literal" && s.value === true) continue;
      if (s.type === "and") flat.push(...s.operands);
      else flat.push(s);
    }
    if (flat.length === 0) return { type: "literal", value: true };
    if (flat.length === 1) return flat[0];
    return { type: "and", operands: flat };
  }
  if (c.type === "or") {
    const flat: ConditionExpr[] = [];
    for (const op of c.operands) {
      const s = simplifyCondition(op);
      if (s.type === "literal" && s.value === true) return { type: "literal", value: true };
      if (s.type === "literal" && s.value === false) continue;
      if (s.type === "or") flat.push(...s.operands);
      else flat.push(s);
    }
    if (flat.length === 0) return { type: "literal", value: false };
    if (flat.length === 1) return flat[0];
    return { type: "or", operands: flat };
  }
  if (c.type === "not") {
    const inner = simplifyCondition(c.operand);
    if (inner.type === "literal" && typeof inner.value === "boolean") {
      return { type: "literal", value: !inner.value };
    }
    if (inner.type === "not") return inner.operand;
    return { type: "not", operand: inner };
  }
  return c;
};

const conditionForEdge = (
  expression: any,
  edgeKind: string,
): ConditionExpr | null => {
  const cond = exprToCondition(expression);
  if (!cond) return null;
  const isTaken = edgeKind === "IfBranch" || edgeKind === "ElseIfBranch";
  return isTaken ? cond : negateCondition(cond);
};

const guardToCondition = (
  guard: Guard,
  statements: Record<string, Statement>,
): ConditionExpr | null => {
  const condId = guard.metadata.conditionStatementId;
  if (!condId) return null;
  const stmt = statements[condId] as any;
  if (!stmt?.expression) return null;
  return conditionForEdge(stmt.expression, guard.edgeKind);
};

const guardsToCondition = (
  guards: Guard[],
  statements: Record<string, Statement>,
): ConditionExpr | null => {
  const parts: ConditionExpr[] = [];
  for (const g of guards) {
    if (isChoiceOptionEdge(g.edgeKind)) {
      if (g.metadata.choiceConditionId) {
        const stmt = statements[g.metadata.choiceConditionId] as any;
        if (stmt?.expression) {
          const cond = exprToCondition(stmt.expression);
          if (cond) parts.push(cond);
          else return null;
        }
      }
      continue;
    }
    const cond = guardToCondition(g, statements);
    if (cond) parts.push(cond);
    else if (g.metadata.conditionStatementId) return null;
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return simplifyCondition({ type: "and", operands: parts });
};

const buildInfiniteCondition = (
  exitLinks: CfgExit[],
  body: Set<string>,
  linked: LinkedCfgs,
  transfers: Map<string, CfgTransfer>,
  statements: Record<string, Statement>,
): ConditionExpr | null => {
  if (exitLinks.length === 0) return null;

  const negatedExits: ConditionExpr[] = [];
  for (const cfgId of body) {
    const transfer = transfers.get(cfgId);
    if (!transfer) continue;
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;

    for (const exitGuard of transfer.exits) {
      const exit = cfg.exits[exitGuard.exitIndex];
      if (!exit) continue;

      const isLoopExit =
        (exit.target.type === "terminal" || exit.target.type === "return") ||
        (exit.target.type === "cfg" && !body.has(exit.target.cfgId));
      if (!isLoopExit) continue;

      if (!exitGuard.conditional) return null;

      const cond = guardsToCondition(exitGuard.guards, statements);
      if (!cond) return null;
      negatedExits.push(negateCondition(cond));
    }
  }

  if (negatedExits.length === 0) return null;
  const combined = simplifyCondition({ type: "and", operands: negatedExits });
  if (combined.type === "literal" && combined.value === false) return null;
  return combined;
};

const classifyLoop = (
  body: Set<string>,
  backEdges: CfgExit[],
  exitLinks: CfgExit[],
  linked: LinkedCfgs,
  transfers: Map<string, CfgTransfer>,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): LoopClassification => {
  const mechanism = classifyMechanism(body, backEdges, linked);
  const pure = !hasEffectsInBody(body, transfers);
  const bound = classifyBound(body, backEdges, exitLinks, linked, transfers, blockIndex, statements);
  const tripCount = computeTripCount(bound, body, exitLinks, linked, blockIndex, statements);
  const unrollDepth = computeUnrollDepth(bound, tripCount);
  const infinite: InfiniteKind = exitLinks.length === 0
    ? (bound === "unbounded" ? "unbounded-infinite" : "bounded-infinite")
    : false;
  const infiniteCondition = buildInfiniteCondition(exitLinks, body, linked, transfers, statements);
  return { mechanism, pure, bound, tripCount, unrollDepth, infinite, infiniteCondition };
};

const classifyMechanism = (
  body: Set<string>,
  backEdges: CfgExit[],
  linked: LinkedCfgs,
): LoopMechanism => {
  let hasGotoScene = false;
  let hasGoSub = false;

  for (const cfg of iterateBodyCfgs(body, linked)) {
    for (const exit of cfg.exits) {
      if (exit.target.type !== "cfg") continue;
      if (!body.has(exit.target.cfgId)) continue;
      if (exit.kind === "GotoScene" || exit.kind === "SceneProgression") hasGotoScene = true;
      if (isGoSubCall(exit.kind)) hasGoSub = true;
    }
  }

  for (const be of backEdges) {
    if (be.kind === "GotoScene" || be.kind === "SceneProgression") hasGotoScene = true;
    if (isGoSubCall(be.kind)) hasGoSub = true;
  }

  if (hasGotoScene && hasGoSub) return "mixed";
  if (hasGoSub) return "call-chain";
  if (hasGotoScene) return "cross-scene";
  return "direct";
};

const hasEffectsInBody = (
  body: Set<string>,
  transfers: Map<string, CfgTransfer>,
): boolean => {
  for (const cfgId of body) {
    const transfer = transfers.get(cfgId);
    if (transfer && transfer.effects.length > 0) return true;
  }
  return false;
};

const classifyBound = (
  body: Set<string>,
  backEdges: CfgExit[],
  exitLinks: CfgExit[],
  linked: LinkedCfgs,
  transfers: Map<string, CfgTransfer>,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): LoopBound => {
  if (isChoiceBounded(body, linked)) return "choice-bounded";
  if (isConditionBounded(body, exitLinks, backEdges, transfers, linked, blockIndex, statements)) return "condition-bounded";
  if (isInputBounded(body, exitLinks, linked)) return "input-bounded";
  return "unbounded";
};

const isChoiceBounded = (
  body: Set<string>,
  linked: LinkedCfgs,
): boolean => {
  for (const cfg of iterateBodyCfgs(body, linked)) {
    for (const edge of cfg.edges) {
      if (isChoiceOptionEdge(edge.kind) && edge.metadata.effectiveReuse) return true;
    }
  }
  return false;
};

const isConditionBounded = (
  body: Set<string>,
  exitLinks: CfgExit[],
  backEdges: CfgExit[],
  transfers: Map<string, CfgTransfer>,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): boolean => {
  let hasConditionalBranch = false;

  for (const cfgId of body) {
    const transfer = transfers.get(cfgId);
    if (!transfer) continue;
    if (transfer.exits.some(e => e.conditional)) hasConditionalBranch = true;
  }

  if (!hasConditionalBranch) {
    for (const be of backEdges) {
      if (be.metadata.conditionStatementId) hasConditionalBranch = true;
    }
  }

  if (!hasConditionalBranch) return false;

  return hasSetVariableInBody(body, linked, blockIndex, statements);
};

const isInputBounded = (
  body: Set<string>,
  exitLinks: CfgExit[],
  linked: LinkedCfgs,
): boolean => {
  if (exitLinks.length === 0) return false;

  for (const cfg of iterateBodyCfgs(body, linked)) {
    for (const edge of cfg.edges) {
      if (isChoiceOptionEdge(edge.kind)) return true;
    }
  }
  return false;
};

const computeTripCount = (
  bound: LoopBound,
  body: Set<string>,
  exitLinks: CfgExit[],
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): number | null => {
  switch (bound) {
    case "input-bounded":
      return 1;
    case "condition-bounded":
      return computeConditionBoundedTripCount(body, exitLinks, linked, blockIndex, statements);
    case "choice-bounded":
      return countReuseTripCount(body, linked);
    case "unbounded":
      return null;
  }
};

const MAX_UNROLL_DEPTH = 50;

const computeUnrollDepth = (
  bound: LoopBound,
  tripCount: number | null,
): number | null => {
  if (tripCount !== null) return Math.min(tripCount, MAX_UNROLL_DEPTH);
  switch (bound) {
    case "condition-bounded": return 2;
    case "input-bounded": return 1;
    case "choice-bounded": return null;
    case "unbounded": return null;
  }
};

const countReuseTripCount = (
  body: Set<string>,
  linked: LinkedCfgs,
): number | null => {
  let minTrips: number | null = null;

  for (const cfg of iterateBodyCfgs(body, linked)) {
    let totalOptions = 0;
    let reuseCount = 0;

    for (const edge of cfg.edges) {
      if (!isChoiceOptionEdge(edge.kind)) continue;
      totalOptions++;
      const er = edge.metadata.effectiveReuse;
      if (er === "hide_reuse" || er === "disable_reuse") reuseCount++;
    }

    if (reuseCount > 0) {
      const trips = reuseCount + 1;
      if (minTrips === null || trips < minTrips) minTrips = trips;
    }
  }

  return minTrips;
};

const ifBranchLeadsToBody = (
  targetBlockId: string,
  cfg: Cfg,
  body: Set<string>,
): boolean => {
  const visited = new Set<string>();
  const queue = [targetBlockId];
  while (queue.length > 0) {
    const blockId = queue.pop()!;
    if (visited.has(blockId)) continue;
    visited.add(blockId);
    for (const edge of cfg.edges) {
      if (edge.sourceBlockId !== blockId) continue;
      if (edge.targetBlockId) queue.push(edge.targetBlockId);
    }
  }
  for (const exit of cfg.exits) {
    if (!visited.has(exit.blockId)) continue;
    if (exit.target.type === "cfg" && body.has(exit.target.cfgId)) return true;
    if (exit.continuation && body.has(exit.continuation)) return true;
  }
  return false;
};

const hasSetVariableInBody = (
  body: Set<string>,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): boolean => {
  for (const cfg of iterateBodyAndGosubCfgs(body, linked)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      const block = blockIndex[blockId];
      if (!block) continue;
      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (stmt && stmt.kind === "SetVariable") return true;
      }
    }
  }
  return false;
};

function* iterateBodyAndGosubCfgs(body: Set<string>, linked: LinkedCfgs): Generator<Cfg> {
  const visited = new Set<string>();
  const queue = [...body];
  const inSubroutine = new Set<string>();
  while (queue.length > 0) {
    const cfgId = queue.pop()!;
    if (visited.has(cfgId)) continue;
    visited.add(cfgId);
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    yield cfg;
    const followAll = inSubroutine.has(cfgId);
    for (const exit of cfg.exits) {
      if (isGoSubCall(exit.kind) && exit.target.type === "cfg" && !visited.has(exit.target.cfgId)) {
        inSubroutine.add(exit.target.cfgId);
        queue.push(exit.target.cfgId);
      } else if (followAll && exit.target.type === "cfg" && !visited.has(exit.target.cfgId)) {
        inSubroutine.add(exit.target.cfgId);
        queue.push(exit.target.cfgId);
      }
      if (followAll && exit.continuation && !visited.has(exit.continuation)) {
        inSubroutine.add(exit.continuation);
        queue.push(exit.continuation);
      }
    }
  }
}

function* iterateBodyCfgs(body: Set<string>, linked: LinkedCfgs): Generator<Cfg> {
  for (const cfgId of body) {
    const cfg = linked.cfgs[cfgId];
    if (cfg) yield cfg;
  }
}

// --- Counter-based trip count detection ---

interface IncrementInfo {
  variable: string;
  step: number;
}

interface ExitCondition {
  variable: string;
  operator: string;
  compareValue: number;
}

const computeConditionBoundedTripCount = (
  body: Set<string>,
  exitLinks: CfgExit[],
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): number | null => {
  const increments = findCounterIncrements(body, linked, blockIndex, statements);
  if (increments.length === 0) return null;

  const conditions = findExitConditions(body, exitLinks, linked, statements);
  if (conditions.length === 0) return null;

  for (const inc of increments) {
    for (const cond of conditions) {
      if (cond.variable !== inc.variable) continue;
      const initial = findInitialValue(inc.variable, linked, blockIndex, statements);
      if (initial === null) continue;

      const trips = computeCounterTrips(initial, inc.step, cond.operator, cond.compareValue);
      if (trips !== null && trips > 0 && trips <= 1000) return trips;
    }
  }

  return null;
};

const findCounterIncrements = (
  body: Set<string>,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): IncrementInfo[] => {
  const result: IncrementInfo[] = [];
  const seen = new Set<string>();

  for (const cfg of iterateBodyAndGosubCfgs(body, linked)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      const block = blockIndex[blockId];
      if (!block) continue;

      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (!stmt || stmt.kind !== "SetVariable") continue;

        const effect = extractEffect(stmt);
        if (!effect.defines?.isCompoundAssignment) continue;
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
        result.push({ variable: varName, step });
      }
    }
  }

  return result;
};

const findExitConditions = (
  body: Set<string>,
  exitLinks: CfgExit[],
  linked: LinkedCfgs,
  statements: Record<string, Statement>,
): ExitCondition[] => {
  const conditions: ExitCondition[] = [];

  for (const exitEdge of exitLinks) {
    const condStmtId = exitEdge.metadata.conditionStatementId;
    if (!condStmtId) continue;

    const condStmt = statements[condStmtId] as any;
    if (!condStmt?.expression) continue;

    const cond = extractComparisonCondition(condStmt.expression, exitEdge.kind);
    if (cond) conditions.push(cond);
  }

  // Scan internal conditional branches in body CFGs.
  // Only negate IfBranch conditions where the if-block leads back into the loop
  // (continuation). If the if-block leads to an exit, use the original operator.
  for (const cfg of iterateBodyCfgs(body, linked)) {
    for (const edge of cfg.edges) {
      if (!isConditionalBranch(edge.kind)) continue;
      if (edge.kind !== "IfBranch" && edge.kind !== "ElseIfBranch") continue;

      const condStmtId = edge.metadata.conditionStatementId;
      if (!condStmtId) continue;

      const condStmt = statements[condStmtId] as any;
      if (!condStmt?.expression) continue;

      const leadsToBody = ifBranchLeadsToBody(edge.targetBlockId, cfg, body);
      const edgeKind = leadsToBody ? "IfFallThrough" : edge.kind;
      const cond = extractComparisonCondition(condStmt.expression, edgeKind);
      if (cond) conditions.push(cond);
    }
  }

  return conditions;
};

const findInitialValue = (
  varName: string,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): number | null => {
  const entryCfg = linked.cfgs[linked.entryCfgId];
  if (!entryCfg) return null;

  const entryBlock = blockIndex[entryCfg.entryBlockId];
  if (!entryBlock) return null;

  for (const stmtId of entryBlock.statementIds) {
    const stmt = statements[stmtId];
    if (!stmt || stmt.kind !== "DeclareVariable") continue;
    const decl = stmt as any;
    if (decl.variable?.value !== varName) continue;
    return extractConstantNumber(decl.expression);
  }

  return null;
};

// Compute iterations until exit condition becomes true.
// After k iterations: val = initial + k * step
const computeCounterTrips = (
  initial: number,
  step: number,
  operator: string,
  compareValue: number,
): number | null => {
  const N = compareValue;
  const I = initial;
  const S = Math.abs(step);
  if (S === 0) return null;

  switch (operator) {
    case "GreaterThanOperator":
      if (step <= 0) return null;
      return Math.floor((N - I) / step) + 1;
    case "GreaterThanEqualsOperator":
      if (step <= 0) return null;
      return Math.ceil((N - I) / step);
    case "LessThanOperator":
      if (step >= 0) return null;
      return Math.floor((I - N) / S) + 1;
    case "LessThanEqualsOperator":
      if (step >= 0) return null;
      return Math.ceil((I - N) / S);
    case "EqualityOperator": {
      const diff = step > 0 ? N - I : I - N;
      if (diff < 0 || diff % S !== 0) return null;
      return diff / S;
    }
    default:
      return null;
  }
};

const extractConstantNumber = (expr: any): number | null => {
  if (!expr) return null;
  if (expr.kind === "Literal" && expr.value?.type === "NumberLiteral" && typeof expr.value.value === "number") {
    return expr.value.value;
  }
  if (expr.value?.type === "NumberLiteral" && typeof expr.value.value === "number") {
    return expr.value.value;
  }
  return null;
};

const flipComparisonOp = (op: string): string | null => {
  switch (op) {
    case "EqualityOperator": return "EqualityOperator";
    case "NotEqualityOperator": return "NotEqualityOperator";
    case "GreaterThanOperator": return "LessThanOperator";
    case "LessThanOperator": return "GreaterThanOperator";
    case "GreaterThanEqualsOperator": return "LessThanEqualsOperator";
    case "LessThanEqualsOperator": return "GreaterThanEqualsOperator";
    default: return null;
  }
};

const conditionExprToExitCondition = (c: ConditionExpr): ExitCondition | null => {
  if (c.type !== "comparison") return null;

  const leftVar = c.left.type === "var" ? c.left.name : null;
  const rightNum = c.right.type === "literal" && typeof c.right.value === "number" ? c.right.value : null;
  if (leftVar !== null && rightNum !== null) {
    return { variable: leftVar, operator: c.operator, compareValue: rightNum };
  }

  const rightVar = c.right.type === "var" ? c.right.name : null;
  const leftNum = c.left.type === "literal" && typeof c.left.value === "number" ? c.left.value : null;
  if (rightVar !== null && leftNum !== null) {
    const flipped = flipComparisonOp(c.operator);
    if (!flipped) return null;
    return { variable: rightVar, operator: flipped, compareValue: leftNum };
  }

  return null;
};

const extractComparisonCondition = (
  rawExpr: any,
  edgeKind: string,
): ExitCondition | null => {
  const cond = conditionForEdge(rawExpr, edgeKind);
  if (!cond) return null;
  return conditionExprToExitCondition(cond);
};

// --- Post-dataflow trip count refinement ---

const deserializeState = (s: SerializedVariableState): VariableState => ({
  parent: null,
  globals: new Map(Object.entries(s.globals)),
  temps: new Map(
    Object.entries(s.temps).map(([scene, vars]) => [scene, new Map(Object.entries(vars))]),
  ),
});

import { AbstractValue } from "../dataflow/abstract-value";

const compareNum = (v: number, op: string, c: number): boolean | null => {
  switch (op) {
    case "GreaterThanOperator": return v > c;
    case "GreaterThanEqualsOperator": return v >= c;
    case "LessThanOperator": return v < c;
    case "LessThanEqualsOperator": return v <= c;
    case "EqualityOperator": return v === c;
    case "NotEqualityOperator": return v !== c;
    default: return null;
  }
};

const evaluateExitCondition = (
  cond: ExitCondition,
  state: VariableState,
  scene: string,
): boolean | null => {
  const val = resolveVar(cond.variable, state, scene);
  if (!val) return null;

  if (val.kind === "constant" && typeof val.value === "number") {
    return compareNum(val.value, cond.operator, cond.compareValue);
  }

  if (val.kind === "range") {
    const lo = compareNum(val.min, cond.operator, cond.compareValue);
    const hi = compareNum(val.max, cond.operator, cond.compareValue);
    if (lo === true || hi === true) return true;
    if (lo === false && hi === false) return false;
    return null;
  }

  if (val.kind === "set") {
    const nums = val.values.filter((v): v is number => typeof v === "number");
    if (nums.length === 0 || nums.length !== val.values.length) return null;
    const results = nums.map(v => compareNum(v, cond.operator, cond.compareValue));
    if (results.some(r => r === true)) return true;
    if (results.every(r => r === false)) return false;
    return null;
  }

  return null;
};

const resolveVar = (
  name: string,
  state: VariableState,
  scene: string,
): AbstractValue | undefined => {
  const v = getVariable(state, name, scene);
  return v.kind === "bottom" ? undefined : v;
};

const evaluateConditionExpr = (
  c: ConditionExpr,
  state: VariableState,
  scene: string,
): boolean | null => {
  switch (c.type) {
    case "literal":
      if (typeof c.value === "boolean") return c.value;
      return null;

    case "unconditional":
      return true;

    case "comparison": {
      const flat = conditionExprToExitCondition(c);
      if (flat) return evaluateExitCondition(flat, state, scene);
      return null;
    }

    case "not": {
      const inner = evaluateConditionExpr(c.operand, state, scene);
      if (inner === null) return null;
      return !inner;
    }

    case "and": {
      let allTrue = true;
      for (const op of c.operands) {
        const r = evaluateConditionExpr(op, state, scene);
        if (r === false) return false;
        if (r === null) allTrue = false;
      }
      return allTrue ? true : null;
    }

    case "or": {
      let allFalse = true;
      for (const op of c.operands) {
        const r = evaluateConditionExpr(op, state, scene);
        if (r === true) return true;
        if (r === null) allFalse = false;
      }
      return allFalse ? false : null;
    }

    case "var": {
      const val = resolveVar(c.name, state, scene);
      if (!val) return null;
      if (val.kind === "constant" && typeof val.value === "boolean") return val.value;
      return null;
    }

    default:
      return null;
  }
};

const conditionVarsResolvable = (
  conditions: ExitCondition[],
  headerState: State,
  dataflow: DataflowResult,
  scene: string,
): boolean => {
  const varNames = new Set(conditions.map(c => c.variable.toLowerCase()));

  for (let i = 0; i < headerState.entryIds.length; i++) {
    const serialized = dataflow.stateStore.get(headerState.entryIds[i]);
    if (!serialized) continue;
    const varState = deserializeState(serialized);
    for (const name of varNames) {
      const val = resolveVar(name, varState, scene);
      if (!val) continue;
      if (val.kind === "constant" || val.kind === "set" || val.kind === "range") return true;
    }
  }
  return false;
};

export const refineTripCounts = (
  loopAnalysis: LoopAnalysis,
  dataflow: DataflowResult,
  linked: LinkedCfgs,
  statements: Record<string, Statement>,
): boolean => {
  const statesByCfg = new Map<string, State>();
  for (const s of dataflow.cfgStates) statesByCfg.set(s.cfgId, s);
  let changed = false;

  for (const loop of loopAnalysis.loops) {
    const c = loop.classification;

    if (c.bound !== "condition-bounded") continue;

    const body = new Set(loop.bodyCfgIds);
    const conditions = findExitConditions(body, loop.exitLinks, linked, statements);
    if (conditions.length === 0) continue;

    const headerState = statesByCfg.get(loop.headerCfgId);
    if (!headerState || headerState.entryIds.length === 0) continue;

    const scene = linked.cfgs[loop.headerCfgId]?.scene ?? "";
    let refined: number | null = null;

    for (let i = 0; i < headerState.entryIds.length; i++) {
      const serialized = dataflow.stateStore.get(headerState.entryIds[i]);
      if (!serialized) continue;

      const varState = deserializeState(serialized);

      for (const cond of conditions) {
        const exits = evaluateExitCondition(cond, varState, scene);
        if (exits === true) {
          refined = i;
          break;
        }
      }
      if (refined !== null) break;
    }

    if (refined !== null && (c.tripCount === null || refined < c.tripCount)) {
      c.tripCount = refined;
      const newUnroll = computeUnrollDepth(c.bound, c.tripCount);
      if (newUnroll !== c.unrollDepth) {
        c.unrollDepth = newUnroll;
        changed = true;
      }
      const ref = linked.loops[loop.headerCfgId];
      if (ref) {
        ref.tripCount = c.tripCount;
        ref.unrollDepth = c.unrollDepth;
      }
    } else if (refined === null && c.tripCount === null && c.unrollDepth !== null) {
      if (!conditionVarsResolvable(conditions, headerState, dataflow, scene)) continue;

      const MAX_EXPLORE_DEPTH = 50;
      const next = Math.min((c.unrollDepth ?? 2) * 2, MAX_EXPLORE_DEPTH);
      if (next > (c.unrollDepth ?? 0)) {
        c.unrollDepth = next;
        const ref = linked.loops[loop.headerCfgId];
        if (ref) ref.unrollDepth = next;
        changed = true;
      }
    }
  }

  return changed;
};
