import { TokenType } from "./token-types";

export interface Token {
    type: TokenType,
    sceneName: string;
    lineNumber: number;
    position: number;
    indent: number;
}