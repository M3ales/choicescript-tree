import { TransitionKind } from "./transition-kind";
import { TransitionMetadata } from "./transition-metadata";

export interface Transition {
  id: string;
  kind: TransitionKind;
  sourceBlockId: string;
  targetBlockId: string | null;
  metadata: TransitionMetadata;
}
