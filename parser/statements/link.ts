import { LinkToken } from "../../scanner/tokens";
import { ProseValue } from "./prose-value";
import { Statement } from "./statement";

export interface LinkStatement extends Statement {
    kind: "Link";
    token: LinkToken;
    url: ProseValue | null;
}
