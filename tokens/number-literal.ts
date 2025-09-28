import {Token} from "./token";

export interface NumberLiteral extends Token {
    value: number;
    type: 'NumberLiteral';
}