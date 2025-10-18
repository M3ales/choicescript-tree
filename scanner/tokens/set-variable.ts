import { Token } from "./token";
export interface SetVariableToken extends Token {
    type: 'SetVariable';
}
