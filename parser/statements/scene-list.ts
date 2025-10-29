import { IdentifierToken, SceneListToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface SceneListStatement extends Statement {
    kind: "SceneList";
    token: SceneListToken;
    identifiers: SceneIdentifier[];
}

export interface SceneIdentifier extends IdentifierToken {
    paid: boolean;
}