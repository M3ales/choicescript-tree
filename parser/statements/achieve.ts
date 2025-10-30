import { AchieveToken, IdentifierToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface AchieveStatement extends Statement {
  kind: "Achieve";
  token: AchieveToken;
  codename: IdentifierToken;
}
