import {Token} from "./token";

export interface ChoiceOptionToken extends Token {
    type: 'ChoiceOption';
    expression: Token[];
    rawText: string;
    hasMultiReplace: boolean;
}