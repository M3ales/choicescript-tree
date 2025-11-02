import { GoSubToken, GotoLabelToken, IdentifierToken, NumberLiteralToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface GoSubStatement extends Statement {
    kind: "GoSub";
    token: GoSubToken;
    label: (IdentifierToken | NumberLiteralToken)[];
    args: Expression[];
}
  