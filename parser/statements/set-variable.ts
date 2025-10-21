import { IdentifierToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface SetVariableStatement extends Statement {
  kind: "SetVariable";
  variable: IdentifierToken;
  expression: Expression;
}
