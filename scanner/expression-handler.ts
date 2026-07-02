import {
  OpenParenthesisToken,
  CloseParenthesisToken,
  Token,
  NumberLiteralToken,
  StringLiteralToken,
  ArithmeticOperatorToken,
  LogicalOperatorToken,
  ComparisonOperatorToken,
  IdentifierToken,
  BooleanLiteralToken,
  UnaryOperatorToken,
  MultiReplaceElseToken,
  OpenMultiReplaceToken,
  CloseBraceToken,
  IndexerToken,
  ProseToken,
  OpenSquareBracketToken,
  CloseSquareBracketToken,
  OpenBraceToken,
} from "./tokens";
import { DollarToken } from "./tokens/expressions/dollar";
import { OpenPrintToken } from "./tokens/expressions/open-print";
import { OpenPrintCapitaliseAllToken } from "./tokens/expressions/open-print-caps-all";
import { OpenPrintCapitaliseFirstToken } from "./tokens/expressions/open-print-caps-first";
import { PrefixTrie } from "./prefix-trie";

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57; // '0' to '9'
}

function isLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90); // 'A'-'Z' or 'a'-'z'
}

const isLetterOrUnderscore = (char: string): boolean => {
  return isLetter(char) || char === "_";
}

const isAlphanumericOrUnderscore = (char: string): boolean => {
  return isLetter(char) || isDigit(char) || char === "_";
}

export { PrefixTrie } from "./prefix-trie";

export function tokenizeExpressionString(
  expression: string,
  lineNumber: number,
  position: number,
  indent: number,
  sceneName: string,
  knownLabels: string[] | PrefixTrie,
  sceneNames: string[] | PrefixTrie,
): Token[] {
  const labelTrie = knownLabels instanceof PrefixTrie ? knownLabels : new PrefixTrie(knownLabels);
  const sceneTrie = sceneNames instanceof PrefixTrie ? sceneNames : new PrefixTrie(sceneNames);
  const labelSet = knownLabels instanceof PrefixTrie ? null : new Set(knownLabels.map(l => l.toLowerCase()));

  const leadingSpaces = expression.length - expression.trimStart().length;
  const trimmed = expression.trim();
  const lowerValue = trimmed.toLowerCase();
  const wholeLabel = labelTrie.match(lowerValue, 0, isAlphanumericOrUnderscore);
  if(wholeLabel.matched && wholeLabel.newCursor === lowerValue.length) {
    return [{
          type: "Identifier",
          value: lowerValue,
          rawValue: trimmed,
          position: position + leadingSpaces,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
          isLabelName: true
        } as IdentifierToken];
  }

  const tokens: Token[] = [];
  let cursor = 0;
  const baseAt = (offset: number) => ({
    position: position + offset,
    lineNumber: lineNumber,
    sceneName: sceneName,
    indent: indent,
  });

  while (cursor < expression.length) {
    const char = expression[cursor];

    // Skip whitespace
    if (char === " " || char === "\t") {
      cursor++;
      continue;
    }

    const sceneMatch = sceneTrie.match(expression, cursor, isAlphanumericOrUnderscore);
    if(sceneMatch.matched !== null) {
      const isAlsoLabelName = labelSet
        ? labelSet.has(sceneMatch.matched)
        : labelTrie.match(sceneMatch.matched, 0, isAlphanumericOrUnderscore).matched !== null;
      tokens.push({
        type: "Identifier",
        value: sceneMatch.matched,
        rawValue: sceneMatch.rawValue,
        ...baseAt(cursor),
        isSceneName: true,
        isLabelName: isAlsoLabelName,
      } as IdentifierToken);
      cursor = sceneMatch.newCursor;
      continue;
    }

    const labelMatch = labelTrie.match(expression, cursor, isAlphanumericOrUnderscore);
    if(labelMatch.matched !== null) {
      tokens.push({
        type: "Identifier",
        value: labelMatch.matched,
        rawValue: labelMatch.rawValue,
        ...baseAt(cursor),
        isLabelName: true
      } as IdentifierToken);
      cursor = labelMatch.newCursor;
      continue;
    }

    // Handle numbers
    if (isDigit(char)) {
      const startPos = cursor;
      let value = "";

      // Collect all digits and possibly decimal point
      while (
        cursor < expression.length &&
        (isDigit(expression[cursor]) || expression[cursor] === ".")
      ) {
        value += expression[cursor];
        cursor++;
      }

      tokens.push({
        type: "NumberLiteral",
        value: parseFloat(value),
        ...baseAt(startPos),
      } as NumberLiteralToken);
      continue;
    }

    // Handle string literals (with ${} interpolation support)
    if (char === '"') {
      const startPos = cursor;
      cursor++; // Skip opening quote

      const segments: { kind: "text"; value: string; pos: number }[] | { kind: "expr"; value: string; pos: number }[] = [];
      let textBuf = "";
      let textPos = cursor;

      while (cursor < expression.length && expression[cursor] !== '"') {
        const c = expression[cursor];
        // Detect ${, $!{, $!!{ interpolation openers
        if (c === "$") {
          let openerLen = 0;
          if (expression[cursor + 1] === "{") openerLen = 2;
          else if (expression[cursor + 1] === "!" && expression[cursor + 2] === "{") openerLen = 3;
          else if (expression[cursor + 1] === "!" && expression[cursor + 2] === "!" && expression[cursor + 3] === "{") openerLen = 4;

          if (openerLen > 0) {
            if (textBuf) {
              segments.push({ kind: "text", value: textBuf, pos: textPos } as any);
              textBuf = "";
            }
            const exprStart = cursor + openerLen;
            // Find matching closing brace
            let depth = 1;
            let ei = exprStart;
            while (ei < expression.length && depth > 0) {
              if (expression[ei] === "{") depth++;
              else if (expression[ei] === "}") { depth--; if (depth === 0) break; }
              else if (expression[ei] === '"') {
                ei++;
                while (ei < expression.length && expression[ei] !== '"') {
                  if (expression[ei] === "\\" && ei + 1 < expression.length) ei++;
                  ei++;
                }
              }
              ei++;
            }
            const exprBody = expression.substring(exprStart, ei);
            segments.push({ kind: "expr", value: exprBody, pos: exprStart } as any);
            cursor = ei < expression.length ? ei + 1 : ei; // skip closing }
            textPos = cursor;
            continue;
          }
        }
        if (c === "\\" && cursor + 1 < expression.length) {
          cursor++;
        }
        textBuf += expression[cursor];
        cursor++;
      }

      // Skip closing quote if present
      if (cursor < expression.length) {
        cursor++;
      }

      if (textBuf) {
        segments.push({ kind: "text", value: textBuf, pos: textPos } as any);
      }

      const hasInterpolation = segments.some((s: any) => s.kind === "expr");
      if (!hasInterpolation) {
        const fullText = segments.length > 0 ? (segments[0] as any).value : "";
        tokens.push({
          type: "StringLiteral",
          value: fullText,
          ...baseAt(startPos),
        } as StringLiteralToken);
      } else {
        for (let si = 0; si < segments.length; si++) {
          const seg = segments[si] as any;
          if (si > 0) {
            tokens.push(<ArithmeticOperatorToken>{
              type: "ConcatenationOperator",
              rawValue: "&",
              synthetic: true,
              ...baseAt(seg.pos),
            });
          }
          if (seg.kind === "text") {
            tokens.push({
              type: "StringLiteral",
              value: seg.value,
              ...baseAt(seg.pos),
            } as StringLiteralToken);
          } else {
            tokens.push({ type: "OpenParenthesis", ...baseAt(seg.pos) } as OpenParenthesisToken);
            const innerTokens = tokenizeExpressionString(
              seg.value, lineNumber, position + seg.pos, indent, sceneName, knownLabels, sceneNames
            );
            tokens.push(...innerTokens);
            tokens.push({ type: "CloseParenthesis", ...baseAt(seg.pos + seg.value.length) } as CloseParenthesisToken);
          }
        }
      }
      continue;
    }

    // Handle parentheses
    switch (char) {
      case "(": {
        tokens.push({ type: "OpenParenthesis", ...baseAt(cursor) } as OpenParenthesisToken);
        cursor++;
        continue;
      }
      case ")": {
        tokens.push({ type: "CloseParenthesis", ...baseAt(cursor) } as CloseParenthesisToken);
        cursor++;
        continue;
      }
      case "[": {
        tokens.push({ type: "OpenSquareBracket", ...baseAt(cursor) } as OpenSquareBracketToken);
        cursor++;
        continue;
      }
      case "]": {
        tokens.push({ type: "CloseSquareBracket", ...baseAt(cursor) } as CloseSquareBracketToken);
        cursor++;
        continue;
      }
      case "{": {
        tokens.push({ type: "OpenBrace", ...baseAt(cursor) } as OpenBraceToken);
        cursor++;
        continue;
      }
    }
    // Handle multi-character operators
    if (cursor + 1 < expression.length) {
      const startPos = cursor;
      const twoChars = expression.substring(cursor, cursor + 2);

      switch (twoChars) {
        case "%+": {
          tokens.push(<ArithmeticOperatorToken>{
            type: "FairmathAdditionOperator",
            rawValue: twoChars,
            ...baseAt(startPos),
          });
          cursor += 2;
          continue;
        }
        case "%-": {
          tokens.push(<ArithmeticOperatorToken>{
            type: "FairmathSubtractionOperator",
            rawValue: twoChars,
            ...baseAt(startPos),
          });
          cursor += 2;
          continue;
        }
        case ">=": {
          tokens.push(<ComparisonOperatorToken>{
            type: "GreaterThanEqualsOperator",
            rawValue: twoChars,
            ...baseAt(startPos),
          });
          cursor += 2;
          continue;
        }
        case "<=": {
          tokens.push(<ComparisonOperatorToken>{
            type: "LessThanEqualsOperator",
            rawValue: twoChars,
            ...baseAt(startPos),
          });
          cursor += 2;
          continue;
        }
        case "!=": {
          tokens.push(<ComparisonOperatorToken>{
            type: "NotEqualityOperator",
            rawValue: twoChars,
            ...baseAt(startPos),
          });
          cursor += 2;
          continue;
        }
        case "@{": {
          tokens.push({ type: "OpenMultiReplace", ...baseAt(startPos) } as OpenMultiReplaceToken);
          cursor += 2;
          continue;
        }
        case "${": {
          tokens.push({ type: "OpenPrint", ...baseAt(startPos) } as OpenPrintToken);
          cursor += 2;
          continue;
        }
        case "$!{": {
          tokens.push({ type: "OpenPrintCapitaliseFirst", ...baseAt(startPos) } as OpenPrintCapitaliseFirstToken);
          cursor += 2;
          continue;
        }
        case "$!!{": {
          tokens.push({ type: "OpenPrintCapitaliseAll", ...baseAt(startPos) } as OpenPrintCapitaliseAllToken);
          cursor += 2;
          continue;
        }
      }
    }

    // Handle single-character operators
    switch (char) {
      case "+": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "AdditionOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case "-": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "SubtractionOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case "*": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "MultiplicationOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case "/": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "DivisionOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case "%": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "ModulusOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case "&": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "ConcatenationOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case "=": {
        tokens.push(<ComparisonOperatorToken>{
          type: "EqualityOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case ">": {
        tokens.push(<ComparisonOperatorToken>{
          type: "GreaterThanOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case "<": {
        tokens.push(<ComparisonOperatorToken>{
          type: "LessThanOperator",
          rawValue: char,
          ...baseAt(cursor),
        });
        cursor++;
        continue;
      }
      case "|": {
        tokens.push({ type: "MultiReplaceElse", ...baseAt(cursor) } as MultiReplaceElseToken);
        cursor++;
        continue;
      }
      case "}": {
        tokens.push({ type: "CloseBrace", ...baseAt(cursor) } as CloseBraceToken);
        cursor++;
        continue;
      }
      case "#": {
        tokens.push({ type: "Indexer", ...baseAt(cursor) } as IndexerToken);
        cursor++;
        continue;
      }
      case "$": {
        tokens.push({ type: "Dollar", ...baseAt(cursor) } as DollarToken);
        cursor++;
        continue;
      }
    }

    // Handle keywords and variables
    if (isLetterOrUnderscore(char)) {
      const startPos = cursor;
      let value = "";

      // Collect all letters, numbers, and underscores
      while (
        cursor < expression.length &&
        (
          isAlphanumericOrUnderscore(expression[cursor])
        )
      ) {
        value += expression[cursor];
        cursor++;
      }

      // Check for keywords
      switch (value) {
        case "true":
        case "false": {
          tokens.push({
            type: "BooleanLiteral",
            value: value === "true",
            ...baseAt(startPos),
          } as BooleanLiteralToken);
          continue;
        }
        case "and": {
          tokens.push(<LogicalOperatorToken>{
            type: "LogicalAnd",
            rawValue: value,
            ...baseAt(startPos),
          });
          continue;
        }
        case "or": {
          tokens.push({
            type: "LogicalOr",
            rawValue: value,
            ...baseAt(startPos),
          } as LogicalOperatorToken);
          continue;
        }
        case "not": {
          tokens.push(<UnaryOperatorToken>{
            type: "NotOperator",
            ...baseAt(startPos),
            rawValue: value,
          });
          continue;
        }
        case "round": {
          tokens.push(<UnaryOperatorToken>{
            type: "RoundOperator",
            ...baseAt(startPos),
            rawValue: value,
          });
          continue;
        }
        case "length": {
          tokens.push(<UnaryOperatorToken>{
            type: "LengthOperator",
            ...baseAt(startPos),
            rawValue: value,
          });
          continue;
        }
        case "modulo": {
          tokens.push(<ArithmeticOperatorToken>{
            type: "ModulusOperator",
            ...baseAt(startPos),
            rawValue: value,
          });
          continue;
        }
        default: {
          tokens.push(<IdentifierToken>{
            type: "Identifier",
            value: value.toLowerCase(),
            rawValue: value,
            ...baseAt(startPos),
          });

          continue;
        }
      }
    }

    // Skip any other character
    cursor++;
  }

  return tokens;
}
