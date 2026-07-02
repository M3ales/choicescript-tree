import * as vscode from "vscode";

export class ChoiceScriptFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const lineCount = document.lineCount;

    const info = (i: number) => {
      const text = document.lineAt(i).text;
      const trimmed = text.trimStart();
      const indent = trimmed.length === 0 ? -1 : text.length - trimmed.length;
      return { text, trimmed, indent };
    };

    const findBlockEnd = (start: number, startIndent: number): number => {
      let end = start;
      for (let j = start + 1; j < lineCount; j++) {
        const { indent } = info(j);
        if (indent === -1) continue;
        if (indent <= startIndent) break;
        end = j;
      }
      return end;
    };

    const ifPattern = /^\*if\b/i;
    const elseIfPattern = /^\*elseif\b/i;
    const elsePattern = /^\*else\b/i;
    const labelPattern = /^\*label\b/i;
    const choicePattern = /^\*(?:choice|fake_choice)\b/i;
    const blockPattern = /^\*(?:label|stat_chart|scene_list|achievement)\b/i;
    const optionPattern = /^(?:#|\*(?:selectable_if|hide_reuse|disable_reuse|allow_reuse)\b)/i;

    const labelLines: number[] = [];
    for (let i = 0; i < lineCount; i++) {
      const { trimmed } = info(i);
      if (labelPattern.test(trimmed)) labelLines.push(i);
    }
    for (let k = 0; k < labelLines.length; k++) {
      const start = labelLines[k];
      let end: number;
      if (k + 1 < labelLines.length) {
        end = labelLines[k + 1] - 1;
        while (end > start && info(end).indent === -1) end--;
      } else {
        end = lineCount - 1;
        while (end > start && info(end).indent === -1) end--;
      }
      if (end > start) {
        ranges.push(new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Region));
      }
    }

    const handled = new Set<number>();

    for (let i = 0; i < lineCount; i++) {
      if (handled.has(i)) continue;
      const { trimmed, indent } = info(i);
      if (indent === -1) continue;

      if (ifPattern.test(trimmed)) {
        const branches: number[] = [];
        let chainEnd = findBlockEnd(i, indent);

        let j = chainEnd + 1;
        while (j < lineCount) {
          const next = info(j);
          if (next.indent === -1) { j++; continue; }
          if (next.indent !== indent) break;
          if (elseIfPattern.test(next.trimmed) || elsePattern.test(next.trimmed)) {
            handled.add(j);
            branches.push(j);
            const branchEnd = findBlockEnd(j, indent);
            chainEnd = branchEnd;
            j = branchEnd + 1;
            if (elsePattern.test(next.trimmed)) break;
          } else {
            break;
          }
        }

        if (chainEnd > i) {
          ranges.push(new vscode.FoldingRange(i, chainEnd));
          for (const branchLine of branches) {
            ranges.push(new vscode.FoldingRange(branchLine, chainEnd));
          }
        }
        continue;
      }

      if (choicePattern.test(trimmed)) {
        const end = findBlockEnd(i, indent);
        if (end > i) {
          ranges.push(new vscode.FoldingRange(i, end));
        }
        continue;
      }

      if (blockPattern.test(trimmed) || optionPattern.test(trimmed)) {
        const end = findBlockEnd(i, indent);
        if (end > i) {
          ranges.push(new vscode.FoldingRange(i, end));
        }
      }
    }

    return ranges;
  }
}
