import { ConditionNode } from "./condition";
import { EffectNode as Effect } from "./effect";
import { ProseNode as Prose } from "./prose";

export interface ChoiceNode {
    type: "Choice";
    text: string;
    condition: ConditionNode | null;

    effects: Effect[];
    prose: Prose[];

    next: ChoiceNode[];
}