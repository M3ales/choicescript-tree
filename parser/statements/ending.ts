import { EndingToken } from "../../scanner/tokens";
import { ProseValue } from "./prose-value";
import { Statement } from "./statement";

export interface EndingStatement extends Statement {
    kind: "Ending";
    token: EndingToken;
    buttonText: ProseValue | null;
}
