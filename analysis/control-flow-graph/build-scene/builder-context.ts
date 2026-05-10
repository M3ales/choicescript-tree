import { CodeBlock, Transition } from "../data";

export interface BuilderContext {
  sceneName: string;
  blocks: Record<string, CodeBlock>;
  edges: Transition[];
  pendingTransitions: { edgeId: string; label: string }[];
  nextBlockNum: number;
  nextEdgeNum: number;
  labelToBlockId: Record<string, string>;
  currentReuseMode: 'hide_reuse' | 'disable_reuse' | null;
}
