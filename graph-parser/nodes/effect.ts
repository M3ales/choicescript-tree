import { Statement } from "../../parser/statements";
import { ConditionNode } from "./condition";

export interface EffectNode extends Node {
    type: "Effect";
    condition: ConditionNode | null;
    statements: Statement[];
}