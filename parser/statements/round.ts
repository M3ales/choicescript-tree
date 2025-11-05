import { UnaryOperatorToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface RoundStatement extends Statement {
    kind: "Round";
    token: UnaryOperatorToken;
    expression: Expression;
}
  