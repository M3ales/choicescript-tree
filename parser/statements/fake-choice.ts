import { FakeChoiceToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface FakeChoiceStatement extends Statement {
    kind: "FakeChoice";
    token: FakeChoiceToken;
    body: Statement[];
  }
  