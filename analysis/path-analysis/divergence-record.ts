import { BranchRecord } from "./branch-record";

export interface DivergenceRecord {
  blockId: string;
  kind: "choice" | "conditional";
  convergeBlockId: string | null;
  isLoop: boolean;
  isSplitPoint: boolean;
  parentBlockId: string | null;
  parentBranchEntryId: string | null;
  depth: number;
  branches: BranchRecord[];
}
