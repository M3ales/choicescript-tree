import { IdentifierToken, ProseToken, StatChartToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface StatChartStatement extends Statement {
  kind: "StatChart";
  token: StatChartToken;
  stats: Stat[];
}

export interface Stat {
    kind: "Text" | "OpposedPair" | "Percent"
    token: IdentifierToken,
    variable: IdentifierToken
    displayName: ProseToken | undefined;
}

export interface TextStat extends Stat {
    kind: "Text";
    token: IdentifierToken;
    variable: IdentifierToken;
    displayName: ProseToken | undefined;
}
  
export interface PercentStat extends Stat {
    kind: "Percent";
    token: IdentifierToken;
    variable: IdentifierToken;
    displayName: ProseToken | undefined;
}

export interface OpposedPairStat extends Stat {
    kind: "OpposedPair";
    token: IdentifierToken;
    variable: IdentifierToken;
    displayName: ProseToken | undefined;
    opposingDisplayName: ProseToken | undefined;
}