import { Scene } from "../scanner/scene";
import { Token } from "../scanner/tokens/token";
import { ProseToken, ChoiceOptionToken } from "../scanner/tokens";
import { scanLabelNames } from "../scanner/scan-label-names";
import { scanScene } from "../scanner/scanner";
import { flattenProse } from "../scanner/flatten-prose";
import { PrefixTrie } from "../scanner/prefix-trie";
import { Parser } from "../parser/parser";
import { SceneAst } from "../parser/scene";
import { buildControlFlow } from "../analysis/control-flow-graph/build-scene";
import { NdjsonWriter } from "../analysis/ndjson";
import { SceneControlFlowGraph } from "../analysis/control-flow-graph/build-scene/scene-control-flow-graph";

export type { Scene } from "../scanner/scene";
export type { Token } from "../scanner/tokens/token";
export type { SceneAst } from "../parser/scene";
export type { SceneControlFlowGraph } from "../analysis/control-flow-graph/build-scene/scene-control-flow-graph";

export interface ScanContext {
  knownLabels: string[] | PrefixTrie;
  knownScenes: string[] | PrefixTrie;
}

export const extractLabels = (content: string): string[] =>
  scanLabelNames({ content } as Scene);

export const buildScanContext = (
  knownLabels: string[],
  knownScenes: string[],
): ScanContext => ({
  knownLabels: new PrefixTrie(knownLabels),
  knownScenes: new PrefixTrie(knownScenes),
});

export const scan = (
  scene: Scene,
  ctx: ScanContext,
): Token[] => {
  const { tokens: raw } = scanScene(scene, ctx.knownLabels, ctx.knownScenes);
  return expandProse(raw, ctx.knownLabels, ctx.knownScenes);
};

export const parse = (sceneTokens: Token[][]): SceneAst[] => {
  const asts: SceneAst[] = [];
  let tokenId = 0;
  for (const tokens of sceneTokens) {
    if (tokens.length === 0) continue;
    for (const t of tokens) {
      t.id = tokenId++;
    }
    const parser = new Parser(tokens);
    const ast = parser.parseScene();
    if (ast) asts.push(ast);
  }
  return asts;
};

const nullWriter: Pick<NdjsonWriter, "write" | "flush"> = {
  write() {},
  flush() {},
};

export const buildCfg = (
  scene: SceneAst,
): SceneControlFlowGraph =>
  buildControlFlow(scene, nullWriter as NdjsonWriter);

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
