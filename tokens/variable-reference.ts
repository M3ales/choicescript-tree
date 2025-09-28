import {Token} from "./token";
import {TokenParser} from "./token-parser";
import {Scene} from "./scene";

export interface VariableReference extends Token {
    name: string;
    type: 'VariableReference';
}

export const variableReferenceParser: TokenParser<VariableReference> = (
    scene: Scene,
    line: string,
    token: string,
    lineNumber: number, index: number) => {
    return {
        token: <VariableReference>{
            type: 'VariableReference',
            position: index,
            lineNumber: lineNumber,
            name: token,
        },
        endIndex: index + token.length,
    };
}