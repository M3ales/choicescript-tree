import { RestoreCheckpointToken } from "../../scanner/tokens";
import { ProseLiteral } from "./prose-literal";
import { Statement } from "./statement";

export interface RestoreCheckpointStatement extends Statement {
    token: RestoreCheckpointToken;
    kind: 'RestoreCheckpoint';
    identifier: ProseLiteral | undefined;
}
