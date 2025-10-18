import { Token } from "../token";
export interface NumberLiteralToken extends Token {
    type: 'NumberLiteral';
    value: number;
}
