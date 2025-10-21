import { Expression } from "./expression";

export interface Grouping {
  expression: Expression;
  kind: "Grouping";
}
