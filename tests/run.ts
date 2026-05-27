import fs from "node:fs";
import path from "node:path";
import { setIO } from "../out-dir";
import { MemoryIO } from "../io/memory-io";
import { Scene } from "../scanner/scene";
import { scanLabelNames } from "../scanner/scan-label-names";
import { scanScene } from "../scanner/scanner";
import { flattenProse } from "../scanner/flatten-prose";
import { ChoiceOptionToken, ProseToken, Token } from "../scanner/tokens";
import { Parser } from "../parser/parser";
import { SceneAst } from "../parser/scene";
import { buildSymbolTable } from "../analysis/symbol-table/build-symbol-table";
import { buildControlFlow } from "../analysis/control-flow-graph/build-scene/build-control-flow";
import { NdjsonWriter } from "../analysis/ndjson";

const SNIPPETS_DIR = path.resolve(import.meta.dirname, "snippets");
const UPDATE_SNAPSHOTS = process.argv.includes("--update");

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface SnapshotDef {
  filename: string;
  data: unknown;
}

const buildScenes = (snippetDir: string): Scene[] => {
  const files = fs.readdirSync(snippetDir).filter(f => f.endsWith(".txt"));
  return files.map(f => ({
    sourceUrl: `test://${f}`,
    name: f.replace(/\.txt$/, ""),
    content: fs.readFileSync(path.join(snippetDir, f), "utf-8"),
    error: undefined,
    flow: [],
  }));
};

const scanAndParse = (scenes: Scene[]): { tokens: Token[][]; asts: SceneAst[] } => {
  const knownLabels = scenes.flatMap(s => scanLabelNames(s));
  const sceneNames = scenes.map(s => s.name);

  const allTokens: Token[][] = [];
  let tokenId = 0;

  for (const scene of scenes) {
    const raw = scanScene(scene, knownLabels, sceneNames);
    const expanded = expandProse(raw, knownLabels, sceneNames);
    for (const t of expanded) {
      t.id = tokenId++;
    }
    allTokens.push(expanded);
  }

  const asts: SceneAst[] = [];
  for (const sceneTokens of allTokens) {
    if (sceneTokens.length === 0) continue;
    const parser = new Parser(sceneTokens);
    const ast = parser.parseScene();
    if (ast) asts.push(ast);
  }

  return { tokens: allTokens, asts };
};

const expandProse = (
  sceneTokens: Token[],
  knownLabels: string[],
  sceneNames: string[],
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

const stripVolatile = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(stripVolatile);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "id" || k === "statementId") continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return obj;
};

const checkSnapshot = (
  snippetDir: string,
  filename: string,
  actual: string,
): { passed: boolean; error?: string } => {
  const expectedPath = path.join(snippetDir, filename);

  if (UPDATE_SNAPSHOTS) {
    fs.writeFileSync(expectedPath, actual, "utf-8");
    return { passed: true };
  }

  if (!fs.existsSync(expectedPath)) {
    fs.writeFileSync(expectedPath, actual, "utf-8");
    return { passed: true, error: `${filename} created (first run)` };
  }

  const expected = fs.readFileSync(expectedPath, "utf-8");
  if (expected.trimEnd() === actual.trimEnd()) {
    return { passed: true };
  }

  return {
    passed: false,
    error: `${filename} mismatch — run with --update to accept`,
  };
};

const runSnippet = (snippetDir: string, name: string): TestResult => {
  try {
    const io = new MemoryIO();
    setIO(io);

    const scenes = buildScenes(snippetDir);
    const { tokens, asts } = scanAndParse(scenes);

    const snapshots: SnapshotDef[] = [
      { filename: "expected-tokens.json", data: stripVolatile(tokens) },
      { filename: "expected.json", data: stripVolatile(asts) },
    ];

    if (asts.length > 0 && asts.every(a => a.parseErrors.length === 0)) {
      const symbolTables = asts.map(ast => buildSymbolTable(ast));
      snapshots.push({ filename: "expected-symbols.json", data: stripVolatile(symbolTables.map(s => s.symbolTable)) });

      const blockWriter = new NdjsonWriter("test://blocks.ndjson");
      const cfgs = symbolTables.map(st => buildControlFlow(st, blockWriter));
      blockWriter.flush();
      snapshots.push({ filename: "expected-cfg.json", data: stripVolatile(cfgs) });
    }

    const errors: string[] = [];
    for (const snap of snapshots) {
      const json = JSON.stringify(snap.data, null, 2);
      const result = checkSnapshot(snippetDir, snap.filename, json);
      if (!result.passed) errors.push(result.error!);
      else if (result.error) errors.push(result.error);
    }

    const failed = errors.some(e => e.includes("mismatch"));
    return {
      name,
      passed: !failed,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

const main = () => {
  const snippetDirs = fs.readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const filter = process.argv.find(a => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);

  const toRun = filter
    ? snippetDirs.filter(d => d.includes(filter))
    : snippetDirs;

  console.log(`Running ${toRun.length} snippet test(s)...\n`);

  const results: TestResult[] = [];
  for (const dir of toRun) {
    const result = runSnippet(path.join(SNIPPETS_DIR, dir), dir);
    const icon = result.passed ? "PASS" : "FAIL";
    const suffix = result.error ? ` (${result.error})` : "";
    console.log(`  ${icon}  ${result.name}${suffix}`);
    results.push(result);
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) process.exit(1);
};

main();
