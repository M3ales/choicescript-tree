import { GotoLabelToken, IdentifierToken, InputTextToken, LabelToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface InputTextStatement extends Statement {
    kind: "InputText";
    token: InputTextToken;
    storeInto: IdentifierToken;
}
  