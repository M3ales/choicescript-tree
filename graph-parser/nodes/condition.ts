export interface ConditionNode extends Node {
    type: "Condition";
    expression: string;
}