import { AchieveToken, IdentifierToken } from "../../scanner/tokens";
import { Statement, ContentKeyFn } from "./statement";

export interface AchieveStatement extends Statement {
  kind: "Achieve";
  token: AchieveToken;
  codename: IdentifierToken;
}

export const contentKey: ContentKeyFn<AchieveStatement> = (stmt) => stmt.codename?.value;
