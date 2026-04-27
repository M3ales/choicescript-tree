import { PageBreakToken } from "../../scanner/tokens";
import { ProseValue } from "./prose-value";
import { Statement } from "./statement";

export interface PageBreakStatement extends Statement {
    kind: "PageBreak";
    token: PageBreakToken;
    buttonText: ProseValue | null;
}
