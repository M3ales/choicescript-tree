import { GenerateRandomToken, IdentifierToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface GenerateRandomStatement extends Statement {
    kind: "GenerateRandom";
    token: GenerateRandomToken;
    identifier: IdentifierToken,
    min: Expression,
    max: Expression,
}