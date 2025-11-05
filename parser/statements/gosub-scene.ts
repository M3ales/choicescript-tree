import { GoSubToken, IdentifierToken, NumberLiteralToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { ElseStatement } from "./else";
import { ElseIfStatement } from "./else-if";
import { Statement } from "./statement";

export interface GoSubSceneStatement extends Statement {
    kind: "GoSubScene";
    token: GoSubToken;
    scene: IdentifierToken;
    label: (IdentifierToken | NumberLiteralToken)[] | Expression;
    args: Expression[];
    // courtesy of novel usage in aura clash chpt 6
    jankContinuedElseIfBranches: ElseIfStatement[];
    jankContinuedElseBranch: ElseStatement | null;
}
  