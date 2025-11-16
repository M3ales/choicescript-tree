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
} from "../parser/expressions";
import {
  AllowReuseStatement,
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
  PageBreakStatement,
  ProseStatement,
  ReturnStatement,
  SelectableIfStatement,
  SetVariableStatement,
  Statement,
} from "../parser/statements";
import { StatementTypes as StatementType } from "../parser/statements/statement-types";
import { ChoiceNode } from "./nodes/choice";

export class Parser {
  statements: Statement[];
  current: number;

  constructor(statements: Statement[]) {
    this.statements = statements;
    this.current = 0;
  }

  
}
