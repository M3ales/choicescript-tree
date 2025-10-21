import { match } from "assert";
import {
  IdentifierToken,
  NumberLiteralToken,
  ProseToken,
  StringLiteralToken,
  Token,
  UnaryOperatorToken,
} from "../scanner/tokens";
import { TokenType } from "../scanner/tokens/token-types";
import {
  Binary,
  Expression,
  Grouping,
  Identifier,
  Literal,
  Unary,
} from "./expressions";
import {
  DeclareVariableStatement,
  ExpressionStatement,
  SetVariableStatement,
  Statement,
} from "./statements";

export class Parser {
  tokens: Token[];
  current: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.current = 0;
  }

  check(
    type: TokenType,
    sameLine: boolean = true,
    sameIndent: boolean = true
  ): boolean {
    if (this.isAtEnd()) return false;
    if(sameLine && !this.peekSameLine()) return false;
    if(sameIndent && !this.peekSameIndent()) return false;
    const peek = this.peek();
    return peek.type == type;
  }

  advance(): Token {
    if(!this.peekSameIndent()) {
      console.log("=========================== Indent change ===========================");
    }
    if(!this.peekSameLine()) {
      console.log("---------------------------- Line change ----------------------------");
    }
    if (!this.isAtEnd()) this.current++;
    const previous = this.previous();
    
    const detail = `${previous.type} at ${previous.sceneName}:${previous.lineNumber}:${previous.position}[${previous.indent}]`;
    console.log("Advance to", this.current, detail);

    return previous;
  }

  isAtEnd(): boolean {
    const peek = this.peek()?.type;
    return peek == null || peek == "SceneEnd";
  }

  peek(): Token {
    // console.log('Peek at', this.current, this.tokens[this.current].type);
    return this.tokens[this.current];
  }

  peekSameLine(): boolean {
    const peek = this.peek();
    if (peek === null || peek === undefined) return false;
    return peek.lineNumber == (this.previous()?.lineNumber ?? 0);
  }

  peekSameIndent(): boolean {
    const peek = this.peek();
    if (peek === null || peek === undefined) return false;
    return peek.indent == (this.previous()?.indent ?? 0);
  }

  previous(): Token {
    // console.debug('Previous at', this.current - 1, this.tokens[this.current - 1].type);
    return this.tokens[this.current - 1];
  }

  match(
    typesToMatch: TokenType[],
    sameLine: boolean = true,
    sameIndent: boolean = true
  ) {
    for (const tokenType of typesToMatch) {
      if (this.check(tokenType, sameLine, sameIndent)) {
        console.debug("Matched", tokenType);
        this.advance();
        return true;
      }
    }
    return false;
  }

  scene(): Statement {
    while (this.match(["SceneStart"], false, false)) {
      this.advance(); // TODO: perhaps make this the root of the program?
    }
    return this.statement();
  }

  statement(): Statement {
    if (this.match(["SceneStart"], false, false)) return this.scene();
    if (this.match(["CreateVariable"], false, false)) return this.createVariable(false);
    if (this.match(["CreateTempVariable"], false, false)) return this.createVariable(true);
    if (this.match(["SetVariable"], false, false)) return this.setVariable();
    return this.expressionStatement();
  }

  expressionStatement(): ExpressionStatement {
    const expr = this.expression();
    this.consumeLineChange();
    return <ExpressionStatement>{ expression: expr };
  }

  createVariable(temporary: boolean): DeclareVariableStatement {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect variable name");
    const peek = this.peek();
    const expr =
      peek.lineNumber !== identifier.lineNumber ? null : this.expression();
    return <DeclareVariableStatement>{
      kind: "DeclareVariable",
      variable: identifier,
      expression: expr,
      scope: temporary ? "Temporary" : "Global",
      token: token,
    };
  }

  setVariable(): SetVariableStatement {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect variable name");
    const expr = this.expression();
    this.consumeLineChange();
    return <SetVariableStatement>{
      kind: "SetVariable",
      variable: identifier,
      expression: expr,
      token: token
    };
  }

  comparison(): Expression {
    let expr: Expression = this.term();

    while (
      this.match([
        "GreaterThanOperator",
        "GreaterThanEqualsOperator",
        "LessThanOperator",
        "LessThanEqualsOperator",
        "EqualityOperator",
        "NotEqualityOperator",
      ])
    ) {
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
    let expr: Expression = this.factor();

    while (this.match(["SubtractionOperator", "AdditionOperator"])) {
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

    while (
      this.match([
        "DivisionOperator",
        "MultiplicationOperator",
        "ModulusOperator",
      ])
    ) {
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
    if (
      this.match(["NotOperator", "SubtractionOperator", "AdditionOperator"])
    ) {
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
    if (this.match(["NumberLiteral", "StringLiteral", "BooleanLiteral"])) {
      return <Literal>{ value: this.previous() };
    }

    if (this.match(["Identifier"])) {
      return <Identifier>{ token: this.previous() };
    }

    if (this.match(["OpenParenthesis"])) {
      const expr = this.expression();
      this.consume("CloseParenthesis", "Expect ')' after expression.");
      return <Grouping>{ expression: expr };
    }

    throw this.error(this.peek(), "Expect expression.");
  }

  expression(): Expression {
    console.log("Matching Expression at", this.current);
    return this.equality();
  }

  equality() {
    let expr = this.comparison();

    while (this.match(["NotEqualityOperator", "EqualityOperator"])) {
      const operator: Token = this.previous();
      const right: Expression = this.comparison();
      expr = <Binary>{ left: expr, operator: operator, right: right };
    }

    return expr;
  }

  consumeIndentChange() {
    if (!this.peekSameIndent()) {
      return this.advance();
    }

    const peek = this.peek();
    throw this.error(
      peek,
      `Expected change in indentation, found ${peek.type} instead at ${peek.lineNumber}:${peek.position} with indentation ${peek.indent}`
    );
  }

  consumeLineChange() {
    if (!this.peekSameLine()) {
      return;
    }

    const peek = this.peek();
    throw this.error(
      peek,
      `Expected end of statement, found ${peek.type} instead at ${peek.lineNumber}:${peek.position}`
    );
  }

  consume(type: TokenType, message: string, sameLine: boolean = true, sameIndent: boolean = true) {
    console.log("Consume", type, message);
    if (this.check(type)) return this.advance();

    throw this.error(this.peek(), message);
  }

  error(token: Token, message: string) {
    if (token.type == "SceneEnd") {
      this.report(`at end of scene ${token.sceneName}:${token.lineNumber}:${token.position}[${token.indent}]`, message);
    } else {
      this.report(
        `at '${token.type}' ${token.sceneName}:${token.lineNumber}:${token.position}[${token.indent}]`,
        message
      );
    }
  }

  report(
    location: string,
    message: string
  ) {
    const err = `Error: ${message} ${location}`;
    console.error(err);
    throw new Error(err);
  }

  synchronize(): void {
    this.advance();

    // TODO: tbh I have no idea how this helps us, but apparently it helps error handling?
    // Need to read more
    while (!this.isAtEnd()) {
      if (this.previous().type == "Return") return;

      switch (this.peek()?.type) {
        case "GotoRandomScene":
        case "GotoScene":
        case "GotoLabel":
        case "Return":
        case null:
        case undefined:
          return;
      }

      this.advance();
    }
  }

  parse(): Statement[] {
    const statements: Statement[] = [];
    while (!this.isAtEnd()) {
      statements.push(this.statement());
    }

    return statements;
  }
}
