import { SceneAst } from "../../parser/scene";
import { LabelStatement, SaveCheckpointStatement, DeclareVariableStatement, EndingStatement, FinishStatement, ReturnStatement, GoSubStatement, GoSubSceneStatement, GotoLabelStatement, GotoSceneStatement } from "../../parser/statements";
import { AnalysisError } from "../errors";

export interface SceneAstWithSymbolTable extends SceneAst {
    symbolTable: {
        labels: Record<string, LabelStatement>;
        checkpoints: Record<string, SaveCheckpointStatement>;
        globalVariables: Record<string, DeclareVariableStatement>;
        tempVariables: Record<string, DeclareVariableStatement>;
        gosubs: (GoSubStatement | GoSubSceneStatement)[];
        gotos: (GotoLabelStatement | GotoSceneStatement)[];
        errors: AnalysisError[];
    }
}