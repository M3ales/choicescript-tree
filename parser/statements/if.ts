import { IfToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { ElseStatement } from "./else";
import { ElseIfStatement } from "./else-if";
import { Statement } from "./statement";

export interface IfStatement extends Statement {
  kind: "If";
  token: IfToken;
  expression: Expression;
  body: Statement[];

  elseIfBranches: ElseIfStatement[];
  elseBranch: ElseStatement | null;
}
