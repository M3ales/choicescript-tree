import { Statement } from "./statements";

export interface SceneAst {
    name: string;
    statements: Statement[];
}