import { HideReuseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface HideReuseStatement extends Statement {
  kind: "HideReuse";
  token: HideReuseToken;
}
