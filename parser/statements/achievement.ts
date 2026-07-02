import { AchievementToken, IdentifierToken } from "../../scanner/tokens";
import { ProseLiteral } from "./prose-literal";
import { Statement, ContentKeyFn } from "./statement";

export interface AchievementStatement extends Statement {
  kind: "Achievement";
  token: AchievementToken;
  codename: IdentifierToken;
  hidden: boolean;
  title: ProseLiteral;
  visibility: IdentifierToken;
  preDescription: ProseLiteral | IdentifierToken | null;
  postDescription: ProseLiteral;
}

export const contentKey: ContentKeyFn<AchievementStatement> = (stmt) => stmt.codename?.value;
