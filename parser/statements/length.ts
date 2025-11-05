import { UnaryOperatorToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface LengthStatement extends Statement {
    kind: "Length";
    token: UnaryOperatorToken;
    expression: Expression;
}
  