import { Token } from "../token";
export interface VariableReference extends Token {
    type: 'VariableReference';
    value: string;
}
