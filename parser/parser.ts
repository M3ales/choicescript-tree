import { match } from "assert";
import {
  AllowReuseToken,
  CommentToken,
  DisableReuseToken,
  HideReuseToken,
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
  ChoiceOptionStatement,
  ChoiceStatement,
  CommentBlock,
  DeclareVariableStatement,
  ElseIfStatement,
  ElseStatement,
  ExpressionStatement,
  GoSubSceneStatement,
  GoSubStatement,
  GotoLabelStatement,
  GotoSceneStatement,
  IfStatement,
  InputTextStatement,
  LabelStatement,
  PageBreakStatement,
  ProseStatement,
  ReturnStatement,
  SelectableIfStatement,
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
    if (sameLine && !this.peekSameLine()) return false;
    if (sameIndent && !this.peekSameIndent(this.previous()?.indent ?? 0))
      return false;
    const peek = this.peek();
    return peek.type == type;
  }

  advance(): Token {
    const currentIndent = this.previous()?.indent ?? 0;
    if (!this.peekSameIndent(currentIndent)) {
      console.log(
        "=========================== Indent change ==========================="
      );
    }
    if (!this.peekSameLine()) {
      console.log(
        "---------------------------- Line change ----------------------------"
      );
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

  peekSameIndent(desiredIndent: number): boolean {
    const peek = this.peek();
    if (peek === null || peek === undefined) return false;
    return peek.indent == desiredIndent;
  }

  peekGreaterIndent(desiredIndent: number): boolean {
    const peek = this.peek();
    if (peek === null || peek === undefined) return false;
    return peek.indent > desiredIndent;
  }

  peekLessIndent(desiredIndent: number): boolean {
    const peek = this.peek();
    if (peek === null || peek === undefined) return false;

    return peek.indent < desiredIndent;
  }

  childScope(indent: number) {
    return !this.peekSameIndent(indent) && !this.peekLessIndent(indent);
  }

  siblingScope(indent: number) {
    return !this.peekLessIndent(indent);
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
    if (this.match(["CreateVariable"], false, false))
      return this.createVariable(false);
    if (this.match(["CreateTempVariable"], false, false))
      return this.createVariable(true);
    if (this.match(["SetVariable"], false, false)) return this.setVariable();
    if (this.match(["Prose"], false, false)) return this.proseStatement();
    if (this.match(["Choice"], false, false)) return this.choiceStatement();
    if (this.match(["ChoiceOption"], false, false)) return this.choiceOption();
    if (this.match(["If"], false, false)) return this.ifStatement();
    if (this.match(["GoSub"], false, false)) return this.goSub();
    if (this.match(["GoSubScene"], false, false)) return this.goSubScene();
    if (this.match(["Return"], false, false)) return this.return();
    if (this.match(["GotoLabel"], false, false)) return this.gotoLabel();
    if (this.match(["GotoScene"], false, false)) return this.gotoScene();
    if (this.match(["Label"], false, false)) return this.labelDefinition();
    if (this.match(["PageBreak"], false, false)) return this.pageBreak();
    if (this.match(["InputText"], false, false)) return this.inputText();
    if (this.match(["Comment"], false, false)) return this.commentBlock();
    const peek = this.peek();
    throw new Error(
      `Unknown statement block starting ${peek?.type} at ${peek?.sceneName}:${peek?.lineNumber}:${peek?.position}[${peek?.indent}]`
    );
  }

  commentBlock(): CommentBlock {
    const collectedComments: CommentToken[] = [];

    while (this.match(["Comment"], false, true)) {
      const comment = this.advance() as CommentToken;
      collectedComments.push(comment);
    }

    return <CommentBlock>{ content: collectedComments, kind: "Comment" };
  }

  return(): ReturnStatement {
    const token = this.previous();
    this.expectLineChange();
    return <ReturnStatement>{ kind: "Return", token: token };
  }

  goSubScene(): GoSubSceneStatement {
    const token = this.previous();
    const scene = this.consume("Identifier", "Expect scene name.");

    let identifier = null;
    if (this.peekSameLine()) {
      identifier = this.consume("Identifier", "Expect subroutine label name.");
    }
    this.expectLineChange();

    return <GoSubSceneStatement>{
      kind: "GoSubScene",
      token: token,
      scene: scene,
      label: identifier,
    };
  }

  goSub(): GoSubStatement {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect subroutine name.");
    this.expectLineChange();

    return <GoSubStatement>{
      kind: "GoSub",
      token: token,
      label: identifier,
    };
  }

  inputText(): InputTextStatement {
    const token = this.previous();
    const variable = this.consume(
      "Identifier",
      "Expect variable name to store input text."
    ) as IdentifierToken;
    this.expectLineChange();
    return <InputTextStatement>{
      kind: "InputText",
      token: token,
      storeInto: variable,
    };
  }

  gotoScene(): GotoSceneStatement {
    const token = this.previous();
    const scene = this.consume(
      "Identifier",
      "Expect scene name."
    ) as IdentifierToken;
    let label: IdentifierToken;

    if (this.peekSameLine()) {
      label = this.consume(
        "Identifier",
        "Expect label name."
      ) as IdentifierToken;
    } else {
      label = null;
    }

    this.expectLineChange();
    return <GotoSceneStatement>{
      kind: "GotoScene",
      token: token,
      scene: scene,
      label: label,
    };
  }

  pageBreak(): PageBreakStatement {
    const token = this.previous();
    let buttonText: ProseToken | null = null;
    if (this.peekSameLine()) {
      buttonText = this.consume(
        "Prose",
        "Expect button text after page break."
      ) as ProseToken;
    }
    this.expectLineChange();
    return <PageBreakStatement>{
      kind: "PageBreak",
      token: token,
      buttonText: buttonText,
    };
  }

  ifStatement(): Statement {
    const token = this.previous();
    const expression = this.expression();
    this.expectLineChange();
    const body: Statement[] = [];

    while (this.childScope(token.indent)) {
      body.push(this.statement());
    }

    const elseIfBranches: ElseIfStatement[] = [];
    while (
      this.match(["ElseIf"], false, false) &&
      this.siblingScope(token.indent)
    ) {
      elseIfBranches.push(this.elseIfStatement());
    }

    let elseBranch: ElseStatement | null = null;
    if (this.match(["Else"], false, false) && this.siblingScope(token.indent)) {
      elseBranch = this.elseStatement();
    }

    return <IfStatement>{
      kind: "If",
      token: token,
      body: body,
      expression: expression,
      elseBranch: elseBranch,
      elseIfBranches: elseIfBranches,
    };
  }

  elseStatement(): ElseStatement {
    const token = this.previous();
    const body: Statement[] = [];
    while (this.childScope(token.indent)) {
      body.push(this.statement());
    }
    return <ElseStatement>{
      kind: "Else",
      token: token,
      body: body,
    };
  }

  elseIfStatement(): ElseIfStatement {
    const token = this.previous();
    const expression = this.expression();
    const body: Statement[] = [];
    while (this.childScope(token.indent)) {
      body.push(this.statement());
    }
    return <ElseIfStatement>{
      kind: "ElseIf",
      token: token,
      body: body,
      expression: expression,
    };
  }

  choiceStatement(): ChoiceStatement {
    const token = this.previous();
    const choice = <ChoiceStatement>{ kind: "Choice", token: token, body: [] };
    const body: Statement[] = [];
    // TODO: disable reuse

    while (this.childScope(token.indent)) {
      console.log("Parsing choice body at", this.current, this.peek());
      if (
        this.match(
          [
            "ChoiceOption",
            "AllowReuse",
            "DisableReuse",
            "SelectableIf",
            "HideReuse",
          ],
          false,
          false
        )
      ) {
        body.push(this.choiceOption());
      } else if (this.match(["FakeChoice"], false, false)) {
        // TODO: fake choice
      } else if (this.match(["If"], false, false)) {
        body.push(this.ifStatement());
      } else if (this.match(["Comment"], false, false)) {
        body.push(this.commentBlock());
      } else {
        throw this.error(
          this.peek(),
          "Expected choice option or conditional branch in choice statement."
        );
      }
    }
    choice.body = body;
    return choice;
  }

  gotoLabel(): GotoLabelStatement {
    const token = this.previous();
    const label = this.consume("Identifier", "Expect label name.");
    this.expectLineChange();
    return <GotoLabelStatement>{
      kind: "GotoLabel",
      token: token,
      label: label,
    };
  }

  labelDefinition(): LabelStatement {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect label name.");
    return <LabelStatement>{ kind: "Label", token: token, label: identifier };
  }

  selectableIf(): SelectableIfStatement {
    const token = this.previous();
    const expression = this.expression();
    return <SelectableIfStatement>{
      kind: "SelectableIf",
      token: token,
      expression: expression,
    };
  }

  choiceOption(): ChoiceOptionStatement {
    let disableReuse: DisableReuseToken | null = null;
    let hideReuse: HideReuseToken | null = null;
    let allowReuse: AllowReuseToken | null = null;
    let selectableIf: SelectableIfStatement | null = null;

    while (
      this.match(
        ["DisableReuse", "HideReuse", "AllowReuse", "SelectableIf"],
        false,
        false
      )
    ) {
      if (this.match(["DisableReuse"], false, false)) {
        disableReuse = this.advance() as DisableReuseToken;
      } else if (this.match(["HideReuse"], false, false)) {
        hideReuse = this.advance() as HideReuseToken;
      } else if (this.match(["AllowReuse"], false, false)) {
        allowReuse = this.advance() as AllowReuseToken;
      } else if (this.match(["SelectableIf"], false, false)) {
        selectableIf = this.selectableIf(); // TODO: investigate issue with selectable if in scanner, looks like its eating the choice its related to?
      }
    }

    const token = this.previous();
    const body: Statement[] = [];
    while (this.childScope(token.indent)) {
      body.push(this.statement());
    }

    return <ChoiceOptionStatement>{
      kind: "ChoiceOption",
      token: token,
      body: body,
      reuse: disableReuse
        ? "disable_reuse"
        : hideReuse
        ? "hide_reuse"
        : allowReuse
        ? "allow_reuse"
        : null,
      selectableIf: selectableIf?.expression ?? null,
    };
  }

  proseStatement(): ProseStatement {
    const collectedProse: ProseToken[] = [];

    while (this.match(["Prose"], false, true)) {
      const prose = this.advance() as ProseToken;
      collectedProse.push(prose);
    }

    return <ProseStatement>{ content: collectedProse, kind: "Prose" };
  }

  expressionStatement(): ExpressionStatement {
    const expr = this.expression();
    return <ExpressionStatement>{ expression: expr };
  }

  createVariable(temporary: boolean): DeclareVariableStatement {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect variable name");
    const expr = !this.peekSameLine() ? null : this.expression();
    this.expectLineChange();
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
    this.expectLineChange();
    return <SetVariableStatement>{
      kind: "SetVariable",
      variable: identifier,
      expression: expr,
      token: token,
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

    while (
      this.match([
        "SubtractionOperator",
        "AdditionOperator",
        "ConcatenationOperator",
      ])
    ) {
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
      this.match([
        "NotOperator",
        "SubtractionOperator",
        "AdditionOperator",
        "FairmathAdditionOperator",
        "FairmathSubtractionOperator",
      ])
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
    return this.logical();
  }

  logical() {
    let expr = this.equality();

    while (this.match(["LogicalAnd", "LogicalOr"])) {
      const operator: Token = this.previous();
      const right: Expression = this.equality();
      expr = <Binary>{ left: expr, operator: operator, right: right };
    }

    return expr;
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

  expectIndentChange() {
    if (!this.peekSameIndent(this.previous()?.indent ?? 0)) {
      return;
    }

    const peek = this.peek();
    throw this.error(
      peek,
      `Expected change in indentation, found ${peek.type} instead at ${peek.lineNumber}:${peek.position} with indentation ${peek.indent}`
    );
  }

  expectLineChange() {
    if (!this.peekSameLine()) {
      return;
    }

    const peek = this.peek();
    throw this.error(
      peek,
      `Expected end of statement, found ${peek.type} instead at ${peek.lineNumber}:${peek.position}`
    );
  }

  consume(
    type: TokenType,
    message: string,
    sameLine: boolean = true,
    sameIndent: boolean = true
  ) {
    console.log("Consume", type, message);
    if (this.check(type)) return this.advance();

    throw this.error(this.peek(), message);
  }

  error(token: Token, message: string) {
    if (token.type == "SceneEnd") {
      this.report(
        `at end of scene ${token.sceneName}:${token.lineNumber}:${token.position}[${token.indent}]`,
        message
      );
    } else {
      this.report(
        `at '${token.type}' ${token.sceneName}:${token.lineNumber}:${token.position}[${token.indent}]`,
        message
      );
    }
  }

  report(location: string, message: string) {
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
