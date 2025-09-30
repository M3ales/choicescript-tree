import {IndentationContext} from "./indentation-context";
import {Scene} from "./scene";

export interface ScannerContext {
    proseBlock: string;
    currentToken: string;
    currentTokenStartPosition: number | undefined;

    position: number;
    lineNumber: number;
    currentScene: Scene;

    insideMultiLineToken: boolean;

    mode: 'Indentation' | 'Prose' | 'Token' | 'Expression' | 'Comment'

    indent: IndentationContext;
}
