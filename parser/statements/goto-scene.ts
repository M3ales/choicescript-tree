import { GotoSceneToken, IdentifierToken, NumberLiteralToken } from "../../scanner/tokens";
import { Statement } from "./statement";
import { Expression } from "../expressions";

export interface GotoSceneStatement extends Statement {
    kind: "GotoScene";
    token: GotoSceneToken;
    scene: IdentifierToken;
    label: (IdentifierToken | NumberLiteralToken)[] | Expression;
}
  