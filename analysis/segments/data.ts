import { TransitionKind } from "../control-flow-graph/data/transition-kind";
import { TransitionMetadata } from "../control-flow-graph/data/transition-metadata";
import { Expression } from "../../parser/expressions";

export interface SegmentEntry {
  cfgId: string;
  blockId: string;
  kind: "game-start" | "choice-option" | "input-continuation";
  edgeKind?: TransitionKind;
  metadata?: TransitionMetadata;
  selectableIf?: Expression;
}

export interface SegmentExit {
  cfgId: string;
  blockId: string;
  kind: "choice" | "terminal" | "input";
}

export interface GosubBinding {
  callerCfgId: string;
  callerBlockId: string;
  targetCfgId: string;
  continuationCfgId?: string;
}

export type EffectOp =
  | { kind: "assign"; value: unknown }
  | { kind: "compound"; operator: string; operand: number | null };

export interface VariableEffect {
  variable: string;
  ops: EffectOp[];
}

export interface Segment {
  id: string;
  cfgId: string;
  entries: SegmentEntry[];
  exits: SegmentExit[];
  blockIds: string[];
  gosubBindings: GosubBinding[];
  effects: VariableEffect[];
}

export type DrainTag =
  | { kind: "boolean-flip"; variable: string; segmentId: string }
  | { kind: "monotone-drain"; variable: string; drain: number; threshold: number; segmentId: string };

export interface SegmentGraph {
  segments: Record<string, Segment>;
  edges: SegmentEdge[];
  entrySegmentId: string;
}

export interface SegmentEdge {
  sourceSegmentId: string;
  targetSegmentId: string;
  exitBlockId: string;
  entryBlockId: string;
  metadata?: TransitionMetadata;
}
