import {Token} from "./tokens/token";

export interface Scene {
    sourceUrl: string;
    name: string;
    content: string;
    error: { message: string, code: number } | undefined;
    flow: Token[];
}