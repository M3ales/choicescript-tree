import { Scene } from "../scanner/scene";

export interface SimulatedDelta {
  scenes: Scene[];
  mutations: DeltaMutation[];
}

export interface DeltaMutation {
  scene: string;
  line: number;
  original: string;
  mutated: string;
  kind: "modify" | "insert" | "delete";
}

export interface SimulateDeltaOptions {
  maxScenes?: number;
  maxLinesPerScene?: number;
  seed?: number;
}

class SeededRng {
  private state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }
  int(max: number): number {
    return Math.floor(this.next() * max);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
}

export const simulateDelta = (
  scenes: Scene[],
  opts: SimulateDeltaOptions = {},
): SimulatedDelta => {
  const maxScenes = opts.maxScenes ?? 1;
  const maxLines = opts.maxLinesPerScene ?? 3;
  const rng = new SeededRng(opts.seed ?? Date.now());

  const eligible = scenes.filter(s => s.error === undefined && s.content.length > 0);
  if (eligible.length === 0) return { scenes, mutations: [] };

  const sceneCount = Math.min(maxScenes, eligible.length);
  const targetScenes = new Set<string>();
  while (targetScenes.size < sceneCount) {
    targetScenes.add(rng.pick(eligible).name);
  }

  const mutations: DeltaMutation[] = [];
  const mutatedScenes = scenes.map(scene => {
    if (!targetScenes.has(scene.name)) return scene;

    const lines = scene.content.split("\n");
    if (lines.length < 2) return scene;

    const lineCount = rng.int(maxLines) + 1;
    const mutatedLines = new Set<number>();

    for (let i = 0; i < lineCount; i++) {
      let lineIdx: number;
      let attempts = 0;
      do {
        lineIdx = rng.int(lines.length);
        attempts++;
      } while ((mutatedLines.has(lineIdx) || isStructuralLine(lines[lineIdx])) && attempts < 50);

      if (mutatedLines.has(lineIdx) || isStructuralLine(lines[lineIdx])) continue;
      mutatedLines.add(lineIdx);

      const original = lines[lineIdx];
      const kind = rng.next() < 0.7 ? "modify" : rng.next() < 0.5 ? "insert" : "delete";

      switch (kind) {
        case "modify":
          lines[lineIdx] = mutateLine(original, rng);
          break;
        case "insert":
          lines.splice(lineIdx + 1, 0, generateLine(original, rng));
          break;
        case "delete":
          lines.splice(lineIdx, 1);
          break;
      }

      mutations.push({
        scene: scene.name,
        line: lineIdx + 1,
        original,
        mutated: kind === "delete" ? "(deleted)" : lines[lineIdx],
        kind,
      });
    }

    return { ...scene, content: lines.join("\n") };
  });

  return { scenes: mutatedScenes, mutations };
};

const isStructuralLine = (line: string): boolean => {
  const trimmed = line.trimStart();
  return trimmed.startsWith("*label ") ||
    trimmed.startsWith("*choice") ||
    trimmed.startsWith("*fake_choice") ||
    trimmed.startsWith("*finish") ||
    trimmed.startsWith("*ending") ||
    trimmed.startsWith("*goto ") ||
    trimmed.startsWith("*goto_scene ") ||
    trimmed.startsWith("*gosub ") ||
    trimmed.startsWith("*gosub_scene ") ||
    trimmed.startsWith("*return") ||
    trimmed.startsWith("*create ") ||
    trimmed.startsWith("*temp ") ||
    trimmed === "";
};

const mutateLine = (line: string, rng: SeededRng): string => {
  const trimmed = line.trimStart();
  const indent = line.substring(0, line.length - trimmed.length);

  if (trimmed.startsWith("*set ")) {
    const parts = trimmed.split(" ");
    if (parts.length >= 3) {
      const lastPart = parts[parts.length - 1];
      const num = parseInt(lastPart, 10);
      if (!isNaN(num)) {
        parts[parts.length - 1] = String(num + rng.int(10) + 1);
        return indent + parts.join(" ");
      }
    }
  }

  if (trimmed.startsWith("*if ") || trimmed.startsWith("*elseif ")) {
    return line + " ";
  }

  if (!trimmed.startsWith("*")) {
    return indent + trimmed + " [mutated]";
  }

  return line + " ";
};

const generateLine = (context: string, rng: SeededRng): string => {
  const indent = context.substring(0, context.length - context.trimStart().length);
  const options = [
    `${indent}This is inserted prose.`,
    `${indent}*comment simulated insertion`,
  ];
  return rng.pick(options);
};
