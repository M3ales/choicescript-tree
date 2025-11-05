import { IdentifierToken, LabelToken, NumberLiteralToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface LabelStatement extends Statement {
    kind: "Label";
    token: LabelToken;
    label: (IdentifierToken | NumberLiteralToken)[] | Expression;
}
  