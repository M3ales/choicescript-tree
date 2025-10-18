import { IdentifierToken, Token } from "../scanner/tokens";

export interface Condition {
    
}

export interface Expression {
    kind: 'Binary' | 'Unary' | 'Grouping' | 'Literal';
}

export interface Grouping {
    expression: Expression;
    kind: 'Grouping';
}

export interface Unary extends Expression {
    operator: Token;
    right: Token;
    kind: 'Unary';
}

export interface Binary extends Expression {
    left: Expression;
    right: Expression;
    operator: Token;
    kind: 'Binary';
}

export interface Literal extends Expression {
    value: Token;
    kind: 'Literal';
}

export interface Identifier {
    token: IdentifierToken
    kind: 'Identifier';
}

export interface Option {

}

export interface Choice {

}

export interface Prose {
    type: 'Prose';
    content: Prose;
}