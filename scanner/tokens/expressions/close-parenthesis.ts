import { Token } from "../token";
export interface CloseParenthesisToken extends Token {
    type: 'CloseParenthesis';
    value: number;
}
