import { AbstractValue } from "./abstract-value";

export interface DataflowResult {
  resolvedEdges: ResolvedEdge[];
  unresolvedEdges: string[];
  variableSummary: Record<string, VariableSummary>;
  iterations: number;
}

export interface ResolvedEdge {
  originalEdgeId: string;
  sourceBlockId: string;
  resolvedTargets: { targetBlockId: string; value: string }[];
}

export interface VariableSummary {
  name: string;
  scope: "Global" | "Temporary";
  scene?: string;
  possibleValues: AbstractValue;
  perScene: Record<string, AbstractValue>;
}
