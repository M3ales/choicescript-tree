import { tokenizeExpressionString } from "./expression-handler";
import {
    CloseBraceToken,
    MultiReplaceElseToken,
    OpenMultiReplaceToken,
    ProseToken,
    Token,
} from "./tokens";
import { OpenPrintToken } from "./tokens/expressions/open-print";
import { OpenPrintCapitaliseAllToken } from "./tokens/expressions/open-print-caps-all";
import { OpenPrintCapitaliseFirstToken } from "./tokens/expressions/open-print-caps-first";

interface FlattenContext {
    sceneName: string;
    lineNumber: number;
    position: number;
    indent: number;
    knownLabels: string[];
    sceneNames: string[];
}

interface OpenerMatch {
    kind: "Print" | "PrintCapitaliseFirst" | "PrintCapitaliseAll" | "MultiReplace";
    length: number;
}

const matchOpener = (content: string, cursor: number): OpenerMatch | undefined => {
    const c = content[cursor];
    if (c === "@" && content[cursor + 1] === "{") {
        return { kind: "MultiReplace", length: 2 };
    }
    if (c === "$") {
        if (
            content[cursor + 1] === "!" &&
            content[cursor + 2] === "!" &&
            content[cursor + 3] === "{"
        ) {
            return { kind: "PrintCapitaliseAll", length: 4 };
        }
        if (content[cursor + 1] === "!" && content[cursor + 2] === "{") {
            return { kind: "PrintCapitaliseFirst", length: 3 };
        }
        if (content[cursor + 1] === "{") {
            return { kind: "Print", length: 2 };
        }
    }
    return undefined;
};

const positionAt = (
    content: string,
    offset: number,
    base: FlattenContext,
): { lineNumber: number; position: number } => {
    let line = base.lineNumber;
    let col = base.position;
    for (let i = 0; i < offset && i < content.length; i++) {
        if (content[i] === "\n") {
            line++;
            col = 0;
        } else {
            col++;
        }
    }
    return { lineNumber: line, position: col };
};

const findMatchingBrace = (content: string, openCursor: number): number => {
    let depth = 1;
    let i = openCursor;
    while (i < content.length) {
        const c = content[i];
        if (c === "{") {
            depth++;
        } else if (c === "}") {
            depth--;
            if (depth === 0) return i;
        } else if (c === '"') {
            i++;
            while (i < content.length && content[i] !== '"') {
                if (content[i] === "\\" && i + 1 < content.length) i++;
                i++;
            }
        }
        i++;
    }
    return -1;
};

const emitText = (
    out: Token[],
    content: string,
    start: number,
    end: number,
    base: FlattenContext,
): void => {
    if (end <= start) return;
    const pos = positionAt(content, start, base);
    out.push(<ProseToken>{
        type: "Prose",
        sceneName: base.sceneName,
        lineNumber: pos.lineNumber,
        position: pos.position,
        indent: base.indent,
        content: content.substring(start, end),
    });
};

const emitRange = (
    out: Token[],
    content: string,
    rangeStart: number,
    rangeEnd: number,
    base: FlattenContext,
): void => {
    let cursor = rangeStart;
    let textStart = cursor;

    while (cursor < rangeEnd) {
        const opener = matchOpener(content, cursor);
        if (!opener) {
            cursor++;
            continue;
        }

        const openerStart = cursor;
        const bodyStart = cursor + opener.length;
        const closeBrace = findMatchingBrace(content, bodyStart);
        const hasClose = closeBrace !== -1 && closeBrace < rangeEnd;
        const bodyEnd = hasClose ? closeBrace : rangeEnd;
        const segmentEnd = hasClose ? closeBrace + 1 : rangeEnd;

        emitText(out, content, textStart, openerStart, base);

        const openPos = positionAt(content, openerStart, base);
        switch (opener.kind) {
            case "Print":
                out.push(<OpenPrintToken>{
                    type: "OpenPrint",
                    sceneName: base.sceneName,
                    lineNumber: openPos.lineNumber,
                    position: openPos.position,
                    indent: base.indent,
                });
                break;
            case "PrintCapitaliseFirst":
                out.push(<OpenPrintCapitaliseFirstToken>{
                    type: "OpenPrintCapitaliseFirst",
                    sceneName: base.sceneName,
                    lineNumber: openPos.lineNumber,
                    position: openPos.position,
                    indent: base.indent,
                });
                break;
            case "PrintCapitaliseAll":
                out.push(<OpenPrintCapitaliseAllToken>{
                    type: "OpenPrintCapitaliseAll",
                    sceneName: base.sceneName,
                    lineNumber: openPos.lineNumber,
                    position: openPos.position,
                    indent: base.indent,
                });
                break;
            case "MultiReplace":
                out.push(<OpenMultiReplaceToken>{
                    type: "OpenMultiReplace",
                    sceneName: base.sceneName,
                    lineNumber: openPos.lineNumber,
                    position: openPos.position,
                    indent: base.indent,
                });
                break;
        }

        if (opener.kind === "MultiReplace") {
            emitMultiReplaceBody(out, content, bodyStart, bodyEnd, base);
        } else {
            const body = content.substring(bodyStart, bodyEnd);
            const bodyPos = positionAt(content, bodyStart, base);
            const exprTokens = tokenizeExpressionString(
                body,
                bodyPos.lineNumber,
                bodyPos.position,
                base.indent,
                base.sceneName,
                base.knownLabels,
                base.sceneNames,
            );
            out.push(...exprTokens);
        }

        if (hasClose) {
            const closePos = positionAt(content, closeBrace, base);
            out.push(<CloseBraceToken>{
                type: "CloseBrace",
                sceneName: base.sceneName,
                lineNumber: closePos.lineNumber,
                position: closePos.position,
                indent: base.indent,
            });
        }

        cursor = segmentEnd;
        textStart = cursor;
    }

    emitText(out, content, textStart, rangeEnd, base);
};

const emitMultiReplaceBody = (
    out: Token[],
    content: string,
    bodyStart: number,
    bodyEnd: number,
    base: FlattenContext,
): void => {
    let cursor = bodyStart;
    while (cursor < bodyEnd && (content[cursor] === " " || content[cursor] === "\t")) {
        cursor++;
    }

    const selectorStart = cursor;
    let depth = 0;
    while (cursor < bodyEnd) {
        const c = content[cursor];
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") depth--;
        else if (depth === 0 && (c === " " || c === "\t")) break;
        cursor++;
    }
    const selectorEnd = cursor;

    if (selectorEnd > selectorStart) {
        const selectorText = content.substring(selectorStart, selectorEnd);
        const selectorPos = positionAt(content, selectorStart, base);
        out.push(
            ...tokenizeExpressionString(
                selectorText,
                selectorPos.lineNumber,
                selectorPos.position,
                base.indent,
                base.sceneName,
                base.knownLabels,
                base.sceneNames,
            ),
        );
    }

    while (cursor < bodyEnd && (content[cursor] === " " || content[cursor] === "\t")) {
        cursor++;
    }

    let altStart = cursor;
    depth = 0;
    while (cursor < bodyEnd) {
        const c = content[cursor];
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") depth--;
        else if (c === '"') {
            cursor++;
            while (cursor < bodyEnd && content[cursor] !== '"') {
                if (content[cursor] === "\\" && cursor + 1 < bodyEnd) cursor++;
                cursor++;
            }
        } else if (c === "|" && depth === 0) {
            emitRange(out, content, altStart, cursor, base);
            const elsePos = positionAt(content, cursor, base);
            out.push(<MultiReplaceElseToken>{
                type: "MultiReplaceElse",
                sceneName: base.sceneName,
                lineNumber: elsePos.lineNumber,
                position: elsePos.position,
                indent: base.indent,
            });
            altStart = cursor + 1;
        }
        cursor++;
    }
    emitRange(out, content, altStart, bodyEnd, base);
};

export const flattenProse = (content: string, base: FlattenContext): Token[] => {
    const out: Token[] = [];
    emitRange(out, content, 0, content.length, base);
    return out;
};
