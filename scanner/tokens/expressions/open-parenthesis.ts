import { Token } from "../token";
export interface OpenParenthesisToken extends Token {
    type: 'OpenParenthesis';
    value: number;
}
