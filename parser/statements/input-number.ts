import { IdentifierToken, InputNumberToken, NumberLiteralToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface InputNumberStatement extends Statement {
    kind: "InputNumber";
    token: InputNumberToken;
    storeInto: IdentifierToken;
    min: NumberLiteralToken;
    max: NumberLiteralToken;
}
  