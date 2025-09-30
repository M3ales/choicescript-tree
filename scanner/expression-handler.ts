import { OpenParenthesis, CloseParenthesis, Token, NumberLiteral, StringLiteral, ArithmeticOperator, LogicalOperator, ComparisonOperator, VariableReference, BooleanLiteral } from './tokens';

function isDigit(char: string): boolean {
    const code = char.charCodeAt(0);
    return code >= 48 && code <= 57; // '0' to '9'
}

function isLetter(char: string): boolean {
    const code = char.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); // 'A'-'Z' or 'a'-'z'
}

function isLetterOrUnderscore(char: string): boolean {
    return isLetter(char) || char === '_';
}

function isAlphanumericOrUnderscore(char: string): boolean {
    return isLetter(char) || isDigit(char) || char === '_';
}

export function tokenizeExpressionString(expression: string, lineNumber: number, position: number): Token[] {
    const tokens: Token[] = [];
    let cursor = 0;

    while (cursor < expression.length) {
        const char = expression[cursor];

        // Skip whitespace
        if (char === ' ' || char === '\t') {
            cursor++;
            continue;
        }

        // Handle numbers
        if (isDigit(char)) {
            const startPos = cursor;
            let value = '';

            // Collect all digits and possibly decimal point
            while (cursor < expression.length && (isDigit(expression[cursor]) || expression[cursor] === '.')) {
                value += expression[cursor];
                cursor++;
            }

            tokens.push({
                type: 'NumberLiteral',
                value: parseFloat(value),
                position: position + startPos,
                lineNumber: lineNumber,
                sceneName: '',
                indent: 0
            } as NumberLiteral);
            continue;
        }

        // Handle string literals
        if (char === '"' || char === "'") {
            const startPos = cursor;
            const quote = char;
            let value = '';
            cursor++; // Skip opening quote

            while (cursor < expression.length && expression[cursor] !== quote) {
                // Handle escape sequences
                if (expression[cursor] === '\\' && cursor + 1 < expression.length) {
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
                type: 'StringLiteral',
                value: value,
                position: position + startPos,
                lineNumber: lineNumber,
                sceneName: '',
                indent: 0
            } as StringLiteral);
            continue;
        }

        // Handle parentheses
        if (char === '(') {
            tokens.push({
                type: 'OpenParenthesis',
                position: position + cursor,
                lineNumber: lineNumber,
                sceneName: '',
                indent: 0
            } as OpenParenthesis);
            cursor++;
            continue;
        }
        if (char === ')') {
            tokens.push({
                type: 'CloseParenthesis',
                position: position + cursor,
                lineNumber: lineNumber,
                sceneName: '',
                indent: 0
            } as CloseParenthesis);
            cursor++;
            continue;
        }

        // Handle multi-character operators
        if (cursor + 1 < expression.length) {
            const startPos = cursor;
            const twoChars = expression.substring(cursor, cursor + 2);
            
            if (twoChars === '%+' || twoChars === '%-') {
                const operatorMap: Record<string, ArithmeticOperator['operator']> = {
                    '%+': 'fairmath_addition',
                    '%-': 'fairmath_subtraction'
                };

                tokens.push({
                    type: 'ArithmeticOperator',
                    operator: operatorMap[twoChars],
                    rawValue: twoChars as ArithmeticOperator['rawValue'],
                    position: position + startPos,
                    lineNumber: lineNumber,
                    sceneName: '',
                    indent: 0
                } as ArithmeticOperator);
                cursor += 2;
                continue;
            }
            
            if (twoChars === '>=' || twoChars === '<=' || twoChars === '!=') {
                const operatorMap: Record<string, ComparisonOperator['operator']> = {
                    '>=': 'greater_than_equals',
                    '<=': 'less_than_equals',
                    '!=': 'not_equals'
                };

                tokens.push({
                    type: 'ComparisonOperator',
                    operator: operatorMap[twoChars],
                    rawValue: twoChars as ComparisonOperator['rawValue'],
                    position: position + startPos,
                    lineNumber: lineNumber,
                    sceneName: '',
                    indent: 0
                } as ComparisonOperator);
                cursor += 2;
                continue;
            }
        }

        // Handle single-character operators
        if (char === '+' || char === '-' || char === '*' || char === '/' || char === '%') {
            const operatorMap: Record<string, ArithmeticOperator['operator']> = {
                '+': 'addition',
                '-': 'subtraction',
                '*': 'multiplication',
                '/': 'division',
                '%': 'modulus'
            };

            tokens.push({
                type: 'ArithmeticOperator',
                operator: operatorMap[char],
                rawValue: char as ArithmeticOperator['rawValue'],
                position: position + cursor,
                lineNumber: lineNumber,
                sceneName: '',
                indent: 0
            } as ArithmeticOperator);
            cursor++;
            continue;
        }

        if (char === '=' || char === '>' || char === '<') {
            const operatorMap: Record<string, ComparisonOperator['operator']> = {
                '=': 'equals',
                '>': 'greater_than',
                '<': 'less_than'
            };

            tokens.push({
                type: 'ComparisonOperator',
                operator: operatorMap[char],
                rawValue: char as ComparisonOperator['rawValue'],
                position: position + cursor,
                lineNumber: lineNumber,
                sceneName: '',
                indent: 0
            } as ComparisonOperator);
            cursor++;
            continue;
        }

        // Handle keywords and variables
        if (isLetterOrUnderscore(char)) {
            const startPos = cursor;
            let value = '';

            // Collect all letters, numbers, and underscores
            while (cursor < expression.length && isAlphanumericOrUnderscore(expression[cursor])) {
                value += expression[cursor];
                cursor++;
            }

            // Check for keywords
            if (value === 'true' || value === 'false') {
                tokens.push({
                    type: 'BooleanLiteral',
                    value: value === 'true',
                    position: position + startPos,
                    lineNumber: lineNumber,
                    sceneName: '',
                    indent: 0
                } as BooleanLiteral);
            } else if (value === 'and' || value === 'or' || value === 'not') {
                tokens.push({
                    type: 'LogicalOperator',
                    operator: value as 'and' | 'or' | 'not',
                    position: position + startPos,
                    lineNumber: lineNumber,
                    sceneName: '',
                    indent: 0
                } as LogicalOperator);
            } else {
                tokens.push({
                    type: 'VariableReference',
                    value: value,
                    position: position + startPos,
                    lineNumber: lineNumber,
                    sceneName: '',
                    indent: 0
                } as VariableReference);
            }
            continue;
        }

        // Skip any other character
        cursor++;
    }

    return tokens;
}