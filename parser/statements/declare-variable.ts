import { CreateTempVariableToken, CreateVariableToken, IdentifierToken, SetVariableToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface DeclareVariableStatement extends Statement {
  kind: "DeclareVariable";
  token: CreateVariableToken | CreateTempVariableToken;
  variable: IdentifierToken;
  expression: Expression | null;
  scope: 'Temporary' | 'Global';
}
