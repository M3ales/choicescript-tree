import { LinkToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface LinkStatement extends Statement {
    kind: "Link";
    token: LinkToken;
    url: ProseToken | null;
}
  