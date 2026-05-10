import { BlockEntryType } from "./block-entry-type";
import { BlockExitType } from "./block-exit-type";

export interface CodeBlock {
  id: string;
  scene: string;
  statementIds: string[];
  entryType: BlockEntryType;
  exitType: BlockExitType;
  label?: string;
  parameterNames?: string[];
}
