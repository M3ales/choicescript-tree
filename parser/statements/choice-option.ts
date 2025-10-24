import { ChoiceOptionToken, CreateTempVariableToken, CreateVariableToken, IdentifierToken, SetVariableToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { SelectableIfStatement } from "./selectable-if";
import { Statement } from "./statement";

export interface ChoiceOptionStatement extends Statement {
  kind: "ChoiceOption";
  token: ChoiceOptionToken;
  body: Statement[];
  selectableIf: Expression | null;
  reuse: 'hide_reuse' | 'disable_reuse' | 'allow_reuse' | null;
}
