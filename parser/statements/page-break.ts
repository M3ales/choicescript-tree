import { PageBreakToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface PageBreakStatement extends Statement {
    kind: "PageBreak";
    token: PageBreakToken;
    buttonText: ProseToken | null;
}
  