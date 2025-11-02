import { LineBreakToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface LineBreakStatement extends Statement {
    kind: "LineBreak";
    token: LineBreakToken;
}
  