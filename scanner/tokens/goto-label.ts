import { Token } from "./token";

export interface GotoLabelToken extends Token {
    type: 'GotoLabel';
}
