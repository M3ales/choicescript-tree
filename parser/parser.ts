import { ParseContext, ParseError } from "./parse-error";
import {
  AchievementToken,
  AllowReuseToken,
  CheckAchievementsToken,
  ChoiceOptionToken,
  CommentToken,
  CreateArrayToken,
  CreateTempArrayToken,
  DeleteArrayToken,
  DeleteVariableToken,
  DisableReuseToken,
  GameIdentifierToken,
  HideReuseToken,
  IdentifierToken,
  ImageToken,
  NumberLiteralToken,
  ProseToken,
  RestoreCheckpointToken,
  SaveCheckpointToken,
  SceneEndToken,
  SceneListToken,
  SceneStartToken,
  StringLiteralToken,
  Token,
  UnaryOperatorToken,
} from "../scanner/tokens";
import { TokenType } from "../scanner/tokens/token-types";
import {
  ArrayIndexer,
  Binary,
  Dereference,
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
  DeclareArrayStatement,
  DeclareVariableStatement,
  DeleteArrayStatement,
  DeleteVariableStatement,
  DisableReuseStatement,
  ElseIfStatement,
  ElseStatement,
  EndingStatement,
  ErrorStatement,
  ExpressionStatement,
  FakeChoiceStatement,
  FinishStatement,
  GameIdentifierStatement,
  GenerateRandomStatement,
  GoSubSceneStatement,
  GoSubStatement,
  GotoLabelStatement,
  GotoSceneStatement,
  HideReuseStatement,
  IfStatement,
  ImageStatement,
  InputNumberStatement,
  InputTextStatement,
  LabelStatement,
  LineBreakStatement,
  LinkStatement,
  OpposedPairStat,
  PageBreakStatement,
  ParametersStatement,
  PercentStat,
  ProseLiteral,
  ProseSegmentStatement,
  ProseValue,
  MultiReplaceBranchStatement,
  ProseStatement,
  RestoreCheckpointStatement,
  ReturnStatement,
  SaveCheckpointStatement,
  SelectableIfStatement,
  SetVariableStatement,
  Stat,
  StatChartStatement,
  Statement,
  TextStat,
  AchieveStatement,
} from "./statements";
import { SceneAst } from "./scene";
import {
  SceneIdentifier as SceneIdentifierToken,
  SceneListStatement,
} from "./statements/scene-list";

export class ParseErrorSignal extends Error {
  parseError: ParseError;
  constructor(parseError: ParseError) {
    super(parseError.message);
    this.parseError = parseError;
    this.name = "ParseErrorSignal";
  }
}
const choiceScopeOnlyTokenTypes: Set<TokenType> = new Set<TokenType>([
  "ChoiceOption",
  "SelectableIf",
]);

const startupHeaderStatements = new Set([
  "DeclareVariable", "DeclareArray", "Author", "SceneList", "GameIdentifier", "Comment", "Achievement",
]);

export class Parser {
  tokens: Token[];
  current: number;
  errors: ParseError[];
  contextStack: ParseContext[];
  seenNonHeaderStatement = false;
  sceneName: string | null = null;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.current = 0;
    this.errors = [];
    this.contextStack = [];
  }

  withContext<T>(ctx: ParseContext, f: () => T): T {
    this.contextStack.push(ctx);
    try {
      return f();
    } finally {
      this.contextStack.pop();
    }
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

  consume(
    type: TokenType,
    message: string,
    sameLine: boolean = true,
    sameIndent: boolean = true
  ) {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), message);
  }

  consumeOneOf(
    type: TokenType[],
    message: string,
    sameLine: boolean = true,
    sameIndent: boolean = true
  ) {
    for (const t of type) {
      if (this.check(t)) return this.advance();
    }
    throw this.error(this.peek(), message);
  }

  error(token: Token, message: string): ParseErrorSignal {
    const location =
      token.type == "SceneEnd"
        ? `at end of scene ${token.sceneName}:${token.lineNumber}:${token.position}[Indent ${token.indent}]`
        : `at '${token.type}' ${token.sceneName}:${token.lineNumber}:${token.position}[Indent ${token.indent}, Id: ${token.id}]`;

    const fullMessage = `${message} ${location}`;
    const parseError: ParseError = {
      token,
      message: fullMessage,
      context: [...this.contextStack],
    };
    this.errors.push(parseError);
    return new ParseErrorSignal(parseError);
  }

  expectIndentChange() {
    if (!this.peekSameIndent(this.previous()?.indent ?? 0)) return;
    const peek = this.peek();
    throw this.error(
      peek,
      `Expected change in indentation, found ${peek.type} instead at ${peek.lineNumber}:${peek.position} with indentation ${peek.indent}`
    );
  }

  expectLineChange() {
    if (!this.peekSameLine()) return;
    const peek = this.peek();
    throw this.error(
      peek,
      `Expected end of statement, found ${peek.type} instead at ${peek.lineNumber}:${peek.position}`
    );
  }

  expression(): Expression {
    return this.logical();
  }

  logical(): Expression {
    let expr = this.equality();
    while (this.match(["LogicalAnd", "LogicalOr"])) {
      const operator: Token = this.previous();
      const right: Expression = this.equality();
      expr = <Binary>{ kind: "Binary", left: expr, operator: operator, right: right };
    }
    return expr;
  }

  equality(): Expression {
    let expr = this.comparison();
    while (this.match(["NotEqualityOperator", "EqualityOperator"])) {
      const operator: Token = this.previous();
      const right: Expression = this.comparison();
      expr = <Binary>{ kind: "Binary", left: expr, operator: operator, right: right };
    }
    return expr;
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
      expr = <Binary>{ kind: "Binary", left: expr, operator: operator, right: right };
    }
    return expr;
  }

  term(inConcat = false): Expression {
    let expr: Expression = this.factor();
    while (
      this.match([
        "SubtractionOperator",
        "AdditionOperator",
        "ConcatenationOperator",
        "FairmathAdditionOperator",
        "FairmathSubtractionOperator",
      ])
    ) {
      const operator: Token = this.previous();
      if (operator.type === "ConcatenationOperator" && inConcat && !(operator as any).synthetic) {
        this.error(operator, "Concatenation (&) is strictly binary — use parentheses to group multiple concatenations");
      }
      const isConcat = operator.type === "ConcatenationOperator" && !(operator as any).synthetic;
      const right = this.term(isConcat);
      expr = <Binary>{ kind: "Binary", left: expr, operator: operator, right: right };
    }
    return expr;
  }

  factor(): Expression {
    let expr = this.indexing();
    while (
      this.match([
        "DivisionOperator",
        "MultiplicationOperator",
        "ModulusOperator",
      ])
    ) {
      const operator = this.previous();
      const right = this.indexing();
      expr = <Binary>{ kind: "Binary", left: expr, operator: operator, right: right };
    }
    return expr;
  }

  indexing(): Expression {
    let expr = this.unary();
    while (this.match(["Indexer", "StringIndexerOperator"])) {
      const operator = this.previous();
      const right = this.unary();
      expr = <Binary>{ kind: "Binary", left: expr, operator: operator, right: right };
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
        "RoundOperator",
        "LengthOperator",
      ])
    ) {
      const operator = this.previous();
      const right = this.unary();
      return <Unary>{ kind: "Unary", operator: operator, value: right };
    }
    return this.primary();
  }

  primary(): Expression {
    if (this.match(["NumberLiteral", "StringLiteral", "BooleanLiteral"])) {
      return <Literal>{ kind: "Literal", value: this.previous() };
    }

    if (this.match(["Identifier"])) {
      const identifier = this.previous();
      if (this.match(["OpenSquareBracket"])) {
        const accessExpression = this.expression();
        this.consume(
          "CloseSquareBracket",
          "Expect ']' after accessor expression"
        );
        return <ArrayIndexer>{
          kind: "ArrayIndexer",
          expression: accessExpression,
          identifier: identifier,
        };
      }
      return <Identifier>{ kind: "Identifier", token: identifier };
    }

    if (this.match(["OpenParenthesis"])) {
      const expr = this.expression();
      this.consume("CloseParenthesis", "Expect ')' after expression.");
      return <Grouping>{ kind: "Grouping", expression: expr };
    }

    if (this.match(["OpenBrace"])) {
      const expr = this.expression();
      this.consume("CloseBrace", "Expect '}' after dereference expression.");
      return <Dereference>{ kind: "Dereference", expression: expr };
    }

    throw this.error(this.peek(), "Expect expression");
  }

  parseExpressionFromTokens(tokens: Token[]): Expression {
    const savedTokens = this.tokens;
    const savedCurrent = this.current;
    const sentinel: SceneEndToken = {
      type: "SceneEnd",
      sceneName: tokens[0]?.sceneName ?? "",
      lineNumber: tokens[tokens.length - 1]?.lineNumber ?? 0,
      position: tokens[tokens.length - 1]?.position ?? 0,
      indent: tokens[tokens.length - 1]?.indent ?? 0,
    };
    this.tokens = [...tokens, sentinel];
    this.current = 0;
    try {
      return this.expression();
    } finally {
      this.tokens = savedTokens;
      this.current = savedCurrent;
    }
  }

  recoverInto(body: Statement[], e: unknown): void {
    if (!(e instanceof ParseErrorSignal)) throw e;
    body.push(<ErrorStatement>{
      kind: "Error",
      token: e.parseError.token,
      message: e.parseError.message,
      statementId: this.generateStatementId(),
    });
    this.synchronize();
  }

  statementId = 0;
  generateStatementId() {
    return this.statementId++;
  }

  parseScene(): SceneAst {
    if (this.match(["SceneStart"], false, false)) {
      const sceneStart = this.previous() as SceneStartToken;
      this.sceneName = sceneStart.sceneName;
      return this.withContext({ kind: `Scene '${sceneStart.sceneName}'`, token: sceneStart }, () => {
        const statements: Statement[] = [];
        while (!this.isAtEnd() && !this.match(["SceneEnd"], false, false)) {
          try {
            statements.push(this.statement());
          } catch (e) {
            this.recoverInto(statements, e);
          }
        }
        const sceneEnd = this.previous() as SceneEndToken;

        return <SceneAst>{
          name: sceneStart.sceneName,

          statements: statements,
          parseErrors: this.errors,

          start: sceneStart,
          end: sceneEnd,
        };
      });
    }

    return null;
  }

  statementDispatch: Array<[TokenType, () => Statement]> = [
    ["Prose", () => this.proseStatement()],
    ["Choice", () => this.choiceStatement()],
    ["FakeChoice", () => this.fakeChoiceStatement()],
    ["If", () => this.ifStatement()],
    ["GotoLabel", () => this.gotoLabel()],
    ["GotoScene", () => this.gotoScene()],
    ["Label", () => this.labelDefinition()],
    ["PageBreak", () => this.pageBreak()],
    ["LineBreak", () => this.lineBreak()],
    ["SetVariable", () => this.setVariable()],
    ["CreateVariable", () => this.createVariable(false)],
    ["CreateTempVariable", () => this.createVariable(true)],
    ["CreateArray", () => this.createArray(false)],
    ["CreateTempArray", () => this.createArray(true)],
    ["DeleteVariable", () => this.deleteVariable()],
    ["DeleteArray", () => this.deleteArray()],
    ["Image", () => this.imageStatement()],
    ["GoSub", () => this.goSub()],
    ["Finish", () => this.finishStatement()],
    ["GoSubScene", () => this.goSubScene()],
    ["Return", () => this.return()],
    ["Comment", () => this.commentBlock()],
    ["Ending", () => this.endingStatement()],
    ["Author", () => this.authorStatement()],
    ["SceneList", () => this.sceneList()],
    ["Achievement", () => this.achievementDefinition()],
    ["Achieve", () => this.achieveStatement()],
    ["CheckAchievements", () => this.checkAchievementsStatement()],
    ["Link", () => this.linkStatement()],
    ["GenerateRandom", () => this.generateRandomStatement()],
    ["InputText", () => this.inputText()],
    ["InputNumber", () => this.inputNumber()],
    ["Parameters", () => this.parametersStatement()],
    ["StatChart", () => this.statChart()],
    ["GameIdentifier", () => this.gameIdentifierStatement()],
    ["SaveCheckpoint", () => this.saveCheckpointStatement()],
    ["RestoreCheckpoint", () => this.restoreCheckpointStatement()],
    ["HideReuse", () => this.hideReuse()],
    ["DisableReuse", () => this.disableReuse()],
    ["AllowReuse", () => this.allowReuse()],
  ];

  statement(): Statement {
    for (const [tokenType, fn] of this.statementDispatch) {
      if (this.match([tokenType], false, false)) {
        const stmt = this.withContext({ kind: tokenType, token: this.previous() }, fn);
        if (!startupHeaderStatements.has(stmt.kind)) {
          this.seenNonHeaderStatement = true;
        }
        return stmt;
      }
    }

    if (this.match(["Else"], false, false)) {
      this.error(this.previous(), "Dangling *else with no related *if");
      return this.withContext({ kind: "Else", token: this.previous() }, () => this.elseStatement());
    }
    const peek = this.peek();

    if (peek !== undefined && choiceScopeOnlyTokenTypes.has(peek.type)) {
      throw this.error(
        peek,
        `'${peek.type}' is only valid at choice scope (inside *choice or *fake_choice). Found at indent ${peek.indent}.`
      );
    }

    throw this.error(
      peek,
      `Unknown statement starting with ${peek?.type}`
    );
  }

  restoreCheckpointStatement(): RestoreCheckpointStatement {
    const token = this.previous() as RestoreCheckpointToken;
    let identifier: ProseLiteral | undefined = undefined;
    if(this.peekSameLine()) {
      identifier = this.consumeProseLiteral("Expect identifier for checkpoint after *restore_checkpoint");
    }
    return <RestoreCheckpointStatement>{
      kind: "RestoreCheckpoint",
      token: token,
      identifier: identifier,
    }
  }
  saveCheckpointStatement(): SaveCheckpointStatement {
    const token = this.previous() as SaveCheckpointToken;
    let identifier: ProseLiteral | undefined = undefined;
    if(this.peekSameLine()) {
      identifier = this.consumeProseLiteral("Expect identifier for checkpoint after *save_checkpoint");
    }
    return <SaveCheckpointStatement>{
      kind: "SaveCheckpoint",
      token: token,
      identifier: identifier,
    }
  }

  gameIdentifierStatement(): GameIdentifierStatement {
    const token = this.previous() as GameIdentifierToken;
    const id = this.consumeProseLiteral("Expect identifier uuid following *ifid");
    return <GameIdentifierStatement> {
      kind: "GameIdentifier",
      token: token,
      uuid: id,
    }
  }

  imageStatement(): ImageStatement {
    const token = this.previous() as ImageToken;
    const path = this.consumeProseValue("Expect path after *image.");
    let alignment: IdentifierToken | undefined = undefined;
    let altText: ProseValue | undefined = undefined;
    if(this.peekSameLine()) {
      alignment = this.consume("Identifier", "Expect alignment after image path.", true, true) as IdentifierToken;
      if(this.peekSameLine()) {
        altText = this.consumeProseValue("Expect alt text after image alignement.");
      }
    }

    return <ImageStatement>{
      kind: "Image",
      token: token,
      path: path,
      alignment: alignment,
      altText: altText,
    }
  }

  statChart(): StatChartStatement {
    const token = this.previous();

    const stats: Stat[] = [];
    let title: ProseValue | undefined = undefined;
    if(this.peekSameLine() && this.check("Prose")){
      title = this.matchProseValue();
    }

    while (this.childScope(token.indent)) {
      try {
      if (this.match(["Identifier"], false, false)) {
        const type = this.previous() as IdentifierToken;
        const identifier = this.consume(
          "Identifier",
          "Expect variable name for stat entry"
        );
        let displayName: ProseValue | undefined = undefined;

        if (this.peekSameIndent(type.indent) && this.check("Prose")) {
          displayName = this.matchProseValue();
        }

        if (type.value === "text") {
          stats.push(<TextStat>{
            kind: "Text",
            token: type,
            variable: identifier,
            displayName: displayName,
          });
          continue;
        }

        if (type.value === "percent") {
          stats.push(<PercentStat>{
            kind: "Percent",
            variable: identifier,
            displayName: displayName,
          });
          continue;
        }

        let opposedDisplayName: ProseValue | undefined = undefined;
        if (this.peekGreaterIndent(type.indent) && this.check("Prose")) {
          opposedDisplayName = this.matchProseValue();
        }

        if (
          displayName === undefined &&
          this.peekGreaterIndent(type.indent) &&
          this.check("Prose")
        ) {
          const temp = this.matchProseValue();
          displayName = opposedDisplayName;
          opposedDisplayName = temp;
        }

        stats.push(<OpposedPairStat>{
          kind: "OpposedPair",
          token: token,
          variable: identifier,
          displayName: displayName,
          opposingDisplayName: opposedDisplayName,
        });
      }
      } catch (e) {
        if (!(e instanceof ParseErrorSignal)) throw e;
        this.synchronize();
      }
    }

    return <StatChartStatement>{
      kind: "StatChart",
      token: token,
      title: title,
      stats: stats,
      statementId: this.generateStatementId()
    };
  }
  parametersStatement(): ParametersStatement {
    const token = this.previous();
    const identifiers = [];
    while (this.peekSameLine()) {
      identifiers.push(
        this.consume(
          "Identifier",
          "Expect identifier following *params statement",
          true,
          true
        )
      );
    }
    return <ParametersStatement>{
      kind: "Parameters",
      token: token,
      identifiers: identifiers,
      statementId: this.generateStatementId()
    };
  }

  generateRandomStatement(): GenerateRandomStatement {
    const token = this.previous();
    const identifier: IdentifierToken = this.consume(
      "Identifier",
      "Expect variable name to store random number.",
      true,
      true
    ) as IdentifierToken;
    const min = this.expression();
    const max = this.expression();
    this.expectLineChange();
    return <GenerateRandomStatement>{
      kind: "GenerateRandom",
      token: token,
      identifier: identifier,
      min: min,
      max: max,
      statementId: this.generateStatementId()
    };
  }

  linkStatement(): LinkStatement {
    const token = this.previous();
    let url: ProseValue | null = null;
    if (this.peekSameLine()) {
      url = this.consumeProseValue("Expect URL after Link.");
    }
    this.expectLineChange();
    return <LinkStatement>{ kind: "Link", token: token, url: url };
  }

  checkAchievementsStatement(): Statement {
    const token = this.previous() as CheckAchievementsToken;
    this.expectLineChange();
    return <CheckAchievementsStatement>{
      kind: "CheckAchievements",
      token: token,
      statementId: this.generateStatementId()
    };
  }

  achieveStatement(): Statement {
    const token = this.previous();
    const codename: IdentifierToken = this.consume(
      "Identifier",
      "Expect achievement codename."
    ) as IdentifierToken;
    this.expectLineChange();
    return <AchieveStatement>{
      kind: "Achieve",
      token: token,
      codename: codename,
      statementId: this.generateStatementId()
    };
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

    const title = this.consumeProseLiteral("Expect achievement title.");

    let preDescription: IdentifierToken | ProseLiteral | null = null;
    if (this.match(["Identifier"], false, false)) {
      preDescription = this.previous() as IdentifierToken;
    } else if (this.check("Prose")) {
      preDescription = this.consumeProseLiteral("Expect achievement description.");
    }

    const postDescription = this.consumeProseLiteral("Expect unlocked achievement description.");

    return <AchievementStatement>{
      kind: "Achievement",
      token: token,
      codename,
      visibility,
      title,
      preDescription,
      postDescription,
      hidden: visibility.value === "hidden",
      statementId: this.generateStatementId()
    };
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

    return <SceneListStatement>{
      kind: "SceneList",
      token: token,
      identifiers: identifiers,
      statementId: this.generateStatementId()
    };
  }

  authorStatement(): AuthorStatement {
    const token = this.previous();
    const name = this.consumeProseLiteral("Expect author name.");
    this.expectLineChange();
    return <AuthorStatement>{
      kind: "Author",
      token: token,
      value: name,
      statementId: this.generateStatementId()
    };
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
    return <ReturnStatement>{ 
      kind: "Return",
      token: token,
      statementId: this.generateStatementId() };
  }

  parseLabel() {
    if(this.peek().type != "Identifier")  {
      return this.expression();
    }

    return this.consume(
          "Identifier",
          "Expect valid label name"
        ) as IdentifierToken;
  }

  goSubScene(): GoSubSceneStatement {
    const token = this.previous();
    const scene = this.consume("Identifier", "Expect scene name.");

    let label: IdentifierToken | Expression;
    if (this.peekSameLine()) {
      label = this.parseLabel();
    }

    const args: Expression[] = [];
    while (this.peekSameLine()) {
      args.push(this.expression());
    }

    this.expectLineChange();

    return <GoSubSceneStatement>{
      kind: "GoSubScene",
      token: token,
      scene: scene,
      label: label,
      args: args,
      statementId: this.generateStatementId()
    };
  }

  goSub(): GoSubStatement {
    const token = this.previous();

    const label = this.parseLabel();

    const args: Expression[] = [];
    while (this.peekSameLine()) {
      args.push(this.expression());
    }

    this.expectLineChange();

    return <GoSubStatement>{
      kind: "GoSub",
      token: token,
      label: label,
      args: args,
      statementId: this.generateStatementId()
    };
  }

  inputNumber(): InputNumberStatement {
    const token = this.previous();
    const variable = this.consume(
      "Identifier",
      "Expect variable name to store input text."
    ) as IdentifierToken;
    const min = this.expression();
    const max = this.expression();
    this.expectLineChange();
    return <InputNumberStatement>{
      kind: "InputNumber",
      token: token,
      storeInto: variable,
      min: min,
      max: max,
      statementId: this.generateStatementId()
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
      statementId: this.generateStatementId()
    };
  }

  gotoScene(): GotoSceneStatement {
    const token = this.previous();

    let scene : IdentifierToken | Expression;
    if(this.peek().type !== "Identifier") {
      scene = this.parseLabel();
    }
    else {
      scene = this.consume(
        "Identifier",
        "Expect scene name."
      ) as IdentifierToken;
    }

    let label: IdentifierToken | Expression;

    if (this.peekSameLine()) {
      label = this.parseLabel();
    }

    this.expectLineChange();
    return <GotoSceneStatement>{
      kind: "GotoScene",
      token: token,
      scene: scene,
      label: label,
      statementId: this.generateStatementId()
    };
  }

  lineBreak(): LineBreakStatement {
    const token = this.previous();
    return <LineBreakStatement>{
      kind: "LineBreak",
      token: token,
      statementId: this.generateStatementId()
    };
  }

  pageBreak(): PageBreakStatement {
    const token = this.previous();
    let buttonText: ProseValue | null = null;
    if (this.peekSameLine()) {
      buttonText = this.consumeProseValue("Expect button text after page break.");
    }
    this.expectLineChange();
    return <PageBreakStatement>{
      kind: "PageBreak",
      token: token,
      buttonText: buttonText,
      statementId: this.generateStatementId()
    };
  }

  choiceBoundedifStatement(): Statement {
    const parser = () => {
      if (
        this.match(
          [
            "ChoiceOption",
            "AllowReuse",
            "HideReuse",
            "DisableReuse",
            "SelectableIf",
          ],
          false,
          false
        )
      ) {
        return this.choiceOptionWithModifiers();
      }
      if (this.match(["If"], false, false)) {
        return this.choiceBoundedifStatement();
      }
      return this.statement();
    };
    return this.ifStatement(parser);
  }

  ifStatement(bodyParser: () => Statement = () => this.statement()): Statement {
    const token = this.previous();
    const expression = this.expression();
    const body: Statement[] = [];

    while (this.childScope(token.indent) || this.peekSameLine()) {
      try {
        body.push(bodyParser());
      } catch (e) {
        this.recoverInto(body, e);
      }
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
      statementId: this.generateStatementId()
    };
  }

  elseStatement(
    bodyParser: () => Statement = () => this.statement()
  ): ElseStatement {
    const token = this.previous();
    const body: Statement[] = [];
    while (this.childScope(token.indent)) {
      try {
        body.push(bodyParser());
      } catch (e) {
        this.recoverInto(body, e);
      }
    }
    return <ElseStatement>{
      kind: "Else",
      token: token,
      body: body,
      statementId: this.generateStatementId()
    };
  }

  elseIfStatement(
    bodyParser: () => Statement = () => this.statement()
  ): ElseIfStatement {
    const token = this.previous();
    const expression = this.expression();
    const body: Statement[] = [];
    while (this.childScope(token.indent)) {
      try {
        body.push(bodyParser());
      } catch (e) {
        this.recoverInto(body, e);
      }
    }
    return <ElseIfStatement>{
      kind: "ElseIf",
      token: token,
      body: body,
      expression: expression,
      statementId: this.generateStatementId()
    };
  }

  finishStatement(): FinishStatement {
    const token = this.previous();
    let prose: ProseValue | null = null;
    if (this.check("Prose", true, true)) {
      prose = this.matchProseValue() ?? null;
    }
    return <FinishStatement>{
      kind: "Finish",
      token: token,
      buttonText: prose,
      statementId: this.generateStatementId() };
  }

  endingStatement(): EndingStatement {
    const token = this.previous();
    let prose: ProseValue | null = null;
    if (this.check("Prose", true, true)) {
      prose = this.matchProseValue() ?? null;
    }
    return <EndingStatement>{
      kind: "Ending",
      token: token,
      buttonText: prose,
      statementId: this.generateStatementId() };
  }

  choiceStatement(): ChoiceStatement {
    const token = this.previous();
    const body: Statement[] = [];

    const noteTokens: ProseValue[] = [];
    while (this.peekSameLine()) {
      noteTokens.push(
        this.consumeProseValue("Note elements on same line after choice")
      );
    }

    while (this.childScope(token.indent)) {
      try {
        if (
          this.match(
            [
              "ChoiceOption",
              "AllowReuse",
              "DisableReuse",
              "HideReuse",
              "SelectableIf",
            ],
            false,
            false
          )
        ) {
          //console.log('Add choice with modifiers block', this.previous());
          body.push(this.choiceOptionWithModifiers());
        } else if (this.match(["If"], false, false)) {
          body.push(this.choiceBoundedifStatement());
        } else if (this.match(["Prose"], false, false)) {
          throw this.error(
            this.previous(),
            "Prose is not allowed directly inside Choice statements."
          );
        } else if (this.match(["Comment"], false, false)) {
          body.push(this.commentBlock());
        }
      } catch (e) {
        this.recoverInto(body, e);
      }
    }

    //console.log('Complete Choice');

    return <ChoiceStatement>{
      kind: "Choice",
      token: token,
      body: body,
      statementId: this.generateStatementId() };
  }

  fakeChoiceStatement(): FakeChoiceStatement {
    const token = this.previous();
    const body: Statement[] = [];

    while (this.childScope(token.indent)) {
      try {
        if (
          this.match(
            [
              "ChoiceOption",
              "AllowReuse",
              "DisableReuse",
              "HideReuse",
              "SelectableIf",
            ],
            false,
            false
          )
        ) {
          //console.log('Add choice with modifiers block', this.previous());
          body.push(this.choiceOptionWithModifiers());
        } else if (this.match(["If"], false, false)) {
          body.push(this.choiceBoundedifStatement());
        } else if (this.match(["Label"], false, false)) {
          body.push(this.labelDefinition());
        } else if (this.match(["Prose"], false, false)) {
          throw this.error(
            this.previous(),
            "Prose is not allowed directly inside Choice statements."
          );
        } else if (this.match(["Comment"], false, false)) {
          body.push(this.commentBlock());
        }
      } catch (e) {
        this.recoverInto(body, e);
      }
    }

    //console.log('Complete Fake Choice');

    return <FakeChoiceStatement>{
      kind: "FakeChoice",
      token: token,
      body: body,
      statementId: this.generateStatementId()
    };
  }

  gotoLabel(): GotoLabelStatement {
    const token = this.previous();
    const label = this.parseLabel();
    this.expectLineChange();
    return <GotoLabelStatement>{
      kind: "GotoLabel",
      token: token,
      label: label,
      statementId: this.generateStatementId()
    };
  }

  labelDefinition(): LabelStatement {
    const token = this.previous();
    const label = this.consume("Identifier", "Expect label name.");
    this.expectLineChange();
    return <LabelStatement>{ 
      kind: "Label",
      token: token,
      label: label,
      statementId: this.generateStatementId()
    };
  }

  selectableIf(): SelectableIfStatement {
    const token = this.previous();
    const expression = this.expression();
    return <SelectableIfStatement>{
      kind: "SelectableIf",
      token: token,
      expression: expression,
      statementId: this.generateStatementId()
    };
  }

  choiceOptionWithModifiers(): Statement {
    const token = this.previous();
    const modififers: Statement[] = [];

    switch (token.type) {
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

    const rejectReuseAfterSelectableIf = () => {
      if (modififers.some((m) => m.kind === "SelectableIf")) {
        this.error(
          this.previous(),
          "Reuse modifiers (*hide_reuse, *disable_reuse, *allow_reuse) must appear before *selectable_if on a choice option."
        );
      }
    };

    while (true) {
      if (this.match(["AllowReuse"], false, false)) {
        rejectReuseAfterSelectableIf();
        modififers.push(this.allowReuse());
      } else if (this.match(["DisableReuse"], false, false)) {
        rejectReuseAfterSelectableIf();
        modififers.push(this.disableReuse());
      } else if (this.match(["HideReuse"], false, false)) {
        rejectReuseAfterSelectableIf();
        modififers.push(this.hideReuse());
      } else if (this.match(["SelectableIf"], false, false)) {
        modififers.push(this.selectableIf());
      } else if (this.match(["ChoiceOption"], false, false)) {
        return this.choiceOption(modififers);
      } else if (this.match(["If"], true, true)) {
        return this.choiceBoundedifStatement();
      } else {
        break;
      }
    }

    throw this.error(token, "Expect ChoiceOption after modifiers.");
  }

  hideReuse() {
    const token = this.previous();
    return <HideReuseStatement>{ 
      kind: "HideReuse",
      token: token,
      statementId: this.generateStatementId()
    };
  }

  disableReuse() {
    const token = this.previous();
    return <DisableReuseStatement>{
      kind: "DisableReuse",
      token: token,
      statementId: this.generateStatementId()
    };
  }

  allowReuse() {
    const token = this.previous();
    return <AllowReuseStatement>{
      kind: "AllowReuse",
      token: token,
      statementId: this.generateStatementId()
    };
  }

  choiceOption(modifiers: Statement[] = []): ChoiceOptionStatement {
    const token = this.previous() as ChoiceOptionToken;
    const body: Statement[] = [];

    const parsedSegments: ProseSegmentStatement[] = [];
    const proseAccumulator: ProseToken[] = [];
    this.collectProseSegments(parsedSegments, proseAccumulator, token.indent);

    while (this.childScope(token.indent)) {
      try {
        //console.log('Read child', this.peek());
        if (this.match(["ChoiceOption"], false, false)) {
          body.push(this.choiceOptionWithModifiers());
          continue;
        }
        if (this.match(["If"], false, false)) {
          body.push(this.choiceBoundedifStatement());
          continue;
        }
        body.push(this.statement());
      } catch (e) {
        this.recoverInto(body, e);
      }
    }

    //console.log('Exited child scope', token.lineNumber);

    const disableReuse =
      (modifiers.find(
        (m) => m.kind === "DisableReuse"
      ) as DisableReuseStatement) !== undefined
        ? true
        : false;
    const hideReuse =
      (modifiers.find((m) => m.kind === "HideReuse") as HideReuseStatement) !==
      undefined
        ? true
        : false;
    const allowReuse =
      (modifiers.find(
        (m) => m.kind === "AllowReuse"
      ) as AllowReuseStatement) !== undefined
        ? true
        : false;
    const selectableIf =
      (
        modifiers.find(
          (m) => m.kind === "SelectableIf"
        ) as SelectableIfStatement
      )?.expression ?? null;

    return <ChoiceOptionStatement>{
      kind: "ChoiceOption",
      statementId: this.generateStatementId(),
      token: token,
      body: body,
      parsedSegments: parsedSegments,
      reuse: disableReuse
        ? "disable_reuse"
        : hideReuse
        ? "hide_reuse"
        : allowReuse
        ? "allow_reuse"
        : null,
      selectableIf: selectableIf,
    };
  }

  proseStatement(): ProseStatement {
    const startToken = this.previous() as ProseToken;
    const content: ProseToken[] = [startToken];
    const parsedSegments: ProseSegmentStatement[] = [];

    this.appendTextSegment(parsedSegments, startToken);
    this.collectProseSegments(parsedSegments, content, startToken.indent);

    return <ProseStatement>{
      content,
      kind: "Prose",
      parsedSegments,
      statementId: this.generateStatementId(),
    };
  }

  consumeProseValue(message: string): ProseValue {
    const anchor = this.consume("Prose", message) as ProseToken;
    return this.proseValueFrom(anchor);
  }

  consumeProseLiteral(message: string): ProseLiteral {
    const anchor = this.consume("Prose", message) as ProseToken;
    this.rejectInlineProse();
    return {
      token: anchor,
      content: anchor.content,
      lineNumber: anchor.lineNumber,
      position: anchor.position,
      indent: anchor.indent,
      sceneName: anchor.sceneName,
    };
  }

  private rejectInlineProse(): void {
    while (true) {
      const peek = this.peek();
      if (!peek) return;
      const t = peek.type;
      if (
        t === "OpenPrint" ||
        t === "OpenPrintCapitaliseFirst" ||
        t === "OpenPrintCapitaliseAll" ||
        t === "OpenMultiReplace"
      ) {
        try {
          this.error(
            peek,
            "${...} / @{...} not allowed in literal context — runtime treats this as plain text.",
          );
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        this.advance();
        let depth = 1;
        while (!this.isAtEnd() && depth > 0) {
          const next = this.advance();
          if (
            next.type === "OpenPrint" ||
            next.type === "OpenPrintCapitaliseFirst" ||
            next.type === "OpenPrintCapitaliseAll" ||
            next.type === "OpenMultiReplace"
          ) {
            depth++;
          } else if (next.type === "CloseBrace") {
            depth--;
          }
        }
        continue;
      }
      return;
    }
  }

  matchProseValue(): ProseValue | undefined {
    if (!this.match(["Prose"], false, false)) return undefined;
    const anchor = this.previous() as ProseToken;
    return this.proseValueFrom(anchor);
  }

  private proseValueFrom(anchor: ProseToken): ProseValue {
    const parsedSegments: ProseSegmentStatement[] = [];
    const content: ProseToken[] = [anchor];
    this.appendTextSegment(parsedSegments, anchor);
    this.collectProseSegments(parsedSegments, content, anchor.indent);
    const joined = content.map(t => t.content).join("");
    return {
      token: anchor,
      content: joined,
      parsedSegments,
      lineNumber: anchor.lineNumber,
      position: anchor.position,
      indent: anchor.indent,
      sceneName: anchor.sceneName,
    };
  }

  private appendTextSegment(out: ProseSegmentStatement[], token: ProseToken): void {
    if (!token.content || token.content.length === 0) return;
    out.push({
      kind: "Text",
      start: 0,
      end: token.content.length,
      lineNumber: token.lineNumber,
      position: token.position,
      text: token.content,
    });
  }

  private collectProseSegments(
    out: ProseSegmentStatement[],
    content: ProseToken[],
    sameIndent: number,
    stopAt: TokenType[] = [],
  ): void {
    while (!this.isAtEnd()) {
      const peek = this.peek();
      if (stopAt.includes(peek.type)) return;

      if (peek.type === "Prose" && peek.indent === sameIndent) {
        this.advance();
        const prose = this.previous() as ProseToken;
        content.push(prose);
        this.appendTextSegment(out, prose);
        continue;
      }

      if (
        peek.type === "OpenPrint" ||
        peek.type === "OpenPrintCapitaliseFirst" ||
        peek.type === "OpenPrintCapitaliseAll"
      ) {
        const opener = this.advance();
        let expr: Expression | undefined = undefined;
        try {
          expr = this.expression();
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        try {
          this.consume("CloseBrace", "Expect '}' after print expression.");
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        out.push({
          ...this.printKindFor(opener.type),
          start: 0,
          end: 0,
          lineNumber: opener.lineNumber,
          position: opener.position,
          expression: expr,
        });
        continue;
      }

      if (peek.type === "OpenMultiReplace") {
        const opener = this.advance();
        let selector: Expression | undefined = undefined;
        try {
          selector = this.expression();
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }

        const alternatives: MultiReplaceBranchStatement[] = [];
        while (true) {
          const altSegments: ProseSegmentStatement[] = [];
          this.collectProseSegments(altSegments, content, sameIndent, [
            "MultiReplaceElse",
            "CloseBrace",
          ]);
          alternatives.push({
            start: 0,
            end: 0,
            segments: altSegments,
          });
          if (this.match(["MultiReplaceElse"], false, false)) continue;
          break;
        }
        try {
          this.consume("CloseBrace", "Expect '}' after multireplace.");
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        out.push({
          kind: "MultiReplace",
          start: 0,
          end: 0,
          lineNumber: opener.lineNumber,
          position: opener.position,
          selector,
          alternatives,
        });
        continue;
      }

      return;
    }
  }

  private printKindFor(type: TokenType): {
    kind: "Print" | "PrintCapitaliseFirst" | "PrintCapitaliseAll";
  } {
    if (type === "OpenPrintCapitaliseFirst")
      return { kind: "PrintCapitaliseFirst" };
    if (type === "OpenPrintCapitaliseAll") return { kind: "PrintCapitaliseAll" };
    return { kind: "Print" };
  }

  expressionStatement(): ExpressionStatement {
    const expr = this.expression();
    return <ExpressionStatement>{ 
      expression: expr,
      statementId: this.generateStatementId()
    };
  }

  createVariable(temporary: boolean): DeclareVariableStatement {
    const token = this.previous();
    const canUseCreate = !temporary && this.sceneName === "startup" && !this.seenNonHeaderStatement;
    if (!temporary && !canUseCreate) {
      this.error(token, "*create is only allowed at the top of startup, before any non-header statements");
    }
    const identifier = this.consume("Identifier", "Expect variable name");
    const expr = !this.peekSameLine() ? null : this.expression();
    this.expectLineChange();
    return <DeclareVariableStatement>{
      kind: "DeclareVariable",
      variable: identifier,
      expression: expr,
      scope: temporary ? "Temporary" : "Global",
      token: token,
      statementId: this.generateStatementId()
    };
  }

  createArray(temporary: boolean): DeclareArrayStatement {
    const token = this.previous();
    const canUseCreate = !temporary && this.sceneName === "startup" && !this.seenNonHeaderStatement;
    if (!temporary && !canUseCreate) {
      this.error(token, "*create_array is only allowed at the top of startup, before any non-header statements");
    }
    const identifier = this.consume("Identifier", "Expect array name") as IdentifierToken;
    const countExpr = this.expression();
    if (countExpr.kind !== "Literal" || (countExpr as Literal).value.type !== "NumberLiteral") {
      this.error(token, "Array count must be a numeric literal");
    }
    const count = ((countExpr as Literal).value as NumberLiteralToken).value;
    const valueExpr = !this.peekSameLine() ? null : this.expression();
    this.expectLineChange();

    const declarations: DeclareVariableStatement[] = [];
    for (let i = 1; i <= count; i++) {
      const syntheticIdentifier = <IdentifierToken>{
        ...identifier,
        value: `${identifier.value}_${i}`,
      };
      declarations.push(<DeclareVariableStatement>{
        kind: "DeclareVariable",
        variable: syntheticIdentifier,
        expression: valueExpr,
        scope: temporary ? "Temporary" : "Global",
        token: token,
        statementId: this.generateStatementId(),
      });
    }

    return <DeclareArrayStatement>{
      kind: "DeclareArray",
      token: token,
      variable: identifier,
      count: count,
      declarations: declarations,
      scope: temporary ? "Temporary" : "Global",
      statementId: this.generateStatementId(),
    };
  }

  deleteVariable(): DeleteVariableStatement {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect variable name");
    this.expectLineChange();
    return <DeleteVariableStatement>{
      kind: "DeleteVariable",
      token: token,
      variable: identifier,
      statementId: this.generateStatementId(),
    };
  }

  deleteArray(): DeleteArrayStatement {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect array name");
    this.expectLineChange();
    return <DeleteArrayStatement>{
      kind: "DeleteArray",
      token: token,
      variable: identifier,
      statementId: this.generateStatementId(),
    };
  }

  setVariable(): SetVariableStatement {
    const token = this.previous();
    const identifierOrAssignment = this.expression();
    let assignment = undefined;
    if (this.peekSameLine()) {
      assignment = this.expression();
    }
    this.expectLineChange();

    // console.log('Set Expression', identifierOrAssignment, 'to', assignment);

    return <SetVariableStatement>{
      kind: "SetVariable",
      expression: identifierOrAssignment,
      assignment: assignment,
      token: token,
      statementId: this.generateStatementId()
    };
  }

  synchronize(): void {
    if (this.isAtEnd()) return;

    const errorIndent = this.peek().indent;
    this.advance();

    while (!this.isAtEnd()) {
      const next = this.peek();
      if (next.indent > errorIndent) {
        this.advance();
        continue;
      }

      switch (next.type) {
        case "Prose":
        case "Choice":
        case "FakeChoice":
        case "If":
        case "GotoLabel":
        case "GotoScene":
        case "Label":
        case "PageBreak":
        case "LineBreak":
        case "SetVariable":
        case "CreateVariable":
        case "CreateTempVariable":
        case "Image":
        case "GoSub":
        case "GoSubScene":
        case "Finish":
        case "Return":
        case "Comment":
        case "Ending":
        case "Author":
        case "SceneList":
        case "Achievement":
        case "Achieve":
        case "CheckAchievements":
        case "Link":
        case "GenerateRandom":
        case "InputText":
        case "InputNumber":
        case "Parameters":
        case "StatChart":
        case "GameIdentifier":
        case "SaveCheckpoint":
        case "RestoreCheckpoint":
        case "ChoiceOption":
        case "AllowReuse":
        case "DisableReuse":
        case "HideReuse":
        case "SelectableIf":
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
