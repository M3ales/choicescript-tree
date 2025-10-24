import { ElseIfToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface ElseIfStatement extends Statement {
  kind: "ElseIf";
  token: ElseIfToken;
  expression: Expression;
  body: Statement[];
}
