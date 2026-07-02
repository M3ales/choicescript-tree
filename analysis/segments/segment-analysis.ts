import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { AbstractValue, bottom, join as joinAbstract, set as makeSet, constant as makeConstant } from "../dataflow/abstract-value";
import { VariableState, getVariable } from "../dataflow/variable-state";
import { evaluateExpression } from "../dataflow/evaluate-expression";
import { extractEffect } from "../dataflow/extract-definitions";
import { isConditionalBranch, isChoiceOptionEdge } from "../control-flow-graph/data/transition-kind";
import { CfgLayout, applyBlockStatements } from "../ref-cfg/dominator-walk";
import { IndexedMap, IndexedTempMap } from "../dataflow/indexed-map";
import { LinkedCfgs, Cfg } from "../ref-cfg/data";
import { extractExpressions } from "../ref-cfg/collect-refs";

// ── Dead branch types ───────────────────────────────────────────────────────

export interface DeadBranch {
  cfgId: string;
  blockId: string;
  scene: string;
  reason: "condition-false" | "condition-true-elsewhere" | "selectable-if-false";
  conditionStatementId: string | undefined;
}

// ── Undeclared set/reference types ───────────────────────────────────────────

export interface UndeclaredSetViolation {
  cfgId: string;
  blockId: string;
  statementId: string;
  scene: string;
  variable: string;
  line: number;
  position: number;
  statementKind: string;
  kind: "set" | "reference";
}

// ── MultiReplace violation types ─────────────────────────────────────────────

export interface MultiReplaceViolation {
  cfgId: string;
  blockId: string;
  statementId: string;
  scene: string;
  line: number;
  position: number;
  selectorValue: number | string;
  alternativeCount: number;
  kind: "zero-index" | "out-of-range" | "string-selector";
}

// ── Control flow violation types ─────────────────────────────────────────────

export type ControlFlowViolationKind =
  | "branch-fallthrough"
  | "choice-fallthrough"
  | "implicit-end";

export interface ControlFlowViolation {
  cfgId: string;
  blockId: string;
  scene: string;
  kind: ControlFlowViolationKind;
  displayBlockId?: string;
}

// ── Analysis collector ──────────────────────────────────────────────────────

const BUILTINS = new Set([
  "choice_randomtest", "choice_quicktest", "choice_randomscene",
  "choice_nightmode", "choice_saved_is_allowed", "choice_save_name",
  "choice_time_stamp", "choice_restore_purchases_allowed",
  "choice_purchased_adfree", "choice_is_trial", "choice_is_advertising_supported",
  "choice_is_web", "choice_is_steam", "choice_is_ios", "choice_is_android",
  "choice_is_omnibus", "choice_release_date", "choice_prerelease",
  "choice_subscribe_allowed", "choice_subscribed",
  "true", "false",
]);

const isBuiltin = (name: string): boolean =>
  BUILTINS.has(name) || name.startsWith("choice_");

export class AnalysisCollector {
  deadBranches: DeadBranch[] = [];
  icfStates = new Map<string, boolean>();
  undeclaredSets: UndeclaredSetViolation[] = [];
  multiReplaceViolations: MultiReplaceViolation[] = [];

  private seen = new Set<string>();
  private knownDeclared = new Set<string>();

  filterUndeclaredSets(): UndeclaredSetViolation[] {
    return this.undeclaredSets.filter(
      v => !this.knownDeclared.has(v.variable.toLowerCase()),
    );
  }

  checkSetDeclarations(
    cfgId: string,
    blockId: string,
    scene: string,
    block: CodeBlock,
    state: VariableState,
    statements: Record<string, Statement>,
  ): void {
    const locallyDefined = new Set<string>();

    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;

      if (stmt.kind === "Parameters") {
        for (const id of (stmt as any).identifiers) {
          if (id?.value) locallyDefined.add(id.value);
        }
      }

      this.checkWrite(cfgId, blockId, stmtId, scene, stmt, state);
      this.checkReferences(cfgId, blockId, stmtId, scene, stmt, state, locallyDefined);
      this.checkMultiReplace(cfgId, blockId, stmtId, scene, stmt, state);

      if (stmt.kind === "DeclareVariable") {
        const s = stmt as any;
        if (s.identifier?.value) locallyDefined.add(s.identifier.value);
      }
    }
  }

  recordIcf(blockId: string, state: VariableState, scene: string): void {
    const value = getVariable(state, "implicit_control_flow", scene);
    if (value.kind === "constant") {
      const v = value.value;
      this.icfStates.set(blockId,
        typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v !== "",
      );
    }
  }

  private checkMultiReplace(
    cfgId: string, blockId: string, stmtId: string, scene: string,
    stmt: Statement, state: VariableState,
  ): void {
    const s = stmt as any;
    const segments = s.parsedSegments;
    if (!segments) return;
    this.walkMultiReplaceSegments(cfgId, blockId, stmtId, scene, segments, state);
  }

  private walkMultiReplaceSegments(
    cfgId: string, blockId: string, stmtId: string, scene: string,
    segments: any[], state: VariableState,
  ): void {
    for (const seg of segments) {
      if (seg.kind !== "MultiReplace") continue;
      const n = seg.alternatives?.length ?? 0;
      if (n === 0) continue;
      const result = evaluateExpression(seg.selector, state, scene);
      if (result.kind === "constant") {
        const v = result.value;
        if (typeof v === "number") {
          if (v === 0) {
            this.multiReplaceViolations.push({
              cfgId, blockId, statementId: stmtId, scene,
              line: seg.lineNumber, position: seg.position,
              selectorValue: v, alternativeCount: n, kind: "zero-index",
            });
          } else if (v < 1 || v > n) {
            this.multiReplaceViolations.push({
              cfgId, blockId, statementId: stmtId, scene,
              line: seg.lineNumber, position: seg.position,
              selectorValue: v, alternativeCount: n, kind: "out-of-range",
            });
          }
        } else if (typeof v === "string" && v !== "true" && v !== "false" && isNaN(Number(v))) {
          this.multiReplaceViolations.push({
            cfgId, blockId, statementId: stmtId, scene,
            line: seg.lineNumber, position: seg.position,
            selectorValue: v, alternativeCount: n, kind: "string-selector",
          });
        }
      }
      for (const alt of seg.alternatives ?? []) {
        if (alt.segments) this.walkMultiReplaceSegments(cfgId, blockId, stmtId, scene, alt.segments, state);
      }
    }
  }

  private checkWrite(
    cfgId: string, blockId: string, stmtId: string, scene: string,
    stmt: Statement, state: VariableState,
  ): void {
    if (stmt.kind !== "SetVariable") return;
    const effect = extractEffect(stmt);
    if (!effect.defines) return;

    const name = effect.defines.variable;
    if (isBuiltin(name)) return;

    const existing = getVariable(state, name, scene);
    if (existing.kind !== "bottom") {
      this.knownDeclared.add(name.toLowerCase());
      return;
    }

    const key = `set:${cfgId}:${stmtId}:${name}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);

    const loc = getWriteTargetLocation(stmt);
    this.undeclaredSets.push({
      cfgId, blockId, statementId: stmtId, scene,
      variable: name, line: loc?.line ?? -1, position: loc?.position ?? -1,
      statementKind: stmt.kind, kind: "set",
    });
  }

  private checkReferences(
    cfgId: string, blockId: string, stmtId: string, scene: string,
    stmt: Statement, state: VariableState, locallyDefined: Set<string>,
  ): void {
    const refs = collectRefsWithLocations(stmt);
    for (const ref of refs) {
      if (isBuiltin(ref.name)) continue;
      if (locallyDefined.has(ref.name)) continue;

      const writeEffect = extractEffect(stmt);
      if (writeEffect.defines && ref.name === writeEffect.defines.variable) continue;

      const existing = getVariable(state, ref.name, scene);
      if (existing.kind !== "bottom") {
        this.knownDeclared.add(ref.name.toLowerCase());
        continue;
      }

      const key = `ref:${cfgId}:${stmtId}:${ref.name}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);

      this.undeclaredSets.push({
        cfgId, blockId, statementId: stmtId, scene,
        variable: ref.name, line: ref.line, position: ref.position,
        statementKind: stmt.kind, kind: "reference",
      });
    }
  }
}

// ── Guard evaluation for walk plan edges ─────────────────────────────────────

const evaluateEdgeCondition = (
  edge: { kind: string; metadata: any },
  state: VariableState,
  scene: string,
  statements: Record<string, Statement>,
): AbstractValue | null => {
  const stmtId = edge.metadata?.conditionStatementId ?? edge.metadata?.choiceConditionId;
  if (!stmtId) return null;
  const stmt = statements[stmtId] as any;
  if (!stmt) return null;
  const expr = stmt.expression ?? stmt.selectableIf;
  if (!expr) return null;
  return evaluateExpression(expr, state, scene);
};

const isTruthy = (value: string | number | boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value !== "";
};

const isProvablyFalse = (value: AbstractValue): boolean =>
  value.kind === "constant" && !isTruthy(value.value);

const isProvablyTrue = (value: AbstractValue): boolean =>
  value.kind === "constant" && isTruthy(value.value);

const isControlFlowExit = (exitType: string): boolean =>
  exitType === "Goto" || exitType === "Finish" || exitType === "GotoScene" ||
  exitType === "Ending" || exitType === "Return";

interface NarrowInfo {
  variable: string;
  value: string | number | boolean;
}

const extractEqualityNarrow = (
  edge: { metadata: any },
  statements: Record<string, Statement>,
): NarrowInfo | null => {
  const stmtId = edge.metadata?.conditionStatementId;
  if (!stmtId) return null;
  const stmt = statements[stmtId] as any;
  if (!stmt) return null;
  const expr = stmt.expression;
  if (!expr || !expr.operator || !expr.left || !expr.right) return null;
  if (expr.operator.type !== "EqualityOperator") return null;
  const leftToken = expr.left?.token;
  const rightToken = expr.right?.value;
  if (leftToken?.type === "Identifier" && rightToken) {
    const litType = rightToken.type;
    if (litType === "StringLiteral" || litType === "NumberLiteral" || litType === "BooleanLiteral") {
      return { variable: leftToken.value.toLowerCase(), value: rightToken.value };
    }
  }
  const rightIdToken = expr.right?.token;
  const leftLit = expr.left?.value;
  if (rightIdToken?.type === "Identifier" && leftLit) {
    const litType = leftLit.type;
    if (litType === "StringLiteral" || litType === "NumberLiteral" || litType === "BooleanLiteral") {
      return { variable: rightIdToken.value.toLowerCase(), value: leftLit.value };
    }
  }
  return null;
};

const narrowVariable = (
  globals: IndexedMap,
  temps: IndexedTempMap,
  varName: string,
  excludeValue: string | number | boolean,
  scene: string,
): void => {
  const idx = globals.index.get(varName);
  if (idx !== undefined) {
    const current = globals.values[idx];
    const narrowed = excludeFromValue(current, excludeValue);
    if (narrowed !== current) globals.set(varName, narrowed);
    return;
  }
  const sv = temps.get(scene);
  if (sv) {
    const current = sv.get(varName);
    if (current) {
      const narrowed = excludeFromValue(current, excludeValue);
      if (narrowed !== current) sv.set(varName, narrowed);
    }
  }
};

const excludeFromValue = (
  value: AbstractValue,
  exclude: string | number | boolean,
): AbstractValue => {
  if (value.kind === "constant") {
    return value.value === exclude ? bottom : value;
  }
  if (value.kind === "set") {
    const filtered = value.values.filter(v => v !== exclude);
    if (filtered.length === value.values.length) return value;
    return makeSet(filtered, value.hasUserInput);
  }
  return value;
};

// ── Enhanced walk with guard evaluation ──────────────────────────────────────

export interface AnalysisWalkOptions {
  cfgId: string;
  scene: string;
  collector: AnalysisCollector;
  statements: Record<string, Statement>;
  blockIndex: Record<string, CodeBlock>;
  allowedBlocks?: Set<string>;
  onBlock?: (blockId: string) => void;
}

export const walkCfgBlocksWithAnalysis = (
  layout: CfgLayout,
  state: VariableState,
  opts: AnalysisWalkOptions,
): void => {
  const plan = layout.walkPlan;
  if (plan.length === 0) return;

  const { cfgId, scene, collector, statements, blockIndex, allowedBlocks, onBlock } = opts;
  const globals = state.globals as unknown as IndexedMap;
  const temps = state.temps as unknown as IndexedTempMap;

  const savedGlobals = new Array<AbstractValue[]>(layout.maxSlots);
  const savedGlobalHashes = new Array<number>(layout.maxSlots);
  const savedTemps = new Array<AbstractValue[]>(layout.maxSlots);
  const savedTempHashes = new Array<number>(layout.maxSlots);
  const joinedGlobals = new Array<AbstractValue[] | null>(layout.maxSlots);
  const joinedTemps = new Array<AbstractValue[] | null>(layout.maxSlots);

  // Guard state per slot
  const armDead = new Array<boolean>(layout.maxSlots).fill(false);
  const armDeadReason = new Array<DeadBranch["reason"] | undefined>(layout.maxSlots);
  const armDeadCondStmt = new Array<string | undefined>(layout.maxSlots);
  let deadDepth = 0;
  const priorConditions = new Array<AbstractValue[]>(layout.maxSlots);
  const armExited = new Array<boolean>(layout.maxSlots).fill(false);
  const priorNarrowings = new Array<NarrowInfo[]>(layout.maxSlots);

  // Track active slot stack for block → dead reason mapping
  const slotStack: number[] = [];

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];

    switch (item.kind) {
      case "block": {
        if (allowedBlocks && !allowedBlocks.has(item.blockId)) break;

        const block = blockIndex[item.blockId];
        if (!block) break;

        const isDead = deadDepth > 0;

        if (isDead) {
          // Report dead with reason from the innermost dead arm
          const activeSlot = slotStack[slotStack.length - 1];
          if (activeSlot !== undefined && armDead[activeSlot] && armDeadReason[activeSlot]) {
            collector.deadBranches.push({
              cfgId, blockId: item.blockId, scene,
              reason: armDeadReason[activeSlot]!,
              conditionStatementId: armDeadCondStmt[activeSlot],
            });
          }
        } else {
          onBlock?.(item.blockId);
          collector.recordIcf(item.blockId, state, scene);
          collector.checkSetDeclarations(cfgId, item.blockId, scene, block, state, statements);
        }

        applyBlockStatements(item.blockId, state, scene, blockIndex, statements);

        if (!isDead && slotStack.length > 0) {
          const activeSlot = slotStack[slotStack.length - 1];
          armExited[activeSlot] = isControlFlowExit(block.exitType);
        }
        break;
      }

      case "branch-start": {
        const slot = item.slot;
        slotStack.push(slot);

        savedGlobalHashes[slot] = globals.xorHash;
        savedGlobals[slot] = globals.shareValues();
        savedTempHashes[slot] = temps.xorHash;
        savedTemps[slot] = temps.shareValues();
        joinedGlobals[slot] = null;
        joinedTemps[slot] = null;
        priorConditions[slot] = [];
        armExited[slot] = false;
        priorNarrowings[slot] = [];

        if (deadDepth === 0) {
          const edge = item.edge;
          if (isConditionalBranch(edge.kind) || isChoiceOptionEdge(edge.kind)) {
            const condResult = evaluateEdgeCondition(edge, state, scene, statements);
            if (condResult) {
              priorConditions[slot].push(condResult);
              if (isProvablyFalse(condResult)) {
                armDead[slot] = true;
                armDeadReason[slot] = edge.metadata?.choiceConditionKind === "selectable_if"
                  ? "selectable-if-false" : "condition-false";
                armDeadCondStmt[slot] = edge.metadata?.conditionStatementId ?? edge.metadata?.choiceConditionId;
                deadDepth++;
              }
            }
            const narrow = extractEqualityNarrow(edge, statements);
            if (narrow) priorNarrowings[slot].push(narrow);
          }
        }
        break;
      }

      case "arm-boundary": {
        const slot = item.slot;

        if (!armExited[slot]) {
          if (joinedGlobals[slot] === null) {
            joinedGlobals[slot] = globals.cloneValues();
            joinedTemps[slot] = temps.cloneValues();
          } else {
            const jg = joinedGlobals[slot]!;
            const gv = globals.values;
            for (let j = 0; j < jg.length; j++) {
              if (jg[j] !== gv[j]) jg[j] = joinAbstract(jg[j], gv[j]);
            }
            const jt = joinedTemps[slot]!;
            const tv = temps.values;
            for (let j = 0; j < jt.length; j++) {
              if (jt[j] !== tv[j]) jt[j] = joinAbstract(jt[j], tv[j]);
            }
          }
        }

        globals.adoptValues(savedGlobals[slot], savedGlobalHashes[slot]);
        temps.adoptValues(savedTemps[slot], savedTempHashes[slot]);

        if (armDead[slot]) {
          deadDepth--;
          armDead[slot] = false;
          armDeadReason[slot] = undefined;
          armDeadCondStmt[slot] = undefined;
        }
        armExited[slot] = false;

        if (deadDepth === 0) {
          const edge = item.edge;
          if (edge.kind === "ElseBranch" || edge.kind === "IfFallThrough") {
            for (const n of priorNarrowings[slot]) {
              narrowVariable(globals, temps, n.variable, n.value, scene);
            }
            const allPriorTrue = priorConditions[slot].length > 0 &&
              priorConditions[slot].every(c => isProvablyTrue(c));
            if (allPriorTrue) {
              armDead[slot] = true;
              armDeadReason[slot] = "condition-true-elsewhere";
              armDeadCondStmt[slot] = edge.metadata?.conditionStatementId;
              deadDepth++;
            }
          } else if (isConditionalBranch(edge.kind) || isChoiceOptionEdge(edge.kind)) {
            const condResult = evaluateEdgeCondition(edge, state, scene, statements);
            if (condResult) {
              priorConditions[slot].push(condResult);
              if (isProvablyFalse(condResult)) {
                armDead[slot] = true;
                armDeadReason[slot] = edge.metadata?.choiceConditionKind === "selectable_if"
                  ? "selectable-if-false" : "condition-false";
                armDeadCondStmt[slot] = edge.metadata?.conditionStatementId ?? edge.metadata?.choiceConditionId;
                deadDepth++;
              }
            }
            const narrow = extractEqualityNarrow(edge, statements);
            if (narrow) priorNarrowings[slot].push(narrow);
          }
        }
        break;
      }

      case "branch-end": {
        const slot = item.slot;
        slotStack.pop();

        if (!armExited[slot]) {
          if (joinedGlobals[slot] === null) {
            joinedGlobals[slot] = globals.cloneValues();
            joinedTemps[slot] = temps.cloneValues();
          } else {
            const jg = joinedGlobals[slot]!;
            const gv = globals.values;
            for (let j = 0; j < jg.length; j++) {
              if (jg[j] !== gv[j]) jg[j] = joinAbstract(jg[j], gv[j]);
            }
            const jt = joinedTemps[slot]!;
            const tv = temps.values;
            for (let j = 0; j < jt.length; j++) {
              if (jt[j] !== tv[j]) jt[j] = joinAbstract(jt[j], tv[j]);
            }
          }
        }
        if (joinedGlobals[slot] !== null) {
          globals.takeValues(joinedGlobals[slot]!);
          temps.takeValues(joinedTemps[slot]!);
        }
        savedGlobals[slot] = null as any;
        savedTemps[slot] = null as any;
        joinedGlobals[slot] = null;
        joinedTemps[slot] = null;
        armExited[slot] = false;

        if (armDead[slot]) {
          deadDepth--;
          armDead[slot] = false;
          armDeadReason[slot] = undefined;
          armDeadCondStmt[slot] = undefined;
        }
        break;
      }
    }
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────

interface IdentifierLocation {
  name: string;
  line: number;
  position: number;
}

const collectIdentifierLocations = (expr: any, out: IdentifierLocation[]): void => {
  if (!expr) return;
  if (expr.token?.type === "Identifier" && expr.token.value) {
    out.push({ name: expr.token.value, line: expr.token.lineNumber, position: expr.token.position });
    return;
  }
  if (expr.identifier?.value) {
    out.push({ name: expr.identifier.value, line: expr.identifier.lineNumber, position: expr.identifier.position });
  }
  if (expr.left) collectIdentifierLocations(expr.left, out);
  if (expr.right) collectIdentifierLocations(expr.right, out);
  if (expr.value && expr.operator) collectIdentifierLocations(expr.value, out);
  if (expr.expression && !expr.identifier) collectIdentifierLocations(expr.expression, out);
  if (expr.selector) collectIdentifierLocations(expr.selector, out);
};

const collectRefsWithLocations = (stmt: Statement): IdentifierLocation[] => {
  const exprs = extractExpressions(stmt);
  const out: IdentifierLocation[] = [];
  for (const expr of exprs) {
    collectIdentifierLocations(expr, out);
  }
  return out;
};

const getWriteTargetLocation = (stmt: Statement): IdentifierLocation | null => {
  const s = stmt as any;
  if (s.assignment) {
    const expr = s.expression;
    if (expr?.token?.type === "Identifier" && expr.token.value) {
      return { name: expr.token.value, line: expr.token.lineNumber, position: expr.token.position };
    }
  } else if (s.expression?.left?.token?.type === "Identifier") {
    const tok = s.expression.left.token;
    return { name: tok.value, line: tok.lineNumber, position: tok.position };
  }
  return null;
};

// ── Control flow violation checking ──────────────────────────────────────────

const doesSubgraphExit = (
  blockId: string,
  cfg: Cfg,
  blockIndex: Record<string, CodeBlock>,
  visited: Set<string>,
): boolean => {
  if (visited.has(blockId)) return false;
  visited.add(blockId);

  const block = blockIndex[blockId];
  if (!block) return false;

  if (isControlFlowExit(block.exitType)) return true;

  if (block.exitType === "Choice") {
    const optEdges = cfg.edges.filter(e =>
      e.sourceBlockId === blockId && isChoiceOptionEdge(e.kind),
    );
    return optEdges.length > 0 && optEdges.every(e =>
      doesSubgraphExit(e.targetBlockId, cfg, blockIndex, visited),
    );
  }

  if (block.exitType === "Branch") {
    const branchEdges = cfg.edges.filter(e =>
      e.sourceBlockId === blockId &&
      (e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch"),
    );
    const hasElse = branchEdges.some(e => e.kind === "ElseBranch");
    if (hasElse) {
      return branchEdges.every(e =>
        doesSubgraphExit(e.targetBlockId, cfg, blockIndex, visited),
      );
    }
  }

  if (block.exitType === "FallThrough") {
    const ftEdge = cfg.edges.find(e =>
      e.sourceBlockId === blockId && e.kind === "FallThrough" && !e.metadata.implicitControlFlow,
    );
    if (ftEdge) return doesSubgraphExit(ftEdge.targetBlockId, cfg, blockIndex, visited);
  }

  return false;
};

const isContinuationUnreachable = (
  blockId: string,
  cfg: Cfg,
  blockIndex: Record<string, CodeBlock>,
): boolean => {
  const incoming = cfg.edges.filter(e => e.targetBlockId === blockId);
  if (incoming.length === 0) return true;
  return incoming.every(e => {
    const src = blockIndex[e.sourceBlockId];
    if (!src) return false;
    if (src.exitType === "Choice") return true;
    if (src.exitType === "FallThrough" && src.statementIds.length === 0) {
      return isContinuationUnreachable(e.sourceBlockId, cfg, blockIndex);
    }
    if (e.kind === "IfFallThrough" && src.exitType === "Branch") {
      const ifBranch = cfg.edges.find(be =>
        be.sourceBlockId === e.sourceBlockId && be.kind === "IfBranch",
      );
      if (ifBranch && doesSubgraphExit(ifBranch.targetBlockId, cfg, blockIndex, new Set())) {
        return isContinuationUnreachable(e.sourceBlockId, cfg, blockIndex);
      }
    }
    return false;
  });
};

const isAllOptionsFallthrough = (
  blockId: string,
  cfg: Cfg,
  blockIndex: Record<string, CodeBlock>,
): boolean => {
  const incoming = cfg.edges.filter(e => e.targetBlockId === blockId);

  let choiceBlockId: string | null = null;
  for (const e of incoming) {
    let current = e.sourceBlockId;
    for (let i = 0; i < 10; i++) {
      const b = blockIndex[current];
      if (!b) break;
      if (b.entryType === "ChoiceOptionEntry") {
        const optEdge = cfg.edges.find(oe =>
          oe.targetBlockId === current && isChoiceOptionEdge(oe.kind),
        );
        if (optEdge) {
          const src = blockIndex[optEdge.sourceBlockId];
          if (src?.exitType === "Choice") { choiceBlockId = optEdge.sourceBlockId; break; }
        }
        break;
      }
      if (b.exitType === "FallThrough" && b.statementIds.length === 0) {
        const pred = cfg.edges.find(pe => pe.targetBlockId === current);
        if (!pred) break;
        current = pred.sourceBlockId;
        continue;
      }
      break;
    }
    if (choiceBlockId) break;
  }

  if (!choiceBlockId) return false;

  const optionEdges = cfg.edges.filter(e =>
    e.sourceBlockId === choiceBlockId && isChoiceOptionEdge(e.kind),
  );
  return optionEdges.length > 0 && optionEdges.every(e =>
    !doesSubgraphExit(e.targetBlockId, cfg, blockIndex, new Set()),
  );
};

export const checkControlFlowViolations = (
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  icfStates: Map<string, boolean>,
  deadBlocks?: Set<string>,
): ControlFlowViolation[] => {
  const violations: ControlFlowViolation[] = [];

  for (const cfg of Object.values(linked.cfgs)) {
    const seen = new Set<string>();

    for (const edge of cfg.edges) {
      if (edge.kind !== "FallThrough") continue;
      if (!edge.metadata.implicitControlFlow) continue;

      if (deadBlocks?.has(edge.sourceBlockId)) continue;
      const icfTrue = icfStates.get(edge.sourceBlockId) ?? false;
      if (!icfTrue && !seen.has(edge.sourceBlockId)) {
        seen.add(edge.sourceBlockId);
        if (isContinuationUnreachable(edge.sourceBlockId, cfg, blockIndex)) continue;
        if (isAllOptionsFallthrough(edge.sourceBlockId, cfg, blockIndex)) continue;
        const block = blockIndex[edge.sourceBlockId];
        let displayBlockId: string | undefined;
        if (block && block.statementIds.length === 0) {
          let targetId = edge.sourceBlockId;
          for (let i = 0; i < 5; i++) {
            const pred = cfg.edges.find(e => e.targetBlockId === targetId);
            if (!pred) break;
            const predBlock = blockIndex[pred.sourceBlockId];
            if (predBlock && predBlock.statementIds.length > 0) {
              displayBlockId = pred.sourceBlockId;
              break;
            }
            targetId = pred.sourceBlockId;
          }
        }
        violations.push({
          cfgId: cfg.id,
          blockId: edge.sourceBlockId,
          scene: cfg.scene,
          kind: "choice-fallthrough",
          displayBlockId,
        });
      }
    }

    for (const exit of cfg.exits) {
      if (exit.kind !== "SceneExit") continue;
      const block = blockIndex[exit.blockId];
      if (!block || block.exitType !== "ImplicitEnd") continue;
      if (deadBlocks?.has(exit.blockId)) continue;
      const icfTrue = icfStates.get(exit.blockId) ?? false;
      if (!icfTrue) {
        violations.push({ cfgId: cfg.id, blockId: exit.blockId, scene: cfg.scene, kind: "implicit-end" });
      }
    }
  }

  return violations;
};
