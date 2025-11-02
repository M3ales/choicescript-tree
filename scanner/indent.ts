export const countIndentation = (line: string): { indent: number, position: number } => {
    let indent = 0;
    let position = 0;
    for (const char of line) {
        const increment = scanIndentCharacter(char);
        if(increment === 0)
            break;
        indent += increment;
        position ++;
    }
    return { indent, position };
}

export const scanIndentCharacter = (char: string) => {
    return char === "\t" ? 1 
        : char === " "  ? 0.5 
        : 0;
}
