import { Token } from "../scanner/tokens";

export interface ParseContext {
  kind: string;
  token: Token;
}

export interface ParseError {
  token: Token;
  endToken?: Token;
  message: string;
  context?: ParseContext[];
  solutionCode?: string;
}
