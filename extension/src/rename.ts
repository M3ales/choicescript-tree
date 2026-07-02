import * as vscode from "vscode";
import { LocationIndex } from "../../api";
import { computeVariableRename, computeLabelRename, computeAchievementRename, TextEdit } from "../../analysis/refactor/rename";

export class ChoiceScriptRenameProvider implements vscode.RenameProvider {
  private locationIndex: LocationIndex | null = null;
  private folder: vscode.Uri | null = null;

  updateData(locationIndex: LocationIndex, folder: vscode.Uri) {
    this.locationIndex = locationIndex;
    this.folder = folder;
  }

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Range | null {
    if (!this.locationIndex) return null;

    const range = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range) return null;

    const word = document.getText(range);
    const ctx = this.classifyCursor(document, position, range);
    if (!ctx) return null;

    if (ctx.kind === "label") {
      const ss = this.locationIndex.getSceneSymbols(ctx.scene);
      if (!ss) return null;
      const hasLabel = [...ss.labels.keys()].some(
        k => k.toLowerCase() === word.toLowerCase(),
      );
      if (!hasLabel) return null;
    } else if (ctx.kind === "achievement") {
      if (!this.locationIndex.findAchievementDefinition(word)) return null;
    } else {
      const occs = this.locationIndex.queryIdentifier(word);
      if (occs.length === 0) return null;
    }

    return range;
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
  ): vscode.WorkspaceEdit | null {
    if (!this.locationIndex || !this.folder) return null;

    const range = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range) return null;

    const word = document.getText(range);
    const ctx = this.classifyCursor(document, position, range);
    if (!ctx) return null;

    const result = ctx.kind === "label"
      ? computeLabelRename(this.locationIndex, word, newName, ctx.scene)
      : ctx.kind === "achievement"
        ? computeAchievementRename(this.locationIndex, word, newName)
        : computeVariableRename(this.locationIndex, word, newName, ctx.scene);

    if (result.edits.length === 0) return null;

    return this.toWorkspaceEdit(result.edits);
  }

  private classifyCursor(
    document: vscode.TextDocument,
    position: vscode.Position,
    range: vscode.Range,
  ): { kind: "variable" | "label" | "achievement"; scene: string } | null {
    const line = document.lineAt(position.line).text;
    const linePrefix = line.substring(0, range.start.character).trimStart();
    const sceneName = fileToScene(document.fileName);

    if (/\*label\s+$/i.test(linePrefix)) {
      return { kind: "label", scene: sceneName };
    }
    if (/\*(goto|gosub)\s+$/i.test(linePrefix)) {
      return { kind: "label", scene: sceneName };
    }
    if (/\*(goto_scene|gosub_scene)\s+(\w+)\s+$/i.test(linePrefix)) {
      const match = linePrefix.match(/\*(?:goto_scene|gosub_scene)\s+(\w+)\s+$/i);
      if (match) return { kind: "label", scene: match[1] };
    }
    if (/\*(achieve|achievement)\s+$/i.test(linePrefix)) {
      return { kind: "achievement", scene: sceneName };
    }

    return { kind: "variable", scene: sceneName };
  }

  private toWorkspaceEdit(edits: TextEdit[]): vscode.WorkspaceEdit {
    const wsEdit = new vscode.WorkspaceEdit();

    for (const edit of edits) {
      const uri = vscode.Uri.joinPath(this.folder!, `${edit.scene}.txt`);
      const range = new vscode.Range(
        edit.line, edit.position,
        edit.line, edit.position + edit.length,
      );
      wsEdit.replace(uri, range, edit.newText);
    }

    return wsEdit;
  }
}

function fileToScene(fileName: string): string {
  return fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\.txt$/, "");
}
