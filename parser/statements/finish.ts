import { FinishToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface FinishStatement extends Statement {
    kind: "Finish";
    token: FinishToken;
    buttonText: ProseToken;
}