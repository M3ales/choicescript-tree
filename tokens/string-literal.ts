import {Token} from "./token";
import {TokenParser} from "./token-parser";
import {Scene} from "./scene";

export interface StringLiteral extends Token {
    value: string;
    type: 'StringLiteral';
}
export const stringLiteralParser: TokenParser<StringLiteral> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    const startIndex = line.indexOf('"');
    const endIndex = line.replace('"', '')
                                .indexOf('"');
    return {
        token: <StringLiteral>{
            type: 'StringLiteral',
            position: index + startIndex,
            lineNumber: lineNumber,
        },
        endIndex: index + endIndex
    };
}