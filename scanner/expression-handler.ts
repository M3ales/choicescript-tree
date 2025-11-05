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

const isValidVariablePunctuation = (char: string) :boolean => {
  return char === `'`;
}

const isAlphanumericOrUnderscore = (char: string): boolean => {
  return isLetter(char) || isDigit(char) || char === "_";
}

function isPunctuation(char: string): boolean {
  return [".", ",", "!", "?", ";", ":", "'"].includes(char);
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
        position: position + startPos,
        lineNumber: lineNumber,
        sceneName: sceneName,
        indent: indent,
      } as StringLiteralToken);
      continue;
    }

    // Handle parentheses
    switch (char) {
      case "(": {
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
      case ")": {
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
      
      case "[": {
        tokens.push({
          type: "OpenSquareBracket",
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as OpenSquareBracketToken);
        cursor++;
        continue;
      }
      case "]": {
        tokens.push({
          type: "CloseSquareBracket",
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as CloseSquareBracketToken);
        cursor++;
        continue;
      }
      case "{": {
        tokens.push({
          type: "OpenBrace",
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as OpenBraceToken);
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
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          });
          cursor += 2;
          continue;
        }
        case "%-": {
          tokens.push(<ArithmeticOperatorToken>{
            type: "FairmathAdditionOperator",
            rawValue: twoChars,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          });
          cursor += 2;
          continue;
        }
        case ">=": {
          tokens.push(<ComparisonOperatorToken>{
            type: "GreaterThanEqualsOperator",
            rawValue: twoChars,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          });
          cursor += 2;
          continue;
        }
        case "<=": {
          tokens.push(<ComparisonOperatorToken>{
            type: "LessThanEqualsOperator",
            rawValue: twoChars,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          });
          cursor += 2;
          continue;
        }
        case "!=": {
          tokens.push(<ComparisonOperatorToken>{
            type: "NotEqualityOperator",
            rawValue: twoChars,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          });
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
      case "+": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "AdditionOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
        cursor++;
        continue;
      }
      case "-": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "SubtractionOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
        cursor++;
        continue;
      }
      case "*": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "MultiplicationOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
        cursor++;
        continue;
      }
      case "/": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "DivisionOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
        cursor++;
        continue;
      }
      case "%": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "ModulusOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
        cursor++;
        continue;
      }
      case "&": {
        tokens.push(<ArithmeticOperatorToken>{
          type: "ConcatenationOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
        cursor++;
        continue;
      }
      case "=": {
        tokens.push(<ComparisonOperatorToken>{
          type: "EqualityOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
        cursor++;
        continue;
      }
      case ">": {
        tokens.push(<ComparisonOperatorToken>{
          type: "GreaterThanOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
        cursor++;
        continue;
      }
      case "<": {
        tokens.push(<ComparisonOperatorToken>{
          type: "LessThanOperator",
          rawValue: char,
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        });
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
      case "#": {
        tokens.push({
          type: "Indexer",
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as IndexerToken);
        cursor++;
        continue;
      }
      case "$": {
        tokens.push({
          type: "Dollar",
          position: position + cursor,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
        } as DollarToken);
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
          isAlphanumericOrUnderscore(expression[cursor]) || 
          isValidVariablePunctuation(expression[cursor])
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
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          } as BooleanLiteralToken);
          continue;
        }
        case "and": {
          tokens.push(<LogicalOperatorToken>{
            type: "LogicalAnd",
            rawValue: value,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          });
          continue;
        }
        case "or": {
          tokens.push({
            type: "LogicalOr",
            rawValue: value,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
          } as LogicalOperatorToken);
          continue;
        }
        case "not": {
          tokens.push(<UnaryOperatorToken>{
            type: "NotOperator",
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
            rawValue: value,
          });
          continue;
        }
        case "round": {
          tokens.push(<UnaryOperatorToken>{
            type: "RoundOperator",
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
            rawValue: value,
          });
          continue;
        }
        case "length": {
          tokens.push(<UnaryOperatorToken>{
            type: "LengthOperator",
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
            rawValue: value,
          });
          continue;
        }
        case "modulo": {
          tokens.push(<ArithmeticOperatorToken>{
            type: "ModulusOperator",
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
            rawValue: value,
          });
          continue;
        }
        default: {
          tokens.push(<IdentifierToken>{
            type: "Identifier",
            value: value,
            position: position + startPos,
            lineNumber: lineNumber,
            sceneName: sceneName,
            indent: indent,
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
