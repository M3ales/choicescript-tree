import exp from "node:constants";
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

const matchKnownIdentifier = (
  expression: string,
  cursor: number,
  names: string[],
): { matched: string | null, newCursor: number } => {
  let possible = names.filter(n => n.startsWith(expression[cursor]));
  let value = "";
  const startPos = cursor;
  let nextCharIsValidVariable = false;

  while(possible.length > 0 && cursor < expression.length) {
    const tempValue = value + expression[cursor];
    const previousPossible = possible;
    possible = names.filter(n => n.startsWith(tempValue));
    if(previousPossible.length > 0 && possible.length === 0) {
      possible = previousPossible;
      if(isAlphanumericOrUnderscore(expression[cursor])) {
        nextCharIsValidVariable = true;
      }
      break;
    }
    value = tempValue;
    cursor++;
  }

  const found = possible.some(n => n === value);
  if(found && !nextCharIsValidVariable) {
    return { matched: value, newCursor: cursor };
  }
  return { matched: null, newCursor: startPos };
}

export function tokenizeExpressionString(
  expression: string,
  lineNumber: number,
  position: number,
  indent: number,
  sceneName: string,
  knownLabels: string[],
  sceneNames: string[],
): Token[] {
  const lowerCaseKnown = knownLabels.map(l => l.toLowerCase());
  const caseInsensitiveMatchIndex = lowerCaseKnown.indexOf(expression.trim().toLowerCase());
  if(caseInsensitiveMatchIndex !== -1) {
    const caseMismatch = !knownLabels.includes(expression.trim());
    const original = knownLabels[caseInsensitiveMatchIndex];
    if(caseMismatch) {
      console.warn(`Case mismatch between label '${original}' and reference '${expression.trim()}' at ${sceneName}:${lineNumber}:${position}`);
    }
    return [{
          type: "Identifier",
          value: expression.trim(),
          position: position,
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
    sceneNames ??= [];
    knownLabels ??= [];
    if(sceneNames.length > 0) {
      const sceneMatch = matchKnownIdentifier(expression, cursor, sceneNames);
      if(sceneMatch.matched !== null) {
        const isAlsoLabelName = knownLabels.some(label => label === sceneMatch.matched);
        tokens.push({
          type: "Identifier",
          value: sceneMatch.matched,
          ...baseAt(cursor),
          isSceneName: true,
          isLabelName: isAlsoLabelName,
        } as IdentifierToken);
        cursor = sceneMatch.newCursor;
        continue;
      }
    }

    if(knownLabels.length > 0) {
      const labelMatch = matchKnownIdentifier(expression, cursor, knownLabels);
      if(labelMatch.matched !== null) {
        tokens.push({
          type: "Identifier",
          value: labelMatch.matched,
          ...baseAt(cursor),
          isLabelName: true
        } as IdentifierToken);
        cursor = labelMatch.newCursor;
        continue;
      }
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

    // Handle string literals
    if (char === '"') {
      const startPos = cursor;
      const quote = char;
      let value = "";
      cursor++; // Skip opening quote

      while (cursor < expression.length && expression[cursor] !== quote) {
        // Handle escape sequences
        if (expression[cursor] === "\\" && cursor + 1 < expression.length) {
          cursor++;
        }
        value += expression[cursor];
        cursor++;
      }

      // Skip closing quote if present
      if (cursor < expression.length) {
        cursor++;
      }

      tokens.push({
        type: "StringLiteral",
        value: value,
        ...baseAt(startPos),
      } as StringLiteralToken);
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
            type: "FairmathAdditionOperator",
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
            value: value,
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
