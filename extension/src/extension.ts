import * as vscode from "vscode";
import { WorkspaceAnalyser } from "./pipeline";
import { pushDiagnostics } from "./diagnostics";
import {
  ChoiceScriptSemanticTokensProvider,
  legend,
} from "./semantic-tokens";
import { ChoiceScriptHoverProvider } from "./hover";
import { ChoiceScriptDefinitionProvider } from "./definition";
import { ChoiceScriptFoldingProvider } from "./folding";
import { InlineHintDecorator } from "./inline-hints";
import { ChoiceScriptReferenceProvider } from "./references";
import { ChoiceScriptRenameProvider } from "./rename";
import { ChoiceScriptDocumentSymbolProvider, ChoiceScriptWorkspaceSymbolProvider } from "./symbols";
import {
  detectChoiceScriptFolders,
  setLanguageForFolder,
  watchStartupFile,
  isInFolder,
} from "./language-detection";
import { ChoiceScriptCodeActionProvider } from "./code-actions";

const selector: vscode.DocumentSelector = { language: "choicescript" };

let activeFolders: vscode.Uri[] = [];
const analysers = new Map<string, WorkspaceAnalyser>();
let analysisTimer: ReturnType<typeof setTimeout> | undefined;
let diagnosticCollection: vscode.DiagnosticCollection;
let semanticProvider: ChoiceScriptSemanticTokensProvider;
let hoverProvider: ChoiceScriptHoverProvider;
let definitionProvider: ChoiceScriptDefinitionProvider;
let referenceProvider: ChoiceScriptReferenceProvider;
let renameProvider: ChoiceScriptRenameProvider;
let documentSymbolProvider: ChoiceScriptDocumentSymbolProvider;
let workspaceSymbolProvider: ChoiceScriptWorkspaceSymbolProvider;
let inlineHints: InlineHintDecorator;
let statusBar: vscode.StatusBarItem;

function scheduleAnalysis() {
  if (analysisTimer) clearTimeout(analysisTimer);
  analysisTimer = setTimeout(runFullAnalysis, 300);
}

function getAnalyser(folder: vscode.Uri): WorkspaceAnalyser {
  const key = folder.toString();
  let analyser = analysers.get(key);
  if (!analyser) {
    analyser = new WorkspaceAnalyser();
    analysers.set(key, analyser);
  }
  return analyser;
}

async function runFullAnalysis() {
  statusBar.text = "$(sync~spin) ChoiceScript Tree";
  statusBar.tooltip = "Analysing workspace…";
  const startTime = Date.now();
  try {
    await Promise.all(activeFolders.map(async (folder) => {
      try {
        const config = vscode.workspace.getConfiguration("choicescript");
        const showConditionHints = config.get<boolean>("showConditionHints", true);
        const analyser = getAnalyser(folder);
        const result = await analyser.analyse(folder, {
          computeConditionHints: showConditionHints,
          onStage: (stage) => { statusBar.text = `$(sync~spin) ChoiceScript Tree: ${stage}`; },
        });
        await pushDiagnostics(diagnosticCollection, folder, result);
        semanticProvider.updateContext(result.knownLabels, result.sceneNames, result.locationIndex);
        hoverProvider.updateData(
          result.symbolTable,
          result.locationIndex,
          folder,
        );
        definitionProvider.updateData(result.locationIndex, folder);
        referenceProvider.updateData(result.locationIndex, folder);
        renameProvider.updateData(result.locationIndex, folder);
        documentSymbolProvider.updateData(result.locationIndex);
        workspaceSymbolProvider.updateData(result.locationIndex, folder);
        inlineHints.setEnabled(showConditionHints);
        inlineHints.updateScenes(result.scenes);
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === "choicescript") {
          inlineHints.update(editor);
        }
      } catch (e) {
        console.error("ChoiceScript analysis failed:", e);
      }
    }));
    const elapsed = Date.now() - startTime;
    statusBar.text = "$(check) ChoiceScript Tree";
    statusBar.tooltip = `Analysis complete (${elapsed}ms)`;
  } catch (e) {
    statusBar.text = "$(error) ChoiceScript Tree";
    statusBar.tooltip = "Analysis failed";
  }
}

async function handleFolderDetected(folder: vscode.Uri) {
  if (!activeFolders.some((f) => f.toString() === folder.toString())) {
    activeFolders.push(folder);
  }
  await setLanguageForFolder(folder);
  scheduleAnalysis();
}

function handleFolderRemoved(folder: vscode.Uri) {
  const key = folder.toString();
  activeFolders = activeFolders.filter((f) => f.toString() !== key);
  const analyser = analysers.get(key);
  if (analyser) {
    analyser.reset();
    analysers.delete(key);
  }
  diagnosticCollection.clear();
}

export async function activate(context: vscode.ExtensionContext) {
  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("choicescript");
  context.subscriptions.push(diagnosticCollection);

  semanticProvider = new ChoiceScriptSemanticTokensProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      semanticProvider,
      legend
    )
  );

  hoverProvider = new ChoiceScriptHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, hoverProvider)
  );

  definitionProvider = new ChoiceScriptDefinitionProvider();
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, definitionProvider)
  );

  referenceProvider = new ChoiceScriptReferenceProvider();
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(selector, referenceProvider)
  );

  renameProvider = new ChoiceScriptRenameProvider();
  context.subscriptions.push(
    vscode.languages.registerRenameProvider(selector, renameProvider)
  );

  documentSymbolProvider = new ChoiceScriptDocumentSymbolProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(selector, documentSymbolProvider)
  );

  workspaceSymbolProvider = new ChoiceScriptWorkspaceSymbolProvider();
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
  );

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(selector, new ChoiceScriptFoldingProvider())
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new ChoiceScriptCodeActionProvider(),
      { providedCodeActionKinds: ChoiceScriptCodeActionProvider.providedCodeActionKinds },
    )
  );

  inlineHints = new InlineHintDecorator();
  inlineHints.activate(context);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBar.text = "$(circle-outline) ChoiceScript Tree";
  statusBar.tooltip = "Waiting for analysis…";
  statusBar.command = "choicescript.analyseWorkspace";
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("choicescript.setLanguageMode", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await vscode.languages.setTextDocumentLanguage(
          editor.document,
          "choicescript"
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("choicescript.analyseWorkspace", () => {
      runFullAnalysis();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("choicescript.clearCache", () => {
      for (const analyser of analysers.values()) {
        analyser.reset();
      }
      diagnosticCollection.clear();
      semanticProvider.updateContext([], [], null);
      vscode.window.showInformationMessage("ChoiceScript cache cleared. Re-analysing…");
      runFullAnalysis();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "choicescript") {
        scheduleAnalysis();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (doc.languageId === "plaintext" && doc.fileName.endsWith(".txt")) {
        if (activeFolders.some((f) => isInFolder(doc.uri, f))) {
          await vscode.languages.setTextDocumentLanguage(doc, "choicescript");
        }
      }
    })
  );

  const config = vscode.workspace.getConfiguration("choicescript");
  if (config.get<boolean>("autoDetect", true)) {
    const folders = await detectChoiceScriptFolders();
    for (const folder of folders) {
      await handleFolderDetected(folder);
    }

    watchStartupFile(context, handleFolderDetected, handleFolderRemoved);
  }
}

export function deactivate() {
  if (analysisTimer) clearTimeout(analysisTimer);
}
