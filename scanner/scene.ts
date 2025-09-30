import {Token} from "./tokens/token";

export interface Scene {
    sourceUrl: string;
    name: string;
    content: string;

    flow: Token[];
}