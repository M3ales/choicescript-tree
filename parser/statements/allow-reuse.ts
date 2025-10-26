import { AllowReuseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface AllowReuseStatement extends Statement {
  kind: "AllowReuse";
  token: AllowReuseToken;
}
