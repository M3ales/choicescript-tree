import { GotoSceneToken, IdentifierToken, NumberLiteralToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface GotoSceneStatement extends Statement {
    kind: "GotoScene";
    token: GotoSceneToken;
    scene: IdentifierToken;
    label: (IdentifierToken | NumberLiteralToken)[];
}
  