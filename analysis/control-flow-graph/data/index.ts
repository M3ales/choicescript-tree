export type { BlockEntryType } from "./block-entry-type";
export type { BlockExitType } from "./block-exit-type";
export { isReturnExit } from "./block-exit-type";
export type { BlockRef } from "./block-ref";
export type { CodeBlock } from "./code-block";
export type { TransitionKind } from "./transition-kind";
export {
  isChoiceOptionEdge,
  isGoSubCall,
  isGoSubReturn,
  isInlinedGoSubCall,
  isInlinedGoSubReturn,
  isAnyGoSubCall,
  isAnyGoSubReturn,
  isConditionalBranch,
  goSubCallToInlined,
  goSubReturnToInlined,
} from "./transition-kind";
export type { TransitionMetadata } from "./transition-metadata";
export type { Transition } from "./transition";
export type { ControlFlowGraph } from "./control-flow-graph";
export type { StatementIndexEntry } from "./statement-index-entry";
