import { ElseToken } from "../../scanner/tokens";
import { Expression } from "../expressions";
import { Statement } from "./statement";

export interface ElseStatement extends Statement {
  kind: "Else";
  token: ElseToken;
  body: Statement[];
}
