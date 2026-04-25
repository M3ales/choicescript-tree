import { ParseError } from "./parse-error";
import { Statement } from "./statements";

export interface SceneAst {
    name: string;
    statements: Statement[];
    parseErrors?: ParseError[];
}