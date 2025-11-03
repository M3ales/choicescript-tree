import { IdentifierToken } from "../../scanner/tokens";
import { Expression } from "./expression";

export interface ArrayIndexer extends Expression {
    identifier: IdentifierToken;
    expression: Expression;
    kind: "ArrayIndexer";
}