import { ProseToken, SaveCheckpointToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface SaveCheckpointStatement extends Statement {
    token: SaveCheckpointToken;
    kind: 'SaveCheckpoint';
    identifier: ProseToken | undefined;
}