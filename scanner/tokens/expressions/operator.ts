import { Token } from "../token";

export interface ArithmeticOperatorToken extends Token {
    rawValue: '=' | '+' | '-' | '%+' | '%-' | '*' | '/' | '%' | 'modulo' | '&' | '#'
    type: 'AssignmentOperator' | 
          'AdditionOperator' | 
          'SubtractionOperator' | 
          'FairmathAdditionOperator' | 
          'FairmathSubtractionOperator' | 
          'MultiplicationOperator' | 
          'DivisionOperator' | 
          'ModulusOperator' | 
          'ConcatenationOperator' | 
          'StringIndexerOperator';
}

export interface LogicalOperatorToken extends Token {
    rawValue: 'and' | 'or';
    type: 'LogicalAnd' | 'LogicalOr';
}

export interface UnaryOperatorToken extends Token {
    rawValue: 'not' | 'round' | 'length';
    type: 'NotOperator' | 'RoundOperator' | 'LengthOperator';
}

export interface ComparisonOperatorToken extends Token {
    rawValue: '=' | '!=' | '>' | '<' | '>=' | '<=';
    type: 'EqualityOperator' |
          'NotEqualityOperator' |
          'GreaterThanOperator' |
          'LessThanOperator' |
          'GreaterThanEqualsOperator' |
          'LessThanEqualsOperator';
}