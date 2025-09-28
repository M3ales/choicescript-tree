import {TokenParser} from "./token-parser";
import {Scene} from "./scene";
import {Token} from "./token";

export interface Comment extends Token {
    content: string;
    type: 'Comment';
}
export const commentParser: TokenParser<Comment> = (scene: Scene, line: string, token: string, lineNumber: number, startIndex: number) => {
    const commentContent = line.slice(startIndex + 8).trim();
    return {
        token: <Comment>{
            type: 'Comment',
            position: startIndex,
            lineNumber: lineNumber,
            content: commentContent
        },
        endIndex: undefined
    };
}