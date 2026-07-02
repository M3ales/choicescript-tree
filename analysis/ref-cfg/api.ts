import { SceneAst } from "../../parser/scene";
import { LinkedCfgs } from "./data";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { CfgTransfer } from "./cfg-transfer";
import { CfgScope } from "./scope-types";
import { linkCfgs } from "./link-cfgs";
import { getOrSet } from "../control-flow-graph/graph-utils";
import { LoopAnalysis, analyseCfgLoops, refineTripCounts } from "./loop-analysis";

import { Graph, buildCfgGraph } from "./cfg-graph";
import { DataflowResult } from "./dataflow";
import { solveDominatorDataflow } from "./dominator-walk";
import { ContextGraph, ContextGraphOptions, buildContextGraph } from "./context-graph";
import { SymbolTable, extractSymbols } from "./extract-symbols";
import { LocationIndex } from "./location-index";
import { ReconcilePlan } from "./reconcile";
import { checkNavigation as _checkNavigation, NavigationError } from "./passes/navigation-pass";

import { SceneControlFlowGraph } from "../control-flow-graph/build-scene/scene-control-flow-graph";
import { findEntryPoints as _findEntryPoints } from "./extract-cfgs";

export { extractOneCfg, findEntryPoints, makeCfgId } from "./extract-cfgs";
export type { ExtractedCfg, SceneEntryPoints } from "./extract-cfgs";
export type { NavigationError } from "./passes/navigation-pass";
export { buildContextGraph } from "./context-graph";
export type { ContextGraph, ContextGraphOptions, ContextNode, ContextEdge, ContextId, ContextGraphDiagnostics } from "./context-graph";

export const getEntryBlocks = (sceneCfg: SceneControlFlowGraph): Set<string> =>
  _findEntryPoints(sceneCfg).entryBlockIds;

export interface ExtractResult {
  linked: LinkedCfgs;
  transfers: Map<string, CfgTransfer>;
  scopes: Map<string, CfgScope>;
  blockIndex: Record<string, CodeBlock>;
  statements: Record<string, Statement>;
  sceneCfgs: Map<string, SceneControlFlowGraph>;
  blockToCfg: Map<string, string>;
  cfgSuccessors: Map<string, Set<string>>;
  locationIndex: LocationIndex;
}

export const linkInterSceneControlFlow = (
  scenes: SceneAst[],
  plan: ReconcilePlan,
): ExtractResult => {
  const linked = linkCfgs(scenes, plan.cfgs, plan.sceneCfgs);

  const blockToCfg = new Map<string, string>();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      blockToCfg.set(blockId, cfg.id);
    }
  }

  const cfgSuccessors = new Map<string, Set<string>>();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type === "cfg") {
        getOrSet(cfgSuccessors, cfg.id, () => new Set()).add(exit.target.cfgId);
      }
      if (exit.continuation) {
        const contCfgId = linked.cfgs[exit.continuation]
          ? exit.continuation
          : blockToCfg.get(exit.continuation);
        if (contCfgId) {
          getOrSet(cfgSuccessors, cfg.id, () => new Set()).add(contCfgId);
        }
      }
    }
  }

  const locationIndex = new LocationIndex(plan.blockIndex, plan.statements, blockToCfg);

  return {
    linked,
    transfers: plan.transfers,
    scopes: plan.scopes,
    blockIndex: plan.blockIndex,
    statements: plan.statements,
    sceneCfgs: plan.sceneCfgs,
    blockToCfg,
    cfgSuccessors,
    locationIndex,
  };
};

export const verifyNavigation = (
  result: ExtractResult,
): NavigationError[] =>
  _checkNavigation(result.linked, result.sceneCfgs, result.blockIndex, result.statements);

export const analyseLoops = (
  result: ExtractResult,
): LoopAnalysis =>
  analyseCfgLoops(result.linked, result.transfers, result.blockToCfg, result.cfgSuccessors, result.blockIndex, result.statements);

export const buildGraph = (
  result: ExtractResult,
): Graph =>
  buildCfgGraph(result.linked, result.blockToCfg);

export const buildContextGraphFromResult = (
  result: ExtractResult,
  loopAnalysis: LoopAnalysis,
  options?: ContextGraphOptions,
): ContextGraph =>
  buildContextGraph(result.linked, loopAnalysis, result.blockToCfg, options);

export const analyseDataflow = (
  result: ExtractResult,
  loopAnalysis: LoopAnalysis,
  options?: ContextGraphOptions,
): DataflowResult => {
  const MAX_REFINE_PASSES = 10;
  let dataflow: DataflowResult;

  for (let pass = 0; pass < MAX_REFINE_PASSES; pass++) {
    const graph = buildContextGraph(result.linked, loopAnalysis, result.blockToCfg, options);
    dataflow = solveDominatorDataflow(graph, result.linked, result.transfers, result.blockIndex, result.statements);
    const changed = refineTripCounts(loopAnalysis, dataflow, result.linked, result.statements);
    if (!changed) break;
  }

  return dataflow!;
};

export const buildGlobalSymbolTable = (
  result: ExtractResult,
  cfgOrder: string[],
): SymbolTable =>
  extractSymbols(result.linked, cfgOrder, result.blockIndex, result.statements);

export const attachDataflow = (
  result: ExtractResult,
  dataflow: DataflowResult,
): void => {
  result.locationIndex.attachDataflow(dataflow.cfgStates, dataflow.stateStore);
};

export const attachReachability = (
  result: ExtractResult,
  graph: Graph,
): void => {
  const reachable = new Set<string>();
  const queue = [result.linked.entryCfgId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const succ of graph.successors.get(id) ?? []) {
      queue.push(succ);
    }
  }
  result.locationIndex.attachReachability(reachable);
};

import {
  analyseBranchReachability as _analyseBranchReachability,
  BranchReachabilityPass,
  BlockStateCollector,
  DeadBranch,
  BlockState,
} from "./passes/branch-reachability";

import {
  verifyControlFlow as _verifyControlFlow,
  VerifyControlFlowPass,
  postProcessControlFlow,
  ControlFlowViolation,
} from "./passes/verify-control-flow";

import {
  verifySetDeclarations as _verifySetDeclarations,
  VerifySetDeclarationsPass,
  UndeclaredSetViolation,
} from "./passes/verify-set-declarations";

import { runDataflowVisitors, DataflowWalkInput } from "./passes/dataflow-visitor";

export { analyseBranchReachability } from "./passes/branch-reachability";
export type { DeadBranch, BlockState } from "./passes/branch-reachability";

export type { ControlFlowViolation, ControlFlowViolationKind } from "./passes/verify-control-flow";
export type { UndeclaredSetViolation, UndeclaredViolationKind } from "./passes/verify-set-declarations";

export const analyseBranches = (
  result: ExtractResult,
  dataflow: DataflowResult,
): { deadBranches: DeadBranch[]; blockStates: BlockState[] } => {
  const cfgScenes = new Map<string, string>();
  for (const cfg of Object.values(result.linked.cfgs)) {
    cfgScenes.set(cfg.id, cfg.scene);
  }
  return _analyseBranchReachability(
    result.transfers, dataflow.cfgStates, dataflow.stateStore,
    result.blockIndex, result.statements, cfgScenes,
  );
};

export const verifyControlFlowFromResult = (
  result: ExtractResult,
  dataflow: DataflowResult,
): ControlFlowViolation[] =>
  _verifyControlFlow(
    result.linked, result.transfers, dataflow.cfgStates, dataflow.stateStore,
    result.blockIndex, result.statements,
  );

export const verifySetDeclarationsFromResult = (
  result: ExtractResult,
  dataflow: DataflowResult,
): UndeclaredSetViolation[] => {
  const cfgScenes = new Map<string, string>();
  for (const cfg of Object.values(result.linked.cfgs)) {
    cfgScenes.set(cfg.id, cfg.scene);
  }
  return _verifySetDeclarations(
    result.transfers, dataflow.cfgStates, dataflow.stateStore,
    result.blockIndex, result.statements, cfgScenes,
  );
};

export const runAllPasses = (
  result: ExtractResult,
  dataflow: DataflowResult,
): {
  deadBranches: DeadBranch[];
  blockStates: BlockState[];
  cfViolations: ControlFlowViolation[];
  undeclaredSets: UndeclaredSetViolation[];
} => {
  const cfgScenes = new Map<string, string>();
  for (const cfg of Object.values(result.linked.cfgs)) {
    cfgScenes.set(cfg.id, cfg.scene);
  }

  const input: DataflowWalkInput = {
    transfers: result.transfers,
    dataflowStates: dataflow.cfgStates,
    stateStore: dataflow.stateStore,
    blockIndex: result.blockIndex,
    statements: result.statements,
    cfgScenes,
  };

  const [deadBranches, blockStates, cfBlockStates, undeclaredSets] =
    runDataflowVisitors<[DeadBranch[], BlockState[], Map<string, import("../dataflow/variable-state").VariableState>, UndeclaredSetViolation[]]>(
      input,
      [
        new BranchReachabilityPass(),
        new BlockStateCollector(),
        new VerifyControlFlowPass(),
        new VerifySetDeclarationsPass(result.statements),
      ],
    );

  const cfViolations = postProcessControlFlow(
    result.linked, cfBlockStates, dataflow.cfgStates, dataflow.stateStore, result.blockIndex,
  );

  return { deadBranches, blockStates, cfViolations, undeclaredSets };
};

export type { UnreachableCode, UnreachableReason } from "./location-index";

export const findUnreachableCode = (
  result: ExtractResult,
  dataflow: DataflowResult,
): void => {
  findUnreachableCodeFromCfgIds(result, new Set(dataflow.cfgStates.map(s => s.cfgId)));
};

export const findUnreachableCodeFromCfgIds = (
  result: ExtractResult,
  hasState: Set<string>,
): void => {
  const statsCfgIds = new Set(result.linked.statsCfgIds);
  const items: import("./location-index").UnreachableCode[] = [];

  for (const cfg of Object.values(result.linked.cfgs)) {
    if (hasState.has(cfg.id)) continue;
    if (statsCfgIds.has(cfg.id)) continue;

    const block = result.blockIndex[cfg.entryBlockId];
    if (!block?.statementIds.length) continue;

    const firstStmtId = block.statementIds[0];
    const stmt = result.statements[firstStmtId];
    if (!stmt) continue;

    const token = (stmt as any).token;
    if (!token) continue;

    const parts = cfg.id.split(":");
    const label = parts[1] ?? "";

    let reason: import("./location-index").UnreachableReason;
    if (label === "") {
      reason = "dead-scene";
    } else if (label.includes("__cont_")) {
      reason = "dead-continuation";
    } else {
      reason = "dead-label";
    }

    items.push({
      scene: cfg.scene,
      line: token.lineNumber,
      position: token.position ?? 0,
      cfgId: cfg.id,
      label,
      reason,
    });
  }

  result.locationIndex.attachUnreachableCode(items);
};

export type { DeltaLine, DeltaResolution } from "./reconcile";
