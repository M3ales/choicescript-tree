import { IdentifierToken, StatChartToken } from "../../scanner/tokens";
import { ProseValue } from "./prose-value";
import { Statement } from "./statement";

export interface StatChartStatement extends Statement {
  kind: "StatChart";
  token: StatChartToken;
  title?: ProseValue;
  stats: Stat[];
}

export interface Stat {
    kind: "Text" | "OpposedPair" | "Percent"
    token: IdentifierToken,
    variable: IdentifierToken
    displayName: ProseValue | undefined;
}

export interface TextStat extends Stat {
    kind: "Text";
    token: IdentifierToken;
    variable: IdentifierToken;
    displayName: ProseValue | undefined;
}

export interface PercentStat extends Stat {
    kind: "Percent";
    token: IdentifierToken;
    variable: IdentifierToken;
    displayName: ProseValue | undefined;
}

export interface OpposedPairStat extends Stat {
    kind: "OpposedPair";
    token: IdentifierToken;
    variable: IdentifierToken;
    displayName: ProseValue | undefined;
    opposingDisplayName: ProseValue | undefined;
}
