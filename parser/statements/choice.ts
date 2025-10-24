import { ChoiceToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface ChoiceStatement extends Statement {
    kind: "Choice";
    token: ChoiceToken;
    body: Statement[];
  }
  