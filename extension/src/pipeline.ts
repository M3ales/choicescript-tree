import * as vscode from "vscode";
import { Scene } from "../../scanner/scene";
import { ParseError } from "../../parser/parse-error";
import {
  CfgReconciler,
  runPipeline,
  PipelineResult,
  SymbolTable,
  LocationIndex,
  NavigationError,
  SceneAst,
  scanLabelNames,
} from "../../api";

export interface AnalysisResult {
  scenes: SceneAst[];
  parseErrors: Map<string, ParseError[]>;
  navigationErrors: NavigationError[];
  knownLabels: string[];
  sceneNames: string[];
  symbolTable: SymbolTable;
  locationIndex: LocationIndex;
  timing: PipelineResult["timing"];
}

const decoder = new TextDecoder();

async function readWorkspaceScenes(folder: vscode.Uri): Promise<Scene[]> {
  const scenes: Scene[] = [];
  const pattern = new vscode.RelativePattern(folder, "*.txt");
  const files = await vscode.workspace.findFiles(pattern);

  for (const file of files) {
    const bytes = await vscode.workspace.fs.readFile(file);
    const content = decoder.decode(bytes);
    const name = file.path.split("/").pop()!.replace(/\.txt$/, "");
    scenes.push({
      sourceUrl: file.toString(),
      name,
      content,
      error: undefined,
      flow: [],
    });
  }

  return scenes;
}

export class WorkspaceAnalyser {
  private reconciler = new CfgReconciler({});
  private previousScenes: Map<string, string> | undefined;
  private previousResult: PipelineResult | undefined;

  async analyse(folder: vscode.Uri, options?: { computeConditionHints?: boolean; onStage?: (stage: string) => void }): Promise<AnalysisResult> {
    const rawScenes = await readWorkspaceScenes(folder);
    const sceneNames = rawScenes.map(s => s.name);

    const pipelineOpts = {
      reconciler: this.reconciler,
      previousScenes: this.previousScenes,
      previousResult: this.previousResult,
      computeConditionHints: options?.computeConditionHints,
    };
    const result = options?.onStage
      ? await runPipeline(rawScenes, { ...pipelineOpts, onStage: options.onStage })
      : runPipeline(rawScenes, pipelineOpts);

    this.previousScenes = new Map(rawScenes.map(s => [s.name, s.content]));
    this.previousResult = result;

    const parseErrors = new Map<string, ParseError[]>();
    for (const ast of result.scenes) {
      if (ast.parseErrors && ast.parseErrors.length > 0) {
        parseErrors.set(ast.name, ast.parseErrors);
      }
    }

    return {
      scenes: result.scenes,
      parseErrors,
      navigationErrors: result.navigationErrors,
      knownLabels: rawScenes.flatMap(s => scanLabelNames(s)),
      sceneNames,
      symbolTable: result.symbolTable,
      locationIndex: result.locationIndex,
      timing: result.timing,
    };
  }

  reset(): void {
    this.reconciler = new CfgReconciler({});
    this.previousScenes = undefined;
    this.previousResult = undefined;
  }
}
