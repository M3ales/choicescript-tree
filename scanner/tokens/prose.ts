import { Token } from "./token";

export interface Prose extends Token {
    type: 'Prose';
    content: string;
}