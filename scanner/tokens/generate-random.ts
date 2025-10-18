import { Token } from './token';

export interface GenerateRandomToken extends Token {
    type: 'GenerateRandom';
}
