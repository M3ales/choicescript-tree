import { SceneAst } from "../../parser/scene";
import {
  DeclareVariableStatement,
  GoSubSceneStatement,
  GoSubStatement,
  GotoLabelStatement,
  GotoSceneStatement,
  LabelStatement,
  SaveCheckpointStatement,
} from "../../parser/statements";
import { Visitor, walk } from "../traversal";
import { SceneAstWithSymbolTable } from "./scene-ast-with-symbol-table";
import parsedOutput from "../../parsed.json";
import fs from 'node:fs';

const buildSymbolTable = (scene: SceneAst) : SceneAstWithSymbolTable => {
  const labels = new Map<string, LabelStatement>();
  const labelVisitor = <Visitor>{
    predicate: stmt => stmt.kind === "Label",
    visit: stmt => {
      const labelStatement = stmt as LabelStatement;
      labels.set(labelStatement.label.value, labelStatement);
    }
  };

  const globalVariables = new Map<string, DeclareVariableStatement>();
  const tempVariables = new Map<string, DeclareVariableStatement>();
  const variableVisitor = <Visitor>{
    predicate: stmt => stmt.kind === "DeclareVariable",
    visit: stmt => {
      const variable = stmt as DeclareVariableStatement;
      switch(variable.scope) {
        case 'Global':
        {
          globalVariables.set(variable.variable.value, variable);
          break;
        }
        case 'Temporary':{
          tempVariables.set(variable.variable.value, variable);
          break;
        }
        default:
          {
            throw new Error(`Unknown variable scope '${variable.scope}'`);
          }
      }
    }
  };

  const checkpoints = new Map<string, SaveCheckpointStatement>();
  const checkpointVisitor = <Visitor>{
    predicate: stmt => stmt.kind === "SaveCheckpoint",
    visit: stmt => {
      const checkpoint = stmt as SaveCheckpointStatement;
      checkpoints.set(checkpoint.identifier.content, checkpoint);
    }
  };

  const gotos: (GotoLabelStatement | GotoSceneStatement)[] = [];
  const gotoVisitor = <Visitor>{
    predicate: stmt => stmt.kind === "GotoLabel" || stmt.kind === "GotoScene",
    visit: stmt => {
      const goto = stmt as GotoLabelStatement | GotoSceneStatement;
      gotos.push(goto);
    }
  };

  const gosubs: (GoSubStatement | GoSubSceneStatement)[] = [];
  const gosubVisitor = <Visitor>{
    predicate: stmt => stmt.kind === "GoSub" || stmt.kind === "GoSubScene",
    visit: stmt => {
      const gosub = stmt as (GoSubStatement | GoSubSceneStatement);
      gosubs.push(gosub);
    }
  };

  const visitors = [
    labelVisitor,
    variableVisitor,
    checkpointVisitor,
    gotoVisitor,
    gosubVisitor,
  ];

  walk(
    scene.statements,
    visitors
  );

  return <SceneAstWithSymbolTable>{
    ...scene,
    symbolTable: {
      labels: Object.fromEntries(labels),
      globalVariables: Object.fromEntries(globalVariables),
      tempVariables: Object.fromEntries(tempVariables),
      checkpoints: Object.fromEntries(checkpoints),
      gosubs: gosubs,
      gotos: gotos,
    }
  };
}

// Step 1: Collect Definitions of Labels, Variables and Save Checkpoints
// Step 2: Collect all references to variables and labels

const scenes = parsedOutput as SceneAst[];
let result = scenes
  .map(buildSymbolTable);

fs.writeFileSync('./symbol-table.json', JSON.stringify(result, null, 2));
console.log(`Symbol Tables created for ${result.length} scenes`);
