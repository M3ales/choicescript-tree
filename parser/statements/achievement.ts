import { AchievementToken, IdentifierToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface AchievementStatement extends Statement {
  kind: "Achievement";
  token: AchievementToken;
  codename: IdentifierToken;
  hidden: boolean;
  title: ProseToken;
  visibility: IdentifierToken;
  preDescription: ProseToken | null;
  postDescription: ProseToken;
}
