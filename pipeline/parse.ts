import { Token } from "../scanner/tokens/token";
import { Parser, ParserOptions } from "../parser/parser";
import { SceneAst } from "../parser/scene";
import { DiffResult } from "../diff";
import { ScanResult } from "./scan";

export interface ParseTiming {
  parse: number;
  scenesParsed: number;
  scenesReused: number;
}

export interface ParseResult {
  asts: SceneAst[];
  timing: ParseTiming;
}

export interface IncrementalParseInput {
  diff: DiffResult;
  previousAsts: SceneAst[];
}

export const parse = (
  scanResult: ScanResult,
  incremental?: IncrementalParseInput,
  parserOptions?: ParserOptions,
): ParseResult => {
  const parseStart = performance.now();
  const asts: SceneAst[] = [];
  let scenesReused = 0;

  if (incremental) {
    const prevAstByName = new Map<string, SceneAst>();
    for (const ast of incremental.previousAsts) prevAstByName.set(ast.name, ast);

    for (const name of scanResult.sceneNames) {
      const change = incremental.diff.scenes.get(name);
      if (change?.kind === "unchanged") {
        const prevAst = prevAstByName.get(name);
        if (prevAst) {
          asts.push(prevAst);
          scenesReused++;
          continue;
        }
      }
      const sceneTokens = scanResult.tokens.get(name);
      if (!sceneTokens || sceneTokens.length === 0) continue;
      const parser = new Parser(sceneTokens, parserOptions);
      const ast = parser.parseScene();
      if (ast) asts.push(ast);
    }
  } else {
    for (const sceneTokens of scanResult.tokens.values()) {
      if (sceneTokens.length === 0) continue;
      const parser = new Parser(sceneTokens, parserOptions);
      const ast = parser.parseScene();
      if (ast) asts.push(ast);
    }
  }

  return {
    asts,
    timing: {
      parse: performance.now() - parseStart,
      scenesParsed: asts.length - scenesReused,
      scenesReused,
    },
  };
};
