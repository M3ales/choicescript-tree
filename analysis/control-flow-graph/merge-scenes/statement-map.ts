import { Statement } from "../../../parser/statements";

export const buildStatementMap = (statements: Statement[], map: Map<number, Statement>) => {
  for (const stmt of statements) {
    if ((stmt as any).statementId != null) {
      map.set((stmt as any).statementId, stmt);
    }
    const s = stmt as any;
    if (s.body) buildStatementMap(s.body, map);
    if (s.elseIfBranches) s.elseIfBranches.forEach((b: any) => {
      if (b.statementId != null) map.set(b.statementId, b);
      buildStatementMap(b.body, map);
    });
    if (s.elseBranch) {
      if (s.elseBranch.statementId != null) map.set(s.elseBranch.statementId, s.elseBranch);
      buildStatementMap(s.elseBranch.body, map);
    }
    if (s.jankContinuedElseIfBranches) s.jankContinuedElseIfBranches.forEach((b: any) => buildStatementMap(b.body, map));
    if (s.jankContinuedElseBranch) buildStatementMap(s.jankContinuedElseBranch.body, map);
  }
};
