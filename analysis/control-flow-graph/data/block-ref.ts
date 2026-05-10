import { BlockExitType } from "./block-exit-type";

export type ClonePurpose = "unroll" | "inline" | "flatten";

export interface ClonedFrom {
  parentId: string;
  purpose: ClonePurpose;
  parent?: ClonedFrom;
}

export interface BlockRef {
  id: string;
  sourceBlockId?: string;
  clonedFrom?: ClonedFrom;
  exitType: BlockExitType;
  loopHeaderId?: string;
  iterationHeaderId?: string;
}
