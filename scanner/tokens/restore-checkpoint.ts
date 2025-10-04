import { Token } from './token';

export interface RestoreCheckpoint extends Token {
    type: 'RestoreCheckpoint';
}