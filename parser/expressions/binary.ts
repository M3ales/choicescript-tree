import { Token } from "../../scanner/tokens";
import { Expression } from "./expression";

export interface Binary extends Expression {
  left: Expression;
  right: Expression;
  operator: Token;
  kind: "Binary";
}
