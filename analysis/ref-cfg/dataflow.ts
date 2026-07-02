import { LinkedCfgs, Cfg } from "./data";
import { CfgTransfer, GuardedEffect, Guard } from "./cfg-transfer";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { AbstractValue, top, bottom, input as inputVal, join as joinAbstract } from "../dataflow/abstract-value";
import {
  VariableState,
  emptyState,
  serializeState,
  SerializedVariableState,
  setVariableMut,
  updateVariableMut,
  cloneState,
  joinStatesMut,
  materialize,
  materializeInto,
  getVariable,
  isTempVariable,
  hasGlobal,
} from "../dataflow/variable-state";
import { extractEffect } from "../dataflow/extract-definitions";
import { evaluateExpression } from "../dataflow/evaluate-expression";
import { ContextGraph, ContextId, ContextGraphDiagnostics } from "./context-graph";
import { isGoSubCall } from "../control-flow-graph/data/transition-kind";
import { FNV_OFFSET, fnvMixStr } from "../../utils/fnv";

export interface EntryProvenance {
  kind: "call" | "iteration" | "entry";
  label: string;
  scene?: string;
  line?: number;
}

export interface State {
  cfgId: string;
  entryIds: number[];
  exitIds: number[];
  entryProvenance?: EntryProvenance[][];
}

export type StateStore = Map<number, SerializedVariableState>;

export interface DataflowResult {
  cfgStates: State[];
  stateStore: StateStore;
  diagnostics: ContextGraphDiagnostics;
}

export const resolveStates = (store: StateStore, ids: number[]): SerializedVariableState[] =>
  ids.map(id => store.get(id)!);

export const resolveMergedEntry = (store: StateStore, state: State): SerializedVariableState => {
  if (state.entryIds.length === 1) return store.get(state.entryIds[0])!;
  const merged: SerializedVariableState = { globals: {}, temps: {} };
  for (const id of state.entryIds) {
    const s = store.get(id)!;
    mergeSerializedInto(merged, s);
  }
  return merged;
};

export const resolveMergedExit = (store: StateStore, state: State): SerializedVariableState => {
  if (state.exitIds.length === 1) return store.get(state.exitIds[0])!;
  const merged: SerializedVariableState = { globals: {}, temps: {} };
  for (const id of state.exitIds) {
    const s = store.get(id)!;
    mergeSerializedInto(merged, s);
  }
  return merged;
};

const mergeSerializedInto = (target: SerializedVariableState, source: SerializedVariableState): void => {
  for (const [name, val] of Object.entries(source.globals)) {
    target.globals[name] = name in target.globals ? joinAbstract(target.globals[name], val) : val;
  }
  for (const [scene, vars] of Object.entries(source.temps)) {
    if (!target.temps[scene]) target.temps[scene] = {};
    for (const [name, val] of Object.entries(vars)) {
      target.temps[scene][name] = name in target.temps[scene]
        ? joinAbstract(target.temps[scene][name], val) : val;
    }
  }
};

const buildSeedState = (
  linked: LinkedCfgs,
  statements: Record<string, Statement>,
): VariableState => {
  const state = emptyState();

  for (const cfg of Object.values(linked.cfgs)) {
    if (!state.temps.has(cfg.scene)) {
      state.temps.set(cfg.scene, new Map());
    }
  }

  for (const stmt of Object.values(statements)) {
    if (stmt.kind !== "DeclareVariable") continue;
    const effect = extractEffect(stmt);
    if (!effect.defines || effect.defines.scope !== "Global") continue;
    const value = effect.defines.valueExpression
      ? evaluateExpression(effect.defines.valueExpression, state, "")
      : { kind: "constant" as const, value: false };
    state.globals.set(effect.defines.variable.toLowerCase(), value);
  }

  return state;
};

export const solveRefDataflow = (
  graph: ContextGraph,
  linked: LinkedCfgs,
  transfers: Map<string, CfgTransfer>,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): DataflowResult => {
  const live = buildSeedState(linked, statements);
  const stateStore: StateStore = new Map();
  const perCfgEntryIds = new Map<string, Set<number>>();
  const perCfgExitIds = new Map<string, Set<number>>();
  const perCfgProvenance = new Map<string, Map<number, EntryProvenance[]>>();
  const nodeExitIds = new Map<ContextId, number>();

  const snap = (): number => {
    const h = hashState(live);
    if (!stateStore.has(h)) stateStore.set(h, serializeState(live));
    return h;
  };

  const loadSnapshot = (id: number): void => {
    const s = stateStore.get(id)!;
    live.parent = null;
    live.globals.clear();
    for (const [k, v] of Object.entries(s.globals)) live.globals.set(k, v);
    for (const [, vars] of live.temps) vars.clear();
    for (const [scene, vars] of Object.entries(s.temps)) {
      const sceneMap = live.temps.get(scene);
      if (sceneMap) for (const [k, v] of Object.entries(vars)) sceneMap.set(k, v);
    }
  };

  const joinSnapshot = (id: number): void => {
    const s = stateStore.get(id)!;
    for (const [k, v] of Object.entries(s.globals)) {
      const existing = live.globals.get(k);
      live.globals.set(k, existing !== undefined ? joinAbstract(existing, v) : v);
    }
    for (const [scene, vars] of Object.entries(s.temps)) {
      const sceneMap = live.temps.get(scene);
      if (!sceneMap) continue;
      for (const [k, v] of Object.entries(vars)) {
        const existing = sceneMap.get(k);
        sceneMap.set(k, existing !== undefined ? joinAbstract(existing, v) : v);
      }
    }
  };

  const recordCfg = (cfgId: string, entryId: number, exitId: number): void => {
    if (!perCfgEntryIds.has(cfgId)) perCfgEntryIds.set(cfgId, new Set());
    if (!perCfgExitIds.has(cfgId)) perCfgExitIds.set(cfgId, new Set());
    perCfgEntryIds.get(cfgId)!.add(entryId);
    perCfgExitIds.get(cfgId)!.add(exitId);
  };

  const recordProvenance = (cfgId: string, entryId: number, prov: EntryProvenance): void => {
    if (!perCfgProvenance.has(cfgId)) perCfgProvenance.set(cfgId, new Map());
    const provMap = perCfgProvenance.get(cfgId)!;
    if (!provMap.has(entryId)) provMap.set(entryId, []);
    provMap.get(entryId)!.push(prov);
  };

  for (const hash of graph.order) {
    const node = graph.nodes.get(hash)!;
    const cfg = linked.cfgs[node.cfgId];
    if (!cfg) continue;

    // Load entry from predecessor exits (handles branching: siblings load same predecessor)
    const preds = graph.predecessors(hash);
    if (preds.length > 0) {
      let loaded = false;
      for (const pred of preds) {
        const predExitId = nodeExitIds.get(pred.from);
        if (predExitId === undefined) continue;
        if (!loaded) { loadSnapshot(predExitId); loaded = true; }
        else joinSnapshot(predExitId);
      }
    }

    mapGosubParams(live, node.id, cfg, graph, linked, blockIndex, statements);

    const entryId = snap();

    const transfer = transfers.get(node.cfgId);
    if (transfer && transfer.effects.length > 0) {
      applyTransferToLive(live, transfer, cfg.scene, blockIndex, statements);
    }

    const exitId = snap();
    nodeExitIds.set(hash, exitId);
    recordCfg(node.cfgId, entryId, exitId);

    if (node.loopIteration !== undefined) {
      recordProvenance(node.cfgId, entryId, {
        kind: "iteration",
        label: `Iteration ${node.loopIteration + 1}`,
      });
    } else {
      const callInfo = findGosubCallInfo(node.id, node.cfgId, graph, linked, blockIndex, statements);
      if (callInfo) {
        recordProvenance(node.cfgId, entryId, {
          kind: "call",
          label: `${callInfo.scene}:${callInfo.line + 1}`,
          scene: callInfo.scene,
          line: callInfo.line,
        });
      }
    }
  }

  // Stats scenes: join all context node exits
  if (linked.statsCfgIds.length > 0) {
    let loaded = false;
    for (const exitId of nodeExitIds.values()) {
      if (!loaded) { loadSnapshot(exitId); loaded = true; }
      else joinSnapshot(exitId);
    }

    for (const statsCfgId of linked.statsCfgIds) {
      const cfg = linked.cfgs[statsCfgId];
      if (!cfg) continue;

      const entryId = snap();
      const transfer = transfers.get(statsCfgId);
      if (transfer && transfer.effects.length > 0) {
        applyTransferToLive(live, transfer, cfg.scene, blockIndex, statements);
      }
      const exitId = snap();
      recordCfg(statsCfgId, entryId, exitId);
      loadSnapshot(entryId);
    }
  }

  const cfgStates: State[] = [];
  for (const [cfgId, entryIds] of perCfgEntryIds) {
    const ids = [...entryIds];
    const provMap = perCfgProvenance.get(cfgId);
    let entryProvenance: EntryProvenance[][] | undefined;
    if (provMap) {
      const mapped = ids.map(id => provMap.get(id) ?? []);
      if (mapped.some(p => p.length > 0)) entryProvenance = mapped;
    }
    cfgStates.push({
      cfgId,
      entryIds: ids,
      exitIds: [...perCfgExitIds.get(cfgId)!],
      ...(entryProvenance ? { entryProvenance } : {}),
    });
  }

  return { cfgStates, stateStore, diagnostics: graph.diagnostics };
};

const findGosubCallInfo = (
  nodeId: ContextId,
  targetCfgId: string,
  graph: ContextGraph,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): { scene: string; line: number } | null => {
  for (const pred of graph.predecessors(nodeId)) {
    if (pred.kind !== "call") continue;
    const predNode = graph.nodes.get(pred.from);
    if (!predNode) continue;
    const predCfg = linked.cfgs[predNode.cfgId];
    if (!predCfg) continue;
    for (const exit of predCfg.exits) {
      if (!isGoSubCall(exit.kind)) continue;
      if (exit.target.type !== "cfg" || exit.target.cfgId !== targetCfgId) continue;
      const block = blockIndex[exit.blockId];
      if (!block?.statementIds.length) continue;
      const lastStmtId = block.statementIds[block.statementIds.length - 1];
      const stmt = statements[lastStmtId] as any;
      if (stmt?.token) return { scene: stmt.token.sceneName, line: stmt.token.lineNumber };
    }
  }
  return null;
};

const mapGosubParams = (
  live: VariableState,
  nodeId: number,
  cfg: Cfg,
  graph: ContextGraph,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): void => {
  const entryBlock = blockIndex[cfg.entryBlockId];
  const paramNames = entryBlock?.parameterNames;
  if (!paramNames?.length) return;

  const preds = graph.predecessors(nodeId);
  for (const pred of preds) {
    if (pred.kind !== "call") continue;
    const predNode = graph.nodes.get(pred.from);
    if (!predNode) continue;
    const predCfg = linked.cfgs[predNode.cfgId];
    if (!predCfg) continue;

    for (const exit of predCfg.exits) {
      if (!isGoSubCall(exit.kind)) continue;
      if (exit.target.type !== "cfg" || exit.target.cfgId !== cfg.id) continue;

      const block = blockIndex[exit.blockId];
      if (!block?.statementIds.length) continue;
      const lastStmtId = block.statementIds[block.statementIds.length - 1];
      const stmt = statements[lastStmtId];
      if (!stmt || (stmt.kind !== "GoSub" && stmt.kind !== "GoSubScene")) continue;

      const gosubStmt = stmt as any;
      if (!gosubStmt.args?.length) continue;

      const count = Math.min(gosubStmt.args.length, paramNames.length);
      for (let i = 0; i < count; i++) {
        const argValue = evaluateExpression(gosubStmt.args[i], live, predNode.scene);
        setVariableMut(live, paramNames[i], argValue, "Temporary", cfg.scene);
      }
      return;
    }
  }
};

const applyTransferToLive = (
  state: VariableState,
  transfer: CfgTransfer,
  scene: string,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): void => {
  applyEffectsAtDepth(state, transfer.effects, 0, scene, blockIndex, statements);
};

const guardArmKey = (g: Guard): string =>
  `${g.branchBlockId}|${g.edgeKind}|${JSON.stringify(g.metadata)}`;

const applyEffectsAtDepth = (
  state: VariableState,
  effects: GuardedEffect[],
  depth: number,
  scene: string,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): void => {
  let i = 0;
  while (i < effects.length) {
    const ge = effects[i];
    if (ge.guards.length <= depth) {
      applyBlockEffect(state, ge.blockId, scene, blockIndex, statements);
      i++;
    } else {
      const branchBlockId = ge.guards[depth].branchBlockId;
      const groupStart = i;
      while (
        i < effects.length &&
        effects[i].guards.length > depth &&
        effects[i].guards[depth].branchBlockId === branchBlockId
      ) {
        i++;
      }
      const group = effects.slice(groupStart, i);

      const arms: GuardedEffect[][] = [];
      let currentKey = "";
      for (const effect of group) {
        const key = guardArmKey(effect.guards[depth]);
        if (key !== currentKey) {
          arms.push([effect]);
          currentKey = key;
        } else {
          arms[arms.length - 1].push(effect);
        }
      }

      if (arms.length <= 1) {
        applyEffectsAtDepth(state, group, depth + 1, scene, blockIndex, statements);
      } else {
        const saved = cloneState(state);
        let joined: VariableState | null = null;
        for (const arm of arms) {
          const armState = cloneState(saved);
          applyEffectsAtDepth(armState, arm, depth + 1, scene, blockIndex, statements);
          if (joined === null) {
            joined = armState;
          } else {
            joinStatesMut(joined, armState);
          }
        }
        copyStateInto(state, joined!);
      }
    }
  }
};

const applyBlockEffect = (
  state: VariableState,
  blockId: string,
  scene: string,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): void => {
  const block = blockIndex[blockId];
  if (!block) return;
  for (const stmtId of block.statementIds) {
    const stmt = statements[stmtId];
    if (stmt) applyStatementEffect(stmt, state, scene);
  }
};

const copyStateInto = (target: VariableState, source: VariableState): void => {
  materializeInto(target, source);
};

const applyStatementEffect = (
  stmt: Statement,
  state: VariableState,
  scene: string,
): void => {
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
    value = inputVal;
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
  } else if (hasGlobal(state, variable) || isTempVariable(state, variable, scene)) {
    updateVariableMut(state, variable, value, scene);
  } else {
    setVariableMut(state, variable, value, "Global", scene);
  }
};

const hashState = (state: VariableState): number => {
  const mat = materialize(state);
  let h = FNV_OFFSET;
  for (const [name, val] of mat.globals) {
    h = fnvMixStr(h, name);
    h = fnvMixStr(h, val.kind);
    if (val.kind === "constant") h = fnvMixStr(h, String(val.value));
  }
  for (const [scene, vars] of mat.temps) {
    h = fnvMixStr(h, scene);
    for (const [name, val] of vars) {
      h = fnvMixStr(h, name);
      h = fnvMixStr(h, val.kind);
      if (val.kind === "constant") h = fnvMixStr(h, String(val.value));
    }
  }
  return h;
};
