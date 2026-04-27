import { AuthorToken } from "../../scanner/tokens";
import { ProseLiteral } from "./prose-literal";
import { Statement } from "./statement";

export interface AuthorStatement extends Statement {
  kind: "Author";
  token: AuthorToken;
  value: ProseLiteral;
}
