import { Token } from './token';

export interface SaveCheckpoint extends Token {
    type: 'SaveCheckpoint';
}