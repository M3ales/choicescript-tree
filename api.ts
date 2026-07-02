// Scanner
export type { Scene, Token } from "./scanner/api";
export { scanScene, scanLabelNames, flattenProse, PrefixTrie } from "./scanner/api";

// Parser
export { Parser } from "./parser/api";
export type { SceneAst, Statement, Expression, ParseError, ParseContext } from "./parser/api";

// Analysis — per-scene
export {
  buildControlFlow,
} from "./analysis/api";
export type {
  SceneControlFlowGraph,
  CodeBlock,
  Transition,
  TransitionKind,
  TransitionMetadata,
  BlockEntryType,
  BlockExitType,
} from "./analysis/api";

// Analysis — whole-game (ref-cfg)
export {
  CfgReconciler,
  linkInterSceneControlFlow,
  analyseLoops,
  buildGraph,
  buildGlobalSymbolTable,
  attachDataflow,
  getEntryBlocks,
  verifyNavigation,
  LocationIndex,
  resolveStates,
  resolveMergedEntry,
  resolveMergedExit,
  buildSegments,
  solveSegmentDataflow,
  analyseSegmentLoops,
} from "./analysis/api";
export type {
  ReconcilePlan,
  ReconcilerOptions,
  DeltaLine,
  DeltaResolution,
  ExtractResult,
  NavigationError,
  LoopAnalysis,
  Loop,
  LoopClassification,
  Graph,
  Edge,
  DataflowResult,
  State,
  StateStore,
  SymbolTable,
  VariableSummary,
  SymbolSite,
  LocationEntry,
  LocationQuery,
  LocationResult,
  SceneSymbols,
  IdentifierOccurrence,
  IdentifierRole,
  AbstractValue,
  UnreachableCode,
  UnreachableReason,
  EntryProvenance,
  SegmentDataflowResult,
  SegmentDataflowTiming,
  SegmentLoop,
  SegmentLoopAnalysis,
  SegmentLoopBound,
  Segment,
  SegmentEntry,
  SegmentExit,
  SegmentGraph,
  SegmentEdge,
  GosubBinding,
  VariableEffect,
  EffectOp,
  DrainTag,
} from "./analysis/api";

// Pipeline — composed stages
export {
  extractLabels,
  buildScanContext,
  scan as scanSingle,
  parse as parseSingle,
  buildCfg,
} from "./pipeline/api";
export type { ScanContext } from "./pipeline/api";

export { runPipeline } from "./pipeline/pipeline";
export type {
  PipelineResult,
  PipelineTiming,
  PipelineOptions,
} from "./pipeline/pipeline";
export type { ScanResult, ScanTiming, IncrementalScanInput } from "./pipeline/scan";
export type { ParseResult, ParseTiming, IncrementalParseInput } from "./pipeline/parse";
