import { GoSubToken, GotoLabelToken, IdentifierToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface GoSubStatement extends Statement {
    kind: "GoSub";
    token: GoSubToken;
    label: IdentifierToken;
}
  