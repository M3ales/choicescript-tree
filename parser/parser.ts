import { match } from "assert";
import {
  AchievementToken,
  AllowReuseToken,
  CheckAchievementsToken,
  CommentToken,
  DisableReuseToken,
  HideReuseToken,
  IdentifierToken,
  NumberLiteralToken,
  ProseToken,
  SceneEndToken,
  SceneListToken,
  SceneStartToken,
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
  AchievementStatement,
  AllowReuseStatement,
  AuthorStatement,
  CheckAchievementsStatement,
  ChoiceOptionStatement,
  ChoiceStatement,
  CommentBlock,
  DeclareVariableStatement,
  DisableReuseStatement,
  ElseIfStatement,
  ElseStatement,
  EndingStatement,
  ExpressionStatement,
  FakeChoiceStatement,
  FinishStatement,
  GoSubSceneStatement,
  GoSubStatement,
  GotoLabelStatement,
  GotoSceneStatement,
  HideReuseStatement,
  IfStatement,
  InputTextStatement,
  LabelStatement,
  LineBreakStatement,
  PageBreakStatement,
  ProseStatement,
  ReturnStatement,
  SelectableIfStatement,
  SetVariableStatement,
  Statement,
} from "./statements";
import { Scene } from "./scene";
import { SceneIdentifier as SceneIdentifierToken, SceneListStatement } from "./statements/scene-list";
import { AchieveStatement } from "./statements/achieve";

export class Parser {
  tokens: Token[];
  current: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.current = 0;
  }

  check(
    type: TokenType,
    sameLine: boolean = false,
    sameIndent: boolean = false
  ): boolean {
    if (this.isAtEnd()) return false;
    if (sameLine && !this.peekSameLine()) return false;
    if (sameIndent && !this.peekSameIndent(this.previous()?.indent ?? 0))
      return false;
    const peek = this.peek();
    return peek.type == type;
  }

  advance(): Token {
    const old = this.previous();
    const newToken = this.peek();

    if (!this.isAtEnd()) this.current++;
    /*
    const indent = newToken.indent == old?.indent ? newToken.indent : `${old?.indent}->${newToken.indent}`;
    const lineNumber = newToken.lineNumber == old?.lineNumber ? newToken.lineNumber : `${old?.lineNumber}->${newToken.lineNumber}`
    
    let changes = '';
    if(old?.lineNumber !== newToken.lineNumber) {
      changes += 'Line ' + lineNumber;
    }
    if(old?.indent !== newToken.indent) {
      changes += ' | Indent ' + indent;
    }
    if(changes.length > 0) {
      console.log(`|- ${changes}`);
    }

    const leading = changes.length > 0 ? '|--' : '|-';
    const detail = `${newToken.type} at ${newToken.sceneName}:${lineNumber}:${newToken.position}[${indent}]`;
    console.log(`${leading} Advanced to ${this.current} ${detail}`);
    */
    return newToken;
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
    return !this.peekLessIndent(indent) && !this.peekGreaterIndent(indent);
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
        this.advance();
        return true;
      }
    }
    return false;
  }

  parseScene(): Scene {
    if (this.match(["SceneStart"], false, false)) {
      const sceneStart = this.previous() as SceneStartToken;
      const statements: Statement[] = [];
      while (!this.isAtEnd() && !this.match(["SceneEnd"], false, false)) {
        statements.push(this.statement());
      }
      const sceneEnd = this.previous() as SceneEndToken;

      return <Scene>{
        name: sceneStart.sceneName,

        statements: statements,

        start: sceneStart,
        end: sceneEnd,
      };
    }

    return null;
  }

  statement(): Statement {
    if (this.match(["Prose"], false, false)) return this.proseStatement();
    if (this.match(["Choice"], false, false)) return this.choiceStatement();
    if (this.match(["FakeChoice"], false, false)) return this.fakeChoiceStatement();
    if (this.match(["If"], false, false)) return this.ifStatement();
    if (this.match(["GotoLabel"], false, false)) return this.gotoLabel();
    if (this.match(["GotoScene"], false, false)) return this.gotoScene();
    if (this.match(["Label"], false, false)) return this.labelDefinition();
    if (this.match(["PageBreak"], false, false)) return this.pageBreak();
    if (this.match(["LineBreak"], false, false)) return this.lineBreak();
    if (this.match(["SetVariable"], false, false)) return this.setVariable();
    if (this.match(["CreateVariable"], false, false))
      return this.createVariable(false);
    if (this.match(["CreateTempVariable"], false, false))
      return this.createVariable(true);
    if (this.match(["GoSub"], false, false)) return this.goSub();
    if (this.match(["Finish"], false, false)) return this.finishStatement();
    if (this.match(["GoSubScene"], false, false)) return this.goSubScene();
    if (this.match(["Return"], false, false)) return this.return();
    if (this.match(["InputText"], false, false)) return this.inputText();
    if (this.match(["Comment"], false, false)) return this.commentBlock();
    if (this.match(["Ending"], false, false)) return this.endingStatement();
    if (this.match(["Author"], false, false)) return this.authorStatement();
    if (this.match(["SceneList"], false, false)) return this.sceneList();
    if (this.match(["Achievement"], false, false)) return this.achievementDefinition();
    if (this.match(["Achieve"], false, false)) return this.achieveStatement();
    if (this.match(["CheckAchievements"], false, false)) return this.checkAchievementsStatement();
    const peek = this.peek();
    
    throw new Error(
      `Unknown statement block starting ${peek?.type} at ${peek?.sceneName}:${peek?.lineNumber}:${peek?.position}[${peek?.indent}]`
    );
  }
  
  checkAchievementsStatement(): Statement {
    const token = this.previous() as CheckAchievementsToken;
    this.expectLineChange();
    return <CheckAchievementsStatement>{ kind: "CheckAchievements", token: token };
  }

  achieveStatement(): Statement {
    const token = this.previous();
    const codename: IdentifierToken = this.consume(
      "Identifier",
      "Expect achievement codename."
    ) as IdentifierToken;
    this.expectLineChange();
    return <AchieveStatement>{ kind: "Achieve", token: token, codename: codename };
  }

  achievementDefinition(): AchievementStatement {
    const token: AchievementToken = this.previous() as AchievementToken;

    const codename: IdentifierToken = this.consume(
      "Identifier",
      "Expect achievement codename."
    ) as IdentifierToken;

    const visibility: IdentifierToken = this.consume(
      "Identifier",
      "Expect achievement visibility."
    ) as IdentifierToken;

    const points: NumberLiteralToken = this.consume(
      "NumberLiteral",
      "Expect achievement points."
    ) as NumberLiteralToken;

    const title: ProseToken = this.consume(
      "Prose", 
      "Expect achievement title."
    ) as ProseToken;

    let preDescription : IdentifierToken | ProseToken;
    if(this.match(["Identifier"], false, false)) {
      preDescription = this.previous() as IdentifierToken;
    }
    else if(this.match(["Prose"], false, false)) {
      preDescription = this.previous() as ProseToken;
    }

    const postDescription: ProseToken = this.consume(
      "Prose",
      "Expect unlocked achievement description."
    ) as ProseToken;

    return <AchievementStatement>{ kind: 'Achievement', token: token, hidden: visibility.value === "hidden" };
  }

  sceneList(): SceneListStatement {
    const token: SceneListToken = this.previous() as SceneListToken;
    const identifiers: SceneIdentifierToken[] = [];
    while (this.childScope(token.indent)) {
      const paid = this.match(["Dollar"], false, false);
      const id = this.consume(
        "Identifier",
        "Expect scene identifier in scene list.",
        false,
        false
      ) as IdentifierToken;
      identifiers.push({ paid: paid, ...id });
    }

    return <SceneListStatement>{ kind: 'SceneList', token: token, identifiers: identifiers };
  }

  authorStatement(): AuthorStatement {
    const token = this.previous();
    const name = this.consume("Prose", "Expect author name.");
    this.expectLineChange();
    return <AuthorStatement>{ kind: "Author", token: token, value: name };
  }

  commentBlock(): CommentBlock {
    const collectedComments: CommentToken[] = [];

    while (this.match(["Comment"], false, true)) {
      const comment = this.previous() as CommentToken;
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
      identifier = this.consumeOneOf(["Identifier", "NumberLiteral"], "Expect subroutine label name.");
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
    let label: IdentifierToken | NumberLiteralToken;

    if (this.peekSameLine()) {
      label = this.consumeOneOf(
        ["Identifier", "NumberLiteral"],
        "Expect label name."
      ) as IdentifierToken | NumberLiteralToken;
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

  lineBreak(): LineBreakStatement {
    const token = this.previous();
    return <LineBreakStatement>{
      kind: "LineBreak",
      token: token,
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
  
  choiceBoundedifStatement(): Statement {
    const parser = () => {
      if(this.match(["ChoiceOption", "AllowReuse", "HideReuse", "DisableReuse", "SelectableIf"], false, false)) {
        return this.choiceOptionWithModifiers();
      }
      if(this.match(["If"], false, false)) {
        return this.choiceBoundedifStatement();
      }
      return this.statement();
    }
    return this.ifStatement(parser);
  }

  ifStatement(bodyParser: () => Statement = () => this.statement()): Statement {
    const token = this.previous();
    const expression = this.expression();
    const body: Statement[] = [];

    while (this.childScope(token.indent) || this.peekSameLine()) {
      body.push(bodyParser());
    }

    const elseIfBranches: ElseIfStatement[] = [];
    while (
      this.siblingScope(token.indent) &&
      this.match(["ElseIf"], false, false)
    ) {
      elseIfBranches.push(this.elseIfStatement(bodyParser));
    }

    let elseBranch: ElseStatement | null = null;
    if (this.siblingScope(token.indent) && this.match(["Else"], false, false)) {
      elseBranch = this.elseStatement(bodyParser);
    }

    //console.log('Complete If', token);
    return <IfStatement>{
      kind: "If",
      token: token,
      body: body,
      expression: expression,
      elseBranch: elseBranch,
      elseIfBranches: elseIfBranches,
    };
  }

  elseStatement(bodyParser: () => Statement = () => this.statement()): ElseStatement {
    const token = this.previous();
    const body: Statement[] = [];
    while (this.childScope(token.indent)) {
      body.push(bodyParser());
    }
    return <ElseStatement>{
      kind: "Else",
      token: token,
      body: body,
    };
  }

  elseIfStatement(bodyParser: () => Statement = () => this.statement()): ElseIfStatement {
    const token = this.previous();
    const expression = this.expression();
    const body: Statement[] = [];
    while (this.childScope(token.indent)) {
      body.push(bodyParser());
    }
    return <ElseIfStatement>{
      kind: "ElseIf",
      token: token,
      body: body,
      expression: expression,
    };
  }

  finishStatement(): FinishStatement {
    const token = this.previous();
    let prose = null;
    if(this.match(["Prose"], true, true)) {
      prose = this.previous();
    }
    return <FinishStatement>{ kind: 'Finish', token: token, buttonText: prose }
  }
  
  endingStatement(): EndingStatement {
    const token = this.previous();
    let prose = null;
    if(this.match(["Prose"], true, true)) {
      prose = this.previous();
    }
    return <EndingStatement>{ kind: 'Ending', token: token, buttonText: prose }
  }

  choiceStatement(): ChoiceStatement {
    const token = this.previous();
    const body: Statement[] = [];

    while (this.childScope(token.indent)) {
      if(this.match([
        "ChoiceOption",
        "AllowReuse",
        "DisableReuse",
        "HideReuse",
        "SelectableIf"
      ], false, false)) {
        //console.log('Add choice with modifiers block', this.previous());
        body.push(this.choiceOptionWithModifiers());
      }
      else if(this.match(["If"], false, false)) {
        body.push(this.choiceBoundedifStatement());
      }else if(this.match(["Prose"], false, false)) {
        throw this.error(this.previous(), "Prose is not allowed directly inside Choice statements.");
      }else if(this.match(["Comment"], false, false)){
        body.push(this.commentBlock());
      }
    }

    //console.log('Complete Choice');

    return <ChoiceStatement>{ kind: "Choice", token: token, body: body };
  }

  
  fakeChoiceStatement(): FakeChoiceStatement {
    const token = this.previous();
    const body: Statement[] = [];

    while (this.childScope(token.indent)) {

      if(this.match([
        "ChoiceOption",
        "AllowReuse",
        "DisableReuse",
        "HideReuse",
        "SelectableIf"
      ], false, false)) {
        //console.log('Add choice with modifiers block', this.previous());
        body.push(this.choiceOptionWithModifiers());
      }
      else if(this.match(["If"], false, false)) {
        body.push(this.choiceBoundedifStatement());
      }else if(this.match(["Label"], false, false)) {
        body.push(this.labelDefinition());
      }else if(this.match(["Prose"], false, false)) {
        throw this.error(this.previous(), "Prose is not allowed directly inside Choice statements.");
      }else if(this.match(["Comment"], false, false)){
        body.push(this.commentBlock());
      }
    }
    
    //console.log('Complete Fake Choice');

    return <FakeChoiceStatement>{ kind: "FakeChoice", token: token, body: body };;
  }

  gotoLabel(): GotoLabelStatement {
    const token = this.previous();
    const label = this.consumeOneOf(["Identifier", "NumberLiteral"], "Expect label name.");
    this.expectLineChange();
    return <GotoLabelStatement>{
      kind: "GotoLabel",
      token: token,
      label: label,
    };
  }

  labelDefinition(): LabelStatement {
    const token = this.previous();
    const identifier = this.consumeOneOf(["Identifier", "NumberLiteral"], "Expect label name.");
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

  choiceOptionWithModifiers(): Statement {
    const token = this.previous();
    const modififers: Statement[] = [];

    switch(token.type) {
      case "AllowReuse": {
        modififers.push(this.allowReuse());
        break;
      }
      case "DisableReuse": {
        modififers.push(this.disableReuse());
        break;
      }
      case "HideReuse": {
        modififers.push(this.hideReuse());
        break;
      }
      case "SelectableIf": {
        modififers.push(this.selectableIf());
        break;
      }
      case "ChoiceOption": {
        return this.choiceOption(modififers);
      }
    }

    while(true) {
      if(this.match(["AllowReuse"], false, false)) {
        modififers.push(this.allowReuse());
      }
      else if(this.match(["DisableReuse"], false, false)) {
        modififers.push(this.disableReuse());
      }
      else if(this.match(["HideReuse"], false, false)) {
        modififers.push(this.hideReuse());
      }
      else if(this.match(["SelectableIf"], false, false)) {
        modififers.push(this.selectableIf());
      }
      else if(this.match(["ChoiceOption"], false, false)) {
        return this.choiceOption(modififers);
      }
      else if(this.match(["If"], true, true)) {
        return this.choiceBoundedifStatement();
      }
      else {
        break;
      }
    }

    throw this.error(token, "Expect ChoiceOption after modifiers.");
  }

  hideReuse() {
    const token = this.previous();
    return <HideReuseStatement>{ kind: "HideReuse", token: token };
  }
  
  disableReuse() {
    const token = this.previous();
    return <DisableReuseStatement>{ kind: "DisableReuse", token: token };
  }

  allowReuse() {
    const token = this.previous();
    return <AllowReuseStatement>{ kind: "AllowReuse", token: token };
  }

  choiceOption(modifiers: Statement[] = []): ChoiceOptionStatement {
    const token = this.previous();
    const body: Statement[] = [];

    while (this.childScope(token.indent)) {
      // console.log('Read child', this.peek());
      body.push(this.statement());
    }

    //console.log('Exited child scope', token.lineNumber);

    const disableReuse = (modifiers.find(m => m.kind === "DisableReuse") as DisableReuseStatement) !== undefined ? true : false;
    const hideReuse = (modifiers.find(m => m.kind === "HideReuse") as HideReuseStatement) !== undefined ? true : false;
    const allowReuse = (modifiers.find(m => m.kind === "AllowReuse") as AllowReuseStatement) !== undefined ? true : false;
    const selectableIf = (modifiers.find(m => m.kind === "SelectableIf") as SelectableIfStatement)?.expression ?? null;
    
    return <ChoiceOptionStatement>{
      kind: "ChoiceOption",
      token: token,
      body: body,
      reuse: disableReuse ? "disable_reuse" : 
                (
                  hideReuse ? "hide_reuse" : 
                    (
                      allowReuse ? "allow_reuse" :
                        null
                    )
                ),
      selectableIf: selectableIf
    };
  }

  proseStatement(): ProseStatement {
    const token = this.previous();
    const collectedProse: ProseToken[] = [token as ProseToken];

    while (this.match(["Prose"], false, true)) {
      const prose = this.previous() as ProseToken;
      collectedProse.push(prose);
    }

    //console.log('Collected Prose', collectedProse.length, this.current)
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
    //console.log("Matching Expression at", this.current);
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
    //console.log("Consume", type, message);
    if (this.check(type)) return this.advance();

    throw this.error(this.peek(), message);
  }

  consumeOneOf(
    type: TokenType[],
    message: string,
    sameLine: boolean = true,
    sameIndent: boolean = true
  ) {
    //console.log("Consume", type, message);
    for(const t of type) {
      if(this.check(t)) {
        return this.advance();
      }
    }

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
