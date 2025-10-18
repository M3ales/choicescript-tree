import { Token } from "../token";

export interface ArithmeticOperatorToken extends Token {
    operator: 'assignment' | 'addition' | 'subtraction' | 'fairmath_addition' | 'fairmath_subtraction' | 'multiplication' | 'division' | 'modulus';
    rawValue: '=' | '+' | '-' | '%+' | '%-' | '*' | '/' | '%'
    type: 'ArithmeticOperator';
}

export interface LogicalOperatorToken extends Token {
    operator: 'and' | 'or' | 'not';
    rawValue: 'and' | 'or' | 'not'
    type: 'LogicalOperator';
}

export interface ComparisonOperatorToken extends Token {
    operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'greater_than_equals' | 'less_than_equals';
    rawValue: '=' | '!=' | '>' | '<' | '>=' | '<=';
    type: 'ComparisonOperator';
}