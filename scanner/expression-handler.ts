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
      let possibleScenes = sceneNames.filter(sceneName => sceneName.startsWith(char));

      let sceneCompareValue = expression[cursor];
      const startPos = cursor;
      let foundScene = false;
      let nextCharIsValidVariable = false;
      
      cursor++;

      while(possibleScenes.length > 0 && cursor < expression.length) {
        const tempValue = sceneCompareValue + expression[cursor];
        
        const previousPossibleScenes = possibleScenes;
        possibleScenes = sceneNames.filter(scene => scene.startsWith(tempValue));
        if(previousPossibleScenes.length > 0 && possibleScenes.length === 0) {
          possibleScenes = previousPossibleScenes;
          if(isAlphanumericOrUnderscore(expression[cursor])) {
            nextCharIsValidVariable = true;
          }
          break;
        }

        sceneCompareValue = tempValue;
        cursor++;
        if(cursor >= expression.length) {
          break;
        }
      }
      
      foundScene = possibleScenes.some(scene => scene === sceneCompareValue);

      if(foundScene && !nextCharIsValidVariable) {
        // console.log('Matched Scene', sceneCompareValue, possibleScenes.length);
        const isAlsoLabelName = knownLabels.some(label => label === sceneCompareValue);
        tokens.push({
          type: "Identifier",
          value: sceneCompareValue,
          position: position + startPos,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
          isSceneName: true,
          isLabelName: isAlsoLabelName,
        } as IdentifierToken);
        continue;
      }
      else {
        cursor = startPos;
      }
    }

    if(knownLabels.length > 0) {
      let possibleLabels = knownLabels.filter(label => label.startsWith(char));

      let labelCompareValue = "";
      const startPos = cursor;
      let foundLabel = false;
      let nextCharIsValidVariable = false;
      while(possibleLabels.length > 0 && cursor < expression.length) {
        const tempValue = labelCompareValue + expression[cursor];
        
        const previousPossibleLabels = possibleLabels;
        possibleLabels = knownLabels.filter(label => label.startsWith(tempValue));
        if(previousPossibleLabels.length > 0 && possibleLabels.length === 0) {
          possibleLabels = previousPossibleLabels;
          if(isAlphanumericOrUnderscore(expression[cursor])) {
            nextCharIsValidVariable = true;
          }
          break;
        }

        labelCompareValue = tempValue;
        cursor++;
        if(cursor >= expression.length) {
          break;
        }
      }
      
      foundLabel = possibleLabels.some(label => label === labelCompareValue);
      if(foundLabel && !nextCharIsValidVariable) {
        // console.log('Matched Label', labelCompareValue, possibleLabels.length, possibleLabels);
        tokens.push({
          type: "Identifier",
          value: labelCompareValue,
          position: position + startPos,
          lineNumber: lineNumber,
          sceneName: sceneName,
          indent: indent,
          isLabelName: true
        } as IdentifierToken);
        continue;
      }
      else {
        cursor = startPos;
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
