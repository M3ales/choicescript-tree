import { ChoiceOptionToken, CreateTempVariableToken, CreateVariableToken, IdentifierToken, IfToken, SelectableIfToken, SetVariableToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { ChoiceOptionStatement } from "./choice-option";
import { Statement } from "./statement";

export interface SelectableIfStatement extends Statement {
  kind: "SelectableIf";
  token: SelectableIfToken;
  expression: Expression;
}
