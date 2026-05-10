import "../../bootstrap";
import { GotoSceneStatement, GoSubSceneStatement, Statement } from "../../parser/statements";
import { LabelStatement } from "../../parser/statements";
import { IdentifierToken } from "../../scanner/tokens";
import { Expression } from "../../parser/expressions";
import { Binary } from "../../parser/expressions/binary";
import { Literal } from "../../parser/expressions/literal";
import { Identifier } from "../../parser/expressions/identifier";
import { Unary } from "../../parser/expressions/unary";
import { Dereference } from "../../parser/expressions/derefererence";
import { Grouping } from "../../parser/expressions/grouping";
import { AnalysisError } from "../errors";
import { SceneAstWithSymbolTable } from "../symbol-table/scene-ast-with-symbol-table";
import { outPath, getIO } from '../../out-dir';
import { tokenPosition } from "../debug";

const stringifyExpression = (expr: Expression): string => {
  switch (expr.kind) {
    case "Literal": return String((expr as Literal).value.value);
    case "Identifier": return (expr as Identifier).token.value;
    case "Binary": {
      const b = expr as Binary;
      return `${stringifyExpression(b.left)}${(b.operator as any).rawValue}${stringifyExpression(b.right)}`;
    }
    case "Unary": {
      const u = expr as Unary;
      return `${u.operator.rawValue} ${stringifyExpression(u.value)}`;
    }
    case "Dereference": return `{${stringifyExpression((expr as Dereference).expression)}}`;
    case "Grouping": return `(${stringifyExpression((expr as Grouping).expression)})`;
    default: return "(dynamic)";
  }
}

const sceneName = (scene: IdentifierToken | Expression): string | undefined => {
  if ("type" in scene && scene.type === "Identifier") return (scene as IdentifierToken).value;
  return undefined;
}

const labelDisplayName = (label: IdentifierToken | Expression | undefined): string => {
  if (label === undefined) return '';
  if ("type" in label && label.type === "Identifier") return (label as IdentifierToken).value;
  return stringifyExpression(label as Expression);
}

const sceneDisplayName = (scene: IdentifierToken | Expression, label?: IdentifierToken | Expression): string => {
  const name = sceneName(scene);
  if (name !== undefined) return name;
  const scenePart = stringifyExpression(scene as Expression);
  const labelPart = label !== undefined ? labelDisplayName(label) : '';
  return `${scenePart}${labelPart}`;
}

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
      const name = sceneName(sceneGoto.scene);
      if (name !== undefined) {
        const targetScene = checkSceneExists(name, scenes, goto, errors);
        if(targetScene) {
          checkSceneLabel(sceneGoto.label as IdentifierToken | undefined, targetScene, goto, errors);
        }
      } else {
        const displayName = sceneDisplayName(sceneGoto.scene, sceneGoto.label);
        checkSceneExists(displayName, scenes, goto, errors);
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
      const name = sceneName(sceneGosub.scene);
      if (name !== undefined) {
        const targetScene = checkSceneExists(name, scenes, gosub, errors);
        if(targetScene && sceneGosub.label["type"] !== undefined) {
          checkSceneLabel(sceneGosub.label as IdentifierToken, targetScene, gosub, errors);
        }
      } else {
        const displayName = sceneDisplayName(sceneGosub.scene, sceneGosub.label);
        checkSceneExists(displayName, scenes, gosub, errors);
      }
      return gosub;
    }

    if(gosub.label["type"] === undefined) return gosub;
    checkLocalLabel(gosub.label as IdentifierToken, scene.symbolTable.labels, gosub, errors);
    return gosub;
  });

  return scene;
}


const scenes = JSON.parse(getIO().readFile(outPath('symbol-table.json'))) as SceneAstWithSymbolTable[];
let result = scenes
  .map(scene => {
    scene.symbolTable.errors = [];
    return scene;
  })
  .map(checkNavigation);

getIO().writeFile(outPath('symbol-table.json'), JSON.stringify(result, null, 2));
const errors = result.flatMap(r => r.symbolTable.errors);
console.log(`Scope Analysis completed for ${result.length} scenes, found ${errors.length} errors`);
console.table(errors.map(e => ({...e, statementId: e.statement.statementId, location: tokenPosition(e.statement['token']) })), ['message','statementId','severity','location']);
