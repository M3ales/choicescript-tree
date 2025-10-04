import {Token} from "./token";

export interface ChoiceOption extends Token {
    type: 'ChoiceOption';
    expression: Token[];
    rawText: string;
}