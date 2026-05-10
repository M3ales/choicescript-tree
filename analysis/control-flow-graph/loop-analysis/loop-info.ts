export interface LoopInfo {
  headerId: string;
  bodyBlockIds: string[];
  backEdges: Array<{ from: string; to: string }>;
  bounds: LoopBound[];
  tripCount: number | null;
}

export type LoopBound =
  | { type: "counter"; variable: string; step: number; exitValue: number; tripCount: number }
  | { type: "reuse"; choiceBlockId: string; optionCount: number; reuseCount: number; tripCount: number }
  | { type: "choice-exit"; choiceBlockId: string; optionCount: number; exitOptionCount: number; tripCount: number }
  | { type: "sequenced-selectable"; choiceBlockId: string; variable: string; maxValue: number; tripCount: number }
  | { type: "confirm-input"; choiceBlockId: string; tripCount: number }
  | { type: "conditional-exit"; exitEdgeCount: number; tripCount: number }
  | { type: "stats-menu"; choiceBlockId: string; optionCount: number; tripCount: number }
  | { type: "fallback"; tripCount: number }
  | { type: "unbounded" };

export interface LoopAnalysisResult {
  loops: LoopInfo[];
  loopHeaderSet: Set<string>;
  blockToLoop: Map<string, string>;
}
