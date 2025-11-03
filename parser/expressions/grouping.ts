import { Expression } from "./expression";

export interface Grouping extends Expression {
  expression: Expression;
  kind: "Grouping";
}
