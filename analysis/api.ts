export { buildControlFlow } from "./control-flow-graph/build-scene";
export type { SceneControlFlowGraph } from "./control-flow-graph/build-scene/scene-control-flow-graph";

export type { CodeBlock } from "./control-flow-graph/data/code-block";
export type { Transition } from "./control-flow-graph/data/transition";
export type { TransitionKind } from "./control-flow-graph/data/transition-kind";
export type { TransitionMetadata } from "./control-flow-graph/data/transition-metadata";
export type { BlockEntryType } from "./control-flow-graph/data/block-entry-type";
export type { BlockExitType } from "./control-flow-graph/data/block-exit-type";

export { CfgReconciler } from "./ref-cfg/reconcile";
export type { ReconcilePlan, ReconcilerOptions, DeltaLine, DeltaResolution } from "./ref-cfg/reconcile";

export {
  linkInterSceneControlFlow,
  analyseLoops,
  buildGraph,
  analyseDataflow,
  buildGlobalSymbolTable,
  attachDataflow,
  attachReachability,
  getEntryBlocks,
  verifyNavigation,
} from "./ref-cfg/api";
export type { ExtractResult, NavigationError } from "./ref-cfg/api";

export type { LoopAnalysis, Loop, LoopClassification } from "./ref-cfg/loop-analysis";
export type { Graph, Edge } from "./ref-cfg/cfg-graph";
export type { DataflowResult, State, StateStore, EntryProvenance } from "./ref-cfg/dataflow";
export { resolveStates, resolveMergedEntry, resolveMergedExit } from "./ref-cfg/dataflow";
export type { AbstractValue } from "./dataflow/abstract-value";
export type { SymbolTable, VariableSummary, SymbolSite } from "./ref-cfg/extract-symbols";
export { LocationIndex } from "./ref-cfg/location-index";
export type { LocationEntry, LocationQuery, LocationResult, SceneSymbols, IdentifierOccurrence, IdentifierRole, UnreachableCode, UnreachableReason } from "./ref-cfg/location-index";

export { buildSegments } from "./segments/build-segments";
export { solveSegmentDataflow } from "./segments/segment-dataflow";
export type { SegmentDataflowResult, SegmentDataflowTiming, BlockDelta } from "./segments/segment-dataflow";
export { analyseSegmentLoops } from "./segments/segment-loop-analysis";
export type { SegmentLoop, SegmentLoopAnalysis, SegmentLoopBound } from "./segments/segment-loop-analysis";
export type { Segment, SegmentEntry, SegmentExit, SegmentGraph, SegmentEdge, GosubBinding, VariableEffect, EffectOp, DrainTag } from "./segments/data";
export type { DeadBranch, UndeclaredSetViolation, MultiReplaceViolation, ControlFlowViolation } from "./segments/segment-analysis";

export { computeVariableRename, computeLabelRename, computeAchievementRename } from "./refactor/rename";
export type { TextEdit, RenameKind, RenameResult } from "./refactor/rename";
