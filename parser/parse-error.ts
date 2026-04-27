import { Token } from "../scanner/tokens";

export interface ParseContext {
  kind: string;
  token: Token;
}

export interface ParseError {
  token: Token;
  message: string;
  context?: ParseContext[];
}
