import { IdentifierToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface DeclareVariableStatement extends Statement {
  kind: "DeclareVariable";
  variable: IdentifierToken;
  expression: Expression | null;
  scope: 'Temporary' | 'Global';
}
