import { GotoSceneStatement, GoSubSceneStatement, Statement } from "../../parser/statements";
import { LabelStatement } from "../../parser/statements";
import { IdentifierToken } from "../../scanner/tokens";
import { AnalysisError } from "../errors";
import { SceneAstWithSymbolTable } from "../symbol-table/scene-ast-with-symbol-table";
import input from '../../symbol-table.json';
import fs from 'node:fs';
import { tokenPosition } from "../debug";

const findLabel = (labels: Record<string, LabelStatement>, name: string): boolean => {
  return labels[name] !== undefined;
}

const checkSceneLabel = (
  label: IdentifierToken | undefined,
  targetScene: SceneAstWithSymbolTable,
  statement: Statement,
  errors: AnalysisError[]
) => {
  if(label === undefined || label["type"] === undefined) return;
  if(!findLabel(targetScene.symbolTable.labels, label.value)) {
    errors.push(<AnalysisError>{
      message: `Failed to find label matching ${label.value} in scene ${targetScene.name}`,
      statement,
      severity: 'Error',
      solutionCode: 0,
      context: { tryDownload: label.value }
    });
  }
}

const checkLocalLabel = (
  label: IdentifierToken,
  labels: Record<string, LabelStatement>,
  statement: Statement,
  errors: AnalysisError[]
) => {
  if(!findLabel(labels, label.value)) {
    errors.push(<AnalysisError>{
      message: `Failed to find label matching ${label.value}`,
      statement,
      severity: 'Error',
      solutionCode: 0,
      context: { tryDownload: label.value }
    });
  }
}

const checkSceneExists = (
  sceneName: string,
  scenes: SceneAstWithSymbolTable[],
  statement: Statement,
  errors: AnalysisError[]
): SceneAstWithSymbolTable | undefined => {
  const targetScene = scenes.find(s => s.name === sceneName);
  if(targetScene === undefined) {
    errors.push(<AnalysisError>{
      message: `Failed to find scene matching ${sceneName}`,
      statement,
      severity: 'Error',
      solutionCode: 1,
      context: { tryFetchScene: sceneName }
    });
  }
  return targetScene;
}

export const checkNavigation = (scene: SceneAstWithSymbolTable, index: number, scenes: SceneAstWithSymbolTable[]) => {
  const errors = scene.symbolTable.errors;

  scene.symbolTable.gotos = scene.symbolTable.gotos?.map(goto => {
    if(goto.kind === 'GotoScene') {
      const sceneGoto = goto as GotoSceneStatement;
      const targetScene = checkSceneExists(sceneGoto.scene.value, scenes, goto, errors);
      if(targetScene) {
        checkSceneLabel(sceneGoto.label as IdentifierToken | undefined, targetScene, goto, errors);
      }
      return goto;
    }

    if(goto.label["type"] === undefined) return goto;
    checkLocalLabel(goto.label as IdentifierToken, scene.symbolTable.labels, goto, errors);
    return goto;
  });

  scene.symbolTable.gosubs = scene.symbolTable.gosubs?.map(gosub => {
    if(gosub.kind === 'GoSubScene') {
      const sceneGosub = gosub as GoSubSceneStatement;
      const targetScene = checkSceneExists(sceneGosub.scene.value, scenes, gosub, errors);
      if(targetScene && sceneGosub.label["type"] !== undefined) {
        checkSceneLabel(sceneGosub.label as IdentifierToken, targetScene, gosub, errors);
      }
      return gosub;
    }

    if(gosub.label["type"] === undefined) return gosub;
    checkLocalLabel(gosub.label as IdentifierToken, scene.symbolTable.labels, gosub, errors);
    return gosub;
  });

  return scene;
}


const scenes = input as SceneAstWithSymbolTable[];
let result = scenes
  .map(scene => {
    if(scene.symbolTable.errors === undefined) {
        scene.symbolTable.errors = [];
    }
    return scene;
  })
  .map(checkNavigation);

fs.writeFileSync('./symbol-table.json', JSON.stringify(result, null, 2));
const errors = result.flatMap(r => r.symbolTable.errors);
console.log(`Scope Analysis completed for ${result.length} scenes, found ${errors.length} errors`);
console.table(errors.map(e => ({...e, statementId: e.statement.statementId, location: tokenPosition(e.statement['token']) })), ['message','statementId','severity','location']);
