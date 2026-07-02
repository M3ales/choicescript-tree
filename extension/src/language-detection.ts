import * as vscode from "vscode";

export async function detectChoiceScriptFolders(): Promise<vscode.Uri[]> {
  const results: vscode.Uri[] = [];
  const startupFiles = await vscode.workspace.findFiles("**/startup.txt", "**/node_modules/**");

  for (const startupUri of startupFiles) {
    const folder = vscode.Uri.joinPath(startupUri, "..");
    if (!results.some((r) => r.toString() === folder.toString())) {
      results.push(folder);
    }
  }

  return results;
}

export function isInFolder(docUri: vscode.Uri, folder: vscode.Uri): boolean {
  const docStr = docUri.toString();
  const folderStr = folder.toString().replace(/\/?$/, "/");
  return docStr.startsWith(folderStr);
}

export async function setLanguageForFolder(folder: vscode.Uri) {
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId !== "plaintext") continue;
    if (!doc.fileName.endsWith(".txt")) continue;
    if (!isInFolder(doc.uri, folder)) continue;
    await vscode.languages.setTextDocumentLanguage(doc, "choicescript");
  }
}

export function watchStartupFile(
  context: vscode.ExtensionContext,
  onDetected: (folder: vscode.Uri) => void,
  onRemoved: (folder: vscode.Uri) => void
) {
  const watcher = vscode.workspace.createFileSystemWatcher("**/startup.txt");

  watcher.onDidCreate((uri) => {
    const folder = vscode.Uri.joinPath(uri, "..");
    onDetected(folder);
  });

  watcher.onDidDelete((uri) => {
    const folder = vscode.Uri.joinPath(uri, "..");
    onRemoved(folder);
  });

  context.subscriptions.push(watcher);
}
