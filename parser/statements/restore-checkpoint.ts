import { ProseToken, RestoreCheckpointToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface RestoreCheckpointStatement extends Statement {
    token: RestoreCheckpointToken;
    kind: 'RestoreCheckpoint';
    identifier: ProseToken | undefined;
}