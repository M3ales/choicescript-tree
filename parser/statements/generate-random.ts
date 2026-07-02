import { GenerateRandomToken, IdentifierToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement, ContentKeyFn } from "./statement";

export interface GenerateRandomStatement extends Statement {
    kind: "GenerateRandom";
    token: GenerateRandomToken;
    identifier: IdentifierToken,
    min: Expression,
    max: Expression,
}

export const contentKey: ContentKeyFn<GenerateRandomStatement> = (stmt) => stmt.identifier?.value;