import { GotoLabelToken, IdentifierToken, LabelToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface LabelStatement extends Statement {
    kind: "Label";
    token: LabelToken;
    label: IdentifierToken;
}
  