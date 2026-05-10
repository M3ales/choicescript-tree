import { TransitionKind } from "../control-flow-graph/data";

export interface BranchRecord {
  edgeKind: TransitionKind;
  entryBlockId: string;
  conditionStatementId?: string;
  optionStatementId?: string;
  choiceConditionId?: string;
  embeddedChoices: string[];
  terminates: boolean;
  nested: string[];
  distToConvergence: number;
  reachableChoices: number;
  isLoopBack: boolean;
}
