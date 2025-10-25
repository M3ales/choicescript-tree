import {IndentationContext} from "./indentation-context";
import {Scene} from "./scene";

export interface ScannerContext {
    proseBlock: string;
    proseBlockStart: {position: number, lineNumber: number, indent: number} | undefined;

    currentToken: string;
    currentTokenStartPosition: number | undefined;

    position: number;
    lineNumber: number;
    currentScene: Scene;

    insideMultiLineToken: boolean;

    mode: 'Indentation' | 'ProseToEOL' | 'Prose' | 'Token' | 'Expression' | 'Comment' | 'ChoiceOption' | 'MultiReplace'

    indent: IndentationContext;
}
