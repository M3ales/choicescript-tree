import { StatementTypes } from "./statement-types";
import { ContentKeyFn, Statement } from "./statement";
import { contentKey as declareVariable } from "./declare-variable";
import { contentKey as declareArray } from "./declare-array";
import { contentKey as deleteVariable } from "./delete-variable";
import { contentKey as deleteArray } from "./delete-array";
import { contentKey as generateRandom } from "./generate-random";
import { contentKey as achieve } from "./achieve";
import { contentKey as achievement } from "./achievement";
import { contentKey as inputNumber } from "./input-number";
import { contentKey as inputText } from "./input-text";
import { contentKey as label } from "./label";

const hashBody = (body: Statement[]): string => {
  let h = 0;
  for (const stmt of body) {
    const s = stmt.statementId ?? stmt.kind;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
  }
  return (h >>> 0).toString(36);
};

const bodyKey = (stmt: { body?: Statement[] }): string | undefined =>
  stmt.body ? hashBody(stmt.body) : undefined;

const ifKey = (stmt: { body?: Statement[]; elseIfBranches?: Statement[]; elseBranch?: { body?: Statement[] } | null }): string | undefined => {
  const parts: Statement[] = [];
  if (stmt.body) parts.push(...stmt.body);
  if (stmt.elseIfBranches) parts.push(...stmt.elseIfBranches);
  if (stmt.elseBranch?.body) parts.push(...stmt.elseBranch.body);
  return parts.length > 0 ? hashBody(parts) : undefined;
};

const registry: Partial<Record<StatementTypes, ContentKeyFn>> = {
  DeclareVariable: declareVariable,
  DeclareArray: declareArray,
  DeleteVariable: deleteVariable,
  DeleteArray: deleteArray,
  GenerateRandom: generateRandom,
  Achieve: achieve,
  Achievement: achievement,
  InputNumber: inputNumber,
  InputText: inputText,
  Label: label,
  Choice: bodyKey as ContentKeyFn,
  FakeChoice: bodyKey as ContentKeyFn,
  ChoiceOption: bodyKey as ContentKeyFn,
  If: ifKey as ContentKeyFn,
  ElseIf: bodyKey as ContentKeyFn,
  Else: bodyKey as ContentKeyFn,
};

export const getContentKey = (stmt: { kind: string; [key: string]: any }): string | undefined => {
  const fn = registry[stmt.kind as StatementTypes];
  return fn?.(stmt as any);
};
