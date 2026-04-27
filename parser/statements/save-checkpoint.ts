import { SaveCheckpointToken } from "../../scanner/tokens";
import { ProseLiteral } from "./prose-literal";
import { Statement } from "./statement";

export interface SaveCheckpointStatement extends Statement {
    token: SaveCheckpointToken;
    kind: 'SaveCheckpoint';
    identifier: ProseLiteral | undefined;
}
