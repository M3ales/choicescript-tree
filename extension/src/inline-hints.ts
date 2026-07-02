import * as vscode from "vscode";
import { SceneAst } from "../../parser/scene";
import { Statement, IfStatement, ElseIfStatement, ElseStatement, ChoiceOptionStatement, AchievementStatement, ImageStatement } from "../../parser/statements";
import { stringifyExpression } from "./stringify-expression";

const hintStyle: vscode.DecorationRenderOptions = {
  after: {
    color: new vscode.ThemeColor("editorCodeLens.foreground"),
    fontStyle: "italic",
    margin: "0 0 0 2em",
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
};

export class InlineHintDecorator {
  private decorationType = vscode.window.createTextEditorDecorationType(hintStyle);
  private disposables: vscode.Disposable[] = [];
  private scenes: SceneAst[] = [];
  private enabled = true;

  activate(context: vscode.ExtensionContext) {
    this.disposables.push(this.decorationType);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.languageId === "choicescript") {
          this.update(editor);
        }
      })
    );

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && e.document === editor.document && e.document.languageId === "choicescript") {
          this.update(editor);
        }
      })
    );

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === doc && doc.languageId === "choicescript") {
          this.update(editor);
        }
      })
    );

    context.subscriptions.push(...this.disposables);

    if (vscode.window.activeTextEditor?.document.languageId === "choicescript") {
      this.update(vscode.window.activeTextEditor);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  updateScenes(scenes: SceneAst[]) {
    this.scenes = scenes;
  }

  update(editor: vscode.TextEditor) {
    const doc = editor.document;
    const decorations: vscode.DecorationOptions[] = [];

    const choicePattern = /^\s*\*(?:choice|fake_choice)\s*$/i;
    const sceneName = doc.uri.path.split("/").pop()?.replace(/\.txt$/, "") ?? "";
    const sceneAst = this.scenes.find(s => s.name === sceneName);

    if (this.enabled) {
      const conditionHints = sceneAst ? buildConditionHintMap(sceneAst.statements) : new Map<number, string>();

      const elseIfPattern = /^\s*\*elseif\b/i;
      const elsePattern = /^\s*\*else\s*$/i;

      for (let i = 0; i < doc.lineCount; i++) {
        const line = doc.lineAt(i);
        const text = line.text;
        const trimmed = text.trimStart();
        if (trimmed.length === 0) continue;

        if (elseIfPattern.test(text) || elsePattern.test(text)) {
          const hint = conditionHints.get(i);
          if (hint) {
            decorations.push({
              range: new vscode.Range(i, text.length, i, text.length),
              renderOptions: { after: { contentText: `  ${hint}` } },
            });
          }
        }
      }
    }

    if (this.enabled && sceneAst) {
      const structureHints = buildStructureHintMap(sceneAst.statements);
      for (const [lineNum, hint] of structureHints) {
        if (lineNum >= doc.lineCount) continue;
        const text = doc.lineAt(lineNum).text;
        decorations.push({
          range: new vscode.Range(lineNum, text.length, lineNum, text.length),
          renderOptions: { after: { contentText: `  ${hint}` } },
        });
      }
    }

    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      const text = line.text;
      const trimmed = text.trimStart();
      if (trimmed.length === 0) continue;

      if (choicePattern.test(text)) {
        const prose = findPrecedingProse(doc, i);
        if (prose) {
          const truncated = prose.length > 80 ? prose.substring(0, 77) + "..." : prose;
          decorations.push({
            range: new vscode.Range(i, line.text.length, i, line.text.length),
            renderOptions: { after: { contentText: `  "${truncated}"` } },
          });
        }
      }
    }

    editor.setDecorations(this.decorationType, decorations);
  }
}

function buildConditionHintMap(statements: Statement[]): Map<number, string> {
  const map = new Map<number, string>();
  walkStatements(statements, map);
  return map;
}

function walkStatements(statements: Statement[], map: Map<number, string>) {
  for (const stmt of statements) {
    if (stmt.kind === "If") {
      const ifStmt = stmt as IfStatement;
      walkStatements(ifStmt.body, map);
      for (const branch of ifStmt.elseIfBranches) {
        if (branch.effectiveCondition) {
          map.set(branch.token.lineNumber, stringifyExpression(branch.effectiveCondition));
        }
        walkStatements(branch.body, map);
      }
      if (ifStmt.elseBranch) {
        const elseBranch = ifStmt.elseBranch as ElseStatement;
        if (elseBranch.invertedCondition) {
          const line = elseBranch.token.lineNumber;
          map.set(line, stringifyExpression(elseBranch.invertedCondition));
        }
        walkStatements(elseBranch.body, map);
      }
    } else if (stmt.kind === "Choice" || stmt.kind === "FakeChoice") {
      walkStatements((stmt as any).body, map);
    } else if (stmt.kind === "ChoiceOption") {
      walkStatements((stmt as ChoiceOptionStatement).body, map);
    }
  }
}

function buildStructureHintMap(statements: Statement[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const stmt of statements) {
    if (stmt.kind === "Achievement") {
      const a = stmt as AchievementStatement;
      if (a.preDescription) {
        const line = "lineNumber" in a.preDescription
          ? a.preDescription.lineNumber
          : (a.preDescription as any).lineNumber;
        if (typeof line === "number") {
          map.set(line, "← pre-earn description");
        }
      }
      if (a.postDescription) {
        map.set(a.postDescription.lineNumber, "← post-earn description");
      }
    }
    if (stmt.kind === "Image" || stmt.kind === "TextImage") {
      const img = stmt as ImageStatement;
      const parts: string[] = [];
      if (img.alignment) parts.push(`align: ${img.alignment.value}`);
      if (img.altText) {
        const alt = img.altText.content.length > 40
          ? img.altText.content.substring(0, 37) + "..."
          : img.altText.content;
        parts.push(`alt: "${alt}"`);
      }
      if (parts.length > 0) {
        map.set(img.token.lineNumber, `← ${parts.join(", ")}`);
      }
    }
  }
  return map;
}

function findPrecedingProse(doc: vscode.TextDocument, choiceLine: number): string | null {
  for (let k = choiceLine - 1; k >= 0; k--) {
    const text = doc.lineAt(k).text;
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("*")) return null;
    return trimmed;
  }
  return null;
}
