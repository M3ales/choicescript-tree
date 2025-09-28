import {Token} from "./token";

export interface Operator extends Token {
    operator: 'assignment' | 'addition' | 'subtraction' | 'fairmath_addition' | 'fairmath_subtraction';
    rawValue: '=' | '+' | '-' | '%+' | '%-'
    type: 'Operator';
}
