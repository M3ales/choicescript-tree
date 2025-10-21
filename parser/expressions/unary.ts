import { UnaryOperatorToken } from "../../scanner/tokens";
import { Expression } from "./expression";
import { Identifier } from "./identifier";
import { Literal } from "./literal";

export interface Unary extends Expression {
  operator: UnaryOperatorToken;
  value: Unary | Literal | Identifier;
  kind: "Unary";
}
