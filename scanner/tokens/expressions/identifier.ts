import { Token } from "../token";
export interface IdentifierToken extends Token {
    type: 'Identifier';
    value: string;
    rawValue: string;
    isLabelName: boolean | undefined;
    isSceneName: boolean | undefined;
}
