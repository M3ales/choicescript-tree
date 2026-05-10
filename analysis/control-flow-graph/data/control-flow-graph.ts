import { BlockRef } from "./block-ref";
import { StatementIndexEntry } from "./statement-index-entry";
import { Transition } from "./transition";

export interface ControlFlowGraph {
  blocks: Record<string, BlockRef>;
  edges: Transition[];
  statementIndex: Record<string, StatementIndexEntry>;
  entryBlockId: string;
  sceneOrder: string[];
}
