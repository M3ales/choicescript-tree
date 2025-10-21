import { ExpressionTypes } from "./expression-types";

export interface Expression {
  expression: Expression;
  kind: ExpressionTypes;
}
