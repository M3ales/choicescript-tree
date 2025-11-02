import { GotoLabelToken, IdentifierToken, LabelToken, NumberLiteralToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface LabelStatement extends Statement {
    kind: "Label";
    token: LabelToken;
    label: (IdentifierToken | NumberLiteralToken)[];
}
  