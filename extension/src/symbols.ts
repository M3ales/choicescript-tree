import * as vscode from "vscode";
import { LocationIndex } from "../../api";

export class ChoiceScriptDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  private locationIndex: LocationIndex | null = null;

  updateData(locationIndex: LocationIndex) {
    this.locationIndex = locationIndex;
  }

  provideDocumentSymbols(
    document: vscode.TextDocument,
  ): vscode.DocumentSymbol[] | null {
    if (!this.locationIndex) return null;

    const scene = fileToScene(document.fileName);
    const ss = this.locationIndex.getSceneSymbols(scene);
    if (!ss) return null;

    const symbols: vscode.DocumentSymbol[] = [];

    for (const [name, label] of ss.labels) {
      const line = label.label.lineNumber;
      const pos = label.label.position;
      const range = new vscode.Range(line, 0, line, pos + name.length);
      const selRange = new vscode.Range(line, pos, line, pos + name.length);
      symbols.push(new vscode.DocumentSymbol(
        name, "label", vscode.SymbolKind.Key, range, selRange,
      ));
    }

    for (const [name, decl] of ss.tempVariables) {
      const tok = decl.variable;
      const line = tok.lineNumber;
      const pos = tok.position;
      const range = new vscode.Range(line, 0, line, pos + name.length);
      const selRange = new vscode.Range(line, pos, line, pos + name.length);
      symbols.push(new vscode.DocumentSymbol(
        name, "temp", vscode.SymbolKind.Variable, range, selRange,
      ));
    }

    for (const [name, achievement] of ss.achievements) {
      const tok = achievement.codename;
      const line = tok.lineNumber;
      const pos = tok.position;
      const range = new vscode.Range(line, 0, line, pos + tok.value.length);
      const selRange = new vscode.Range(line, pos, line, pos + tok.value.length);
      symbols.push(new vscode.DocumentSymbol(
        tok.value, "achievement", vscode.SymbolKind.Event, range, selRange,
      ));
    }

    const globalDecls = this.locationIndex.allGlobalDeclarations;
    for (const [name, decl] of globalDecls) {
      if (decl.token.sceneName !== scene) continue;
      const tok = decl.variable;
      const line = tok.lineNumber;
      const pos = tok.position;
      const range = new vscode.Range(line, 0, line, pos + name.length);
      const selRange = new vscode.Range(line, pos, line, pos + name.length);
      symbols.push(new vscode.DocumentSymbol(
        name, "global", vscode.SymbolKind.Variable, range, selRange,
      ));
    }

    symbols.sort((a, b) => a.range.start.line - b.range.start.line);
    return symbols.length > 0 ? symbols : null;
  }
}

export class ChoiceScriptWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  private locationIndex: LocationIndex | null = null;
  private folder: vscode.Uri | null = null;

  updateData(locationIndex: LocationIndex, folder: vscode.Uri) {
    this.locationIndex = locationIndex;
    this.folder = folder;
  }

  provideWorkspaceSymbols(query: string): vscode.SymbolInformation[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const lower = query.toLowerCase();
    const symbols: vscode.SymbolInformation[] = [];

    for (const sceneName of this.locationIndex.allSceneNames) {
      const ss = this.locationIndex.getSceneSymbols(sceneName);
      if (!ss) continue;
      const uri = vscode.Uri.joinPath(this.folder, `${sceneName}.txt`);

      for (const [name, label] of ss.labels) {
        if (lower && !name.toLowerCase().includes(lower)) continue;
        const pos = new vscode.Position(label.label.lineNumber, label.label.position);
        symbols.push(new vscode.SymbolInformation(
          name, vscode.SymbolKind.Key,
          sceneName, new vscode.Location(uri, pos),
        ));
      }

      for (const [, achievement] of ss.achievements) {
        const codename = achievement.codename.value;
        if (lower && !codename.toLowerCase().includes(lower)) continue;
        const pos = new vscode.Position(achievement.codename.lineNumber, achievement.codename.position);
        symbols.push(new vscode.SymbolInformation(
          codename, vscode.SymbolKind.Event,
          sceneName, new vscode.Location(uri, pos),
        ));
      }

      for (const [name, decl] of ss.tempVariables) {
        if (lower && !name.toLowerCase().includes(lower)) continue;
        const pos = new vscode.Position(decl.variable.lineNumber, decl.variable.position);
        symbols.push(new vscode.SymbolInformation(
          name, vscode.SymbolKind.Variable,
          `${sceneName} (temp)`, new vscode.Location(uri, pos),
        ));
      }
    }

    const globalDecls = this.locationIndex.allGlobalDeclarations;
    for (const [name, decl] of globalDecls) {
      if (lower && !name.toLowerCase().includes(lower)) continue;
      const uri = vscode.Uri.joinPath(this.folder, `${decl.token.sceneName}.txt`);
      const pos = new vscode.Position(decl.variable.lineNumber, decl.variable.position);
      symbols.push(new vscode.SymbolInformation(
        name, vscode.SymbolKind.Variable,
        "global", new vscode.Location(uri, pos),
      ));
    }

    return symbols.length > 0 ? symbols : null;
  }
}

function fileToScene(fileName: string): string {
  return fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\.txt$/, "");
}
