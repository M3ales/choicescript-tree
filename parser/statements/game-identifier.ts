import { GameIdentifierToken } from "../../scanner/tokens";
import { ProseLiteral } from "./prose-literal";
import { Statement } from "./statement";

export interface GameIdentifierStatement extends Statement {
    kind: "GameIdentifier";
    token: GameIdentifierToken;
    uuid: ProseLiteral;
}
