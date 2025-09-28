import {Scene} from "./scene";

export type TokenParser<TToken> = (
    scene: Scene,
    line: string,
    token: string,
    lineNumber: number,
    startIndex: number) => { token: TToken, endIndex: number | undefined };
