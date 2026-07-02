import { IndentationContext } from "./indentation-context";
import { Scene } from "./scene";
import { Token } from "./tokens";

export interface ScannerContext {
  proseBlock: string;
  proseBlockStart:
    | { position: number; lineNumber: number; indent: number }
    | undefined;

  currentToken: string;
  currentTokenStartPosition: number | undefined;

  currentLine: string;

  position: number;
  lineNumber: number;
  scene: Scene;
  sceneLines: string[];

  insideMultiLineToken: boolean;

  mode:
    | "ProseToEOL"
    | "Prose"
    | "Command"
    | "Expression"
    | "LabelToEOL"
    | "SceneArgToEOL"
    | "GoSubArgsToEOL"
    | "Comment"
    | "ChoiceOption"
    | "Achievement"
    | "SceneList"
    | "StatChart"
    | "Image";

  gosubArgs?: boolean;

  indent: IndentationContext;
}
