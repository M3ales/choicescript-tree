import { Token } from './token';

export interface RestoreCheckpointToken extends Token {
    type: 'RestoreCheckpoint';
}