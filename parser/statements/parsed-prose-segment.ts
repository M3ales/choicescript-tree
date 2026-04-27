import { Expression } from "../expressions";

export type ProseSegmentStatementKind =
    | 'Text'
    | 'Print'
    | 'PrintCapitaliseFirst'
    | 'PrintCapitaliseAll'
    | 'MultiReplace';

export interface ProseSegmentStatementBase {
    kind: ProseSegmentStatementKind;
    start: number;
    end: number;
    lineNumber: number;
    position: number;
}

export interface TextParsedProseSegment extends ProseSegmentStatementBase {
    kind: 'Text';
    text: string;
}

export interface PrintParsedProseSegment extends ProseSegmentStatementBase {
    kind: 'Print' | 'PrintCapitaliseFirst' | 'PrintCapitaliseAll';
    expression: Expression;
}

export interface MultiReplaceBranchStatement {
    start: number;
    end: number;
    segments: ProseSegmentStatement[];
}

export interface MultiReplaceParsedProseSegment extends ProseSegmentStatementBase {
    kind: 'MultiReplace';
    selector: Expression;
    alternatives: MultiReplaceBranchStatement[];
}

export type ProseSegmentStatement =
    | TextParsedProseSegment
    | PrintParsedProseSegment
    | MultiReplaceParsedProseSegment;
