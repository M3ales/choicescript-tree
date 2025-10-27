import { AllowReuseToken, AuthorToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface AuthorStatement extends Statement {
  kind: "Author";
  token: AuthorToken;
  value: string;
}
