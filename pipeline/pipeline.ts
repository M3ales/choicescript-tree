import { Scene } from "../scanner/scene";
import { DiffResult, diffScenes } from "../diff";
import { CfgReconciler, ReconcilePlan } from "../analysis/ref-cfg/reconcile";
import {
  ExtractResult,
  linkInterSceneControlFlow,
  analyseLoops,
  buildGraph,
  buildGlobalSymbolTable,
  attachReachability,
  verifyNavigation,
  findUnreachableCodeFromCfgIds,
  NavigationError,
} from "../analysis/ref-cfg/api";
import { LoopAnalysis } from "../analysis/ref-cfg/loop-analysis";
import { Graph } from "../analysis/ref-cfg/cfg-graph";
import { SymbolTable } from "../analysis/ref-cfg/extract-symbols";
import { LocationIndex } from "../analysis/ref-cfg/location-index";
import { buildSegments } from "../analysis/segments/build-segments";
import { solveSegmentDataflow, SegmentDataflowResult } from "../analysis/segments/segment-dataflow";
import { SegmentGraph } from "../analysis/segments/data";
import { scan, ScanResult, ScanTiming } from "./scan";
import { parse, ParseResult, ParseTiming } from "./parse";
import { ScannerCheckpoint } from "../scanner/scanner-checkpoint";
import { SceneHashes } from "../scanner/token-hash";
import { Token } from "../scanner/tokens/token";
import { SceneAst } from "../parser/scene";

export interface PipelineResult {
  scenes: SceneAst[];
  plan: ReconcilePlan;
  extracted: ExtractResult;
  navigationErrors: NavigationError[];
  loopAnalysis: LoopAnalysis;
  cfgGraph: Graph;
  segmentGraph: SegmentGraph;
  segmentDataflow: SegmentDataflowResult;
  symbolTable: SymbolTable;
  locationIndex: LocationIndex;
  diff: DiffResult | null;
  scanResult: ScanResult;
  parseResult: ParseResult;
  timing: PipelineTiming;
}

export interface PipelineTiming {
  diff: number;
  scan: number;
  scanDetail: ScanTiming;
  parse: number;
  parseDetail: ParseTiming;
  reconcile: number;
  linkCfgs: number;
  navigation: number;
  loopAnalysis: number;
  cfgGraph: number;
  segments: number;
  segmentDataflow: number;
  symbolTable: number;
  locationIndex: number;
  segDeltaAttach: number;
  attachDataflow: number;
  reachability: number;
  branches: number;
  controlFlowVerify: number;
  setDeclVerify: number;
  unreachable: number;
  total: number;
}

export interface PipelineOptions {
  reconciler: CfgReconciler;
  previousScenes?: ReadonlyMap<string, string>;
  previousResult?: PipelineResult;
  computeConditionHints?: boolean;
  onStage?: (stage: string) => void;
}

const time = <T>(fn: () => T): [T, number] => {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
};

const yield_ = () => new Promise<void>(r => setTimeout(r, 0));

const findUnreachableCodeFromSegment = (result: ExtractResult, segDataflow: SegmentDataflowResult): void => {
  findUnreachableCodeFromCfgIds(result, segDataflow.cfgIdsWithState);
};

async function runPipelineAsync(
  rawScenes: Scene[],
  opts: PipelineOptions,
  onStage: (stage: string) => void,
): Promise<PipelineResult> {
  const totalStart = performance.now();

  onStage("diff");
  const [diff, diffT] = time(() => {
    if (!opts.previousScenes) return null;
    const current = new Map<string, string>();
    for (const s of rawScenes) current.set(s.name, s.content);
    return diffScenes(opts.previousScenes, current);
  });

  const incrementalScan = diff && opts.previousResult
    ? { diff, previous: opts.previousResult.scanResult }
    : undefined;

  onStage("scan"); await yield_();
  const [scanResult, scanT] = time(() => scan(rawScenes, incrementalScan));

  const incrementalParse = diff && opts.previousResult
    ? { diff, previousAsts: opts.previousResult.parseResult.asts }
    : undefined;

  const parserOptions = opts.computeConditionHints ? { computeConditionHints: true } : undefined;
  onStage("parse"); await yield_();
  const [parseResult, parseT] = time(() => parse(scanResult, incrementalParse, parserOptions));
  const { asts } = parseResult;

  onStage("reconcile"); await yield_();
  const [plan, reconcile] = time(() => opts.reconciler.reconcile(asts));

  onStage("cfg"); await yield_();
  const [extracted, linkCfgs] = time(() => linkInterSceneControlFlow(asts, plan));
  const [navigationErrors, navigationT] = time(() => verifyNavigation(extracted));

  onStage("loops"); await yield_();
  const [loopAnalysis, loopAnalysisT] = time(() => analyseLoops(extracted));

  onStage("graph"); await yield_();
  const [cfgGraph, cfgGraphT] = time(() => buildGraph(extracted));

  onStage("segments"); await yield_();
  const [segmentGraph, segmentsT] = time(() => buildSegments(extracted.linked, extracted.blockIndex, extracted.statements));

  onStage("segment-dataflow"); await yield_();
  const [segmentDataflow, segmentDataflowT] = time(() => solveSegmentDataflow(segmentGraph, extracted.linked, extracted.blockIndex, extracted.statements));

  onStage("symbols"); await yield_();
  const [symbolTable, symbolTableT] = time(() => buildGlobalSymbolTable(extracted, cfgGraph.order));

  onStage("index"); await yield_();
  const [, segDeltaAttachT] = time(() => {
    extracted.locationIndex.attachSegmentDeltas(
      segmentDataflow.segmentStates,
      segmentDataflow.blockDeltas,
      segmentDataflow.blockToSegment,
    );
  });
  const [, attachDfT] = time(() => {
    extracted.locationIndex.attachCfgEntryStates(segmentDataflow.cfgEntryStates);
  });
  const [, reachT] = time(() => attachReachability(extracted, cfgGraph));
  const [, branchesT] = time(() => {
    extracted.locationIndex.attachDeadBranches(segmentDataflow.deadBranches);
    extracted.locationIndex.attachTransfers(extracted.transfers);
    extracted.locationIndex.attachControlFlowViolations(segmentDataflow.controlFlowViolations);
    extracted.locationIndex.attachUndeclaredSets(segmentDataflow.undeclaredSets);
    extracted.locationIndex.attachMultiReplaceViolations(segmentDataflow.multiReplaceViolations);
  });
  const cfViolT = 0;
  const setDeclT = 0;
  const [, unreachT] = time(() => findUnreachableCodeFromSegment(extracted, segmentDataflow));
  const locationIndexT = segDeltaAttachT + attachDfT + reachT + branchesT + cfViolT + setDeclT + unreachT;

  const timing: PipelineTiming = {
    diff: diffT,
    scan: scanT,
    scanDetail: scanResult.timing,
    parse: parseT,
    parseDetail: parseResult.timing,
    reconcile,
    linkCfgs,
    navigation: navigationT,
    loopAnalysis: loopAnalysisT,
    cfgGraph: cfgGraphT,
    segments: segmentsT,
    segmentDataflow: segmentDataflowT,
    symbolTable: symbolTableT,
    locationIndex: locationIndexT,
    segDeltaAttach: segDeltaAttachT,
    attachDataflow: attachDfT,
    reachability: reachT,
    branches: branchesT,
    controlFlowVerify: cfViolT,
    setDeclVerify: setDeclT,
    unreachable: unreachT,
    total: performance.now() - totalStart,
  };

  return {
    scenes: asts,
    plan,
    extracted,
    navigationErrors,
    loopAnalysis,
    cfgGraph,
    segmentGraph,
    segmentDataflow,
    symbolTable,
    locationIndex: extracted.locationIndex,
    diff,
    scanResult,
    parseResult,
    timing,
  };
}

function runPipelineSync(
  rawScenes: Scene[],
  opts: PipelineOptions,
): PipelineResult {
  const totalStart = performance.now();

  const [diff, diffT] = time(() => {
    if (!opts.previousScenes) return null;
    const current = new Map<string, string>();
    for (const s of rawScenes) current.set(s.name, s.content);
    return diffScenes(opts.previousScenes, current);
  });

  const incrementalScan = diff && opts.previousResult
    ? { diff, previous: opts.previousResult.scanResult }
    : undefined;

  const [scanResult, scanT] = time(() => scan(rawScenes, incrementalScan));

  const incrementalParse = diff && opts.previousResult
    ? { diff, previousAsts: opts.previousResult.parseResult.asts }
    : undefined;

  const parserOptions = opts.computeConditionHints ? { computeConditionHints: true } : undefined;
  const [parseResult, parseT] = time(() => parse(scanResult, incrementalParse, parserOptions));
  const { asts } = parseResult;

  const [plan, reconcile] = time(() => opts.reconciler.reconcile(asts));
  const [extracted, linkCfgs] = time(() => linkInterSceneControlFlow(asts, plan));
  const [navigationErrors, navigationT] = time(() => verifyNavigation(extracted));

  const [loopAnalysis, loopAnalysisT] = time(() => analyseLoops(extracted));
  const [cfgGraph, cfgGraphT] = time(() => buildGraph(extracted));
  const [segmentGraph, segmentsT] = time(() => buildSegments(extracted.linked, extracted.blockIndex, extracted.statements));
  const [segmentDataflow, segmentDataflowT] = time(() => solveSegmentDataflow(segmentGraph, extracted.linked, extracted.blockIndex, extracted.statements));
  const [symbolTable, symbolTableT] = time(() => buildGlobalSymbolTable(extracted, cfgGraph.order));
  const [, segDeltaAttachT] = time(() => {
    extracted.locationIndex.attachSegmentDeltas(
      segmentDataflow.segmentStates,
      segmentDataflow.blockDeltas,
      segmentDataflow.blockToSegment,
    );
  });
  const [, attachDfT] = time(() => {
    extracted.locationIndex.attachCfgEntryStates(segmentDataflow.cfgEntryStates);
  });
  const [, reachT] = time(() => attachReachability(extracted, cfgGraph));
  const [, branchesT] = time(() => {
    extracted.locationIndex.attachDeadBranches(segmentDataflow.deadBranches);
    extracted.locationIndex.attachTransfers(extracted.transfers);
    extracted.locationIndex.attachControlFlowViolations(segmentDataflow.controlFlowViolations);
    extracted.locationIndex.attachUndeclaredSets(segmentDataflow.undeclaredSets);
    extracted.locationIndex.attachMultiReplaceViolations(segmentDataflow.multiReplaceViolations);
  });
  const cfViolT = 0;
  const setDeclT = 0;
  const [, unreachT] = time(() => findUnreachableCodeFromSegment(extracted, segmentDataflow));
  const locationIndexT = segDeltaAttachT + attachDfT + reachT + branchesT + cfViolT + setDeclT + unreachT;

  const timing: PipelineTiming = {
    diff: diffT,
    scan: scanT,
    scanDetail: scanResult.timing,
    parse: parseT,
    parseDetail: parseResult.timing,
    reconcile,
    linkCfgs,
    navigation: navigationT,
    loopAnalysis: loopAnalysisT,
    cfgGraph: cfgGraphT,
    segments: segmentsT,
    segmentDataflow: segmentDataflowT,
    symbolTable: symbolTableT,
    locationIndex: locationIndexT,
    segDeltaAttach: segDeltaAttachT,
    attachDataflow: attachDfT,
    reachability: reachT,
    branches: branchesT,
    controlFlowVerify: cfViolT,
    setDeclVerify: setDeclT,
    unreachable: unreachT,
    total: performance.now() - totalStart,
  };

  return {
    scenes: asts,
    plan,
    extracted,
    navigationErrors,
    loopAnalysis,
    cfgGraph,
    segmentGraph,
    segmentDataflow,
    symbolTable,
    locationIndex: extracted.locationIndex,
    diff,
    scanResult,
    parseResult,
    timing,
  };
}

export function runPipeline(rawScenes: Scene[], opts: PipelineOptions): PipelineResult;
export function runPipeline(rawScenes: Scene[], opts: PipelineOptions & { onStage: (stage: string) => void }): Promise<PipelineResult>;
export function runPipeline(
  rawScenes: Scene[],
  opts: PipelineOptions,
): PipelineResult | Promise<PipelineResult> {
  if (opts.onStage) {
    return runPipelineAsync(rawScenes, opts, opts.onStage);
  }
  return runPipelineSync(rawScenes, opts);
}
