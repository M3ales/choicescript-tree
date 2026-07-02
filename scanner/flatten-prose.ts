import { tokenizeExpressionString, PrefixTrie } from "./expression-handler";
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
    knownLabels: string[] | PrefixTrie;
    sceneNames: string[] | PrefixTrie;
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

interface PositionTracker {
    content: string;
    baseLine: number;
    baseCol: number;
    lastOffset: number;
    line: number;
    col: number;
}

const createTracker = (content: string, base: FlattenContext): PositionTracker => ({
    content,
    baseLine: base.lineNumber,
    baseCol: base.position,
    lastOffset: 0,
    line: base.lineNumber,
    col: base.position,
});

const trackAt = (t: PositionTracker, offset: number): { lineNumber: number; position: number } => {
    if (offset < t.lastOffset) {
        t.lastOffset = 0;
        t.line = t.baseLine;
        t.col = t.baseCol;
    }
    for (let i = t.lastOffset; i < offset && i < t.content.length; i++) {
        if (t.content[i] === "\n") {
            t.line++;
            t.col = t.baseCol;
        } else {
            t.col++;
        }
    }
    t.lastOffset = offset;
    return { lineNumber: t.line, position: t.col };
};

interface BraceMatch {
    index: number;
    crossesNewline: boolean;
}

const findMatchingBrace = (content: string, openCursor: number): BraceMatch => {
    let depth = 1;
    let i = openCursor;
    let crossesNewline = false;
    while (i < content.length) {
        const c = content[i];
        if (c === "\n") crossesNewline = true;
        if (c === "{") {
            depth++;
        } else if (c === "}") {
            depth--;
            if (depth === 0) return { index: i, crossesNewline };
        }
        i++;
    }
    return { index: -1, crossesNewline };
};

const emitText = (
    out: Token[],
    content: string,
    start: number,
    end: number,
    base: FlattenContext,
    pos: PositionTracker,
): void => {
    if (end <= start) return;
    const p = trackAt(pos,start);
    out.push(<ProseToken>{
        type: "Prose",
        sceneName: base.sceneName,
        lineNumber: p.lineNumber,
        position: p.position,
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
    pos: PositionTracker,
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
        const braceMatch = findMatchingBrace(content, bodyStart);
        const closeBrace = braceMatch.index;
        const hasClose = closeBrace !== -1 && closeBrace < rangeEnd;

        let bodyEnd: number;
        let segmentEnd: number;
        let isMultiLine = false;
        if (hasClose && braceMatch.crossesNewline) {
            isMultiLine = true;
            const newlinePos = content.indexOf("\n", bodyStart);
            bodyEnd = newlinePos !== -1 && newlinePos < closeBrace ? newlinePos : closeBrace;
            segmentEnd = closeBrace + 1;
        } else {
            bodyEnd = hasClose ? closeBrace : rangeEnd;
            segmentEnd = hasClose ? closeBrace + 1 : rangeEnd;
        }

        emitText(out, content, textStart, openerStart, base, pos);

        const openPos = trackAt(pos,openerStart);
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
            emitMultiReplaceBody(out, content, bodyStart, bodyEnd, base, pos);
        } else {
            const body = content.substring(bodyStart, bodyEnd);
            const bodyPos = trackAt(pos,bodyStart);
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
            const closePos = trackAt(pos,closeBrace);
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

    emitText(out, content, textStart, rangeEnd, base, pos);
};

const emitMultiReplaceBody = (
    out: Token[],
    content: string,
    bodyStart: number,
    bodyEnd: number,
    base: FlattenContext,
    pos: PositionTracker,
): void => {
    let cursor = bodyStart;
    while (cursor < bodyEnd && (content[cursor] === " " || content[cursor] === "\t")) {
        cursor++;
    }

    const selectorStart = cursor;
    let depth = 0;
    while (cursor < bodyEnd) {
        const c = content[cursor];
        if (c === "\"") {
            cursor++;
            while (cursor < bodyEnd && content[cursor] !== "\"") cursor++;
        } else if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") depth--;
        else if (depth === 0 && (c === " " || c === "\t")) break;
        cursor++;
    }
    const selectorEnd = cursor;

    if (selectorEnd > selectorStart) {
        const selectorText = content.substring(selectorStart, selectorEnd);
        const selectorPos = trackAt(pos,selectorStart);
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
        else if (c === "|" && depth === 0) {
            emitRange(out, content, altStart, cursor, base, pos);
            const elsePos = trackAt(pos,cursor);
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
    emitRange(out, content, altStart, bodyEnd, base, pos);
};

export const flattenProse = (content: string, base: FlattenContext): Token[] => {
    const out: Token[] = [];
    const pos = createTracker(content, base);
    emitRange(out, content, 0, content.length, base, pos);
    return out;
};
