export interface Token {
    lineNumber: number;
    position: number;
    type: string;
    sceneName: string;
    indent: number;
    errors: string[];
}