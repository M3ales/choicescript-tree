import { Token } from "../token";
export interface DollarToken extends Token {
    type: 'Dollar';
    value: string;
}
