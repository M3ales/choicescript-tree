import * as vscode from "vscode";

export class ChoiceScriptCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      if (diag.source !== "choicescript") continue;
      if (diag.code === "multiline-multireplace") {
        const fix = this.fixMultilineMultireplace(document, diag);
        if (fix) actions.push(fix);
      }
      if (diag.code === "label-wrong-scene") {
        actions.push(...this.fixLabelWrongScene(document, diag));
      }
    }
    return actions;
  }

  private fixMultilineMultireplace(
    document: vscode.TextDocument,
    diag: vscode.Diagnostic,
  ): vscode.CodeAction | undefined {
    const range = diag.range;
    const text = document.getText(range);
    if (!text.includes("\n")) return undefined;

    const joined = text.replace(/\n\s*/g, " ");
    const action = new vscode.CodeAction(
      "Join multireplace onto a single line",
      vscode.CodeActionKind.QuickFix,
    );
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, range, joined);
    action.diagnostics = [diag];
    action.isPreferred = true;
    return action;
  }

  private fixLabelWrongScene(
    document: vscode.TextDocument,
    diag: vscode.Diagnostic,
  ): vscode.CodeAction[] {
    const fixData = (diag as any)._fixData as
      | { sceneRange: vscode.Range; suggestions: string[] }
      | undefined;
    if (!fixData?.suggestions?.length) return [];

    return fixData.suggestions.map((scene, i) => {
      const action = new vscode.CodeAction(
        `Change scene to "${scene}"`,
        vscode.CodeActionKind.QuickFix,
      );
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, fixData.sceneRange, scene);
      action.diagnostics = [diag];
      if (i === 0) action.isPreferred = true;
      return action;
    });
  }
}
