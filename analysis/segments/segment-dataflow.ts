import { LinkedCfgs } from "../ref-cfg/data";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { AbstractValue, bottom, top, join as joinAbstract, set as makeSet } from "../dataflow/abstract-value";
import {
  VariableState,
  emptyState,
  SerializedVariableState,
  setVariableMut,
} from "../dataflow/variable-state";
import { IndexedMap, IndexedTempMap } from "../dataflow/indexed-map";
import { extractEffect } from "../dataflow/extract-definitions";
import { evaluateExpression } from "../dataflow/evaluate-expression";
import { getOrSet } from "../control-flow-graph/graph-utils";
import { buildCfgLayout, walkCfgBlocks, applyBlockStatements, CfgLayout } from "../ref-cfg/dominator-walk";
import { SegmentGraph, Segment, GosubBinding, DrainTag } from "./data";
import { analyseSegmentLoops, SegmentLoopAnalysis, SegmentLoop } from "./segment-loop-analysis";
import { fnvMixInt } from "../../utils/fnv";
import {
  AnalysisCollector,
  walkCfgBlocksWithAnalysis,
  checkControlFlowViolations,
  DeadBranch,
  UndeclaredSetViolation,
  MultiReplaceViolation,
  ControlFlowViolation,
  AnalysisWalkOptions,
} from "./segment-analysis";

// ── Seed state with IndexedMap globals ────────────────────────────────────────

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

// ── Gosub param wiring ────────────────────────────────────────────────────────

const applyGosubParams = (
  state: VariableState,
  binding: GosubBinding,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): void => {
  const targetCfg = linked.cfgs[binding.targetCfgId];
  if (!targetCfg) return;

  const entryBlock = blockIndex[targetCfg.entryBlockId];
  const paramNames = entryBlock?.parameterNames;
  if (!paramNames?.length) return;

  const callerBlock = blockIndex[binding.callerBlockId];
  if (!callerBlock?.statementIds.length) return;

  const lastStmtId = callerBlock.statementIds[callerBlock.statementIds.length - 1];
  const stmt = statements[lastStmtId];
  if (!stmt || (stmt.kind !== "GoSub" && stmt.kind !== "GoSubScene")) return;

  const gosubStmt = stmt as any;
  if (!gosubStmt.args?.length) return;

  const callerCfg = linked.cfgs[binding.callerCfgId];
  const callerScene = callerCfg?.scene ?? "";
  const count = Math.min(gosubStmt.args.length, paramNames.length);
  for (let i = 0; i < count; i++) {
    const argValue = evaluateExpression(gosubStmt.args[i], state, callerScene);
    setVariableMut(state, paramNames[i], argValue, "Temporary", targetCfg.scene);
  }
};

// ── Walk with block filter (for segment subdivision of a CFG) ─────────────────

const walkSegmentBlocks = (
  layout: CfgLayout,
  state: VariableState,
  scene: string,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  allowedBlocks: Set<string>,
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
        if (allowedBlocks.has(item.blockId)) {
          onBlock?.(item.blockId);
          applyBlockStatements(item.blockId, state, scene, blockIndex, statements);
        }
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

// ── Intra-segment transfer ────────────────────────────────────────────────────

type CfgEntryCollector = Map<string, string>;

const applySegmentTransfer = (
  state: VariableState,
  segment: Segment,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  cfgLayouts: Map<string, CfgLayout>,
  globalBlockToCfg: Map<string, string>,
  cfgEntrySnap?: (cfgId: string) => void,
  onBlock?: (blockId: string) => void,
): void => {
  const visitedCfgs = new Set<string>();
  const segBlockSet = new Set(segment.blockIds);

  const cfgBlockSets = new Map<string, Set<string>>();
  for (const blockId of segment.blockIds) {
    const cfgId = globalBlockToCfg.get(blockId);
    if (cfgId) getOrSet(cfgBlockSets, cfgId, () => new Set()).add(blockId);
  }

  const owningCfg = linked.cfgs[segment.cfgId];
  if (owningCfg) {
    visitedCfgs.add(segment.cfgId);
    cfgEntrySnap?.(segment.cfgId);
    const layout = cfgLayouts.get(segment.cfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkSegmentBlocks(layout, state, owningCfg.scene, blockIndex, statements, segBlockSet, onBlock);
    }
  }

  for (const binding of segment.gosubBindings) {
    if (visitedCfgs.has(binding.targetCfgId)) continue;
    visitedCfgs.add(binding.targetCfgId);

    applyGosubParams(state, binding, linked, blockIndex, statements);

    const targetCfg = linked.cfgs[binding.targetCfgId];
    if (!targetCfg) continue;

    cfgEntrySnap?.(binding.targetCfgId);
    const layout = cfgLayouts.get(binding.targetCfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkCfgBlocks(layout, state, targetCfg.scene, blockIndex, statements, onBlock);
    }

    if (binding.continuationCfgId && !visitedCfgs.has(binding.continuationCfgId)) {
      visitedCfgs.add(binding.continuationCfgId);
      const contCfg = linked.cfgs[binding.continuationCfgId];
      if (contCfg) {
        cfgEntrySnap?.(binding.continuationCfgId);
        const contLayout = cfgLayouts.get(binding.continuationCfgId);
        if (contLayout && contLayout.walkPlan.length > 0) {
          walkCfgBlocks(contLayout, state, contCfg.scene, blockIndex, statements, onBlock);
        }
      }
    }
  }

  for (const [cfgId, blocks] of cfgBlockSets) {
    if (visitedCfgs.has(cfgId)) continue;
    visitedCfgs.add(cfgId);

    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;

    cfgEntrySnap?.(cfgId);
    const layout = cfgLayouts.get(cfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkSegmentBlocks(layout, state, cfg.scene, blockIndex, statements, blocks, onBlock);
    }
  }
};

// ── Topological segment order ─────────────────────────────────────────────────

// ── Stored state: flat arrays for fast copy/compare ──────────────────────────

interface StoredState {
  globals: AbstractValue[];
  globalsHash: number;
  temps: AbstractValue[];
  tempsHash: number;
}

const hashState = (globals: IndexedMap, temps: IndexedTempMap): number =>
  fnvMixInt(globals.xorHash, temps.xorHash);

// ── Serialization helper ─────────────────────────────────────────────────────

const serializeFromIndexed = (
  globals: IndexedMap,
  temps: IndexedTempMap,
  storedGlobals: AbstractValue[],
  storedTemps: AbstractValue[],
): SerializedVariableState => {
  const gObj: Record<string, AbstractValue> = {};
  const names = globals.names;
  for (let i = 0; i < names.length && i < storedGlobals.length; i++) {
    gObj[names[i]] = storedGlobals[i] ?? bottom;
  }
  const tObj: Record<string, Record<string, AbstractValue>> = {};
  for (const [scene, sv] of temps) {
    const sceneObj: Record<string, AbstractValue> = {};
    for (const [name, idx] of sv._indices) {
      const val = idx < storedTemps.length ? storedTemps[idx] : bottom;
      if (val && val.kind !== "bottom") sceneObj[name] = val;
    }
    if (Object.keys(sceneObj).length > 0) tObj[scene] = sceneObj;
  }
  return { globals: gObj, temps: tObj };
};

// ── Drain tag evaluation ─────────────────────────────────────────────────

const computeDrainValues = (initial: number, tags: DrainTag[]): Set<number> => {
  const drainTags = tags.filter((t): t is DrainTag & { kind: "monotone-drain" } => t.kind === "monotone-drain");
  if (drainTags.length === 0) return new Set([initial]);

  const reachable = new Set<number>();
  const queue = [initial];

  while (queue.length > 0) {
    const val = queue.pop()!;
    if (reachable.has(val)) continue;
    reachable.add(val);
    for (const tag of drainTags) {
      if (val >= tag.threshold) {
        const next = val - tag.drain;
        if (!reachable.has(next)) queue.push(next);
      }
    }
  }

  return reachable;
};

const applyDrainOverrides = (
  loop: import("./segment-loop-analysis").SegmentLoop,
  graph: SegmentGraph,
  segEntryHash: Map<string, number>,
  segExitHash: Map<string, number>,
  storedStates: Map<number, { globals: AbstractValue[]; globalsHash: number; temps: AbstractValue[]; tempsHash: number }>,
  globals: IndexedMap,
  temps: IndexedTempMap,
  snap: () => number,
  loadSnapshot: (id: number) => void,
): void => {
  const drainVars = new Set<string>();
  const boolVars = new Set<string>();
  for (const tag of loop.drainTags) {
    if (tag.kind === "monotone-drain") drainVars.add(tag.variable);
    else if (tag.kind === "boolean-flip") boolVars.add(tag.variable);
  }

  // Find external predecessors' exit states (inputs to the loop from outside)
  const members = new Set(loop.memberIds);
  const externalExitHashes: number[] = [];
  for (const edge of graph.edges) {
    if (members.has(edge.targetSegmentId) && !members.has(edge.sourceSegmentId)) {
      const h = segExitHash.get(edge.sourceSegmentId);
      if (h !== undefined) externalExitHashes.push(h);
    }
  }
  // Entry segment feeding the loop
  if (members.has(graph.entrySegmentId)) {
    // Entry segment has no predecessors — use seed
    // Its entry hash IS the seed
    const h = segEntryHash.get(graph.entrySegmentId);
    if (h !== undefined) externalExitHashes.push(h);
  }

  if (externalExitHashes.length === 0) return;

  const varOverrides = new Map<string, AbstractValue>();

  for (const varName of drainVars) {
    const idx = globals.index.get(varName);
    if (idx === undefined) continue;

    // Join all external inputs for this variable
    let joinedVal: AbstractValue = bottom;
    for (const h of externalExitHashes) {
      const state = storedStates.get(h);
      if (!state) continue;
      const val = state.globals[idx];
      if (val) joinedVal = joinAbstract(joinedVal, val);
    }

    if (joinedVal.kind === "constant" && typeof joinedVal.value === "number") {
      const reachable = computeDrainValues(joinedVal.value, loop.drainTags);
      varOverrides.set(varName, makeSet([...reachable]));
    } else if (joinedVal.kind === "set" && joinedVal.values.every(v => typeof v === "number")) {
      const allReachable = new Set<number>();
      for (const v of joinedVal.values as number[]) {
        for (const r of computeDrainValues(v, loop.drainTags)) allReachable.add(r);
      }
      varOverrides.set(varName, makeSet([...allReachable]));
    }
  }

  for (const varName of boolVars) {
    varOverrides.set(varName, makeSet([true, false]));
  }

  if (varOverrides.size === 0) return;

  const patchState = (hashMap: Map<string, number>, segId: string): void => {
    const h = hashMap.get(segId);
    if (h === undefined) return;
    loadSnapshot(h);
    for (const [varName, overrideVal] of varOverrides) {
      globals.set(varName, overrideVal);
    }
    hashMap.set(segId, snap());
  };

  for (const memberId of loop.memberIds) {
    patchState(segEntryHash, memberId);
    patchState(segExitHash, memberId);
  }
};

// ── Block delta: changed vars relative to segment entry ─────────────────────

export interface BlockDelta {
  globals: Record<string, AbstractValue>;
  temps: Record<string, Record<string, AbstractValue>>;
}

const computeBlockDelta = (
  globals: IndexedMap,
  temps: IndexedTempMap,
  refStored: StoredState,
): BlockDelta | null => {
  if (globals.xorHash === refStored.globalsHash && temps.xorHash === refStored.tempsHash) return null;
  const curGlobals = globals.values;
  const gNames = globals.names;
  let gDelta: Record<string, AbstractValue> | null = null;
  if (globals.xorHash !== refStored.globalsHash) {
    const refGlobals = refStored.globals;
    for (let i = 0; i < gNames.length; i++) {
      if (curGlobals[i] !== refGlobals[i]) {
        if (!gDelta) gDelta = {};
        gDelta[gNames[i]] = curGlobals[i];
      }
    }
  }
  let tDelta: Record<string, Record<string, AbstractValue>> | null = null;
  if (temps.xorHash !== refStored.tempsHash) {
    const curTemps = temps.values;
    const refTemps = refStored.temps;
    for (const [scene, sv] of temps) {
      for (const [name, idx] of sv._indices) {
        if (idx < curTemps.length && idx < refTemps.length && curTemps[idx] !== refTemps[idx]) {
          if (!tDelta) tDelta = {};
          if (!tDelta[scene]) tDelta[scene] = {};
          tDelta[scene][name] = curTemps[idx];
        }
      }
    }
  }
  if (!gDelta && !tDelta) return null;
  return { globals: gDelta ?? {}, temps: tDelta ?? {} };
};

// ── Main solver ───────────────────────────────────────────────────────────────

export interface SegmentDataflowTiming {
  seed: number;
  layout: number;
  solve: number;
  serialize: number;
  statsXcfg: number;
  cfgEntrySerialize: number;
  analysis: number;
  total: number;
}

export interface SegmentDataflowResult {
  segmentStates: Map<string, { entry: SerializedVariableState; exit: SerializedVariableState }>;
  cfgEntryStates: Map<string, SerializedVariableState>;
  blockDeltas: Map<string, BlockDelta>;
  blockToSegment: Map<string, string>;
  segmentLoops: SegmentLoopAnalysis;
  deadBranches: DeadBranch[];
  undeclaredSets: UndeclaredSetViolation[];
  multiReplaceViolations: MultiReplaceViolation[];
  controlFlowViolations: ControlFlowViolation[];
  cfgIdsWithState: Set<string>;
  totalIterations: number;
  widenedSccs: number;
  timing: SegmentDataflowTiming;
}

export const solveSegmentDataflow = (
  segmentGraph: SegmentGraph,
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): SegmentDataflowResult => {
  const t0 = performance.now();

  const live = buildSeedState(linked, statements);
  const globals = live.globals as unknown as IndexedMap;
  const temps = live.temps as unknown as IndexedTempMap;

  const tSeed = performance.now();

  const cfgLayouts = new Map<string, CfgLayout>();
  const globalBlockToCfg = new Map<string, string>();
  for (const [cfgId, cfg] of Object.entries(linked.cfgs)) {
    cfgLayouts.set(cfgId, buildCfgLayout(cfg));
    for (const blockId of Object.keys(cfg.blocks)) {
      globalBlockToCfg.set(blockId, cfgId);
    }
  }

  const storedStates = new Map<number, StoredState>();

  const segEntryHash = new Map<string, number>();
  const segExitHash = new Map<string, number>();

  const edgesByTarget = new Map<string, typeof segmentGraph.edges>();
  for (const edge of segmentGraph.edges) {
    getOrSet(edgesByTarget, edge.targetSegmentId, () => []).push(edge);
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
    if (s.globalsHash !== globals.xorHash) globals.joinValues(s.globals);
    if (s.tempsHash !== temps.xorHash) temps.joinValues(s.temps);
  };

  // Segment-level loop analysis (Tarjan SCC + classification)
  const tLayout = performance.now();

  const segmentLoops = analyseSegmentLoops(segmentGraph);

  // Discovery pass: populate index with all variables
  for (const segId of segmentLoops.acyclicOrder) {
    const segment = segmentGraph.segments[segId];
    if (!segment) continue;
    applySegmentTransfer(live, segment, linked, blockIndex, statements, cfgLayouts, globalBlockToCfg);
  }

  // Reset to seed values with fully-populated index
  globals.clear();
  temps.clearAllValues();
  const tempState = emptyState();
  for (const stmt of Object.values(statements)) {
    if (stmt.kind !== "DeclareVariable") continue;
    const effect = extractEffect(stmt);
    if (!effect.defines || effect.defines.scope !== "Global") continue;
    const value = effect.defines.valueExpression
      ? evaluateExpression(effect.defines.valueExpression, tempState, "")
      : { kind: "constant" as const, value: false };
    globals.set(effect.defines.variable.toLowerCase(), value);
  }
  const seedHash = snap();

  // Build top state with full index for widening
  for (let i = 0; i < globals.names.length; i++) {
    globals.set(globals.names[i], top);
  }
  for (const [, sv] of temps) {
    for (const [name] of sv._indices) {
      sv.set(name, top);
    }
  }
  const topHash = snap();
  loadSnapshot(seedHash);

  // ── Capture state: cfgEntryHashes, blockDeltas, blockToSegment ────────────
  const blockDeltas = new Map<string, BlockDelta>();
  const blockToSegment = new Map<string, string>();
  const cfgEntryHashes = new Map<string, number>();

  const cfgEntrySnapFn = (cfgId: string): void => {
    const h = snap();
    const prev = cfgEntryHashes.get(cfgId);
    if (prev === undefined) {
      cfgEntryHashes.set(cfgId, h);
    } else if (prev !== h) {
      loadSnapshot(prev);
      joinSnapshot(h);
      cfgEntryHashes.set(cfgId, snap());
      loadSnapshot(h);
    }
  };

  let captureEntryStored: StoredState;
  const blockDeltaCb = (blockId: string): void => {
    const delta = computeBlockDelta(globals, temps, captureEntryStored);
    if (delta) blockDeltas.set(blockId, delta);
  };

  // Process a single segment: load entry from predecessors, apply transfer
  const processSegment = (
    segId: string,
    cfgEntryCb?: (cfgId: string) => void,
    onBlockCb?: (blockId: string) => void,
  ): boolean => {
    const segment = segmentGraph.segments[segId];
    if (!segment) return false;

    const inEdges = edgesByTarget.get(segId) ?? [];
    let loaded = false;

    if (segId === segmentGraph.entrySegmentId) {
      loadSnapshot(seedHash);
      loaded = true;
    }

    for (const edge of inEdges) {
      const predExitId = segExitHash.get(edge.sourceSegmentId);
      if (predExitId === undefined) continue;
      if (!loaded) { loadSnapshot(predExitId); loaded = true; }
      else joinSnapshot(predExitId);
    }

    if (!loaded) return false;

    const newEntryHash = snap();
    const prevEntryHash = segEntryHash.get(segId);
    if (prevEntryHash === newEntryHash) return false;

    segEntryHash.set(segId, newEntryHash);

    applySegmentTransfer(live, segment, linked, blockIndex, statements, cfgLayouts, globalBlockToCfg, cfgEntryCb, onBlockCb);

    segExitHash.set(segId, snap());
    return true;
  };

  const captureSegment = (segId: string): void => {
    const segment = segmentGraph.segments[segId];
    if (!segment) return;
    const entryId = segEntryHash.get(segId);
    if (entryId === undefined) return;
    for (const blockId of segment.blockIds) blockToSegment.set(blockId, segId);
    captureEntryStored = storedStates.get(entryId)!;
    loadSnapshot(entryId);
    applySegmentTransfer(live, segment, linked, blockIndex, statements, cfgLayouts, globalBlockToCfg, cfgEntrySnapFn, blockDeltaCb);
  };

  let totalIterations = 0;
  let widenedSccs = 0;

  const processedLoops = new Set<SegmentLoop>();

  for (const segId of segmentLoops.acyclicOrder) {
    const loop = segmentLoops.segmentToLoop.get(segId);

    if (!loop) {
      const segment = segmentGraph.segments[segId];
      if (segment) for (const blockId of segment.blockIds) blockToSegment.set(blockId, segId);
      captureEntryStored = null as any;
      processSegment(segId, cfgEntrySnapFn, (blockId) => {
        if (!captureEntryStored) captureEntryStored = storedStates.get(segEntryHash.get(segId)!)!;
        blockDeltaCb(blockId);
      });
      totalIterations++;
      continue;
    }

    if (processedLoops.has(loop)) continue;
    processedLoops.add(loop);

    const cap = loop.iterCap;
    let sccIter = 0;
    let sccChanged = true;

    while (sccChanged && sccIter < cap) {
      sccChanged = false;
      sccIter++;
      totalIterations++;

      for (const memberId of loop.memberIds) {
        if (processSegment(memberId)) sccChanged = true;
      }
    }

    if (sccIter >= cap && sccChanged) {
      widenedSccs++;
      for (const memberId of loop.memberIds) {
        if (segExitHash.has(memberId)) segExitHash.set(memberId, topHash);
      }
    }

    if (loop.drainTags.length > 0) {
      applyDrainOverrides(loop, segmentGraph, segEntryHash, segExitHash, storedStates, globals, temps, snap, loadSnapshot);
    }

    for (const memberId of loop.memberIds) {
      captureSegment(memberId);
    }
  }

  const tSolve = performance.now();

  // ── Serialization with dedup cache ──────────────────────────────────────────
  const serializedCache = new Map<number, SerializedVariableState>();
  const getOrSerialize = (h: number): SerializedVariableState => {
    let s = serializedCache.get(h);
    if (s) return s;
    const stored = storedStates.get(h)!;
    s = serializeFromIndexed(globals, temps, stored.globals, stored.temps);
    serializedCache.set(h, s);
    return s;
  };

  const segmentStates = new Map<string, { entry: SerializedVariableState; exit: SerializedVariableState }>();
  for (const segId of Object.keys(segmentGraph.segments)) {
    const entryId = segEntryHash.get(segId);
    const exitId = segExitHash.get(segId);
    if (entryId !== undefined && exitId !== undefined) {
      segmentStates.set(segId, { entry: getOrSerialize(entryId), exit: getOrSerialize(exitId) });
    }
  }

  const tSegSerialize = performance.now();

  // ── Stats CFGs ──────────────────────────────────────────────────────────────
  if (linked.statsCfgIds.length > 0) {
    const allExitHashes = new Set(segExitHash.values());
    let loaded = false;
    for (const h of allExitHashes) {
      if (!loaded) { loadSnapshot(h); loaded = true; }
      else joinSnapshot(h);
    }
    if (loaded) {
      const statsEntryHash = snap();
      const statsSyntheticSegId = "__stats__";
      for (const statsCfgId of linked.statsCfgIds) {
        const cfg = linked.cfgs[statsCfgId];
        if (!cfg) continue;
        loadSnapshot(statsEntryHash);
        cfgEntryHashes.set(statsCfgId, statsEntryHash);
        const layout = cfgLayouts.get(statsCfgId);
        if (layout && layout.walkPlan.length > 0) {
          const statsStored = storedStates.get(statsEntryHash)!;
          walkCfgBlocks(layout, live, cfg.scene, blockIndex, statements, (blockId) => {
            blockToSegment.set(blockId, statsSyntheticSegId);
            const delta = computeBlockDelta(globals, temps, statsStored);
            if (delta) blockDeltas.set(blockId, delta);
          });
        }
        for (const exit of cfg.exits) {
          if (exit.target.type !== "cfg") continue;
          const targetCfgId = exit.target.cfgId;
          if (cfgEntryHashes.has(targetCfgId)) continue;
          const targetCfg = linked.cfgs[targetCfgId];
          if (!targetCfg || !linked.statsCfgIds.includes(targetCfgId)) continue;
          cfgEntryHashes.set(targetCfgId, snap());
        }
      }

      if (!segmentStates.has(statsSyntheticSegId)) {
        segmentStates.set(statsSyntheticSegId, {
          entry: getOrSerialize(statsEntryHash),
          exit: getOrSerialize(statsEntryHash),
        });
      }
    }
  }

  // ── Cross-CFG propagation ─────────────────────────────────────────────────
  const walkedCfgs = new Set(cfgEntryHashes.keys());
  const cfgQueue: string[] = [];
  for (const cfgId of walkedCfgs) {
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    for (const exit of cfg.exits) {
      if (exit.target.type !== "cfg" || cfgEntryHashes.has(exit.target.cfgId)) continue;
      if (!linked.cfgs[exit.target.cfgId]) continue;
      cfgQueue.push(cfgId);
      break;
    }
  }

  let cqi = 0;
  while (cqi < cfgQueue.length) {
    const cfgId = cfgQueue[cqi++];
    const cfg = linked.cfgs[cfgId]!;
    const entryHash = cfgEntryHashes.get(cfgId)!;
    loadSnapshot(entryHash);
    const eStored = storedStates.get(entryHash)!;
    const synSegId = `__xcfg_${cfgId}`;
    const layout = cfgLayouts.get(cfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkCfgBlocks(layout, live, cfg.scene, blockIndex, statements, (blockId) => {
        blockToSegment.set(blockId, synSegId);
        const delta = computeBlockDelta(globals, temps, eStored);
        if (delta) blockDeltas.set(blockId, delta);
      });
      segmentStates.set(synSegId, {
        entry: getOrSerialize(entryHash),
        exit: getOrSerialize(entryHash),
      });
    }
    for (const exit of cfg.exits) {
      if (exit.target.type !== "cfg") continue;
      const targetCfgId = exit.target.cfgId;
      if (cfgEntryHashes.has(targetCfgId)) continue;
      if (!linked.cfgs[targetCfgId]) continue;
      const h = snap();
      cfgEntryHashes.set(targetCfgId, h);
      cfgQueue.push(targetCfgId);
    }
  }

  const tReplay = performance.now();

  const cfgEntryStates = new Map<string, SerializedVariableState>();
  for (const [cfgId, h] of cfgEntryHashes) {
    cfgEntryStates.set(cfgId, getOrSerialize(h));
  }

  const tSerialize = performance.now();

  // ── Analysis pass: guard evaluation, dead branches, set decl checks ──────
  const collector = new AnalysisCollector();
  const cfgIdsWithState = new Set(cfgEntryHashes.keys());

  for (const [cfgId, entryHash] of cfgEntryHashes) {
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    const layout = cfgLayouts.get(cfgId);
    if (!layout || layout.walkPlan.length === 0) continue;

    loadSnapshot(entryHash);
    walkCfgBlocksWithAnalysis(layout, live, {
      cfgId,
      scene: cfg.scene,
      collector,
      statements,
      blockIndex,
    });
  }

  const deadBlockSet = new Set(collector.deadBranches.map(d => d.blockId));
  const controlFlowViolations = checkControlFlowViolations(linked, blockIndex, collector.icfStates, deadBlockSet);
  const undeclaredSets = collector.filterUndeclaredSets();

  const tAnalysis = performance.now();

  const timing: SegmentDataflowTiming = {
    seed: tSeed - t0,
    layout: tLayout - tSeed,
    solve: tSolve - tLayout,
    serialize: tSegSerialize - tSolve,
    statsXcfg: tReplay - tSegSerialize,
    cfgEntrySerialize: tSerialize - tReplay,
    analysis: tAnalysis - tSerialize,
    total: tAnalysis - t0,
  };

  return {
    segmentStates, cfgEntryStates, blockDeltas, blockToSegment, segmentLoops,
    deadBranches: collector.deadBranches,
    undeclaredSets,
    multiReplaceViolations: collector.multiReplaceViolations,
    controlFlowViolations,
    cfgIdsWithState,
    totalIterations, widenedSccs,
    timing,
  };
};
