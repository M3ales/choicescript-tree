import { IdentifierToken, InputNumberToken, NumberLiteralToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement, ContentKeyFn } from "./statement";

export interface InputNumberStatement extends Statement {
    kind: "InputNumber";
    token: InputNumberToken;
    storeInto: IdentifierToken;
    min: Expression;
    max: Expression;
}

export const contentKey: ContentKeyFn<InputNumberStatement> = (stmt) => stmt.storeInto?.value;
  