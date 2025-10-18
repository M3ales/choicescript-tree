import { Token } from './token';

export interface CommentToken extends Token {
    type: 'Comment';
    value: string;
}