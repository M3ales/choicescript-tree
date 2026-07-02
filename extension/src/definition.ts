import * as vscode from "vscode";
import { LocationIndex } from "../../api";

export class ChoiceScriptDefinitionProvider implements vscode.DefinitionProvider {
  private locationIndex: LocationIndex | null = null;
  private folder: vscode.Uri | null = null;

  updateData(locationIndex: LocationIndex, folder: vscode.Uri) {
    this.locationIndex = locationIndex;
    this.folder = folder;
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.LocationLink[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const range = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range) return null;

    const word = document.getText(range);
    const line = document.lineAt(position.line).text;
    const linePrefix = line.substring(0, range.start.character).trimStart();
    const sceneName = fileToScene(document.fileName);

    if (/\*(goto|gosub)\s+$/i.test(linePrefix)) {
      return this.labelDefinition(word, sceneName, range);
    }

    if (/\*(goto_scene|gosub_scene)\s+\w+\s+$/i.test(linePrefix)) {
      const sceneMatch = linePrefix.match(/\*(?:goto_scene|gosub_scene)\s+(\w+)\s+$/i);
      const targetScene = sceneMatch?.[1];
      if (targetScene) return this.labelDefinition(word, targetScene, range);
    }

    if (/\*(goto_scene|gosub_scene)\s+$/i.test(linePrefix)) {
      return this.sceneDefinition(word, range);
    }

    if (/\*achieve\s+$/i.test(linePrefix)) {
      return this.achievementDefinition(word, range);
    }

    return this.variableDefinition(word, sceneName, range);
  }

  private variableDefinition(
    name: string,
    sceneName: string,
    originRange: vscode.Range
  ): vscode.LocationLink[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const ss = this.locationIndex.getSceneSymbols(sceneName);
    if (ss) {
      const temp = ss.tempVariables.get(name);
      if (temp) {
        const token = temp.token;
        const varToken = temp.variable;
        const uri = vscode.Uri.joinPath(this.folder, `${token.sceneName}.txt`);
        const targetRange = new vscode.Range(
          varToken.lineNumber, varToken.position,
          varToken.lineNumber, varToken.position + varToken.value.length
        );
        return [{ originSelectionRange: originRange, targetUri: uri, targetRange, targetSelectionRange: targetRange }];
      }
    }

    const global = this.locationIndex.getGlobalDeclaration(name);
    if (global) {
      const token = global.token;
      const varToken = global.variable;
      const uri = vscode.Uri.joinPath(this.folder, `${token.sceneName}.txt`);
      const targetRange = new vscode.Range(
        varToken.lineNumber, varToken.position,
        varToken.lineNumber, varToken.position + varToken.value.length
      );
      return [{ originSelectionRange: originRange, targetUri: uri, targetRange, targetSelectionRange: targetRange }];
    }

    return null;
  }

  private labelDefinition(
    labelName: string,
    sceneName: string,
    originRange: vscode.Range
  ): vscode.LocationLink[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const ss = this.locationIndex.getSceneSymbols(sceneName);
    if (!ss) return null;

    const lowerName = labelName.toLowerCase();
    let label = ss.labels.get(labelName);
    if (!label) {
      for (const [key, stmt] of ss.labels) {
        if (key.toLowerCase() === lowerName) { label = stmt; break; }
      }
    }
    if (!label) return null;

    const targetLine = label.label.lineNumber;
    const targetCol = label.label.position;
    const uri = vscode.Uri.joinPath(this.folder, `${sceneName}.txt`);
    const targetRange = new vscode.Range(targetLine, targetCol, targetLine, targetCol + label.label.value.length);

    return [{
      originSelectionRange: originRange,
      targetUri: uri,
      targetRange,
      targetSelectionRange: targetRange,
    }];
  }

  private achievementDefinition(
    codename: string,
    originRange: vscode.Range
  ): vscode.LocationLink[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const found = this.locationIndex.findAchievementDefinition(codename);
    if (!found) return null;

    const tok = found.achievement.codename;
    const uri = vscode.Uri.joinPath(this.folder, `${found.scene}.txt`);
    const targetRange = new vscode.Range(tok.lineNumber, tok.position, tok.lineNumber, tok.position + tok.value.length);

    return [{
      originSelectionRange: originRange,
      targetUri: uri,
      targetRange,
      targetSelectionRange: targetRange,
    }];
  }

  private sceneDefinition(
    sceneName: string,
    originRange: vscode.Range
  ): vscode.LocationLink[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const ss = this.locationIndex.getSceneSymbols(sceneName);
    if (!ss) return null;

    const uri = vscode.Uri.joinPath(this.folder, `${sceneName}.txt`);
    const targetRange = new vscode.Range(0, 0, 0, 0);

    return [{
      originSelectionRange: originRange,
      targetUri: uri,
      targetRange,
      targetSelectionRange: targetRange,
    }];
  }
}

function fileToScene(fileName: string): string {
  return fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\.txt$/, "");
}
