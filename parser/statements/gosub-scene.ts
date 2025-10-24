import { GoSubToken, GotoLabelToken, IdentifierToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface GoSubSceneStatement extends Statement {
    kind: "GoSubScene";
    token: GoSubToken;
    scene: IdentifierToken;
    label: IdentifierToken | null;
}
  