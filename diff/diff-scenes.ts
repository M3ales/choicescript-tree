import { diffLines } from "./diff-lines";

export interface LineEdit {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export type SceneChange =
  | { kind: "unchanged" }
  | { kind: "added" }
  | { kind: "removed" }
  | { kind: "modified"; edits: LineEdit[] };

export interface DiffResult {
  scenes: Map<string, SceneChange>;
}

export const diffScenes = (
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): DiffResult => {
  const scenes = new Map<string, SceneChange>();

  for (const [name, prevContent] of previous) {
    const currContent = current.get(name);
    if (currContent === undefined) {
      scenes.set(name, { kind: "removed" });
      continue;
    }
    if (prevContent === currContent) {
      scenes.set(name, { kind: "unchanged" });
    } else {
      const oldLines = prevContent.split("\n");
      const newLines = currContent.split("\n");
      const edits = diffLines(oldLines, newLines);
      scenes.set(name, { kind: "modified", edits });
    }
  }

  for (const name of current.keys()) {
    if (!previous.has(name)) {
      scenes.set(name, { kind: "added" });
    }
  }

  return { scenes };
};
