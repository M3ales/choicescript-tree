import { GoSubToken, IdentifierToken, NumberLiteralToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface GoSubSceneStatement extends Statement {
    kind: "GoSubScene";
    token: GoSubToken;
    scene: IdentifierToken;
    label: IdentifierToken | Expression;
    args: Expression[];
}
  