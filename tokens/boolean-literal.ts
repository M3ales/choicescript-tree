import {Token} from "./token";

export interface BooleanLiteral extends Token {
    value: boolean;
    type: 'BooleanLiteral';
}