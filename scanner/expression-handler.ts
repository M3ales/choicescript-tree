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
} from "./tokens";
import { OpenPrintToken } from "./tokens/expressions/open-print";
import { OpenPrintCapitaliseAllToken } from "./tokens/expressions/open-print-caps-all";
import { OpenPrintCapitaliseFirstToken } from "./tokens/expressions/open-print-caps-first";

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57; // '0' to '9'
}

function isLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); // 'A'-'Z' or 'a'-'z'
}

function isLetterOrUnderscore(char: string): boolean {
  return isLetter(char) || char === "_";
}

function isAlphanumericOrUnderscore(char: string): boolean {
  return isLetter(char) || isDigit(char) || char === "_";
}

export function tokenizeExpressionString(
  expression: string,
  lineNumber: number,
  position: number,
  indent: number,
  sceneName: string
): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < expression.length) {
    const char = expression[cursor];

    // Skip whitespace
    if (char === " " || char === "\t") {
      cursor++;
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
        position: position + startPos,
        lineNumber: lineNumber,
        sceneName: sceneName,
        indent: indent,
      } as NumberLiteralToken);
      continue;
    }

    // Handle string literals
    if (char === '"' || char === "'") {
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
        position: position + startPos,
        lineNumber: lineNumber,
        sceneName: sceneName,
        indent: indent,
      } as StringLiteralToken);
      continue;
    }

    // Handle parentheses
    if (char === "(") {
      tokens.push({
        type: "OpenParenthesis",
        position: position + cursor,
        lineNumber: lineNumber,
        sceneName: sceneName,
        indent: indent,
      } as OpenParenthesisToken);
      cursor++;
      continue;
    }
    if (char === ")") {
      tokens.push({
        type: "CloseParenthesis",
        position: position + cursor,
        lineNumber: lineNumber,
        sceneName: sceneName,
        indent: indent,
      } as CloseParenthesisToken);
      cursor++;
      continue;
    }

    // Handle multi-character operators
    if (cursor + 1 < expression.length) {
      const startPos = cursor;
      const twoChars = expression.substring(cursor, cursor + 2);

      switch (twoChars) {
        case "%+":
        case "%-": {
          const operatorMap: Record<
            string,
            ArithmeticOperatorToken["operator"]
          > = {
            "%+": "fairmath_addition",
            "%-": "fairmath_subtraction",
          };

          tokens.push({
            type: "ArithmeticOperator",
            operator: operatorMap[twoChars],
            rawValue: twoChars as ArithmeticOperatorToken["rawValue"],
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          } as ArithmeticOperatorToken);
          cursor += 2;
          continue;
        }
        case ">=":
        case "<=":
        case "!=": {
          const operatorMap: Record<
            string,
            ComparisonOperatorToken["operator"]
          > = {
            ">=": "greater_than_equals",
            "<=": "less_than_equals",
            "!=": "not_equals",
          };

          tokens.push({
            type: "ComparisonOperator",
            operator: operatorMap[twoChars],
            rawValue: twoChars as ComparisonOperatorToken["rawValue"],
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          } as ComparisonOperatorToken);
          cursor += 2;
          continue;
        }
        case "@{": {
            tokens.push({
                type: "OpenMultiReplace",
                position: position + startPos,
                lineNumber: lineNumber,
                sceneName: sceneName,
                indent: indent,
            } as OpenMultiReplaceToken);
            cursor += 2;
            continue;
        }
        case "${": {
            tokens.push({
                type: "OpenPrint",
                position: position + startPos,
                lineNumber: lineNumber,
                sceneName: sceneName,
                indent: indent,
            } as OpenPrintToken);
            cursor += 2;
            continue;
        }
        case "$!{": {
            tokens.push({
                type: "OpenPrintCapitaliseFirst",
                position: position + startPos,
                lineNumber: lineNumber,
                sceneName: sceneName,
                indent: indent,
            } as OpenPrintCapitaliseFirstToken);
            cursor += 2;
            continue;
        }
        case "$!!{": {
            tokens.push({
                type: "OpenPrintCapitaliseAll",
                position: position + startPos,
                lineNumber: lineNumber,
                sceneName: sceneName,
                indent: indent,
            } as OpenPrintCapitaliseAllToken);
            cursor += 2;
            continue;
        }
      }
    }

    // Handle single-character operators
    switch (char) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "%":
      case "&": {
        const operatorMap: Record<string, ArithmeticOperatorToken["operator"]> =
          {
            "+": "addition",
            "-": "subtraction",
            "*": "multiplication",
            "/": "division",
            "%": "modulus",
            "&": "concatenation",
          };
        tokens.push({
          type: "ArithmeticOperator",
          operator: operatorMap[char],
          rawValue: char as ArithmeticOperatorToken["rawValue"],
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as ArithmeticOperatorToken);
        cursor++;
        continue;
      }
      case "=":
      case ">":
      case "<": {
        const operatorMap: Record<string, ComparisonOperatorToken["operator"]> =
          {
            "=": "equals",
            ">": "greater_than",
            "<": "less_than",
          };

        tokens.push({
          type: "ComparisonOperator",
          operator: operatorMap[char],
          rawValue: char as ComparisonOperatorToken["rawValue"],
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as ComparisonOperatorToken);
        cursor++;
        continue;
      }
      case "|": {
        tokens.push({
          type: "MultiReplaceElse",
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as MultiReplaceElseToken);
        cursor++;
        continue;
      }
      case "}": {
        tokens.push({
          type: "CloseBrace",
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as CloseBraceToken);
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
        isAlphanumericOrUnderscore(expression[cursor])
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
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          } as BooleanLiteralToken);
          continue;
        }
        case "and":
        case "or": {
          tokens.push({
            type: "LogicalOperator",
            operator: value as "and" | "or",
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          } as LogicalOperatorToken);
          continue;
        }
        case "not":
        case "round": {
          tokens.push({
            type: "UnaryOperator",
            value: value,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
            operator: value == "not" ? "not" : "round",
            rawValue: value,
          } as UnaryOperatorToken);
          continue;
        }
        case "modulo": {
          tokens.push({
            type: "ArithmeticOperator",
            value: value,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
            rawValue: value,
            operator: "modulus",
          } as ArithmeticOperatorToken);
          continue;
        }
        default: {
          tokens.push({
            type: "Identifier",
            value: value,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          } as IdentifierToken);
          continue;
        }
      }
    }

    // Skip any other character
    cursor++;
  }

  return tokens;
}
