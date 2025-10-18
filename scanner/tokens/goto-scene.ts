import { Token } from './token';

export interface GotoSceneToken extends Token {
    type: 'GotoScene';
}