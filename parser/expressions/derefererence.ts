import { Expression } from "./expression";

export interface Dereference extends Expression {
  expression: Expression;
  kind: "Dereference";
}
