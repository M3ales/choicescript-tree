import { GotoLabelToken, IdentifierToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface GotoLabelStatement extends Statement {
    kind: "GotoLabel";
    token: GotoLabelToken;
    label: IdentifierToken;
}
  