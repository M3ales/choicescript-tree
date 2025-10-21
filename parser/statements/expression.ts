import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface ExpressionStatement extends Statement {
  expression: Expression;
  kind: "Expression";
}
