import { Token } from "../token";
export interface StringLiteralToken extends Token {
    type: 'StringLiteral';
    value: string;
}
