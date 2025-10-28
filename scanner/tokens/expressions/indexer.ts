import { Token } from "../token";
export interface IndexerToken extends Token {
    type: 'Indexer';
    value: string;
}
