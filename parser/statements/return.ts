import { GotoSceneToken, IdentifierToken, ReturnToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface ReturnStatement extends Statement {
    kind: "Return";
    token: ReturnToken;
}
  