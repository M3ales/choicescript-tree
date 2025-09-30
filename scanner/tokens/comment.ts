import { Token } from './token';

export interface Comment extends Token {
    type: 'Comment';
    value: string;
}