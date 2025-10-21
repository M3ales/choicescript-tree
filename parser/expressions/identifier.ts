import { IdentifierToken } from "../../scanner/tokens";
import { Expression } from "./expression";

export interface Identifier extends Expression {
  token: IdentifierToken;
  kind: "Identifier";
}
