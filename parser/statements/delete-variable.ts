import { DeleteVariableToken, IdentifierToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface DeleteVariableStatement extends Statement {
  kind: "DeleteVariable";
  token: DeleteVariableToken;
  variable: IdentifierToken;
}
