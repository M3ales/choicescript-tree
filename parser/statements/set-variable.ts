import { IdentifierToken, NumberLiteralToken, SetVariableToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface SetVariableStatement extends Statement {
  kind: "SetVariable";
  expression: Expression;
  assignment: Expression;
  token: SetVariableToken;
}
