import { Token } from "../scanner/tokens";

export interface ParseError {
  token: Token;
  message: string;
}
