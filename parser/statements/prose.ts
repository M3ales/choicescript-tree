import { ProseToken } from "../../scanner/tokens";
import { ProseSegmentStatement } from "./parsed-prose-segment";
import { Statement } from "./statement";

export interface ProseStatement extends Statement {
    content: ProseToken[];
    kind: 'Prose';
    parsedSegments?: ProseSegmentStatement[];
}