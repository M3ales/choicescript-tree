import { DeleteVariableToken, IdentifierToken } from "../../scanner/tokens";
import { Statement, ContentKeyFn } from "./statement";

export interface DeleteVariableStatement extends Statement {
  kind: "DeleteVariable";
  token: DeleteVariableToken;
  variable: IdentifierToken;
}

export const contentKey: ContentKeyFn<DeleteVariableStatement> = (stmt) => stmt.variable?.value;
