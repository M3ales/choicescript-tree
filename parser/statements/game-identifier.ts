import { GameIdentifierToken, GenerateRandomToken, IdentifierToken, NumberLiteralToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface GameIdentifierStatement extends Statement {
    kind: "GameIdentifier";
    token: GameIdentifierToken;
    uuid: ProseToken
}