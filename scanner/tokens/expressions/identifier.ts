import { Token } from "../token";
export interface IdentifierToken extends Token {
    type: 'Identifier';
    value: string;
}
