import * as vscode from "vscode";
import { LocationIndex } from "../../api";

export class ChoiceScriptReferenceProvider implements vscode.ReferenceProvider {
  private locationIndex: LocationIndex | null = null;
  private folder: vscode.Uri | null = null;

  updateData(locationIndex: LocationIndex, folder: vscode.Uri) {
    this.locationIndex = locationIndex;
    this.folder = folder;
  }

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
  ): vscode.Location[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const range = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range) return null;

    const word = document.getText(range);
    const line = document.lineAt(position.line).text;
    const linePrefix = line.substring(0, range.start.character).trimStart();
    const sceneName = fileToScene(document.fileName);

    if (/\*label\s+$/i.test(linePrefix)) {
      return this.labelReferences(word, sceneName);
    }
    if (/\*(goto|gosub)\s+$/i.test(linePrefix)) {
      return this.labelReferences(word, sceneName);
    }
    if (/\*(goto_scene|gosub_scene)\s+\w+\s+$/i.test(linePrefix)) {
      const match = linePrefix.match(/\*(?:goto_scene|gosub_scene)\s+(\w+)\s+$/i);
      if (match) return this.labelReferences(word, match[1]);
    }
    if (/\*(achieve|achievement)\s+$/i.test(linePrefix)) {
      return this.achievementReferences(word);
    }

    return this.variableReferences(word, sceneName);
  }

  private variableReferences(name: string, sceneName: string): vscode.Location[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const isTempOnly = this.isTempOnly(name, sceneName);
    const occurrences = this.locationIndex.queryIdentifier(name);
    if (occurrences.length === 0) return null;

    const locations: vscode.Location[] = [];
    const seen = new Set<string>();

    for (const occ of occurrences) {
      if (isTempOnly && occ.scene !== sceneName) continue;
      const key = `${occ.scene}:${occ.line}:${occ.position}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const uri = vscode.Uri.joinPath(this.folder, `${occ.scene}.txt`);
      const range = new vscode.Range(occ.line, occ.position, occ.line, occ.position + occ.length);
      locations.push(new vscode.Location(uri, range));
    }

    return locations.length > 0 ? locations : null;
  }

  private isTempOnly(name: string, sceneName: string): boolean {
    if (!this.locationIndex) return false;
    const ss = this.locationIndex.getSceneSymbols(sceneName);
    if (!ss || !ss.tempVariables.has(name.toLowerCase())) return false;
    return !this.locationIndex.getGlobalDeclaration(name);
  }

  private labelReferences(labelName: string, inScene: string): vscode.Location[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const locations: vscode.Location[] = [];
    const lower = labelName.toLowerCase();

    for (const sceneName of this.locationIndex.allSceneNames) {
      const ss = this.locationIndex.getSceneSymbols(sceneName);
      if (!ss) continue;

      for (const [name, label] of ss.labels) {
        if (name.toLowerCase() === lower && sceneName === inScene) {
          const uri = vscode.Uri.joinPath(this.folder, `${sceneName}.txt`);
          locations.push(new vscode.Location(uri, new vscode.Position(label.label.lineNumber, label.label.position)));
        }
      }

      for (const goto of ss.gotos) {
        const ref = extractLabelRef(goto, lower, inScene);
        if (ref) {
          const uri = vscode.Uri.joinPath(this.folder, `${sceneName}.txt`);
          locations.push(new vscode.Location(uri, new vscode.Position(ref.line, ref.position)));
        }
      }

      for (const gosub of ss.gosubs) {
        const ref = extractLabelRef(gosub, lower, inScene);
        if (ref) {
          const uri = vscode.Uri.joinPath(this.folder, `${sceneName}.txt`);
          locations.push(new vscode.Location(uri, new vscode.Position(ref.line, ref.position)));
        }
      }
    }

    return locations.length > 0 ? locations : null;
  }

  private achievementReferences(codename: string): vscode.Location[] | null {
    if (!this.locationIndex || !this.folder) return null;

    const locations: vscode.Location[] = [];

    const def = this.locationIndex.findAchievementDefinition(codename);
    if (def) {
      const tok = def.achievement.codename;
      const uri = vscode.Uri.joinPath(this.folder, `${def.scene}.txt`);
      locations.push(new vscode.Location(uri, new vscode.Range(tok.lineNumber, tok.position, tok.lineNumber, tok.position + tok.value.length)));
    }

    for (const ref of this.locationIndex.findAchievementReferences(codename)) {
      const uri = vscode.Uri.joinPath(this.folder, `${ref.scene}.txt`);
      locations.push(new vscode.Location(uri, new vscode.Range(ref.line, ref.position, ref.line, ref.position + ref.length)));
    }

    return locations.length > 0 ? locations : null;
  }
}

function extractLabelRef(
  stmt: any,
  lowerLabel: string,
  targetScene: string,
): { line: number; position: number } | null {
  if (stmt.kind === "GotoLabel" || stmt.kind === "GoSub") {
    const label = stmt.label;
    if (label && "value" in label && label.value.toLowerCase() === lowerLabel) {
      return { line: label.lineNumber, position: label.position };
    }
  }

  if (stmt.kind === "GotoScene" || stmt.kind === "GoSubScene") {
    const scene = stmt.scene;
    const label = stmt.label;
    if (scene && "value" in scene && scene.value.toLowerCase() === targetScene.toLowerCase()) {
      if (label && "value" in label && label.value.toLowerCase() === lowerLabel) {
        return { line: label.lineNumber, position: label.position };
      }
    }
  }

  return null;
}

function fileToScene(fileName: string): string {
  return fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\.txt$/, "");
}
