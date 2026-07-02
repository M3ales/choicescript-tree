import * as vscode from "vscode";
import { Token } from "../../scanner/tokens/token";
import { TokenType } from "../../scanner/tokens/token-types";
import { Scene } from "../../scanner/scene";
import { scanScene } from "../../scanner/scanner";
import { LocationIndex } from "../../api";

export const TOKEN_TYPES = [
  "keyword",
  "variable",
  "number",
  "string",
  "comment",
  "operator",
  "macro",
  "function",
  "type",
  "parameter",
] as const;

export const TOKEN_MODIFIERS = ["declaration", "readonly", "defaultLibrary"] as const;

export const legend = new vscode.SemanticTokensLegend(
  [...TOKEN_TYPES],
  [...TOKEN_MODIFIERS]
);

const typeIndex: Record<string, number> = {};
TOKEN_TYPES.forEach((t, i) => (typeIndex[t] = i));

const modIndex: Record<string, number> = {};
TOKEN_MODIFIERS.forEach((m, i) => (modIndex[m] = i));

const COMMAND_LENGTHS: Partial<Record<TokenType, number>> = {
  If: 3,
  ElseIf: 8,
  Else: 5,
  Choice: 7,
  FakeChoice: 12,
  GotoLabel: 5,
  GotoScene: 11,
  GoSub: 6,
  GoSubScene: 12,
  Return: 7,
  Finish: 7,
  Ending: 7,
  Bug: 7,
  GotoRandomScene: 18,
  SelectableIf: 14,
  CreateVariable: 7,
  CreateTempVariable: 5,
  SetVariable: 4,
  DeleteVariable: 7,
  CreateArray: 13,
  CreateTempArray: 11,
  DeleteArray: 13,
  Label: 6,
  PageBreak: 11,
  LineBreak: 11,
  Image: 6,
  Link: 5,
  InputText: 11,
  InputNumber: 13,
  GenerateRandom: 5,
  Achievement: 12,
  Achieve: 8,
  CheckAchievements: 19,
  StatChart: 11,
  SceneList: 11,
  Author: 7,
  GameIdentifier: 5,
  Parameters: 7,
  SaveCheckpoint: 16,
  RestoreCheckpoint: 19,
  HideReuse: 11,
  DisableReuse: 14,
  AllowReuse: 12,
  Comment: 8,
};

interface SemanticMapping {
  type: number;
  modifiers: number;
}

function getMapping(token: Token): SemanticMapping | null {
  const t = token.type as TokenType;

  switch (t) {
    case "If":
    case "ElseIf":
    case "Else":
    case "Choice":
    case "FakeChoice":
    case "GotoLabel":
    case "GotoScene":
    case "GoSub":
    case "GoSubScene":
    case "Return":
    case "Finish":
    case "Ending":
    case "Bug":
    case "GotoRandomScene":
    case "SelectableIf":
    case "CreateVariable":
    case "CreateTempVariable":
    case "SetVariable":
    case "DeleteVariable":
    case "CreateArray":
    case "CreateTempArray":
    case "DeleteArray":
    case "PageBreak":
    case "LineBreak":
    case "Image":
    case "TextImage":
    case "Link":
    case "InputText":
    case "InputNumber":
    case "GenerateRandom":
    case "Achievement":
    case "Achieve":
    case "CheckAchievements":
    case "StatChart":
    case "SceneList":
    case "Author":
    case "GameIdentifier":
    case "Parameters":
    case "SaveCheckpoint":
    case "RestoreCheckpoint":
    case "HideReuse":
    case "DisableReuse":
    case "AllowReuse":
      return { type: typeIndex.keyword, modifiers: 0 };

    case "Label":
      return {
        type: typeIndex.keyword,
        modifiers: 1 << modIndex.declaration,
      };

    case "Comment":
      return { type: typeIndex.comment, modifiers: 0 };

    case "Identifier":
      return { type: typeIndex.variable, modifiers: 0 };

    case "NumberLiteral":
      return { type: typeIndex.number, modifiers: 0 };

    case "StringLiteral":
      return { type: typeIndex.string, modifiers: 0 };

    case "BooleanLiteral":
      return { type: typeIndex.keyword, modifiers: 0 };

    case "AssignmentOperator":
    case "EqualityOperator":
      return { type: typeIndex.operator, modifiers: 0 };

    case "FairmathAdditionOperator":
    case "FairmathSubtractionOperator":
      return { type: typeIndex.macro, modifiers: 0 };

    case "ChoiceOption":
      return { type: typeIndex.string, modifiers: 0 };

    case "OpenPrint":
    case "OpenPrintCapitaliseFirst":
    case "OpenPrintCapitaliseAll":
    case "Dollar":
      return { type: typeIndex.variable, modifiers: 0 };

    case "OpenMultiReplace":
    case "MultiReplaceElse":
      return { type: typeIndex.macro, modifiers: 0 };

    default:
      if (t === "LogicalAnd" || t === "LogicalOr" || t === "NotOperator")
        return { type: typeIndex.keyword, modifiers: 0 };

      const raw = (token as any).rawValue;
      if (raw !== undefined)
        return { type: typeIndex.operator, modifiers: 0 };

      return null;
  }
}

function getTokenLength(token: Token): number {
  const t = token.type as TokenType;

  const cmdLen = COMMAND_LENGTHS[t];
  if (cmdLen !== undefined) return cmdLen;

  if (t === "StringLiteral") {
    const str = (token as any).value as string;
    return str.length + 2;
  }

  const val = (token as any).value;
  if (typeof val === "boolean") return val ? 4 : 5;
  if (typeof val === "string") return val.length;
  if (typeof val === "number") return String(val).length;

  const raw = (token as any).rawValue;
  if (typeof raw === "string") return raw.length;

  const content = (token as any).content;
  if (typeof content === "string") return content.length;

  const rawText = (token as any).rawText;
  if (typeof rawText === "string") return rawText.length + 1;

  return 1;
}

function resolveLabel(
  name: string,
  locationIndex: LocationIndex | null,
  targetScene: string,
): boolean {
  const ss = locationIndex?.getSceneSymbols(targetScene);
  if (!ss) return false;
  if (ss.labels.has(name)) return true;
  const lower = name.toLowerCase();
  for (const key of ss.labels.keys()) {
    if (key.toLowerCase() === lower) return true;
  }
  return false;
}

function resolveIdentifierMapping(
  token: Token,
  locationIndex: LocationIndex | null,
  sceneName: string,
  prevCommandToken: TokenType | null,
  prevSceneArg: string | null,
): SemanticMapping | null {
  const id = token as any;
  const name: string | undefined = id.value;
  if (!name) return null;

  const isSceneArg = prevCommandToken === "GotoScene" || prevCommandToken === "GoSubScene";
  const isLabelArg = prevCommandToken === "GotoLabel" || prevCommandToken === "GoSub"
    || (isSceneArg && prevSceneArg !== null);

  if (id.isSceneName || (isSceneArg && !prevSceneArg)) {
    const resolved = locationIndex?.getSceneSymbols(name);
    return {
      type: resolved ? typeIndex.type : typeIndex.variable,
      modifiers: resolved ? 1 << modIndex.defaultLibrary : 0,
    };
  }

  if (prevCommandToken === "Label") {
    const isSubroutine = locationIndex?.isGosubTarget(sceneName, name) ?? false;
    return {
      type: isSubroutine ? typeIndex.macro : typeIndex.function,
      modifiers: 1 << modIndex.declaration,
    };
  }

  if (id.isLabelName || isLabelArg) {
    const isGosubRef = prevCommandToken === "GoSub" || prevCommandToken === "GoSubScene";
    const targetScene = prevSceneArg ?? sceneName;
    const resolved = resolveLabel(name, locationIndex, targetScene);
    return {
      type: resolved ? (isGosubRef ? typeIndex.macro : typeIndex.function) : typeIndex.variable,
      modifiers: resolved ? 1 << modIndex.defaultLibrary : 0,
    };
  }

  if (prevCommandToken === "Achieve" || prevCommandToken === "Achievement") {
    const resolved = locationIndex?.findAchievementDefinition(name);
    return {
      type: resolved ? typeIndex.function : typeIndex.variable,
      modifiers: resolved ? 1 << modIndex.defaultLibrary : 0,
    };
  }

  if (prevCommandToken === "Parameters") {
    return { type: typeIndex.parameter, modifiers: 1 << modIndex.declaration };
  }

  if (prevCommandToken === "Image" || prevCommandToken === "TextImage") {
    return { type: typeIndex.keyword, modifiers: 0 };
  }

  if (name && locationIndex?.isParamVariable(sceneName, name)) {
    return { type: typeIndex.parameter, modifiers: 0 };
  }

  return null;
}

export function buildSemanticTokens(
  text: string,
  sceneName: string,
  knownLabels: string[],
  sceneNames: string[],
  locationIndex: LocationIndex | null = null,
): vscode.SemanticTokensBuilder {
  const builder = new vscode.SemanticTokensBuilder(legend);

  const scene: Scene = {
    sourceUrl: `vscode://${sceneName}`,
    name: sceneName,
    content: text,
    error: undefined,
    flow: [],
  };

  let tokens: Token[];
  try {
    ({ tokens } = scanScene(scene, knownLabels, sceneNames));
  } catch {
    return builder;
  }

  let prevCommandToken: TokenType | null = null;
  let prevSceneArg: string | null = null;

  const mapped = tokens
    .map(token => {
      const t = token.type as TokenType;

      if (t === "GotoLabel" || t === "GotoScene" || t === "GoSub" || t === "GoSubScene"
        || t === "Achieve" || t === "Achievement" || t === "Image" || t === "TextImage" || t === "Label"
        || t === "Parameters") {
        prevCommandToken = t;
        prevSceneArg = null;
      }

      let mapping: SemanticMapping | null = null;

      if (t === "Identifier") {
        const id = token as any;
        if (id.isSceneName && (prevCommandToken === "GotoScene" || prevCommandToken === "GoSubScene")) {
          prevSceneArg = id.value;
        }
        mapping = resolveIdentifierMapping(token, locationIndex, sceneName, prevCommandToken, prevSceneArg);
      }

      if (!mapping) mapping = getMapping(token);
      if (!mapping) return null;

      const len = getTokenLength(token);
      if (len <= 0 || token.lineNumber < 0 || token.position < 0) return null;
      return { line: token.lineNumber, col: token.position, len, ...mapping };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => a.line - b.line || a.col - b.col);

  let prevLine = -1, prevCol = -1;
  for (const t of mapped) {
    if (t.line === prevLine && t.col === prevCol) continue;
    try {
      builder.push(t.line, t.col, t.len, t.type, t.modifiers);
    } catch {
      continue;
    }
    prevLine = t.line;
    prevCol = t.col;
  }

  return builder;
}

export class ChoiceScriptSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider
{
  private knownLabels: string[] = [];
  private sceneNames: string[] = [];
  private locationIndex: LocationIndex | null = null;
  private cache = new Map<string, { version: number; tokens: vscode.SemanticTokens }>();

  private _onDidChangeSemanticTokens = new vscode.EventEmitter<void>();
  readonly onDidChangeSemanticTokens = this._onDidChangeSemanticTokens.event;

  updateContext(knownLabels: string[], sceneNames: string[], locationIndex: LocationIndex | null = null) {
    this.knownLabels = knownLabels;
    this.sceneNames = sceneNames;
    this.locationIndex = locationIndex;
    this.cache.clear();
    this._onDidChangeSemanticTokens.fire();
  }

  provideDocumentSemanticTokens(
    document: vscode.TextDocument
  ): vscode.SemanticTokens {
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.version === document.version) return cached.tokens;

    const name = document.fileName
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/\.txt$/, "");

    const builder = buildSemanticTokens(
      document.getText(),
      name,
      this.knownLabels,
      this.sceneNames,
      this.locationIndex,
    );

    const tokens = builder.build();
    this.cache.set(key, { version: document.version, tokens });
    return tokens;
  }
}
