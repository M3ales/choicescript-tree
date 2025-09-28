import {Token} from "./token";
import {TokenParser} from "./token-parser";
import {Scene} from "./scene";

export interface CreateCommand extends Token {
    type: 'CreateCommand';
    name: string;
    value: string;
}


export const createCommandParser: TokenParser<CreateCommand> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    const startIndex = line.indexOf('*create');
    const endIndex = startIndex + '*create'.length;

    let currentIndex = startIndex + '*create'.length;
    let errors = [];
    // Skip any whitespace
    while (currentIndex < line.length && line[currentIndex] === ' ') {
        currentIndex++;
    }

    // Extract name
    const nameStartIndex = currentIndex;
    while (currentIndex < line.length && line[currentIndex] !== ' ') {
        currentIndex++;
    }

    const name = line.substring(nameStartIndex, currentIndex);

    if (name.length === 0) {
        errors.push(`Invalid *create command, missing variable name`);
    }

    // Skip whitespace after the name
    while (currentIndex < line.length && line[currentIndex] === ' ') {
        currentIndex++;
    }

    const value = currentIndex < line.length ? line.substring(currentIndex).trim() : "";

    if (value.length === 0) {
        errors.push(`Invalid *create command, missing initial value`);
    }

    return {
        token: <CreateCommand>{
            type: 'CreateCommand',
            position: index,
            lineNumber: lineNumber,
            name: name,
            value: value
        },
        endIndex: endIndex
    };
}
