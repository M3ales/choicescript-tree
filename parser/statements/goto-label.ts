import { GotoLabelToken, IdentifierToken, NumberLiteralToken } from "../../scanner/tokens";
import { Statement } from "./statement";
import { Expression } from "../expressions";

export interface GotoLabelStatement extends Statement {
    kind: "GotoLabel";
    token: GotoLabelToken;
    label: (IdentifierToken | NumberLiteralToken)[] | Expression;
}
  