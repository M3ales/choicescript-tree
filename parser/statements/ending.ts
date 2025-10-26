import { EndingToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface EndingStatement extends Statement {
    kind: "Ending";
    token: EndingToken;
    buttonText: ProseToken | null;
}