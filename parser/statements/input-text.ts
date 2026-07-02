import { GotoLabelToken, IdentifierToken, InputTextToken, LabelToken } from "../../scanner/tokens";
import { Statement, ContentKeyFn } from "./statement";

export interface InputTextStatement extends Statement {
    kind: "InputText";
    token: InputTextToken;
    storeInto: IdentifierToken;
}

export const contentKey: ContentKeyFn<InputTextStatement> = (stmt) => stmt.storeInto?.value;
  