import {
  IdentifierToken,
  ProseToken,
  Token,
  UnaryOperatorToken,
} from "../scanner/tokens";

export class Parser {
  tokens: Token[];
  current: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.current = 0;
  }

  check(type: string): boolean {
    if (this.isAtEnd()) return false;
    const peek = this.peek();

    const compoundType = peek.type + peek["operator"] !== undefined ? '-' + peek["operator"] : '';

    return peek.type == type;
  }

  advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  isAtEnd(): boolean {
    return this.peek().type == "SceneEnd";
  }

  peek(): Token {
    return this.tokens[this.current];
  }

  previous(): Token {
    return this.tokens[this.current - 1];
  }

  match(...types: string[]) {
    for (const type in types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  comparison(): Expression {
    let expr: Expression = this.term();

    while (this.match('ArithmeticOperatorToken-greater_than', 'ArithmeticOperatorToken')) {
      const operator: Token = this.previous();
      const right: Expression = this.term();
      expr = <Binary>{
        left: expr,
        operator: operator,
        right: right,
      };
    }

    return expr;
  }

  term(): Expression {
    let expr: Expression = this.term();

    while (this.match(GREATER, GREATER_EQUAL, LESS, LESS_EQUAL)) {
      const operator: Token = this.previous();
      const right = this.term();
      expr = <Binary>{
        left: expr,
        operator: operator,
        right: right,
      };
    }

    return expr;
  }

  factor(): Expression {
    let expr = this.unary();

    while (this.match(SLASH, STAR)) {
      const operator = this.previous();
      const right = this.unary();
      expr = <Binary>{
        left: expr,
        operator: operator,
        right: right,
      };
    }

    return expr;
  }

  unary(): Expression {
    if (this.match(BANG, MINUS)) {
      const operator = this.previous();
      const right = this.unary();

      return <Unary>{
        operator: operator,
        value: right,
      };
    }

    return this.primary();
  }

  primary(): Expression {
    if (this.match(FALSE)) return <Literal> { value: false };
    if (this.match(TRUE)) return <Literal> { value: true }

    if (this.match(NUMBER, STRING)) {
      return <Literal>{ value: this.previous() }
    }

    if (this.match(LEFT_PAREN)) {
      const expr = this.expression();
      this.consume(RIGHT_PAREN, "Expect ')' after expression.");
      return <Grouping>{ expression: expr };
    }
  }

  expression(): Expression {
    return this.equality();
  }

  equality() {
    let expr = this.comparison();

    while (this.match(BANG_EQUAL, EQUAL_EQUAL)) {
      const operator: Token = this.previous();
      const right: Token = this.comparison();
      expr = <Binary>{ left: expr, operator: operator, right: right };
    }

    return expr;
  }

  consume(type: string, message: string) {
    if (this.check(type)) return this.advance();

    throw error(this.peek(), message);
  }

  error(token: Token, message: string) {
    if (token.type == 'SceneEnd') {
      this.report(token.line, " at end", message);
    } else {
      this.report(token.line, " at '" + token.lexeme + "'", message);
    }
  }
}

export interface Expression {
  kind: "Binary" | "Unary" | "Grouping" | "Literal" | "Primary";
}

export interface Grouping {
  expression: Expression;
  kind: "Grouping";
}

export interface Unary extends Expression {
  operator: UnaryOperatorToken;
  value: Unary | Primary;
  kind: "Unary";
}

export interface Binary extends Expression {
  left: Expression;
  right: Expression;
  operator: Token;
  kind: "Binary";
}

export interface Primary extends Expression {
  value: Literal | Identifier;
  kind: "Primary";
}

export interface Literal extends Expression {
  value: Token;
  kind: "Literal";
}

export interface Identifier {
  token: IdentifierToken;
  kind: "Identifier";
}

export interface Option {
  conditional: Expression;
  consequences: Token[];
  next: Node;
}

export interface Scene {
  first: Option | Prose;
  variables: Set<string>;
  tempVariables: Set<string>;
}

export interface Condition {
  expression: Expression;
  tokens: Token[];
}
export interface Statement {
  expression: Expression;
  tokens: Token[];
}
export interface Choice {
  conditional: Expression;
  type: "Choice";
  options: Option[];
}

export interface Prose {
  type: "Prose";
  content: ProseToken;
}
