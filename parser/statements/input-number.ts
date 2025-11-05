import { IdentifierToken, InputNumberToken, NumberLiteralToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface InputNumberStatement extends Statement {
    kind: "InputNumber";
    token: InputNumberToken;
    storeInto: IdentifierToken;
    min: Expression;
    max: Expression;
}
  