import { Token } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface ErrorStatement extends Statement {
  kind: "Error";
  token: Token;
  message: string;
}
