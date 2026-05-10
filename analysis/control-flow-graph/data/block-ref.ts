import { BlockExitType } from "./block-exit-type";

export interface BlockRef {
  id: string;
  sourceBlockId?: string;
  unrolled?: boolean;
  inlined?: boolean;
  exitType: BlockExitType;
  loopHeaderId?: string;
  iterationHeaderId?: string;
}
