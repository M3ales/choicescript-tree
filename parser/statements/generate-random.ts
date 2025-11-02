import { GenerateRandomToken, IdentifierToken, NumberLiteralToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface GenerateRandomStatement extends Statement {
    kind: "GenerateRandom";
    token: GenerateRandomToken;
    identifier: IdentifierToken,
    min: NumberLiteralToken,
    max: NumberLiteralToken,
}