import { Token } from "../token";
export interface BooleanLiteralToken extends Token {
    type: 'BooleanLiteral';
    value: boolean;
}
