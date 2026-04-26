import { ScannerContext } from "./scanner-context";
import { IdentifierToken, ProseToken, Token } from "./tokens";

export const handleImage = (context: ScannerContext): Token[] => {
    const tokens = [];
    const args = context.currentLine.replace('*image ', '').trim()
    const {path, alignment, altText} = lineToSegments(args);
    if(path) {
    context.position = context.currentLine.indexOf(path);
      tokens.push(<ProseToken>{
        type: 'Prose',
        sceneName: context.scene.name,
        position: context.position,
        lineNumber: context.lineNumber,
        indent: context.indent.current,
        content: path,
      });

      context.position += path.length + 1;
    }

    if(alignment) {
      context.position = context.currentLine.indexOf(alignment, context.position);
      tokens.push(<IdentifierToken>{
        type: 'Identifier',
        sceneName: context.scene.name,
        position: context.position,
        lineNumber: context.lineNumber,
        indent: context.indent.current,
        value: alignment,
      });
      context.position += alignment.length + 1;
    }

    if(altText && altText.length > 0) {
      context.position = context.currentLine.indexOf(altText[0], context.position);
      tokens.push(<ProseToken>{
        type: 'Prose',
        sceneName: context.scene.name,
        position: context.position,
        lineNumber: context.lineNumber,
        indent: context.indent.current,
        content: context.currentLine.substring(context.position),
      });
    }

    context.position = context.currentLine.length;
    return tokens;
}

const lineToSegments = (line: string) => {
    const segments = line.split(" ");
    if(segments.length === 1) {
      return {
        path: line
      };
    }
    if(segments.length === 2) {
    const [path, alignment] = segments;
      return {
        path,
        alignment
      }
    }
    const [path, alignment, ...altText] = segments;
    if(alignment)
    return {
        path,
        alignment,
        altText
    }
}