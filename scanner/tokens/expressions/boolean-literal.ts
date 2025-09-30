import { Token } from "../token";
export interface BooleanLiteral extends Token {
    type: 'BooleanLiteral';
    value: boolean;
}
