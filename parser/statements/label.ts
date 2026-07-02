import { IdentifierToken, LabelToken, NumberLiteralToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement, ContentKeyFn } from "./statement";

export interface LabelStatement extends Statement {
    kind: "Label";
    token: LabelToken;
    label: IdentifierToken;
}

export const contentKey: ContentKeyFn<LabelStatement> = (stmt) => stmt.label?.value;
  