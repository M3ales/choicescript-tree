import { LocationIndex, IdentifierOccurrence } from "../ref-cfg/location-index";

export interface TextEdit {
  scene: string;
  line: number;
  position: number;
  length: number;
  newText: string;
}

export type RenameKind = "variable" | "label" | "achievement";

export interface RenameResult {
  kind: RenameKind;
  oldName: string;
  newName: string;
  edits: TextEdit[];
}

export function computeVariableRename(
  locationIndex: LocationIndex,
  oldName: string,
  newName: string,
  scene?: string,
): RenameResult {
  let occurrences = locationIndex.queryIdentifier(oldName);
  if (scene && isTempOnly(locationIndex, oldName, scene)) {
    occurrences = occurrences.filter(o => o.scene === scene);
  }
  const edits = deduplicateEdits(occurrences, newName);
  return { kind: "variable", oldName, newName, edits };
}

function isTempOnly(locationIndex: LocationIndex, name: string, scene: string): boolean {
  const ss = locationIndex.getSceneSymbols(scene);
  if (!ss || !ss.tempVariables.has(name.toLowerCase())) return false;
  return !locationIndex.getGlobalDeclaration(name);
}

export function computeLabelRename(
  locationIndex: LocationIndex,
  oldName: string,
  newName: string,
  scene: string,
): RenameResult {
  const edits: TextEdit[] = [];
  const seen = new Set<string>();
  const lowerOld = oldName.toLowerCase();

  for (const sceneName of locationIndex.allSceneNames) {
    const ss = locationIndex.getSceneSymbols(sceneName);
    if (!ss) continue;

    for (const [name, label] of ss.labels) {
      if (name.toLowerCase() !== lowerOld || sceneName !== scene) continue;
      pushEdit(edits, seen, sceneName, label.label.lineNumber, label.label.position, label.label.value.length, newName);
    }

    for (const stmt of ss.gotos) {
      const ref = extractLabelRef(stmt, lowerOld, scene);
      if (ref) pushEdit(edits, seen, sceneName, ref.line, ref.position, ref.length, newName);
    }

    for (const stmt of ss.gosubs) {
      const ref = extractLabelRef(stmt, lowerOld, scene);
      if (ref) pushEdit(edits, seen, sceneName, ref.line, ref.position, ref.length, newName);
    }
  }

  return { kind: "label", oldName, newName, edits };
}

export function computeAchievementRename(
  locationIndex: LocationIndex,
  oldName: string,
  newName: string,
): RenameResult {
  const edits: TextEdit[] = [];
  const seen = new Set<string>();

  const def = locationIndex.findAchievementDefinition(oldName);
  if (def) {
    const tok = def.achievement.codename;
    pushEdit(edits, seen, def.scene, tok.lineNumber, tok.position, tok.value.length, newName);
  }

  for (const ref of locationIndex.findAchievementReferences(oldName)) {
    pushEdit(edits, seen, ref.scene, ref.line, ref.position, ref.length, newName);
  }

  return { kind: "achievement", oldName, newName, edits };
}

function deduplicateEdits(occurrences: IdentifierOccurrence[], newText: string): TextEdit[] {
  const edits: TextEdit[] = [];
  const seen = new Set<string>();
  for (const occ of occurrences) {
    pushEdit(edits, seen, occ.scene, occ.line, occ.position, occ.length, newText);
  }
  return edits;
}

function pushEdit(
  edits: TextEdit[],
  seen: Set<string>,
  scene: string,
  line: number,
  position: number,
  length: number,
  newText: string,
): void {
  const key = `${scene}:${line}:${position}`;
  if (seen.has(key)) return;
  seen.add(key);
  edits.push({ scene, line, position, length, newText });
}

function extractLabelRef(
  stmt: any,
  lowerLabel: string,
  targetScene: string,
): { line: number; position: number; length: number } | null {
  if (stmt.kind === "GotoLabel" || stmt.kind === "GoSub") {
    const label = stmt.label;
    if (label && "value" in label && label.value.toLowerCase() === lowerLabel) {
      return { line: label.lineNumber, position: label.position, length: label.value.length };
    }
  }

  if (stmt.kind === "GotoScene" || stmt.kind === "GoSubScene") {
    const scene = stmt.scene;
    const label = stmt.label;
    if (scene && "value" in scene && scene.value.toLowerCase() === targetScene.toLowerCase()) {
      if (label && "value" in label && label.value.toLowerCase() === lowerLabel) {
        return { line: label.lineNumber, position: label.position, length: label.value.length };
      }
    }
  }

  return null;
}
