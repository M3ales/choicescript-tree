import { Token } from "../token";
export interface StringLiteral extends Token {
    type: 'StringLiteral';
    value: string;
}
