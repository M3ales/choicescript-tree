import { Token } from './token';

export interface CreateTempVariableToken extends Token {
    type: 'CreateTempVariable';
}