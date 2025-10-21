import { StringLiteralToken, NumberLiteralToken } from "../../scanner/tokens";
import { Expression } from "./expression";

export interface Literal extends Expression {
  value: StringLiteralToken | NumberLiteralToken;
  kind: "Literal";
}
