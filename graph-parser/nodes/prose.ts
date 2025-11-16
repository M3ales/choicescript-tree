import { ProseStatement } from "../../parser/statements";
import { ConditionNode } from "./condition";

export interface ProseNode extends Node {
    type: "Prose";
    content: ProseStatement[];
    condition: ConditionNode | null;
}