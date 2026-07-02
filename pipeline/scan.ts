import { Scene } from "../scanner/scene";
import { Token } from "../scanner/tokens/token";
import { ProseToken, ChoiceOptionToken } from "../scanner/tokens";
import { scanLabelNames } from "../scanner/scan-label-names";
import { scanScene } from "../scanner/scanner";
import { ScannerCheckpoint } from "../scanner/scanner-checkpoint";
import { flattenProse } from "../scanner/flatten-prose";
import { PrefixTrie } from "../scanner/prefix-trie";
import { computeSceneHashes, SceneHashes } from "../scanner/token-hash";
import { DiffResult } from "../diff";

export interface ScanTiming {
  preScan: number;
  scan: number;
  total: number;
  scenesScanned: number;
  scenesReused: number;
}

export interface ScanResult {
  tokens: Map<string, Token[]>;
  checkpoints: Map<string, ScannerCheckpoint[]>;
  sceneHashes: Map<string, SceneHashes>;
  knownLabels: string[];
  sceneNames: string[];
  timing: ScanTiming;
}

export interface IncrementalScanInput {
  diff: DiffResult;
  previous: ScanResult;
}

export const scan = (
  scenes: Scene[],
  incremental?: IncrementalScanInput,
): ScanResult => {
  const totalStart = performance.now();
  const cleanedScenes = scenes.filter(s => s.error === undefined);

  const preScanStart = performance.now();
  const knownLabels = cleanedScenes.flatMap(s => scanLabelNames(s));
  const sceneNames = scenes.map(s => s.name);
  const labelTrie = new PrefixTrie(knownLabels);
  const sceneTrie = new PrefixTrie(sceneNames);
  const preScan = performance.now() - preScanStart;

  const scanStart = performance.now();
  let tokenId = 0;
  const allTokens = new Map<string, Token[]>();
  const allCheckpoints = new Map<string, ScannerCheckpoint[]>();
  const allSceneHashes = new Map<string, SceneHashes>();
  const sceneTimes: { name: string; lines: number; scanMs: number; expandMs: number }[] = [];
  let scenesReused = 0;

  for (const scene of cleanedScenes) {
    const change = incremental?.diff.scenes.get(scene.name);

    if (change?.kind === "unchanged" && incremental) {
      const prevTokens = incremental.previous.tokens.get(scene.name);
      const prevCheckpoints = incremental.previous.checkpoints.get(scene.name);
      const prevHashes = incremental.previous.sceneHashes.get(scene.name);
      if (prevTokens && prevCheckpoints && prevHashes) {
        for (const t of prevTokens) t.id = tokenId++;
        allTokens.set(scene.name, prevTokens);
        allCheckpoints.set(scene.name, prevCheckpoints);
        allSceneHashes.set(scene.name, prevHashes);
        scenesReused++;
        continue;
      }
    }

    const t0 = performance.now();
    const { tokens: raw, checkpoints: sceneCheckpoints } = scanScene(scene, labelTrie, sceneTrie);
    allCheckpoints.set(scene.name, sceneCheckpoints);
    const t1 = performance.now();
    const expanded = expandProse(raw, labelTrie, sceneTrie);
    const t2 = performance.now();
    allSceneHashes.set(scene.name, computeSceneHashes(expanded));
    for (const t of expanded) {
      t.id = tokenId++;
    }
    allTokens.set(scene.name, expanded);
    sceneTimes.push({
      name: scene.name,
      lines: scene.content.split("\n").length,
      scanMs: t1 - t0,
      expandMs: t2 - t1,
    });
  }
  sceneTimes.sort((a, b) => (b.scanMs + b.expandMs) - (a.scanMs + a.expandMs));
  for (const s of sceneTimes.slice(0, 10)) {
    console.log(`  ${s.name.padEnd(30)} ${s.lines.toString().padStart(6)} lines  scan: ${s.scanMs.toFixed(0).padStart(6)}ms  expand: ${s.expandMs.toFixed(0).padStart(6)}ms`);
  }
  const scanTime = performance.now() - scanStart;

  return {
    tokens: allTokens,
    checkpoints: allCheckpoints,
    sceneHashes: allSceneHashes,
    knownLabels,
    sceneNames,
    timing: {
      preScan,
      scan: scanTime,
      total: performance.now() - totalStart,
      scenesScanned: cleanedScenes.length - scenesReused,
      scenesReused,
    },
  };
};

const expandProse = (
  sceneTokens: Token[],
  knownLabels: string[] | PrefixTrie,
  sceneNames: string[] | PrefixTrie,
): Token[] => {
  const out: Token[] = [];
  for (const token of sceneTokens) {
    if (token.type === "Prose") {
      const prose = token as ProseToken;
      const flat = flattenProse(prose.content, {
        sceneName: token.sceneName,
        lineNumber: token.lineNumber,
        position: token.position,
        indent: token.indent,
        knownLabels,
        sceneNames,
      });
      if (flat.length > 0 && flat[0].type !== "Prose") {
        out.push({
          type: "Prose",
          sceneName: token.sceneName,
          lineNumber: token.lineNumber,
          position: token.position,
          indent: token.indent,
          content: "",
        } as ProseToken);
      }
      out.push(...flat);
    } else if (token.type === "ChoiceOption") {
      const opt = token as ChoiceOptionToken;
      out.push(opt);
      if (opt.rawText && opt.rawText.length > 0) {
        const flat = flattenProse(opt.rawText, {
          sceneName: token.sceneName,
          lineNumber: token.lineNumber,
          position: token.position + 1,
          indent: token.indent,
          knownLabels,
          sceneNames,
        });
        out.push(...flat);
      }
    } else {
      out.push(token);
    }
  }
  return out;
};
