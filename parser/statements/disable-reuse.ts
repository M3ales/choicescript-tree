import { DisableReuseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface DisableReuseStatement extends Statement {
  kind: "DisableReuse";
  token: DisableReuseToken;
}
