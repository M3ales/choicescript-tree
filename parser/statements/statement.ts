import { StatementTypes } from "./statement-types";

export interface Statement {
  kind: StatementTypes;
  statementId: string,
}

export type ContentKeyFn<T extends Statement = Statement> = (stmt: T) => string | undefined;
