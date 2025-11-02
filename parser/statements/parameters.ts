import { IdentifierToken, ProseToken } from "../../scanner/tokens";
import { ParametersToken } from "../../scanner/tokens/parameters";
import { Statement } from "./statement";

export interface ParametersStatement extends Statement {
    kind: "Parameters";
    token: ParametersToken;
    identifiers: IdentifierToken[];
}