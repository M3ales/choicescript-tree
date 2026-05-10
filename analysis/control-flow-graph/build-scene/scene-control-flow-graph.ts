import { Transition, CodeBlock, BlockRef } from "../data";

export interface SceneControlFlowGraph {
  sceneName: string;
  blocks: Record<string, BlockRef>;
  blockIndex: Record<string, CodeBlock>;
  edges: Transition[];
  entryBlockId: string;
  labelToBlockId: Record<string, string>;
  unresolvedEdges: Transition[];
}
