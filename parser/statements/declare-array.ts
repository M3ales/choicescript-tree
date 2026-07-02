import { CreateArrayToken, CreateTempArrayToken, IdentifierToken } from "../../scanner/tokens";
import { DeclareVariableStatement } from "./declare-variable";
import { Statement, ContentKeyFn } from "./statement";

export interface DeclareArrayStatement extends Statement {
  kind: "DeclareArray";
  token: CreateArrayToken | CreateTempArrayToken;
  variable: IdentifierToken;
  count: number;
  declarations: DeclareVariableStatement[];
  scope: 'Temporary' | 'Global';
}

export const contentKey: ContentKeyFn<DeclareArrayStatement> = (stmt) => stmt.variable?.value;
