import { countIndentation } from "./indent";
import { ScannerContext } from "./scanner-context";
import { IdentifierToken, Token } from "./tokens";

export const handleSceneList = (context: ScannerContext): Token[] => {
    let startingIndent = context.indent.current;
    const tokens = [];
    while(true) {
        context.lineNumber++;
        const countIndent = countIndentation(context.sceneLines[context.lineNumber]);
        if(countIndent.indent <= startingIndent) {
            context.lineNumber--;
            context.position = context.sceneLines[context.lineNumber].length;
            break;
        }
        context.currentLine = context.sceneLines[context.lineNumber];
        context.indent.previous = context.indent.current;
        context.indent.current = countIndent.indent;
        context.position = countIndent.position;

        const trimmedLine = context.currentLine.trim();
        if(trimmedLine.length > 0) {
            const sceneName = trimmedLine;
            const token: IdentifierToken = {
                type: "Identifier",
                value: sceneName,
                sceneName: context.scene.name,
                lineNumber: context.lineNumber + 1,
                position: context.position,
                indent: context.indent.current,
            };
            tokens.push(token);
        }
    }

    return tokens;
}