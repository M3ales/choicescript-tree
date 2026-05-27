import { DeleteArrayToken, IdentifierToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface DeleteArrayStatement extends Statement {
  kind: "DeleteArray";
  token: DeleteArrayToken;
  variable: IdentifierToken;
}
