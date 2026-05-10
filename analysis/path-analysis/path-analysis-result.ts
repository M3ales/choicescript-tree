import { DivergenceRecord } from "./divergence-record";

export interface PathAnalysis {
  divergences: Record<string, DivergenceRecord>;
  splitPoints: Set<string>;
}
