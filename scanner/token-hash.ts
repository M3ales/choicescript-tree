import { Token } from "./tokens/token";
import { FNV_OFFSET, fnvMixStr, fnvMixInt } from "../utils/fnv";

export const hashToken = (token: Token): number => {
  let h = fnvMixStr(FNV_OFFSET, token.type);
  h = fnvMixInt(h, token.indent);

  const t = token as any;
  if (t.content !== undefined && typeof t.content === "string") {
    h = fnvMixStr(h, t.content);
  }
  if (t.value !== undefined) {
    h = typeof t.value === "string"
      ? fnvMixStr(h, t.value)
      : fnvMixInt(h, typeof t.value === "boolean" ? (t.value ? 1 : 0) : t.value);
  }
  if (t.rawValue !== undefined) {
    h = fnvMixStr(h, t.rawValue);
  }
  if (t.rawText !== undefined) {
    h = fnvMixStr(h, t.rawText);
  }
  if (t.expression !== undefined && Array.isArray(t.expression)) {
    for (const sub of t.expression) {
      if (sub.hash !== undefined) {
        h = fnvMixInt(h, sub.hash);
      }
    }
  }

  return h;
};

export const hashTokenLine = (lineTokenHashes: number[]): number => {
  let h = FNV_OFFSET;
  for (const th of lineTokenHashes) {
    h = fnvMixInt(h, th);
  }
  return h;
};

export const hashScene = (lineHashes: number[]): number => {
  let h = FNV_OFFSET;
  for (const lh of lineHashes) {
    h = fnvMixInt(h, lh);
  }
  return h;
};

export interface SceneHashes {
  lineHashes: number[];
  sceneHash: number;
}

export const computeSceneHashes = (tokens: Token[]): SceneHashes => {
  for (const token of tokens) {
    token.hash = hashToken(token);
  }

  const lineMap = new Map<number, number[]>();
  for (const token of tokens) {
    const line = token.lineNumber;
    let arr = lineMap.get(line);
    if (!arr) {
      arr = [];
      lineMap.set(line, arr);
    }
    arr.push(token.hash!);
  }

  const sortedLines = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const lineHashes: number[] = [];
  for (const line of sortedLines) {
    lineHashes.push(hashTokenLine(lineMap.get(line)!));
  }

  return {
    lineHashes,
    sceneHash: hashScene(lineHashes),
  };
};
