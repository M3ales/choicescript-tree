import { Token } from "../token";
export interface NumberLiteral extends Token {
    type: 'NumberLiteral';
    value: number;
}
