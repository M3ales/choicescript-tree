import { ChoiceToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface ChoiceStatement extends Statement {
    kind: "Choice";
    token: ChoiceToken;
    body: Statement[];
    // Tokens that are placed on the same line as the choice token
    noteTokens: ProseToken[];
  }
  