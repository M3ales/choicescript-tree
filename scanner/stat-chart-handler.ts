import { countIndentation } from "./indent";
import { ScannerContext } from "./scanner-context"
import { IdentifierToken, ProseToken, Token } from "./tokens"

export const handleStatChart = (context: ScannerContext): Token[] => {
    let startingIndent = context.indent.current;
    const tokens = [];
    const here = () => ({
        sceneName: context.scene.name,
        lineNumber: context.lineNumber,
        position: context.position,
        indent: context.indent.current,
    });
    while(true) {
        const countIndent = countIndentation(context.sceneLines[context.lineNumber + 1]);
        if(countIndent.indent <= startingIndent) {
            context.position = context.sceneLines[context.lineNumber].length;
            break;
        }
        context.lineNumber++;

        context.currentLine = context.sceneLines[context.lineNumber];
        context.indent.previous = context.indent.current;
        context.indent.current = countIndent.indent;
        context.position = countIndent.position;

        const trimmedLine = context.currentLine.trim();
        if(trimmedLine.length > 0) {
            const { type, identifier, displayName } = lineToSegments(trimmedLine);
            tokens.push(<IdentifierToken>{
                type: "Identifier",
                value: type,
                rawValue: type,
                ...here(),
            });
            context.position += type.length + 1;
            switch(type) {
                case 'text': {
                    tokens.push(<IdentifierToken>{
                        type: "Identifier",
                        value: identifier.toLowerCase(),
                        rawValue: identifier,
                        ...here(),
                    });
                    context.position += identifier.length + 1;
                    if(displayName !== undefined) {
                        tokens.push(<ProseToken>{
                            type: "Prose",
                            content: displayName.join(" "),
                            ...here(),
                        });
                        context.position += displayName.join(" ").length + 1;
                    }
                    break;
                }
                case 'opposed_pair': {
                    tokens.push(<IdentifierToken>{
                        type: "Identifier",
                        value: identifier.toLowerCase(),
                        rawValue: identifier,
                        ...here(),
                    });
                    context.position += identifier.length + 1;
                    if(displayName !== undefined && displayName.length > 0) {
                        tokens.push(<ProseToken>{
                            type: "Prose",
                            content: displayName.join(" "),
                            ...here(),
                        });
                        context.position += displayName.join(" ").length + 1;
                    }
                    let linesToAdd = 0;
                    const nextLine = context.sceneLines[context.lineNumber+1];
                    const nextLineIndent = countIndentation(nextLine);
                    if(nextLineIndent.indent > context.indent.current) {
                        tokens.push(<ProseToken>{
                            type: "Prose",
                            content: nextLine.trim(),
                            sceneName: context.scene.name,
                            lineNumber: context.lineNumber + 1,
                            position: nextLineIndent.position + 1,
                            indent: nextLineIndent.indent,
                        });
                        linesToAdd++;
                    }
                    const following = context.sceneLines[context.lineNumber + 2];
                    const followingLine = countIndentation(following);
                    if(followingLine.indent > context.indent.current) {
                        tokens.push(<ProseToken>{
                            type: "Prose",
                            content: following.trim(),
                            sceneName: context.scene.name,
                            lineNumber: context.lineNumber + 2,
                            position: followingLine.position + 1,
                            indent: followingLine.indent,
                        });
                        linesToAdd++;
                    }

                    context.lineNumber += linesToAdd;
                    context.position = 0;
                    break;
                }
                case 'percent': {
                    tokens.push(<IdentifierToken>{
                        type: "Identifier",
                        value: identifier.toLowerCase(),
                        rawValue: identifier,
                        ...here(),
                    });
                    if(displayName !== undefined) {
                        tokens.push(<ProseToken>{
                            type: "Prose",
                            content: displayName.join(" "),
                            ...here(),
                        });
                    }
                    break;
                }
            }
        }
    }

    return tokens;
}

const lineToSegments = (line: string) => {
    const segments = line.split(" ");
    const [type, identifier, ...displayName] = segments;
    return {
        type,
        identifier,
        displayName
    }
}
