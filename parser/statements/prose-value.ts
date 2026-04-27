import { ProseToken } from "../../scanner/tokens";
import { ProseSegmentStatement } from "./parsed-prose-segment";

export interface ProseValue {
    token: ProseToken;
    content: string;
    parsedSegments: ProseSegmentStatement[];
    lineNumber: number;
    position: number;
    indent: number;
    sceneName: string;
}
