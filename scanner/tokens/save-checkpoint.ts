import { Token } from './token';

export interface SaveCheckpointToken extends Token {
    type: 'SaveCheckpoint';
}