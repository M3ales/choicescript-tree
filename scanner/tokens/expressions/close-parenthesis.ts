import { Token } from "../token";
export interface CloseParenthesis extends Token {
    type: 'CloseParenthesis';
    value: number;
}
