import { Token } from "../token";
export interface OpenParenthesis extends Token {
    type: 'OpenParenthesis';
    value: number;
}
