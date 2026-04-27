import { FinishToken } from "../../scanner/tokens";
import { ProseValue } from "./prose-value";
import { Statement } from "./statement";

export interface FinishStatement extends Statement {
    kind: "Finish";
    token: FinishToken;
    buttonText: ProseValue | null;
}
