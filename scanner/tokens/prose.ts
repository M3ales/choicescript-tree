import { Token } from "./token";

export interface ProseToken extends Token {
    type: 'Prose';
    content: string;
}