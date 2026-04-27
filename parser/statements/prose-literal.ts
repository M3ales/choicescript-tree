import { ProseToken } from "../../scanner/tokens";

export interface ProseLiteral {
    token: ProseToken;
    content: string;
    lineNumber: number;
    position: number;
    indent: number;
    sceneName: string;
}
