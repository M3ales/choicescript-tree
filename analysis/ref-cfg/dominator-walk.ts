import { LinkedCfgs, Cfg } from "./data";
import { CfgTransfer } from "./cfg-transfer";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Transition } from "../control-flow-graph/data/transition";
import { isGoSubCall } from "../control-flow-graph/data/transition-kind";
import { Statement } from "../../parser/statements";
import { AbstractValue, top, bottom, input as inputVal, join as joinAbstract } from "../dataflow/abstract-value";
import {
  VariableState,
  emptyState,
  setVariableMut,
  updateVariableMut,
  getVariable,
  isTempVariable,
  hasGlobal,
} from "../dataflow/variable-state";
import { IndexedMap, IndexedTempMap, valueHash } from "../dataflow/indexed-map";
import { extractEffect } from "../dataflow/extract-definitions";
import { evaluateExpression } from "../dataflow/evaluate-expression";
import { ContextGraph, ContextId } from "./context-graph";
import { buildDominatorTree, getMergePoint } from "./dominators";
import { DataflowResult, State, StateStore, EntryProvenance } from "./dataflow";
import { SerializedVariableState, serializeState } from "../dataflow/variable-state";
import { fnvMixInt } from "../../utils/fnv";

// ── Walk plan: flattened branch structure per CFG ───────────────────────────

type WorkItem =
  | { kind: "block"; blockId: string }
  | { kind: "branch-start"; edge: Transition; slot: number }
  | { kind: "arm-boundary"; edge: Transition; slot: number }
  | { kind: "branch-end"; slot: number };

export interface CfgLayout {
  walkPlan: WorkItem[];
  maxSlots: number;
}

export type { WorkItem };

export const buildCfgLayout = (cfg: Cfg): CfgLayout => {
  const succs = new Map<string, Transition[]>();
  for (const id of Object.keys(cfg.blocks)) succs.set(id, []);
  for (const edge of cfg.edges) {
    if (!edge.targetBlockId || !cfg.blocks[edge.targetBlockId]) continue;
    succs.get(edge.sourceBlockId)!.push(edge);
  }

  const domTree = buildDominatorTree(cfg.entryBlockId, cfg.blocks, cfg.edges);
  const plan: WorkItem[] = [];
  let slotCounter = 0;

  interface Frame {
    blockId: string;
    phase: number;
    edges: Transition[];
    mergeBlockId: string | null;
    slot: number;
    domChildren: string[];
    armGroups: string[][];
    nonBranchChildren: string[];
  }

  const stack: Frame[] = [];

  const pushBlock = (bid: string): void => {
    const edges = succs.get(bid) ?? [];
    const isBranch = edges.length > 1;
    const mergeBlockId = isBranch ? getMergePoint(bid, domTree.ipdom) : null;
    const domChildren = domTree.children.get(bid) ?? [];

    let armGroups: string[][] = [];
    let nonBranchChildren: string[] = [];

    if (isBranch && mergeBlockId) {
      const armEntries = new Map<string, number>();
      for (let i = 0; i < edges.length; i++) {
        if (edges[i].targetBlockId && edges[i].targetBlockId !== mergeBlockId) {
          armEntries.set(edges[i].targetBlockId!, i);
        }
      }

      armGroups = edges.map(() => [] as string[]);

      for (const child of domChildren) {
        if (child === mergeBlockId) continue;
        const armIdx = armEntries.get(child);
        if (armIdx !== undefined) {
          armGroups[armIdx].push(child);
        } else {
          let assigned = false;
          for (const [entry, idx] of armEntries) {
            if (isDominatedBy(child, entry, domTree.idom)) {
              armGroups[idx].push(child);
              assigned = true;
              break;
            }
          }
          if (!assigned) nonBranchChildren.push(child);
        }
      }
    } else {
      nonBranchChildren = domChildren;
    }

    stack.push({
      blockId: bid,
      phase: 0,
      edges,
      mergeBlockId,
      slot: isBranch && mergeBlockId ? slotCounter++ : 0,
      domChildren,
      armGroups,
      nonBranchChildren,
    });
  };

  pushBlock(cfg.entryBlockId);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];

    if (frame.phase === 0) {
      plan.push({ kind: "block", blockId: frame.blockId });

      if (frame.armGroups.length > 0 && frame.mergeBlockId) {
        frame.phase = 1;
        const firstEdge = frame.edges[0];
        plan.push({ kind: "branch-start", edge: firstEdge, slot: frame.slot });
        const arm = frame.armGroups[0];
        for (let i = arm.length - 1; i >= 0; i--) pushBlock(arm[i]);
      } else {
        frame.phase = -1;
        for (let i = frame.nonBranchChildren.length - 1; i >= 0; i--) {
          pushBlock(frame.nonBranchChildren[i]);
        }
      }
      continue;
    }

    if (frame.phase > 0 && frame.phase < frame.armGroups.length) {
      const armIdx = frame.phase;
      const edge = frame.edges[armIdx] ?? frame.edges[0];
      plan.push({ kind: "arm-boundary", edge, slot: frame.slot });
      frame.phase = armIdx + 1;
      const arm = frame.armGroups[armIdx];
      for (let i = arm.length - 1; i >= 0; i--) pushBlock(arm[i]);
      continue;
    }

    if (frame.phase >= frame.armGroups.length && frame.armGroups.length > 0 && frame.mergeBlockId) {
      plan.push({ kind: "branch-end", slot: frame.slot });
      frame.phase = -1;
      if (frame.domChildren.includes(frame.mergeBlockId)) {
        pushBlock(frame.mergeBlockId);
      }
      continue;
    }

    stack.pop();
  }

  return { walkPlan: plan, maxSlots: slotCounter };
};

const isDominatedBy = (
  block: string,
  dominator: string,
  idom: Map<string, string | null>,
): boolean => {
  let current: string | null | undefined = block;
  while (current !== null && current !== undefined) {
    if (current === dominator) return true;
    current = idom.get(current) ?? null;
  }
  return false;
};

// ── Statement effect application ────────────────────────────────────────────

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
        setVariableMut(state, id.value, top, "Temporary", scene);
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

export const applyBlockStatements = (
  blockId: string,
  state: VariableState,
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

// ── CFG walk: fully iterative, array-backed branch save/restore ────────────

export const walkCfgBlocks = (
  layout: CfgLayout,
  state: VariableState,
  scene: string,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  onBlock?: (blockId: string) => void,
): void => {
  const plan = layout.walkPlan;
  if (plan.length === 0) return;

  const globals = state.globals as unknown as IndexedMap;
  const temps = state.temps as unknown as IndexedTempMap;
  const savedGlobals = new Array<AbstractValue[]>(layout.maxSlots);
  const savedGlobalHashes = new Array<number>(layout.maxSlots);
  const savedTemps = new Array<AbstractValue[]>(layout.maxSlots);
  const savedTempHashes = new Array<number>(layout.maxSlots);
  const joinedGlobals = new Array<AbstractValue[] | null>(layout.maxSlots);
  const joinedTemps = new Array<AbstractValue[] | null>(layout.maxSlots);

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];

    switch (item.kind) {
      case "block":
        onBlock?.(item.blockId);
        applyBlockStatements(item.blockId, state, scene, blockIndex, statements);
        break;

      case "branch-start":
        savedGlobalHashes[item.slot] = globals.xorHash;
        savedGlobals[item.slot] = globals.shareValues();
        savedTempHashes[item.slot] = temps.xorHash;
        savedTemps[item.slot] = temps.shareValues();
        joinedGlobals[item.slot] = null;
        joinedTemps[item.slot] = null;
        break;

      case "arm-boundary": {
        const slot = item.slot;
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
        globals.adoptValues(savedGlobals[slot], savedGlobalHashes[slot]);
        temps.adoptValues(savedTemps[slot], savedTempHashes[slot]);
        break;
      }

      case "branch-end": {
        const slot = item.slot;
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
        globals.takeValues(joinedGlobals[slot]!);
        temps.takeValues(joinedTemps[slot]!);
        savedGlobals[slot] = null as any;
        savedTemps[slot] = null as any;
        joinedGlobals[slot] = null;
        joinedTemps[slot] = null;
        break;
      }
    }
  }
};

// ── Seed state with IndexedMap globals ─────────────────────────────────────

const buildSeedState = (
  linked: LinkedCfgs,
  statements: Record<string, Statement>,
): VariableState => {
  const tempState = emptyState();

  for (const cfg of Object.values(linked.cfgs)) {
    if (!tempState.temps.has(cfg.scene)) {
      tempState.temps.set(cfg.scene, new Map());
    }
  }

  for (const stmt of Object.values(statements)) {
    if (stmt.kind !== "DeclareVariable") continue;
    const effect = extractEffect(stmt);
    if (!effect.defines || effect.defines.scope !== "Global") continue;
    const value = effect.defines.valueExpression
      ? evaluateExpression(effect.defines.valueExpression, tempState, "")
      : { kind: "constant" as const, value: false };
    tempState.globals.set(effect.defines.variable.toLowerCase(), value);
  }

  const globalIndex = new Map<string, number>();
  const globalNames: string[] = [];
  for (const [name] of tempState.globals) {
    globalIndex.set(name, globalNames.length);
    globalNames.push(name);
  }

  const indexedGlobals = new IndexedMap(globalIndex, globalNames);
  for (const [name, value] of tempState.globals) {
    indexedGlobals.set(name, value);
  }

  const indexedTemps = new IndexedTempMap();
  for (const [scene] of tempState.temps) {
    indexedTemps.addScene(scene);
  }

  return {
    parent: null,
    globals: indexedGlobals as any,
    temps: indexedTemps as any,
  };
};

// ── Stored state: flat arrays for fast copy/load ───────────────────────────

interface StoredState {
  globals: AbstractValue[];
  globalsHash: number;
  temps: AbstractValue[];
  tempsHash: number;
}

// ── State hashing ───────────────────────────────────────────────────────────

const hashState = (globals: IndexedMap, temps: IndexedTempMap): number => {
  return fnvMixInt(globals.xorHash, temps.xorHash);
};

// ── GoSub param mapping ─────────────────────────────────────────────────────

const mapGosubParams = (
  live: VariableState,
  nodeId: ContextId,
  cfg: Cfg,
  graph: ContextGraph,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): boolean => {
  const entryBlock = blockIndex[cfg.entryBlockId];
  const paramNames = entryBlock?.parameterNames;
  if (!paramNames?.length) return false;

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
      return true;
    }
  }
  return false;
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

// ── Chain detection for collapsing linear context sequences ────────────────

interface Chain {
  nodes: ContextId[];
}

const buildChains = (graph: ContextGraph): Chain[] => {
  const chains: Chain[] = [];
  const visited = new Set<ContextId>();

  for (const nodeId of graph.order) {
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const chain: ContextId[] = [nodeId];
    let current = nodeId;
    while (true) {
      const succs = graph.successors(current);
      if (succs.length !== 1) break;
      const next = succs[0].to;
      if (visited.has(next)) break;
      const nextPreds = graph.predecessors(next);
      if (nextPreds.length !== 1) break;
      visited.add(next);
      chain.push(next);
      current = next;
    }
    chains.push({ nodes: chain });
  }
  return chains;
};

// ── Serialization helpers ──────────────────────────────────────────────────

const serializeStoredState = (
  stored: StoredState,
  globals: IndexedMap,
  temps: IndexedTempMap,
): SerializedVariableState => {
  const gObj: Record<string, AbstractValue> = {};
  const names = globals.names;
  for (let i = 0; i < stored.globals.length; i++) {
    gObj[names[i]] = stored.globals[i];
  }
  const tObj: Record<string, Record<string, AbstractValue>> = {};
  for (const [scene, sv] of temps) {
    const sceneObj: Record<string, AbstractValue> = {};
    for (const [name, idx] of sv._indices) {
      const val = stored.temps[idx];
      if (val && val.kind !== "bottom") sceneObj[name] = val;
    }
    if (Object.keys(sceneObj).length > 0) tObj[scene] = sceneObj;
  }
  return { globals: gObj, temps: tObj };
};

// ── Main solver ─────────────────────────────────────────────────────────────

export const solveDominatorDataflow = (
  graph: ContextGraph,
  linked: LinkedCfgs,
  _transfers: Map<string, CfgTransfer>,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): DataflowResult => {
  const live = buildSeedState(linked, statements);
  const globals = live.globals as unknown as IndexedMap;
  const temps = live.temps as unknown as IndexedTempMap;
  const storedStates = new Map<number, StoredState>();
  const perCfgEntryIds = new Map<string, Set<number>>();
  const perCfgExitIds = new Map<string, Set<number>>();
  const perCfgProvenance = new Map<string, Map<number, EntryProvenance[]>>();
  const nodeExitIds = new Map<ContextId, number>();

  const cfgLayouts = new Map<string, CfgLayout>();
  for (const cfgId of Object.keys(linked.cfgs)) {
    cfgLayouts.set(cfgId, buildCfgLayout(linked.cfgs[cfgId]));
  }

  const snap = (): number => {
    const h = hashState(globals, temps);
    if (!storedStates.has(h)) {
      storedStates.set(h, {
        globals: globals.shareValues(),
        globalsHash: globals.xorHash,
        temps: temps.shareValues(),
        tempsHash: temps.xorHash,
      });
    }
    return h;
  };

  const loadSnapshot = (id: number): void => {
    const s = storedStates.get(id)!;
    globals.adoptValues(s.globals, s.globalsHash);
    temps.adoptValues(s.temps, s.tempsHash);
  };

  const joinSnapshot = (id: number): void => {
    const s = storedStates.get(id)!;
    if (s.globalsHash === globals.xorHash && s.tempsHash === temps.xorHash) return;
    if (s.globalsHash !== globals.xorHash) globals.joinValues(s.globals);
    if (s.tempsHash !== temps.xorHash) temps.joinValues(s.temps);
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

  const processNode = (nodeId: ContextId): void => {
    const node = graph.nodes.get(nodeId)!;
    const cfg = linked.cfgs[node.cfgId];
    if (!cfg) return;

    const hasParams = mapGosubParams(live, node.id, cfg, graph, linked, blockIndex, statements);

    const preds = graph.predecessors(nodeId);
    const singlePredExitId = (preds.length === 1 && !hasParams)
      ? nodeExitIds.get(preds[0].from)
      : undefined;
    const entryId = singlePredExitId !== undefined ? singlePredExitId : snap();

    const layout = cfgLayouts.get(node.cfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkCfgBlocks(layout, live, cfg.scene, blockIndex, statements);
    }

    const exitId = snap();
    nodeExitIds.set(nodeId, exitId);
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
  };

  const chains = buildChains(graph);
  for (const chain of chains) {
    const headId = chain.nodes[0];
    const headPreds = graph.predecessors(headId);
    if (headPreds.length > 0) {
      let loaded = false;
      for (const pred of headPreds) {
        const predExitId = nodeExitIds.get(pred.from);
        if (predExitId === undefined) continue;
        if (!loaded) { loadSnapshot(predExitId); loaded = true; }
        else joinSnapshot(predExitId);
      }
    }

    for (const nodeId of chain.nodes) {
      processNode(nodeId);
    }
  }
  // Stats scenes — join unique exit states only (75k nodes → 2-3k unique)
  if (linked.statsCfgIds.length > 0) {
    const uniqueExitIds = new Set(nodeExitIds.values());
    const exitIdArr = [...uniqueExitIds];
    const firstState = storedStates.get(exitIdArr[0])!;
    const gLen = firstState.globals.length;
    const tLen = firstState.temps.length;
    const mergedGlobals = firstState.globals.slice();
    const mergedTemps = firstState.temps.slice();
    for (let si = 1; si < exitIdArr.length; si++) {
      const s = storedStates.get(exitIdArr[si])!;
      for (let i = 0; i < gLen; i++) {
        const cur = mergedGlobals[i];
        if (cur === s.globals[i] || cur.kind === "top") continue;
        mergedGlobals[i] = joinAbstract(cur, s.globals[i]);
      }
      const sLen = Math.min(tLen, s.temps.length);
      for (let i = 0; i < sLen; i++) {
        const cur = mergedTemps[i];
        if (cur === s.temps[i] || cur.kind === "top") continue;
        mergedTemps[i] = joinAbstract(cur, s.temps[i]);
      }
    }
    globals.takeValues(mergedGlobals);
    temps.takeValues(mergedTemps);

    for (const statsCfgId of linked.statsCfgIds) {
      const cfg = linked.cfgs[statsCfgId];
      if (!cfg) continue;

      const entryId = snap();
      const layout = cfgLayouts.get(statsCfgId);
      if (layout && layout.walkPlan.length > 0) {
        walkCfgBlocks(layout, live, cfg.scene, blockIndex, statements);
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

  const stateStore: StateStore = new Map();
  for (const [id, s] of storedStates) {
    stateStore.set(id, serializeStoredState(s, globals, temps));
  }

  return { cfgStates, stateStore, diagnostics: graph.diagnostics };
};
