import * as vscode from "vscode";
import { ParseError } from "../../parser/parse-error";
import { NavigationError } from "../../api";
import { AnalysisResult } from "./pipeline";

const stripTokenLocation = (msg: string): string =>
  msg.replace(/ at '.*$/, "").replace(/ at end of scene .*$/, "");

function parseErrorToDiagnostic(error: ParseError): vscode.Diagnostic {
  const line = error.token.lineNumber;
  const col = error.token.position;
  const endLine = error.endToken?.lineNumber ?? line;
  const endCol = error.endToken ? error.endToken.position + 1 : col + 1;
  const range = new vscode.Range(line, col, endLine, endCol);
  const message = friendlyParseError(error);
  const diag = new vscode.Diagnostic(
    range,
    message,
    vscode.DiagnosticSeverity.Error
  );
  diag.source = "choicescript";
  if (error.solutionCode !== undefined) {
    diag.code = error.solutionCode;
  }
  return diag;
}

function friendlyParseError(error: ParseError): string {
  const raw = error.message;
  const clean = stripTokenLocation(raw);

  if (clean.startsWith("Expect expression")) {
    return "Expected a value or expression here.";
  }
  if (clean.startsWith("Expect ')' after expression")) {
    return "Missing closing parenthesis — every ( needs a matching ).";
  }
  if (clean.startsWith("Expect ']' after accessor")) {
    return "Missing closing bracket — every [ needs a matching ].";
  }
  if (clean.startsWith("Expect '}' after")) {
    return "Missing closing brace — every { needs a matching }.";
  }
  if (clean.startsWith("Expect variable name")) {
    return "Expected a variable name here.";
  }
  if (clean.startsWith("Expect array name")) {
    return "Expected an array name here.";
  }
  if (clean.startsWith("Expect identifier")) {
    return "Expected a name here.";
  }
  if (clean.startsWith("Expect scene name")) {
    return "Expected a scene name here.";
  }
  if (clean.startsWith("Expect label name") || clean.startsWith("Expect valid label name")) {
    return "Expected a label name here.";
  }
  if (clean.startsWith("Expect ChoiceOption after modifiers")) {
    return "Expected a choice option (#) here — modifiers like *hide_reuse must appear on a choice option line.";
  }
  if (clean.includes("Dangling *else")) {
    return "This *else doesn't have a matching *if — check indentation.";
  }
  if (clean.includes("Concatenation (&) is strictly binary")) {
    return "The & operator joins exactly two values — use parentheses to chain more: (a & b) & c.";
  }
  if (clean.includes("*create is only allowed")) {
    return "*create must appear at the top of the startup scene, before any story text or commands.";
  }
  if (clean.includes("*create_array is only allowed")) {
    return "*create_array must appear at the top of the startup scene, before any story text or commands.";
  }
  if (clean.includes("Array count must be")) {
    return "Array size must be a plain number like 5 — variables and expressions are not allowed here.";
  }
  if (clean.startsWith("Expect URL")) {
    return "Expected a URL after *link.";
  }
  if (clean.startsWith("Expect path after *image")) {
    return "Expected an image file path after *image.";
  }
  if (clean.startsWith("Expect path after *text_image")) {
    return "Expected an image file path after *text_image.";
  }
  if (clean.startsWith("Expect achievement")) {
    return clean.replace("Expect ", "Expected ") + ".";
  }
  if (clean.startsWith("Expect author name")) {
    return "Expected the author name after *author.";
  }
  if (clean.startsWith("Expect button text")) {
    return "Expected button text after *page_break.";
  }
  if (clean.startsWith("Expect scene identifier")) {
    return "Expected a scene name in the *scene_list.";
  }

  if (clean.startsWith("Expect ")) {
    return clean.replace("Expect ", "Expected ") + ".";
  }

  return clean || raw;
}

const NAVIGATION_MESSAGES: Record<number, (e: NavigationError) => string> = {
  0: (e) => {
    const label = e.targetLabel;
    const scene = e.targetScene;
    if (scene && label) {
      return `Can't find the label "${label}" in scene "${scene}" — check the spelling, or make sure the label exists.`;
    }
    if (label) {
      return `Can't find the label "${label}" — check the spelling, or make sure the label exists in this scene.`;
    }
    return stripTokenLocation(e.message);
  },
  1: (e) => {
    const scene = e.targetScene;
    if (scene) {
      return `Can't find the scene "${scene}" — make sure a file named "${scene}.txt" exists in your scenes folder.`;
    }
    return stripTokenLocation(e.message);
  },
};

function navigationErrorToDiagnostic(error: NavigationError, folder: vscode.Uri): vscode.Diagnostic {
  const stmt = error.statement as any;
  const targetToken = error.targetLabel
    ? (stmt.label ?? stmt.token)
    : (stmt.scene ?? stmt.token);
  const token = targetToken?.type ? targetToken : stmt.token;
  const line = token?.lineNumber ?? 0;
  const col = token?.position ?? 0;
  const len = token?.value?.length ?? token?.rawValue?.length ?? 1;
  const range = new vscode.Range(line, col, line, col + len);
  const severity = error.severity === "Error"
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;
  const formatter = NAVIGATION_MESSAGES[error.solutionCode];
  const message = formatter ? formatter(error) : stripTokenLocation(error.message);
  const diag = new vscode.Diagnostic(range, message, severity);
  diag.source = "choicescript";

  const foundIn: { scene: string; line: number }[] | undefined = (error.context as any)?.foundInScenes;
  if (foundIn?.length) {
    diag.relatedInformation = foundIn.map(f => {
      const uri = vscode.Uri.joinPath(folder, `${f.scene}.txt`);
      const loc = new vscode.Location(uri, new vscode.Position(f.line, 0));
      return new vscode.DiagnosticRelatedInformation(loc, `Label "${error.targetLabel}" exists here`);
    });
    const sceneToken = stmt.scene;
    if (sceneToken) {
      const sceneLine = sceneToken.lineNumber ?? 0;
      const sceneCol = sceneToken.position ?? 0;
      const sceneLen = sceneToken.value?.length ?? sceneToken.rawValue?.length ?? 1;
      diag.code = "label-wrong-scene";
      (diag as any)._fixData = {
        sceneRange: new vscode.Range(sceneLine, sceneCol, sceneLine, sceneCol + sceneLen),
        suggestions: foundIn.map(f => f.scene),
      };
    }
  }

  return diag;
}

const DEAD_BRANCH_MESSAGES: Record<string, string> = {
  "condition-false":
    "This branch can never be reached — its condition is always false.",
  "condition-true-elsewhere":
    "This branch can never be reached — a previous branch's condition is always true, so this one is skipped.",
  "selectable-if-false":
    "This option can never be selected — its *selectable_if condition is always false.",
};

const CONTROL_FLOW_MESSAGES: Record<string, string> = {
  "branch-fallthrough":
    "This branch needs a *goto, *finish, or *ending at the end — " +
    "without one, the story has no way to continue after this point.",
  "choice-fallthrough":
    "This choice option needs a *goto, *finish, or *ending at the end — " +
    "without one, the reader will skip past the remaining options.",
  "implicit-end":
    "This scene ends without a *goto, *finish, or *ending — " +
    "the reader will have nowhere to go when they reach this point.",
};

function deadBranchDiagnostic(
  branch: { scene: string; line: number; reason: string },
): vscode.Diagnostic {
  const range = new vscode.Range(branch.line, 0, branch.line, 1000);
  const message = DEAD_BRANCH_MESSAGES[branch.reason] ?? "This branch can never be reached.";
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Hint);
  diag.source = "choicescript";
  diag.tags = [vscode.DiagnosticTag.Unnecessary];
  return diag;
}

function controlFlowDiagnostic(
  violation: { scene: string; line: number; kind: string },
): vscode.Diagnostic {
  const range = new vscode.Range(violation.line, 0, violation.line, 1000);
  const message = CONTROL_FLOW_MESSAGES[violation.kind] ?? "Missing explicit navigation";
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diag.source = "choicescript";
  return diag;
}

function undeclaredSetDiagnostic(
  v: { scene: string; line: number; position: number; length: number; variable: string; kind: string },
): vscode.Diagnostic {
  const range = new vscode.Range(v.line, v.position, v.line, v.position + v.length);
  const message = v.kind === "set"
    ? `Variable "${v.variable}" is used in *set but was never declared with *create or *temp.`
    : `Variable "${v.variable}" has not been declared with *create or *temp.`;
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diag.source = "choicescript";
  return diag;
}

function multiReplaceDiagnostic(
  v: { scene: string; line: number; position: number; selectorValue: number | string; alternativeCount: number; kind: string },
): vscode.Diagnostic {
  const range = new vscode.Range(v.line, v.position, v.line, v.position + 2);
  let message: string;
  if (v.kind === "zero-index") {
    message = `Multireplace selector is 0 (uninitialized). Multireplace is 1-indexed — valid range is 1 to ${v.alternativeCount}.`;
  } else if (v.kind === "string-selector") {
    message = `Multireplace selector is "${v.selectorValue}" (a string) which cannot be used as a numeric index. Multireplace expects a number (1 to ${v.alternativeCount}) or a boolean.`;
  } else {
    message = `Multireplace selector value ${v.selectorValue} is out of range. Valid range is 1 to ${v.alternativeCount}.`;
  }
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diag.source = "choicescript";
  return diag;
}

function unusedVariableDiagnostic(
  v: { name: string; scene: string; line: number; position: number; length: number; scope: string },
): vscode.Diagnostic {
  const range = new vscode.Range(v.line, v.position, v.line, v.position + v.length);
  const scope = v.scope === "Global" ? "*create" : "*temp";
  const message = `Variable "${v.name}" is declared with ${scope} but never read.`;
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Hint);
  diag.source = "choicescript";
  diag.tags = [vscode.DiagnosticTag.Unnecessary];
  return diag;
}

function unusedLabelDiagnostic(
  l: { name: string; scene: string; line: number; position: number; length: number },
): vscode.Diagnostic {
  const range = new vscode.Range(l.line, l.position, l.line, l.position + l.length);
  const message = `Label "${l.name}" is never referenced by *goto or *gosub.`;
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Hint);
  diag.source = "choicescript";
  diag.tags = [vscode.DiagnosticTag.Unnecessary];
  return diag;
}

const UNREACHABLE_MESSAGES: Record<string, (item: { cfgId: string; label: string }) => string> = {
  "dead-scene":
    (item) => `This scene is never reached — no *goto_scene or *scene_list progression leads here.`,
  "dead-label":
    (item) => `The code starting at label "${item.label}" is never reached — no *goto or *gosub targets it.`,
  "dead-continuation":
    (item) => `This code is never reached — the *gosub that would return here is itself unreachable.`,
  "dead-code":
    (item) => `This code is never reached.`,
};

function unreachableCodeDiagnostic(
  item: { scene: string; line: number; position: number; cfgId: string; label: string; reason: string },
): vscode.Diagnostic {
  const range = new vscode.Range(item.line, 0, item.line, 1000);
  const formatter = UNREACHABLE_MESSAGES[item.reason];
  const message = formatter ? formatter(item) : "This code is never reached.";
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Hint);
  diag.source = "choicescript";
  diag.tags = [vscode.DiagnosticTag.Unnecessary];
  return diag;
}

function missingImageDiagnostic(
  img: { path: string; scene: string; line: number; position: number; length: number },
): vscode.Diagnostic {
  const range = new vscode.Range(img.line, img.position, img.line, img.position + img.length);
  const message = `Image file "${img.path}" not found in the scenes folder.`;
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diag.source = "choicescript";
  return diag;
}

function achievementVariableConflictDiagnostic(
  c: { codename: string; variable: string; scene: string; line: number; position: number; length: number },
): vscode.Diagnostic {
  const range = new vscode.Range(c.line, c.position, c.line, c.position + c.length);
  const message = `Achievement codename "${c.codename}" matches variable "${c.variable}" — this may cause confusion.`;
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diag.source = "choicescript";
  return diag;
}

function getSceneFromNavError(error: NavigationError): string {
  const token = (error.statement as any).token;
  return token?.sceneName ?? "unknown";
}

export async function pushDiagnostics(
  collection: vscode.DiagnosticCollection,
  folder: vscode.Uri,
  result: AnalysisResult
) {
  collection.clear();

  const allDiags = new Map<string, vscode.Diagnostic[]>();

  for (const [sceneName, errors] of result.parseErrors) {
    const diags = allDiags.get(sceneName) ?? [];
    for (const err of errors) {
      diags.push(parseErrorToDiagnostic(err));
    }
    allDiags.set(sceneName, diags);
  }

  for (const err of result.navigationErrors) {
    const sceneName = getSceneFromNavError(err);
    const diags = allDiags.get(sceneName) ?? [];
    diags.push(navigationErrorToDiagnostic(err, folder));
    allDiags.set(sceneName, diags);
  }

  for (const branch of result.locationIndex.getDeadBranches()) {
    const diags = allDiags.get(branch.scene) ?? [];
    diags.push(deadBranchDiagnostic(branch));
    allDiags.set(branch.scene, diags);
  }

  for (const violation of result.locationIndex.getControlFlowViolations()) {
    const diags = allDiags.get(violation.scene) ?? [];
    diags.push(controlFlowDiagnostic(violation));
    allDiags.set(violation.scene, diags);
  }

  for (const v of result.locationIndex.getUndeclaredSets()) {
    const diags = allDiags.get(v.scene) ?? [];
    diags.push(undeclaredSetDiagnostic(v));
    allDiags.set(v.scene, diags);
  }

  for (const v of result.locationIndex.getMultiReplaceViolations()) {
    const diags = allDiags.get(v.scene) ?? [];
    diags.push(multiReplaceDiagnostic(v));
    allDiags.set(v.scene, diags);
  }

  for (const v of result.locationIndex.getUnusedVariables()) {
    const diags = allDiags.get(v.scene) ?? [];
    diags.push(unusedVariableDiagnostic(v));
    allDiags.set(v.scene, diags);
  }

  for (const l of result.locationIndex.getUnusedLabels()) {
    const diags = allDiags.get(l.scene) ?? [];
    diags.push(unusedLabelDiagnostic(l));
    allDiags.set(l.scene, diags);
  }

  for (const item of result.locationIndex.getUnreachableCode()) {
    const diags = allDiags.get(item.scene) ?? [];
    diags.push(unreachableCodeDiagnostic(item));
    allDiags.set(item.scene, diags);
  }

  for (const c of result.locationIndex.getAchievementVariableConflicts()) {
    const diags = allDiags.get(c.scene) ?? [];
    diags.push(achievementVariableConflictDiagnostic(c));
    allDiags.set(c.scene, diags);
  }

  const imageRefs = result.locationIndex.getImageReferences();
  const imageChecks = await Promise.all(imageRefs.map(async (img) => {
    const uri = vscode.Uri.joinPath(folder, img.path);
    try {
      await vscode.workspace.fs.stat(uri);
      return null;
    } catch {
      return img;
    }
  }));
  for (const img of imageChecks) {
    if (!img) continue;
    const diags = allDiags.get(img.scene) ?? [];
    diags.push(missingImageDiagnostic(img));
    allDiags.set(img.scene, diags);
  }

  for (const [sceneName, diags] of allDiags) {
    const uri = vscode.Uri.joinPath(folder, `${sceneName}.txt`);
    collection.set(uri, diags);
  }
}
