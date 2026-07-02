import { DeleteArrayToken, IdentifierToken } from "../../scanner/tokens";
import { Statement, ContentKeyFn } from "./statement";

export interface DeleteArrayStatement extends Statement {
  kind: "DeleteArray";
  token: DeleteArrayToken;
  variable: IdentifierToken;
}

export const contentKey: ContentKeyFn<DeleteArrayStatement> = (stmt) => stmt.variable?.value;
