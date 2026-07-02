import { CodeBlock } from "../control-flow-graph/data/code-block";
import {
  Statement,
  AchievementStatement,
  AchieveStatement,
  DeclareVariableStatement,
  ImageStatement,
  TextImageStatement,
  LabelStatement,
} from "../../parser/statements";
import { State, StateStore, EntryProvenance } from "./dataflow";
import { DeadBranch, BlockState } from "./passes/branch-reachability";
import { CfgTransfer } from "./cfg-transfer";
import { narrowStateByGuard, narrowStateByGuardNegation } from "./narrow-guard";
import { joinStatesMut } from "../dataflow/variable-state";
import {
  VariableState, cloneState, serializeState, SerializedVariableState,
  getVariable, setVariableMut, updateVariableMut, isTempVariable,
} from "../dataflow/variable-state";
import { AbstractValue, top, bottom } from "../dataflow/abstract-value";
import { extractEffect } from "../dataflow/extract-definitions";
import { evaluateExpression } from "../dataflow/evaluate-expression";
import { BlockDelta } from "../segments/segment-dataflow";
import { ControlFlowViolation, ControlFlowViolationKind } from "./passes/verify-control-flow";
import { UndeclaredSetViolation, UndeclaredViolationKind } from "./passes/verify-set-declarations";

export interface LocationEntry {
  scene: string;
  line: number;
  position: number;
  statementId: string;
  statementKind: string;
  cfgId: string;
  blockId: string;
  variableLength?: number;
}

export interface LocationQuery {
  scene: string;
  line: number;
  position?: number;
}

export interface LocationResult {
  entries: LocationEntry[];
  cfgId: string | null;
  dataflow: SerializedVariableState[] | null;
}

export interface VariableQuery {
  variable: string;
}

export interface VariableLocationResult {
  variable: string;
  definitions: LocationEntry[];
  references: LocationEntry[];
  deletes: LocationEntry[];
}

export type IdentifierRole = "definition" | "reference" | "delete";

export interface IdentifierOccurrence {
  name: string;
  scene: string;
  line: number;
  position: number;
  length: number;
  role: IdentifierRole;
  statementId: string;
  statementKind: string;
}

export interface SceneSymbols {
  labels: Map<string, LabelStatement>;
  tempVariables: Map<string, DeclareVariableStatement>;
  paramVariables: Set<string>;
  achievements: Map<string, AchievementStatement>;
  achieves: AchieveStatement[];
  images: (ImageStatement | TextImageStatement)[];
  gotos: Statement[];
  gosubs: Statement[];
}

export type UnreachableReason =
  | "dead-scene"
  | "dead-label"
  | "dead-continuation"
  | "dead-code";

export interface UnreachableCode {
  scene: string;
  line: number;
  position: number;
  cfgId: string;
  label: string;
  reason: UnreachableReason;
}

export class LocationIndex {
  private bySceneLine = new Map<string, LocationEntry[]>();
  private stmtToEntry = new Map<string, LocationEntry>();
  private statements: Record<string, Statement>;
  private blockToCfg: Map<string, string>;
  private dataflowByCfg = new Map<string, State>();
  private stateStore: StateStore = new Map();
  private cfgEntryStates = new Map<string, SerializedVariableState>();
  private reachableCfgs = new Set<string>();
  private deadBranches: DeadBranch[] = [];
  private controlFlowViolations: ControlFlowViolation[] = [];
  private undeclaredSets: UndeclaredSetViolation[] = [];
  private multiReplaceViolations: { scene: string; line: number; position: number; selectorValue: number | string; alternativeCount: number; kind: "zero-index" | "out-of-range" | "string-selector" }[] = [];
  private unreachableCode: UnreachableCode[] = [];
  private variableDefs = new Map<string, LocationEntry[]>();
  private variableRefs = new Map<string, LocationEntry[]>();
  private variableDeletes = new Map<string, LocationEntry[]>();

  private blockEntryStates = new MultiMap<string, { state: VariableState; scene: string; provenance?: EntryProvenance[] }>();
  private transfers: Map<string, CfgTransfer> | null = null;
  private blockIndex: Record<string, CodeBlock> = {};

  private segmentEntryStates = new Map<string, SerializedVariableState>();
  private blockDeltaMap = new Map<string, BlockDelta>();
  private blockToSegmentMap = new Map<string, string>();

  private identifiers = new Map<string, IdentifierOccurrence[]>();
  private sceneSymbols = new Map<string, SceneSymbols>();
  private globalDeclarations = new Map<string, DeclareVariableStatement>();
  private _gosubTargets: Set<string> | null = null;
  private stmtRefToId = new Map<Statement, string>();

  constructor(
    blockIndex: Record<string, CodeBlock>,
    statements: Record<string, Statement>,
    blockToCfg: Map<string, string>,
  ) {
    this.statements = statements;
    this.blockToCfg = blockToCfg;
    this.blockIndex = blockIndex;

    const stmtToBlock = new Map<string, string>();
    for (const [blockId, block] of Object.entries(blockIndex)) {
      for (const sid of block.statementIds) {
        stmtToBlock.set(sid, blockId);
      }
    }

    for (const [stmtId, stmt] of Object.entries(statements)) {
      this.stmtRefToId.set(stmt, stmtId);
      const token = (stmt as any).token ?? (stmt as any).content?.[0];
      if (!token) continue;

      const blockId = stmtToBlock.get(stmtId);
      if (!blockId) continue;

      const cfgId = this.blockToCfg.get(blockId);
      if (!cfgId) continue;

      const entry: LocationEntry = {
        scene: token.sceneName,
        line: token.lineNumber,
        position: token.position ?? 0,
        statementId: stmtId,
        statementKind: stmt.kind,
        cfgId,
        blockId,
      };

      this.stmtToEntry.set(stmtId, entry);

      const key = `${token.sceneName}:${token.lineNumber}`;
      const existing = this.bySceneLine.get(key);
      if (existing) existing.push(entry);
      else this.bySceneLine.set(key, [entry]);

      this.indexVariable(stmt, stmtId, entry);
      this.indexSymbol(stmt, token.sceneName);
    }
  }

  attachDataflow(dataflowStates: State[], stateStore: StateStore): void {
    this.stateStore = stateStore;
    for (const state of dataflowStates) {
      this.dataflowByCfg.set(state.cfgId, state);
    }
  }

  attachCfgEntryStates(states: Map<string, SerializedVariableState>): void {
    this.cfgEntryStates = states;
  }

  attachBlockStates(blockStates: BlockState[]): void {
    for (const bs of blockStates) {
      this.blockEntryStates.add(bs.blockId, { state: bs.state, scene: bs.scene, provenance: bs.provenance });
    }
  }

  attachSegmentDeltas(
    segmentStates: Map<string, { entry: SerializedVariableState; exit: SerializedVariableState }>,
    blockDeltas: Map<string, BlockDelta>,
    blockToSegment: Map<string, string>,
  ): void {
    for (const [segId, states] of segmentStates) {
      this.segmentEntryStates.set(segId, states.entry);
    }
    this.blockDeltaMap = blockDeltas;
    this.blockToSegmentMap = blockToSegment;
  }

  attachTransfers(transfers: Map<string, CfgTransfer>): void {
    this.transfers = transfers;
  }

  private resolveBlockEntryFromSegment(blockId: string): SerializedVariableState | null {
    const segId = this.blockToSegmentMap.get(blockId);
    if (!segId) return null;
    const segEntry = this.segmentEntryStates.get(segId);
    if (!segEntry) return null;
    const delta = this.blockDeltaMap.get(blockId);
    if (!delta) return segEntry;
    const globals = { ...segEntry.globals, ...delta.globals };
    const temps: Record<string, Record<string, AbstractValue>> = {};
    for (const [scene, vars] of Object.entries(segEntry.temps)) {
      temps[scene] = { ...vars };
    }
    for (const [scene, vars] of Object.entries(delta.temps)) {
      if (!temps[scene]) temps[scene] = {};
      Object.assign(temps[scene], vars);
    }
    return { globals, temps };
  }

  getStateAtStatement(statementId: string, scene: string): SerializedVariableState[] {
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];

    const blockId = entry.blockId;

    const segState = this.resolveBlockEntryFromSegment(blockId);
    if (segState) {
      const state = deserializeToVariableState(segState);
      const block = this.blockIndex[blockId];
      if (block) {
        for (const stmtId of block.statementIds) {
          if (stmtId === statementId) break;
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      }
      return [serializeState(state)];
    }

    const entries = this.blockEntryStates.getAll(blockId);
    if (entries.length === 0) return [];

    return entries.map(blockEntry => {
      const block = this.blockIndex[blockId];
      if (!block) return serializeState(blockEntry.state);

      const state = cloneState(blockEntry.state);
      for (const stmtId of block.statementIds) {
        if (stmtId === statementId) break;
        const stmt = this.statements[stmtId];
        if (stmt) applyEffect(stmt, state, blockEntry.scene);
      }
      return serializeState(state);
    });
  }

  getStateBeforeAndAfter(statementId: string, scene: string): { before: SerializedVariableState; after: SerializedVariableState }[] {
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];

    const blockId = entry.blockId;

    const segState = this.resolveBlockEntryFromSegment(blockId);
    if (segState) {
      const state = deserializeToVariableState(segState);
      const block = this.blockIndex[blockId];
      if (block) {
        for (const stmtId of block.statementIds) {
          if (stmtId === statementId) break;
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      }
      const before = serializeState(state);
      const targetStmt = this.statements[statementId];
      if (targetStmt) applyEffect(targetStmt, state, scene);
      const after = serializeState(state);
      return [{ before, after }];
    }

    const entries = this.blockEntryStates.getAll(blockId);
    if (entries.length === 0) return [];

    return entries.map(blockEntry => {
      const block = this.blockIndex[blockId];
      if (!block) {
        const s = serializeState(blockEntry.state);
        return { before: s, after: s };
      }

      const state = cloneState(blockEntry.state);
      for (const stmtId of block.statementIds) {
        if (stmtId === statementId) break;
        const stmt = this.statements[stmtId];
        if (stmt) applyEffect(stmt, state, blockEntry.scene);
      }
      const before = serializeState(state);

      const targetStmt = this.statements[statementId];
      if (targetStmt) applyEffect(targetStmt, state, blockEntry.scene);
      const after = serializeState(state);

      return { before, after };
    });
  }

  getParamCallValues(
    cfgId: string,
    paramName: string,
  ): { callerScene: string; callerLine: number; value: AbstractValue }[] {
    const lowerParam = paramName.toLowerCase();

    let paramIndex = -1;
    for (const [stmtId, entry] of this.stmtToEntry) {
      if (entry.cfgId !== cfgId) continue;
      const stmt = this.statements[stmtId];
      if (stmt?.kind !== "Parameters") continue;
      const ids = (stmt as any).identifiers;
      for (let i = 0; i < ids.length; i++) {
        if (ids[i].value.toLowerCase() === lowerParam) { paramIndex = i; break; }
      }
      break;
    }
    if (paramIndex < 0) return [];

    const parts = cfgId.split(":");
    const targetScene = parts[0].toLowerCase();
    const targetLabel = (parts[1] ?? "").toLowerCase();

    const results: { callerScene: string; callerLine: number; value: AbstractValue }[] = [];

    for (const [, ss] of this.sceneSymbols) {
      for (const gosubStmt of ss.gosubs) {
        const target = extractStaticLabelTarget(gosubStmt);
        if (!target) continue;
        if (target.scene !== targetScene || target.label !== targetLabel) continue;

        const gosub = gosubStmt as any;
        if (!gosub.args || gosub.args.length <= paramIndex) continue;

        const gosubStmtId = this.stmtRefToId.get(gosubStmt);
        if (!gosubStmtId) continue;
        const gosubEntry = this.stmtToEntry.get(gosubStmtId);
        if (!gosubEntry) continue;

        const entryStates = this.resolveEntryStates(gosubEntry.cfgId);
        if (!entryStates) continue;

        for (const serialized of entryStates) {
          const state = deserializeToVariableState(serialized);
          const value = evaluateExpression(gosub.args[paramIndex], state, gosubEntry.scene);
          results.push({ callerScene: gosubEntry.scene, callerLine: gosubEntry.line, value });
        }
      }
    }

    return results;
  }

  getCallSiteVariableValues(
    cfgId: string,
    variable: string,
  ): { callerScene: string; callerLine: number; value: AbstractValue }[] {
    const parts = cfgId.split(":");
    if (parts.length < 2 || !parts[1]) return [];
    const targetScene = parts[0].toLowerCase();
    const targetLabel = parts[1].toLowerCase();

    const lowerVar = variable.toLowerCase();
    const results: { callerScene: string; callerLine: number; value: AbstractValue }[] = [];

    for (const [, ss] of this.sceneSymbols) {
      for (const gosubStmt of ss.gosubs) {
        const target = extractStaticLabelTarget(gosubStmt);
        if (!target) continue;
        if (target.scene !== targetScene || target.label !== targetLabel) continue;

        const gosubStmtId = this.stmtRefToId.get(gosubStmt);
        if (!gosubStmtId) continue;
        const gosubEntry = this.stmtToEntry.get(gosubStmtId);
        if (!gosubEntry) continue;

        const states = this.getStateAtStatement(gosubStmtId, gosubEntry.scene);
        for (const state of states) {
          const tempScene = state.temps[gosubEntry.scene];
          let value: AbstractValue | undefined;
          if (tempScene && lowerVar in tempScene) {
            value = tempScene[lowerVar];
          } else if (lowerVar in state.globals) {
            value = state.globals[lowerVar];
          }
          if (value && value.kind !== "bottom") {
            results.push({ callerScene: gosubEntry.scene, callerLine: gosubEntry.line, value });
          }
        }
      }
    }

    return results;
  }

  getAttributedStatesAtStatement(
    statementId: string,
    scene: string,
  ): { provenance?: EntryProvenance[]; state: SerializedVariableState }[] {
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];

    const blockId = entry.blockId;

    const segState = this.resolveBlockEntryFromSegment(blockId);
    if (segState) {
      const state = deserializeToVariableState(segState);
      const block = this.blockIndex[blockId];
      if (block) {
        for (const stmtId of block.statementIds) {
          if (stmtId === statementId) break;
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      }
      return [{ state: serializeState(state) }];
    }

    const entries = this.blockEntryStates.getAll(blockId);
    if (entries.length === 0) return [];

    return entries.map(blockEntry => {
      const block = this.blockIndex[blockId];
      if (!block) return { provenance: blockEntry.provenance, state: serializeState(blockEntry.state) };

      const state = cloneState(blockEntry.state);
      for (const stmtId of block.statementIds) {
        if (stmtId === statementId) break;
        const stmt = this.statements[stmtId];
        if (stmt) applyEffect(stmt, state, blockEntry.scene);
      }
      return { provenance: blockEntry.provenance, state: serializeState(state) };
    });
  }

  getAttributedBeforeAndAfter(
    statementId: string,
    scene: string,
  ): { provenance?: EntryProvenance[]; before: SerializedVariableState; after: SerializedVariableState }[] {
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];

    const blockId = entry.blockId;

    const segState = this.resolveBlockEntryFromSegment(blockId);
    if (segState) {
      const state = deserializeToVariableState(segState);
      const block = this.blockIndex[blockId];
      if (block) {
        for (const stmtId of block.statementIds) {
          if (stmtId === statementId) break;
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      }
      const before = serializeState(state);
      const targetStmt = this.statements[statementId];
      if (targetStmt) applyEffect(targetStmt, state, scene);
      const after = serializeState(state);
      return [{ before, after }];
    }

    const entries = this.blockEntryStates.getAll(blockId);
    if (entries.length === 0) return [];

    return entries.map(blockEntry => {
      const block = this.blockIndex[blockId];
      if (!block) {
        const s = serializeState(blockEntry.state);
        return { provenance: blockEntry.provenance, before: s, after: s };
      }

      const state = cloneState(blockEntry.state);
      for (const stmtId of block.statementIds) {
        if (stmtId === statementId) break;
        const stmt = this.statements[stmtId];
        if (stmt) applyEffect(stmt, state, blockEntry.scene);
      }
      const before = serializeState(state);

      const targetStmt = this.statements[statementId];
      if (targetStmt) applyEffect(targetStmt, state, blockEntry.scene);
      const after = serializeState(state);

      return { provenance: blockEntry.provenance, before, after };
    });
  }

  getCallSiteBeforeAndAfter(
    cfgId: string,
    statementId: string,
    scene: string,
  ): { callerScene: string; callerLine: number; before: SerializedVariableState; after: SerializedVariableState }[] {
    if (!this.transfers) return [];
    const transfer = this.transfers.get(cfgId);
    if (!transfer) return [];

    const callerEntries = this.findGosubCallerEntries(cfgId);
    if (callerEntries.length === 0) return [];

    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];

    const results: { callerScene: string; callerLine: number; before: SerializedVariableState; after: SerializedVariableState }[] = [];
    for (const caller of callerEntries) {
      const walked = this.walkTransferToStatement(caller.entryState, transfer, entry.blockId, statementId, scene);
      if (walked) {
        results.push({ callerScene: caller.scene, callerLine: caller.line, ...walked });
      }
    }
    return results;
  }

  getCallSiteStateAtStatement(
    cfgId: string,
    statementId: string,
    scene: string,
  ): { callerScene: string; callerLine: number; state: SerializedVariableState }[] {
    if (!this.transfers) return [];
    const transfer = this.transfers.get(cfgId);
    if (!transfer) return [];

    const callerEntries = this.findGosubCallerEntries(cfgId);
    if (callerEntries.length === 0) return [];

    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];

    const results: { callerScene: string; callerLine: number; state: SerializedVariableState }[] = [];
    for (const caller of callerEntries) {
      const walked = this.walkTransferToStatement(caller.entryState, transfer, entry.blockId, statementId, scene);
      if (walked) {
        results.push({ callerScene: caller.scene, callerLine: caller.line, state: walked.before });
      }
    }
    return results;
  }

  private findGosubCallerEntries(
    cfgId: string,
  ): { scene: string; line: number; entryState: VariableState }[] {
    const parts = cfgId.split(":");
    if (parts.length < 2 || !parts[1]) return [];
    const targetScene = parts[0].toLowerCase();
    const targetLabel = parts[1].toLowerCase();

    const results: { scene: string; line: number; entryState: VariableState }[] = [];

    for (const [, ss] of this.sceneSymbols) {
      for (const gosubStmt of ss.gosubs) {
        const target = extractStaticLabelTarget(gosubStmt);
        if (!target) continue;
        if (target.scene !== targetScene || target.label !== targetLabel) continue;

        const gosubStmtId = this.stmtRefToId.get(gosubStmt);
        if (!gosubStmtId) continue;
        const gosubEntry = this.stmtToEntry.get(gosubStmtId);
        if (!gosubEntry) continue;

        const states = this.getStateAtStatement(gosubStmtId, gosubEntry.scene);
        for (const state of states) {
          const deserialized = deserializeToVariableState(state);
          const gosub = gosubStmt as any;
          const entryBlock = this.findEntryBlockForCfg(cfgId);
          if (entryBlock?.parameterNames?.length && gosub.args?.length) {
            const count = Math.min(gosub.args.length, entryBlock.parameterNames.length);
            for (let i = 0; i < count; i++) {
              const argValue = evaluateExpression(gosub.args[i], deserialized, gosubEntry.scene);
              setVariableMut(deserialized, entryBlock.parameterNames[i], argValue, "Temporary", targetScene);
            }
          }
          results.push({ scene: gosubEntry.scene, line: gosubEntry.line, entryState: deserialized });
        }
      }
    }

    return results;
  }

  private findEntryBlockForCfg(cfgId: string): CodeBlock | null {
    const transfer = this.transfers?.get(cfgId);
    if (transfer && transfer.effects.length > 0) {
      return this.blockIndex[transfer.effects[0].blockId] ?? null;
    }
    for (const [blockId, block] of Object.entries(this.blockIndex)) {
      if (this.blockToCfg.get(blockId) === cfgId && block.parameterNames?.length) return block;
    }
    return null;
  }

  private walkTransferToStatement(
    entryState: VariableState,
    transfer: CfgTransfer,
    targetBlockId: string,
    targetStmtId: string,
    scene: string,
  ): { before: SerializedVariableState; after: SerializedVariableState } | null {
    let state = cloneState(entryState);

    for (const ge of transfer.effects) {
      const block = this.blockIndex[ge.blockId];
      if (!block) continue;

      if (ge.blockId === targetBlockId) {
        if (ge.guards.length > 0) {
          const lastGuard = ge.guards[ge.guards.length - 1];
          const narrowed = narrowStateByGuard(lastGuard, state, scene, this.statements);
          if (narrowed) state = narrowed;
        }

        for (const stmtId of block.statementIds) {
          if (stmtId === targetStmtId) {
            const before = serializeState(state);
            const targetStmt = this.statements[targetStmtId];
            if (targetStmt) applyEffect(targetStmt, state, scene);
            const after = serializeState(state);
            return { before, after };
          }
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
        return null;
      }

      if (ge.guards.length === 0) {
        for (const stmtId of block.statementIds) {
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      } else {
        const lastGuard = ge.guards[ge.guards.length - 1];
        const narrowed = narrowStateByGuard(lastGuard, state, scene, this.statements);
        const modified = cloneState(narrowed ?? state);
        for (const stmtId of block.statementIds) {
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, modified, scene);
        }
        const negNarrowed = narrowStateByGuardNegation(lastGuard, state, scene, this.statements);
        if (negNarrowed) state = negNarrowed;
        joinStatesMut(state, modified);
      }
    }

    return null;
  }

  attachReachability(reachable: Set<string>): void {
    this.reachableCfgs = reachable;
  }

  attachDeadBranches(branches: DeadBranch[]): void {
    this.deadBranches = branches;
  }

  attachControlFlowViolations(violations: ControlFlowViolation[]): void {
    this.controlFlowViolations = violations;
  }

  attachUndeclaredSets(violations: UndeclaredSetViolation[]): void {
    this.undeclaredSets = violations;
  }

  attachMultiReplaceViolations(violations: { scene: string; line: number; position: number; selectorValue: number | string; alternativeCount: number; kind: "zero-index" | "out-of-range" | "string-selector" }[]): void {
    this.multiReplaceViolations = violations;
  }

  getMultiReplaceViolations(): { scene: string; line: number; position: number; selectorValue: number | string; alternativeCount: number; kind: "zero-index" | "out-of-range" | "string-selector" }[] {
    return this.multiReplaceViolations;
  }

  attachUnreachableCode(items: UnreachableCode[]): void {
    this.unreachableCode = items;
  }

  getUnreachableCode(): UnreachableCode[] {
    return this.unreachableCode;
  }

  getDeadBranches(): { scene: string; line: number; reason: DeadBranch["reason"] }[] {
    const results: { scene: string; line: number; reason: DeadBranch["reason"] }[] = [];
    for (const branch of this.deadBranches) {
      const entry = this.findFirstEntryForBlock(branch.blockId);
      if (!entry) continue;
      results.push({ scene: entry.scene, line: entry.line, reason: branch.reason });
    }
    return results;
  }

  getControlFlowViolations(): { scene: string; line: number; kind: ControlFlowViolationKind }[] {
    const results: { scene: string; line: number; kind: ControlFlowViolationKind }[] = [];
    for (const v of this.controlFlowViolations) {
      const entry = this.findLastEntryForBlock(v.blockId)
        ?? (v.displayBlockId ? this.findFirstEntryForBlock(v.displayBlockId) : null);
      if (!entry) continue;
      results.push({ scene: entry.scene, line: entry.line, kind: v.kind });
    }
    return results;
  }

  getUndeclaredSets(): { scene: string; line: number; position: number; length: number; variable: string; kind: UndeclaredViolationKind }[] {
    const results: { scene: string; line: number; position: number; length: number; variable: string; kind: UndeclaredViolationKind }[] = [];
    for (const v of this.undeclaredSets) {
      const line = v.line >= 0 ? v.line : (this.stmtToEntry.get(v.statementId)?.line ?? -1);
      const position = v.position >= 0 ? v.position : 0;
      const scene = v.scene;
      if (line < 0) continue;
      results.push({ scene, line, position, length: v.variable.length, variable: v.variable, kind: v.kind });
    }
    return results;
  }

  private findFirstEntryForBlock(blockId: string): LocationEntry | null {
    for (const entry of this.stmtToEntry.values()) {
      if (entry.blockId === blockId) return entry;
    }
    return null;
  }

  private findLastEntryForBlock(blockId: string): LocationEntry | null {
    let best: LocationEntry | null = null;
    for (const entry of this.stmtToEntry.values()) {
      if (entry.blockId !== blockId) continue;
      if (!best || entry.line > best.line) best = entry;
    }
    return best;
  }

  private findLastEntryForScene(scene: string): LocationEntry | null {
    let best: LocationEntry | null = null;
    for (const entry of this.stmtToEntry.values()) {
      if (entry.scene !== scene) continue;
      if (!best || entry.line > best.line) best = entry;
    }
    return best;
  }

  queryLocation(query: LocationQuery): LocationResult {
    const key = `${query.scene}:${query.line}`;
    const entries = this.bySceneLine.get(key) ?? [];

    let matched = entries;
    if (query.position !== undefined && entries.length > 1) {
      const exact = entries.filter(e => e.position === query.position);
      if (exact.length > 0) matched = exact;
    }

    const cfgId = matched.length > 0 ? matched[0].cfgId : null;

    return {
      entries: matched,
      cfgId,
      dataflow: cfgId ? this.resolveEntryStates(cfgId) : null,
    };
  }

  queryVariable(query: VariableQuery): VariableLocationResult {
    const name = query.variable.toLowerCase();
    return {
      variable: query.variable,
      definitions: this.variableDefs.get(name) ?? [],
      references: this.variableRefs.get(name) ?? [],
      deletes: this.variableDeletes.get(name) ?? [],
    };
  }

  queryIdentifier(name: string): IdentifierOccurrence[] {
    return this.identifiers.get(name.toLowerCase()) ?? [];
  }

  allLocationsForLine(scene: string, line: number): LocationEntry[] {
    return this.bySceneLine.get(`${scene}:${line}`) ?? [];
  }

  private resolveEntryStates(cfgId: string): SerializedVariableState[] | null {
    const direct = this.cfgEntryStates.get(cfgId);
    if (direct) return [direct];
    const state = this.dataflowByCfg.get(cfgId);
    if (!state) return null;
    return state.entryIds.map(id => this.stateStore.get(id)!).filter(Boolean);
  }

  getCfgDataflow(cfgId: string): SerializedVariableState[] | null {
    return this.resolveEntryStates(cfgId);
  }

  getDataflowForIdentifier(name: string, scene: string, line: number): SerializedVariableState[] | null {
    const occs = this.identifiers.get(name.toLowerCase());
    if (!occs) return null;
    const occ = occs.find(o => o.scene === scene && o.line === line);
    if (!occ) return null;
    const entry = this.stmtToEntry.get(occ.statementId);
    if (!entry) return null;
    return this.resolveEntryStates(entry.cfgId);
  }

  getSceneSymbols(scene: string): SceneSymbols | undefined {
    return this.sceneSymbols.get(scene);
  }

  isParamVariable(scene: string, variable: string): boolean {
    const ss = this.sceneSymbols.get(scene);
    if (!ss) return false;
    return ss.paramVariables.has(variable.toLowerCase());
  }

  isGosubTarget(scene: string, label: string): boolean {
    const key = `${scene.toLowerCase()}:${label.toLowerCase()}`;
    if (!this._gosubTargets) {
      this._gosubTargets = new Set<string>();
      for (const sceneName of this.allSceneNames) {
        const ss = this.sceneSymbols.get(sceneName);
        if (!ss) continue;
        for (const stmt of ss.gosubs) {
          const ref = extractStaticLabelTarget(stmt);
          if (ref) this._gosubTargets.add(`${ref.scene}:${ref.label}`);
        }
      }
    }
    return this._gosubTargets.has(key);
  }

  getGlobalDeclaration(variable: string): DeclareVariableStatement | undefined {
    return this.globalDeclarations.get(variable.toLowerCase());
  }

  getVariableToken(entry: LocationEntry): { line: number; position: number; length: number } | null {
    const stmt = this.statements[entry.statementId] as any;
    if (!stmt) return null;

    switch (entry.statementKind) {
      case "DeclareVariable":
      case "DeclareArray":
      case "DeleteVariable":
      case "DeleteArray": {
        const v = stmt.variable;
        if (v?.value) return { line: v.lineNumber, position: v.position, length: v.value.length };
        return null;
      }
      case "SetVariable": {
        const tok = stmt.assignment
          ? stmt.expression?.token
          : stmt.expression?.left?.token;
        if (tok?.value) return { line: tok.lineNumber, position: tok.position, length: tok.value.length };
        return null;
      }
      case "InputText":
      case "InputNumber": {
        const v = stmt.storeInto;
        if (v?.value) return { line: v.lineNumber, position: v.position, length: v.value.length };
        return null;
      }
      case "GenerateRandom": {
        const v = stmt.identifier;
        if (v?.value) return { line: v.lineNumber, position: v.position, length: v.value.length };
        return null;
      }
      default:
        return null;
    }
  }

  findAchievementDefinition(codename: string): { achievement: AchievementStatement; scene: string } | null {
    const lower = codename.toLowerCase();
    for (const [sceneName, ss] of this.sceneSymbols) {
      const achievement = ss.achievements.get(lower);
      if (achievement) return { achievement, scene: sceneName };
    }
    return null;
  }

  findAchievementReferences(codename: string): { scene: string; line: number; position: number; length: number }[] {
    const lower = codename.toLowerCase();
    const results: { scene: string; line: number; position: number; length: number }[] = [];
    for (const [sceneName, ss] of this.sceneSymbols) {
      for (const achieve of ss.achieves) {
        if (achieve.codename.value.toLowerCase() === lower) {
          results.push({
            scene: sceneName,
            line: achieve.codename.lineNumber,
            position: achieve.codename.position,
            length: achieve.codename.value.length,
          });
        }
      }
    }
    return results;
  }

  getImageReferences(): { path: string; scene: string; line: number; position: number; length: number; alignment?: string; altText?: string }[] {
    const results: { path: string; scene: string; line: number; position: number; length: number; alignment?: string; altText?: string }[] = [];
    for (const [sceneName, ss] of this.sceneSymbols) {
      for (const img of ss.images) {
        const p = img.path;
        if (!p?.content) continue;
        results.push({
          path: p.content,
          scene: sceneName,
          line: p.lineNumber,
          position: p.position,
          length: p.content.length,
          alignment: img.alignment?.value,
          altText: img.altText?.content,
        });
      }
    }
    return results;
  }

  get allGlobalDeclarations(): ReadonlyMap<string, DeclareVariableStatement> {
    return this.globalDeclarations;
  }

  get allSceneNames(): string[] {
    return [...this.sceneSymbols.keys()];
  }

  getUnusedVariables(): { name: string; scene: string; line: number; position: number; length: number; scope: "Global" | "Temporary" }[] {
    const results: { name: string; scene: string; line: number; position: number; length: number; scope: "Global" | "Temporary" }[] = [];

    for (const [name, decl] of this.globalDeclarations) {
      if (isBuiltinVariable(name)) continue;
      const refs = this.variableRefs.get(name.toLowerCase());
      if (refs && refs.length > 0) continue;
      const tok = decl.variable;
      results.push({ name, scene: decl.token.sceneName, line: tok.lineNumber, position: tok.position, length: tok.value.length, scope: "Global" });
    }

    for (const [sceneName, ss] of this.sceneSymbols) {
      for (const [name, decl] of ss.tempVariables) {
        if (isBuiltinVariable(name)) continue;
        const refs = this.variableRefs.get(name.toLowerCase());
        if (refs && refs.length > 0) continue;
        const tok = decl.variable;
        results.push({ name, scene: sceneName, line: tok.lineNumber, position: tok.position, length: tok.value.length, scope: "Temporary" });
      }
    }

    return results;
  }

  getUnusedLabels(): { name: string; scene: string; line: number; position: number; length: number }[] {
    const referenced = new Set<string>();

    for (const sceneName of this.allSceneNames) {
      const ss = this.sceneSymbols.get(sceneName);
      if (!ss) continue;

      for (const stmt of ss.gotos) {
        const ref = extractStaticLabelTarget(stmt);
        if (ref) referenced.add(`${ref.scene}:${ref.label}`);
      }
      for (const stmt of ss.gosubs) {
        const ref = extractStaticLabelTarget(stmt);
        if (ref) referenced.add(`${ref.scene}:${ref.label}`);
      }
    }

    const results: { name: string; scene: string; line: number; position: number; length: number }[] = [];
    for (const [sceneName, ss] of this.sceneSymbols) {
      for (const [name, label] of ss.labels) {
        const key = `${sceneName.toLowerCase()}:${name.toLowerCase()}`;
        if (referenced.has(key)) continue;
        results.push({
          name,
          scene: sceneName,
          line: label.label.lineNumber,
          position: label.label.position,
          length: label.label.value.length,
        });
      }
    }

    return results;
  }

  getAchievementVariableConflicts(): { codename: string; variable: string; scene: string; line: number; position: number; length: number }[] {
    const results: { codename: string; variable: string; scene: string; line: number; position: number; length: number }[] = [];
    const globalLower = new Map<string, string>();
    for (const name of this.globalDeclarations.keys()) {
      globalLower.set(name.toLowerCase(), name);
    }
    const tempLower = new Map<string, string>();
    for (const [, ss] of this.sceneSymbols) {
      for (const name of ss.tempVariables.keys()) {
        tempLower.set(name.toLowerCase(), name);
      }
      for (const name of ss.paramVariables) {
        tempLower.set(name.toLowerCase(), name);
      }
    }

    for (const [, ss] of this.sceneSymbols) {
      for (const [lower, achievement] of ss.achievements) {
        const globalMatch = globalLower.get(lower);
        const tempMatch = tempLower.get(lower);
        const match = globalMatch ?? tempMatch;
        if (!match) continue;
        const tok = achievement.codename;
        results.push({ codename: tok.value, variable: match, scene: tok.sceneName, line: tok.lineNumber, position: tok.position, length: tok.value.length });
      }
    }
    return results;
  }

  unreachableStatements(): LocationEntry[] {
    if (this.reachableCfgs.size === 0) return [];
    const results: LocationEntry[] = [];
    const seen = new Set<string>();
    for (const entry of this.stmtToEntry.values()) {
      if (this.reachableCfgs.has(entry.cfgId)) continue;
      const key = `${entry.scene}:${entry.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(entry);
    }
    return results;
  }

  stats(): { statements: number; lines: number; cfgsWithDataflow: number } {
    return {
      statements: this.stmtToEntry.size,
      lines: this.bySceneLine.size,
      cfgsWithDataflow: this.cfgEntryStates.size || this.dataflowByCfg.size,
    };
  }

  private ensureSceneSymbols(scene: string): SceneSymbols {
    let s = this.sceneSymbols.get(scene);
    if (!s) {
      s = {
        labels: new Map(),
        tempVariables: new Map(),
        paramVariables: new Set(),
        achievements: new Map(),
        achieves: [],
        images: [],
        gotos: [],
        gosubs: [],
      };
      this.sceneSymbols.set(scene, s);
    }
    return s;
  }

  private indexSymbol(stmt: Statement, scene: string): void {
    const ss = this.ensureSceneSymbols(scene);

    switch (stmt.kind) {
      case "Label": {
        const label = stmt as LabelStatement;
        ss.labels.set(label.label.value, label);
        break;
      }
      case "DeclareVariable": {
        const decl = stmt as DeclareVariableStatement;
        if (decl.scope === "Global") {
          this.globalDeclarations.set(decl.variable.value.toLowerCase(), decl);
        } else {
          ss.tempVariables.set(decl.variable.value.toLowerCase(), decl);
        }
        break;
      }
      case "GotoLabel":
      case "GotoScene":
        ss.gotos.push(stmt);
        break;
      case "GoSub":
      case "GoSubScene":
        ss.gosubs.push(stmt);
        break;
      case "Parameters": {
        const params = stmt as any;
        for (const id of params.identifiers) {
          ss.paramVariables.add(id.value.toLowerCase());
        }
        break;
      }
      case "Achievement": {
        const achievement = stmt as AchievementStatement;
        ss.achievements.set(achievement.codename.value.toLowerCase(), achievement);
        break;
      }
      case "Achieve": {
        ss.achieves.push(stmt as AchieveStatement);
        break;
      }
      case "Image": {
        ss.images.push(stmt as ImageStatement);
        break;
      }
      case "TextImage": {
        ss.images.push(stmt as TextImageStatement);
        break;
      }
    }
  }

  private pushIdentifier(token: any, role: IdentifierRole, entry: LocationEntry): void {
    if (!token?.value) return;
    const name = token.value.toLowerCase();
    const occ: IdentifierOccurrence = {
      name,
      scene: entry.scene,
      line: token.lineNumber,
      position: token.position,
      length: token.value.length,
      role,
      statementId: entry.statementId,
      statementKind: entry.statementKind,
    };
    const list = this.identifiers.get(name);
    if (list) list.push(occ);
    else this.identifiers.set(name, [occ]);
  }

  private indexVariable(stmt: Statement, stmtId: string, entry: LocationEntry): void {
    const s = stmt as any;

    if (stmt.kind === "DeleteVariable" || stmt.kind === "DeleteArray") {
      const name = s.variable?.value?.toLowerCase();
      if (name) {
        const list = this.variableDeletes.get(name);
        if (list) list.push(entry);
        else this.variableDeletes.set(name, [entry]);
      }
      this.pushIdentifier(s.variable, "delete", entry);
      return;
    }

    if (stmt.kind === "Parameters") {
      for (const id of s.identifiers) {
        const name = id.value?.toLowerCase();
        if (name) {
          const list = this.variableDefs.get(name);
          if (list) list.push(entry);
          else this.variableDefs.set(name, [entry]);
        }
        this.pushIdentifier(id, "definition", entry);
      }
      return;
    }

    if (stmt.kind === "DeclareVariable" || stmt.kind === "DeclareArray") {
      const name = s.variable?.value?.toLowerCase();
      if (name) {
        const list = this.variableDefs.get(name);
        if (list) list.push(entry);
        else this.variableDefs.set(name, [entry]);
      }
      this.pushIdentifier(s.variable, "definition", entry);
      if (stmt.kind === "DeclareArray" && s.declarations) {
        for (const decl of s.declarations) {
          const dn = decl.variable?.value?.toLowerCase();
          if (dn) {
            const list = this.variableDefs.get(dn);
            if (list) list.push(entry);
            else this.variableDefs.set(dn, [entry]);
          }
          this.pushIdentifier(decl.variable, "definition", entry);
        }
      }
      return;
    }

    if (stmt.kind === "SetVariable") {
      const tok = s.assignment
        ? s.expression?.token
        : s.expression?.left?.token;
      const name = tok?.value?.toLowerCase();
      if (name) {
        const list = this.variableDefs.get(name);
        if (list) list.push(entry);
        else this.variableDefs.set(name, [entry]);
      }
      this.pushIdentifier(tok, "definition", entry);
    }

    if (stmt.kind === "InputText" || stmt.kind === "InputNumber") {
      const name = s.storeInto?.value?.toLowerCase();
      if (name) {
        const list = this.variableDefs.get(name);
        if (list) list.push(entry);
        else this.variableDefs.set(name, [entry]);
      }
      this.pushIdentifier(s.storeInto, "definition", entry);
    }

    if (stmt.kind === "GenerateRandom") {
      const name = s.identifier?.value?.toLowerCase();
      if (name) {
        const list = this.variableDefs.get(name);
        if (list) list.push(entry);
        else this.variableDefs.set(name, [entry]);
      }
      this.pushIdentifier(s.identifier, "definition", entry);
    }

    this.extractRefs(stmt, entry);
  }

  private extractRefs(stmt: Statement, entry: LocationEntry): void {
    const refs = this.collectIdentifierTokens(stmt);
    for (const ref of refs) {
      const refEntry: LocationEntry = {
        ...entry,
        line: ref.line,
        position: ref.position,
        variableLength: ref.length,
      };
      const list = this.variableRefs.get(ref.name);
      if (list) list.push(refEntry);
      else this.variableRefs.set(ref.name, [refEntry]);
      this.pushIdentifier({ value: ref.originalName, lineNumber: ref.line, position: ref.position }, "reference", entry);
    }
  }

  private collectIdentifierTokens(stmt: Statement): { name: string; originalName: string; line: number; position: number; length: number }[] {
    const s = stmt as any;
    const results: { name: string; originalName: string; line: number; position: number; length: number }[] = [];

    const walkExpr = (expr: any) => {
      if (!expr) return;
      if (expr.token?.type === "Identifier") {
        const v = expr.token.value;
        if (v) results.push({ name: v.toLowerCase(), originalName: v, line: expr.token.lineNumber, position: expr.token.position, length: v.length });
      }
      if (expr.left) walkExpr(expr.left);
      if (expr.right) walkExpr(expr.right);
      if (expr.value && typeof expr.value === "object" && expr.operator) walkExpr(expr.value);
      if (expr.expression) walkExpr(expr.expression);
      if (expr.identifier) {
        const v = expr.identifier.value;
        if (v) results.push({ name: v.toLowerCase(), originalName: v, line: expr.identifier.lineNumber, position: expr.identifier.position, length: v.length });
      }
    };

    const pushExpr = (e: any) => { if (e) walkExpr(e); };

    const walkSegments = (segments: any[]) => {
      for (const seg of segments) {
        pushExpr(seg.expression);
        pushExpr(seg.selector);
        if (seg.alternatives) {
          for (const alt of seg.alternatives) {
            if (alt.segments) walkSegments(alt.segments);
          }
        }
      }
    };

    switch (stmt.kind) {
      case "SetVariable":
        if (s.assignment) {
          pushExpr(s.assignment);
        } else {
          pushExpr(s.expression);
        }
        break;
      case "DeclareVariable": pushExpr(s.expression); break;
      case "If": case "ElseIf": case "SelectableIf": case "Expression": pushExpr(s.expression); break;
      case "GenerateRandom": pushExpr(s.min); pushExpr(s.max); break;
      case "InputNumber": pushExpr(s.min); pushExpr(s.max); break;
      case "Round": case "Length": pushExpr(s.expression); break;
      case "Prose":
      case "ChoiceOption":
        if (s.parsedSegments) {
          walkSegments(s.parsedSegments);
        }
        if (stmt.kind === "ChoiceOption") pushExpr(s.selectableIf);
        break;
      default: pushExpr(s.expression); pushExpr(s.selector); break;
    }

    return results;
  }
}

const BUILTIN_VARIABLES = new Set([
  "choice_randomtest", "choice_quicktest", "choice_randomscene",
  "choice_nightmode", "choice_saved_is_allowed", "choice_save_name",
  "choice_time_stamp", "choice_restore_purchases_allowed",
  "choice_purchased_adfree", "choice_is_trial", "choice_is_advertising_supported",
  "choice_is_web", "choice_is_steam", "choice_is_ios", "choice_is_android",
  "choice_is_omnibus", "choice_release_date", "choice_prerelease",
  "choice_subscribe_allowed", "choice_subscribed",
  "true", "false",
  "implicit_control_flow",
]);

const isBuiltinVariable = (name: string): boolean =>
  BUILTIN_VARIABLES.has(name.toLowerCase()) || name.toLowerCase().startsWith("choice_");

function extractStaticLabelTarget(
  stmt: any,
): { scene: string; label: string } | null {
  if (stmt.kind === "GotoLabel" || stmt.kind === "GoSub") {
    const label = stmt.label;
    if (label && "value" in label) {
      return { scene: stmt.token.sceneName.toLowerCase(), label: label.value.toLowerCase() };
    }
  }

  if (stmt.kind === "GotoScene" || stmt.kind === "GoSubScene") {
    const scene = stmt.scene;
    const label = stmt.label;
    if (scene && "value" in scene && label && "value" in label) {
      return { scene: scene.value.toLowerCase(), label: label.value.toLowerCase() };
    }
  }

  return null;
}

const deserializeToVariableState = (
  s: SerializedVariableState,
): VariableState => ({
  parent: null,
  globals: new Map(Object.entries(s.globals)),
  temps: new Map(
    Object.entries(s.temps).map(([scene, vars]) => [scene, new Map(Object.entries(vars))]),
  ),
});

class MultiMap<K, V> {
  private map = new Map<K, V[]>();
  add(key: K, value: V): void {
    const list = this.map.get(key);
    if (list) list.push(value);
    else this.map.set(key, [value]);
  }
  getAll(key: K): V[] {
    return this.map.get(key) ?? [];
  }
}

const applyEffect = (stmt: Statement, state: VariableState, scene: string): void => {
  if (stmt.kind === "Parameters") {
    const params = stmt as any;
    for (const id of params.identifiers) {
      const existing = getVariable(state, id.value, scene);
      if (existing.kind === "bottom") {
        setVariableMut(state, id.value, bottom, "Temporary", scene);
      }
    }
    return;
  }

  const effect = extractEffect(stmt);
  if (!effect.defines) return;

  const { variable, scope, valueExpression, isCompoundAssignment, compoundExpression } = effect.defines;

  let value: AbstractValue;
  if (stmt.kind === "InputText" || stmt.kind === "InputNumber") {
    value = { kind: "input" };
  } else if (stmt.kind === "GenerateRandom") {
    const s = stmt as any;
    const minVal = evaluateExpression(s.min, state, scene);
    const maxVal = evaluateExpression(s.max, state, scene);
    if (minVal.kind === "constant" && typeof minVal.value === "number" &&
        maxVal.kind === "constant" && typeof maxVal.value === "number") {
      value = { kind: "range", min: minVal.value, max: maxVal.value };
    } else {
      value = top;
    }
  } else if (isCompoundAssignment && compoundExpression) {
    value = evaluateExpression(compoundExpression, state, scene);
  } else if (valueExpression) {
    value = evaluateExpression(valueExpression, state, scene);
  } else {
    value = scope === "Global" ? { kind: "constant", value: false } : { kind: "constant", value: "" };
  }

  if (scope === "Temporary") {
    setVariableMut(state, variable, value, "Temporary", scene);
  } else {
    updateVariableMut(state, variable, value, scene);
  }
};

export const serializeLocationIndex = (index: LocationIndex): Record<string, unknown> => {
  const s = index.stats();
  return {
    statements: s.statements,
    lines: s.lines,
    cfgsWithDataflow: s.cfgsWithDataflow,
  };
};
