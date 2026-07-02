import { BugToken } from "../../scanner/tokens";
import { ProseValue } from "./prose-value";
import { Statement } from "./statement";

export interface BugStatement extends Statement {
    kind: "Bug";
    token: BugToken;
    message: ProseValue | null;
}
