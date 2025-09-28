import {Token} from "./token";
import {TokenParser} from "./token-parser";
import {Scene} from "./scene";

export interface SetCommand extends Token {
    type: 'SetCommand';
}

export const setVariableParser: TokenParser<SetCommand> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    const startIndex = line.indexOf('*set');
    const endIndex = startIndex + '*set'.length;
    return {
        token: <SetCommand>{
            type: 'SetCommand',
            position: index,
            lineNumber: lineNumber,
        },
        endIndex: endIndex
    };
}