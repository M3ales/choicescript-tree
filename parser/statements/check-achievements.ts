import { CheckAchievementsToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface CheckAchievementsStatement extends Statement {
  kind: "CheckAchievements";
  token: CheckAchievementsToken;
}
