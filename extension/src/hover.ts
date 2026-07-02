import * as vscode from "vscode";
import { SymbolTable, VariableSummary, LocationIndex, AbstractValue, EntryProvenance } from "../../api";
import { SerializedVariableState } from "../../analysis/dataflow/variable-state";
import { DeclareVariableStatement, GotoLabelStatement, GotoSceneStatement, GoSubStatement, GoSubSceneStatement } from "../../parser/statements";


interface LabelRefCounts {
  gotoCount: number;
  gosubCount: number;
  scenes: string[];
}

export class ChoiceScriptHoverProvider implements vscode.HoverProvider {
  private symbolTable: SymbolTable = { sites: [], variables: new Map() };
  private locationIndex: LocationIndex | null = null;
  private labelRefIndex = new Map<string, LabelRefCounts>();

  private folder: vscode.Uri | null = null;

  updateData(
    symbolTable: SymbolTable,
    locationIndex: LocationIndex,
    folder?: vscode.Uri,
  ) {
    this.symbolTable = symbolTable;
    this.locationIndex = locationIndex;
    if (folder) this.folder = folder;
    this.labelRefIndex = this.buildLabelRefIndex();
  }

  private buildLabelRefIndex(): Map<string, LabelRefCounts> {
    const index = new Map<string, LabelRefCounts>();
    if (!this.locationIndex) return index;

    for (const sceneName of this.locationIndex.allSceneNames) {
      const ss = this.locationIndex.getSceneSymbols(sceneName);
      if (!ss) continue;

      for (const goto of ss.gotos) {
        if (goto.kind === "GotoLabel") {
          const g = goto as GotoLabelStatement;
          if ("value" in (g.label as any)) {
            const labelName = (g.label as any).value as string;
            const targetScene = sceneName;
            const key = `${targetScene}:${labelName}`;
            const entry = index.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
            entry.gotoCount++;
            if (!entry.scenes.includes(sceneName)) entry.scenes.push(sceneName);
            index.set(key, entry);
          }
        }
        if (goto.kind === "GotoScene") {
          const g = goto as GotoSceneStatement;
          if (g.label && "value" in (g.label as any) && "value" in (g.scene as any)) {
            const labelName = (g.label as any).value as string;
            const targetScene = (g.scene as any).value as string;
            const key = `${targetScene}:${labelName}`;
            const entry = index.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
            entry.gotoCount++;
            if (!entry.scenes.includes(sceneName)) entry.scenes.push(sceneName);
            index.set(key, entry);
          }
        }
      }

      for (const gosub of ss.gosubs) {
        if (gosub.kind === "GoSub") {
          const g = gosub as GoSubStatement;
          if ("value" in (g.label as any)) {
            const labelName = (g.label as any).value as string;
            const targetScene = sceneName;
            const key = `${targetScene}:${labelName}`;
            const entry = index.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
            entry.gosubCount++;
            if (!entry.scenes.includes(sceneName)) entry.scenes.push(sceneName);
            index.set(key, entry);
          }
        }
        if (gosub.kind === "GoSubScene") {
          const g = gosub as GoSubSceneStatement;
          if (g.label && "value" in (g.label as any) && "value" in (g.scene as any)) {
            const labelName = (g.label as any).value as string;
            const targetScene = (g.scene as any).value as string;
            const key = `${targetScene}:${labelName}`;
            const entry = index.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
            entry.gosubCount++;
            if (!entry.scenes.includes(sceneName)) entry.scenes.push(sceneName);
            index.set(key, entry);
          }
        }
      }
    }

    return index;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | null {
    const range = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range) return null;

    const word = document.getText(range);
    const line = document.lineAt(position.line).text;
    const sceneName = fileToScene(document.fileName);

    const linePrefix = line.substring(0, range.start.character).trimStart();

    let hover: vscode.Hover | null = null;

    if (/\*label\s+$/i.test(linePrefix)) {
      hover = this.labelDefinitionHover(word, sceneName, range);
    } else if (/\*(goto|gosub)\s+$/i.test(linePrefix)) {
      hover = this.labelReferenceHover(word, sceneName, range);
    } else if (/\*(goto_scene|gosub_scene)\s+$/i.test(linePrefix)) {
      hover = this.sceneHover(word, range);
    } else if (/\*achieve\s+$/i.test(linePrefix)) {
      hover = this.achieveHover(word, range);
    } else if (linePrefix === "*" || linePrefix === "") {
      const cmdMatch = line.trimStart().match(/^\*(\w+)/);
      if (cmdMatch && cmdMatch[1] === word) {
        hover = this.commandHover(word, range);
      }
    }

    if (!hover) {
      hover = this.variableHover(word, sceneName, position.line, range);
    }

    this.appendLocationInfo(hover, sceneName, position.line);

    return hover;
  }

  private appendLocationInfo(
    hover: vscode.Hover | null,
    sceneName: string,
    line: number,
  ): void {
    if (!hover || !this.locationIndex) return;

    const result = this.locationIndex.queryLocation({ scene: sceneName, line });
    if (result.entries.length === 0) return;

    const entry = result.entries[0];
    const md = hover.contents[hover.contents.length - 1] as vscode.MarkdownString;
    if (!md?.appendMarkdown) return;

    md.appendMarkdown(`\n\n---\n\n`);
    md.appendMarkdown(`\`cfg\` \`${entry.cfgId}\` · \`block\` \`${entry.scene}:${entry.line + 1}\` · \`stmt\` \`${entry.statementKind}\``);
  }

  private appendDataflowInfo(
    md: vscode.MarkdownString,
    variable: string,
    sceneName: string,
    line: number,
    isParam = false,
  ): void {
    if (!this.locationIndex) return;

    const locResult = this.locationIndex.queryLocation({ scene: sceneName, line });
    const entry = locResult.entries.length > 0 ? locResult.entries[0] : null;
    const cfgId = entry?.cfgId;
    const isMutation = entry ? MUTATION_KINDS.has(entry.statementKind) : false;
    const isGosubCfg = cfgId ? cfgId.includes(":") && cfgId.split(":")[1] !== "" : false;

    if (isGosubCfg && cfgId && entry) {
      if (isMutation) {
        const callSites = this.locationIndex.getCallSiteBeforeAndAfter(cfgId, entry.statementId, sceneName);
        if (callSites.length > 0) {
          this.appendCallSiteTransitionTable(md, callSites, variable, sceneName);
          return;
        }
      } else {
        const callSites = this.locationIndex.getCallSiteStateAtStatement(cfgId, entry.statementId, sceneName);
        if (callSites.length > 0) {
          this.appendCallSiteValueTable(md, callSites, variable, sceneName);
          return;
        }
      }
    }

    if (entry && isMutation) {
      const attributed = this.locationIndex.getAttributedBeforeAndAfter(entry.statementId, sceneName);
      if (attributed.length > 0 && attributed.some(a => a.provenance && a.provenance.length > 0)) {
        this.appendAttributedTransitionTable(md, attributed, variable, sceneName);
        return;
      }
      if (attributed.length > 0) {
        this.appendPlainTransitions(md, attributed, variable, sceneName);
        return;
      }
    }

    if (entry) {
      const attributed = this.locationIndex.getAttributedStatesAtStatement(entry.statementId, sceneName);
      if (attributed.length > 0 && attributed.some(a => a.provenance && a.provenance.length > 0)) {
        this.appendAttributedValueTable(md, attributed, variable, sceneName);
        return;
      }
      if (attributed.length > 0) {
        this.appendPlainValues(md, attributed, variable, sceneName);
        return;
      }
    }

    const dfStates = locResult.dataflow
      ?? this.locationIndex.getDataflowForIdentifier(variable, sceneName, line);
    if (!dfStates || dfStates.length === 0) return;

    const values = dfStates
      .map(s => lookupVariable(s, variable, sceneName))
      .filter((v): v is AbstractValue => v !== null && v.kind !== "bottom");
    if (values.length === 0) return;

    const formatted = [...new Set(values.map(formatAbstractValue))];
    md.appendMarkdown(`\n\n---\n\n`);
    if (formatted.length === 1) {
      md.appendMarkdown(`**Dataflow** · ${formatted[0]}`);
    } else {
      md.appendMarkdown(`**Dataflow** (${formatted.length} states)\n\n`);
      for (const f of formatted) md.appendMarkdown(`- ${f}\n`);
    }
  }

  private appendCallSiteTransitionTable(
    md: vscode.MarkdownString,
    callSites: { callerScene: string; callerLine: number; before: SerializedVariableState; after: SerializedVariableState }[],
    variable: string,
    scene: string,
  ): void {
    const rows: { scene: string; line: number; before: string; after: string }[] = [];
    const seen = new Map<string, number>();
    for (const cs of callSites) {
      const bv = lookupVariable(cs.before, variable, scene);
      const av = lookupVariable(cs.after, variable, scene);
      if (!bv && !av) continue;
      const bf = bv && bv.kind !== "bottom" ? formatAbstractValue(bv) : "?";
      const af = av && av.kind !== "bottom" ? formatAbstractValue(av) : "?";
      const key = `${cs.callerScene}\0${cs.callerLine}\0${bf}\0${af}`;
      if (!seen.has(key)) {
        seen.set(key, rows.length);
        rows.push({ scene: cs.callerScene, line: cs.callerLine, before: bf, after: af });
      }
    }
    if (rows.length === 0) return;

    md.appendMarkdown(`\n\n---\n\n`);
    md.appendMarkdown(`**Dataflow** (${rows.length} call site${rows.length !== 1 ? "s" : ""})\n\n`);
    md.appendMarkdown(`| Caller | Before | After |\n`);
    md.appendMarkdown(`|:--|:--|:--|\n`);
    const MAX_ROWS = 8;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS); i++) {
      const r = rows[i];
      md.appendMarkdown(`| ${this.sceneLink(r.scene, r.line)} | ${r.before} | ${r.after} |\n`);
    }
    if (rows.length > MAX_ROWS) md.appendMarkdown(`\n*...+${rows.length - MAX_ROWS} more*\n`);
  }

  private appendCallSiteValueTable(
    md: vscode.MarkdownString,
    callSites: { callerScene: string; callerLine: number; state: SerializedVariableState }[],
    variable: string,
    scene: string,
  ): void {
    const rows: { scene: string; line: number; value: string }[] = [];
    const seen = new Map<string, number>();
    for (const cs of callSites) {
      const v = lookupVariable(cs.state, variable, scene);
      if (!v || v.kind === "bottom") continue;
      const formatted = formatAbstractValue(v);
      const key = `${cs.callerScene}\0${cs.callerLine}\0${formatted}`;
      if (!seen.has(key)) {
        seen.set(key, rows.length);
        rows.push({ scene: cs.callerScene, line: cs.callerLine, value: formatted });
      }
    }
    if (rows.length === 0) return;

    md.appendMarkdown(`\n\n---\n\n`);
    md.appendMarkdown(`**Dataflow** (${rows.length} call site${rows.length !== 1 ? "s" : ""})\n\n`);
    md.appendMarkdown(`| Caller | Value |\n`);
    md.appendMarkdown(`|:--|:--|\n`);
    const MAX_ROWS = 8;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS); i++) {
      const r = rows[i];
      md.appendMarkdown(`| ${this.sceneLink(r.scene, r.line)} | ${r.value} |\n`);
    }
    if (rows.length > MAX_ROWS) md.appendMarkdown(`\n*...+${rows.length - MAX_ROWS} more*\n`);
  }

  private appendAttributedTransitionTable(
    md: vscode.MarkdownString,
    attributed: { provenance?: EntryProvenance[]; before: SerializedVariableState; after: SerializedVariableState }[],
    variable: string,
    scene: string,
  ): void {
    const rows: { label: string; before: string; after: string; provenance?: EntryProvenance }[] = [];
    for (const a of attributed) {
      const bv = lookupVariable(a.before, variable, scene);
      const av = lookupVariable(a.after, variable, scene);
      if (!bv && !av) continue;
      const bf = bv && bv.kind !== "bottom" ? formatAbstractValue(bv) : "?";
      const af = av && av.kind !== "bottom" ? formatAbstractValue(av) : "?";
      const prov = a.provenance?.[0];
      const label = prov?.label ?? "Entry";
      rows.push({ label, before: bf, after: af, provenance: prov });
    }
    if (rows.length === 0) return;

    md.appendMarkdown(`\n\n---\n\n`);
    md.appendMarkdown(`**Dataflow** (${rows.length} state${rows.length !== 1 ? "s" : ""})\n\n`);
    md.appendMarkdown(`| Context | Before | After |\n`);
    md.appendMarkdown(`|:--|:--|:--|\n`);
    const MAX_ROWS = 8;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS); i++) {
      const r = rows[i];
      const link = r.provenance?.scene != null && r.provenance?.line != null
        ? this.sceneLink(r.provenance.scene, r.provenance.line)
        : `\`${r.label}\``;
      md.appendMarkdown(`| ${link} | ${r.before} | ${r.after} |\n`);
    }
    if (rows.length > MAX_ROWS) md.appendMarkdown(`\n*...+${rows.length - MAX_ROWS} more*\n`);
  }

  private appendAttributedValueTable(
    md: vscode.MarkdownString,
    attributed: { provenance?: EntryProvenance[]; state: SerializedVariableState }[],
    variable: string,
    scene: string,
  ): void {
    const rows: { label: string; value: string; provenance?: EntryProvenance }[] = [];
    for (const a of attributed) {
      const v = lookupVariable(a.state, variable, scene);
      if (!v || v.kind === "bottom") continue;
      const formatted = formatAbstractValue(v);
      const prov = a.provenance?.[0];
      const label = prov?.label ?? "Entry";
      rows.push({ label, value: formatted, provenance: prov });
    }
    if (rows.length === 0) return;

    md.appendMarkdown(`\n\n---\n\n`);
    md.appendMarkdown(`**Dataflow** (${rows.length} state${rows.length !== 1 ? "s" : ""})\n\n`);
    md.appendMarkdown(`| Context | Value |\n`);
    md.appendMarkdown(`|:--|:--|\n`);
    const MAX_ROWS = 8;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS); i++) {
      const r = rows[i];
      const link = r.provenance?.scene != null && r.provenance?.line != null
        ? this.sceneLink(r.provenance.scene, r.provenance.line)
        : `\`${r.label}\``;
      md.appendMarkdown(`| ${link} | ${r.value} |\n`);
    }
    if (rows.length > MAX_ROWS) md.appendMarkdown(`\n*...+${rows.length - MAX_ROWS} more*\n`);
  }

  private appendPlainTransitions(
    md: vscode.MarkdownString,
    attributed: { before: SerializedVariableState; after: SerializedVariableState }[],
    variable: string,
    scene: string,
  ): void {
    const unique = new Map<string, true>();
    const deduped: { before: string; after: string }[] = [];
    for (const a of attributed) {
      const bv = lookupVariable(a.before, variable, scene);
      const av = lookupVariable(a.after, variable, scene);
      if (!bv && !av) continue;
      const bf = bv && bv.kind !== "bottom" ? formatAbstractValue(bv) : "?";
      const af = av && av.kind !== "bottom" ? formatAbstractValue(av) : "?";
      const key = `${bf}\0${af}`;
      if (!unique.has(key)) { unique.set(key, true); deduped.push({ before: bf, after: af }); }
    }
    if (deduped.length === 0) return;

    md.appendMarkdown(`\n\n---\n\n`);
    if (deduped.length === 1) {
      md.appendMarkdown(`**Dataflow** · ${deduped[0].before} → ${deduped[0].after}`);
    } else {
      md.appendMarkdown(`**Dataflow** (${deduped.length} states)\n\n`);
      for (const d of deduped) md.appendMarkdown(`- ${d.before} → ${d.after}\n`);
    }
  }

  private appendPlainValues(
    md: vscode.MarkdownString,
    attributed: { state: SerializedVariableState }[],
    variable: string,
    scene: string,
  ): void {
    const values = attributed
      .map(a => lookupVariable(a.state, variable, scene))
      .filter((v): v is AbstractValue => v !== null && v.kind !== "bottom");
    if (values.length === 0) return;

    const formatted = [...new Set(values.map(formatAbstractValue))];
    md.appendMarkdown(`\n\n---\n\n`);
    if (formatted.length === 1) {
      md.appendMarkdown(`**Dataflow** · ${formatted[0]}`);
    } else {
      md.appendMarkdown(`**Dataflow** (${formatted.length} states)\n\n`);
      for (const f of formatted) md.appendMarkdown(`- ${f}\n`);
    }
  }

  private sceneLink(scene: string, line: number): string {
    if (!this.folder) return `\`${scene}:${line + 1}\``;
    const uri = vscode.Uri.joinPath(this.folder, `${scene}.txt`).with({ fragment: `L${line + 1}` });
    return `[\`${scene}:${line + 1}\`](${uri.toString()})`;
  }

  private variableHover(
    name: string,
    sceneName: string,
    line: number,
    range: vscode.Range
  ): vscode.Hover | null {
    const lowerName = name.toLowerCase();
    const summary = this.findVariableSummary(lowerName);
    const decl = this.findDeclaration(lowerName, sceneName);

    if (!summary && !decl) return null;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const scope = summary?.scope ?? decl?.scope ?? "Global";
    const isParam = summary?.isParam
      ?? this.hasParam(sceneName, lowerName)
      ?? false;
    const keyword = isParam ? "params" : scope === "Temporary" ? "temp" : "create";
    md.appendMarkdown(`**${keyword} \`${name}\`**`);

    if (isParam) {
      md.appendMarkdown(`\n\n*Subroutine parameter — value passed by caller via \\*gosub*`);
    }

    if (decl) {
      if (decl.expression) {
        md.appendMarkdown(` = \`${stringifyExpression(decl.expression)}\``);
      }
      md.appendMarkdown(`\n\n`);
      md.appendMarkdown(`*Declared in* \`${decl.token.sceneName}\` line ${decl.token.lineNumber + 1}`);
    }

    if (this.locationIndex) {
      const varLoc = this.locationIndex.queryVariable({ variable: name });
      const sceneFilter = scope === "Temporary"
        ? (d: { scene: string }) => d.scene === sceneName
        : () => true;
      const declarations = varLoc.definitions.filter(d => sceneFilter(d) && DECLARATION_KINDS.has(d.statementKind));
      const modifications = varLoc.definitions.filter(d => sceneFilter(d) && !DECLARATION_KINDS.has(d.statementKind));
      const refs = varLoc.references.filter(sceneFilter);
      const deletes = varLoc.deletes.filter(sceneFilter);

      md.appendMarkdown(`\n\n---\n\n`);
      const parts: string[] = [];
      if (declarations.length > 0) parts.push(`${declarations.length} declaration${declarations.length !== 1 ? "s" : ""}`);
      if (modifications.length > 0) parts.push(`${modifications.length} modification${modifications.length !== 1 ? "s" : ""}`);
      if (refs.length > 0) parts.push(`${refs.length} reference${refs.length !== 1 ? "s" : ""}`);
      if (deletes.length > 0) parts.push("deleted");
      md.appendMarkdown(parts.join(", "));

      const allScenes = new Set([
        ...varLoc.definitions.map(d => d.scene),
        ...refs.map(r => r.scene),
      ]);
      if (allScenes.size > 1 && allScenes.size <= 8) {
        md.appendMarkdown(`\n\n*Used in:* ${[...allScenes].map(s => `\`${s}\``).join(", ")}`);
      } else if (allScenes.size > 8) {
        md.appendMarkdown(`\n\n*Used in ${allScenes.size} scenes*`);
      }
    } else if (summary) {
      md.appendMarkdown(`\n\n---\n\n`);
      const parts: string[] = [];
      if (summary.defCount > 0) parts.push(`${summary.defCount} definition${summary.defCount !== 1 ? "s" : ""}`);
      if (summary.refCount > 0) parts.push(`${summary.refCount} reference${summary.refCount !== 1 ? "s" : ""}`);
      if (summary.deleted) parts.push("deleted");
      md.appendMarkdown(parts.join(", "));
    }

    this.appendDataflowInfo(md, name, sceneName, line, isParam);

    return new vscode.Hover(md, range);
  }

  private labelDefinitionHover(
    name: string,
    sceneName: string,
    range: vscode.Range
  ): vscode.Hover | null {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**label \`${name}\`**\n\n`);

    const key = `${sceneName}:${name}`;
    const { gotoCount, gosubCount, scenes: refScenes } = this.labelRefIndex.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
    const total = gotoCount + gosubCount;

    if (total === 0) {
      md.appendMarkdown(`*No references found — this label may be unused*`);
    } else {
      const parts: string[] = [];
      if (gotoCount > 0) parts.push(`${gotoCount} goto${gotoCount !== 1 ? "s" : ""}`);
      if (gosubCount > 0) parts.push(`${gosubCount} gosub${gosubCount !== 1 ? "s" : ""}`);
      md.appendMarkdown(`*Referenced by:* ${parts.join(", ")}`);

      if (refScenes.length > 1) {
        md.appendMarkdown(` (from ${refScenes.map(s => `\`${s}\``).join(", ")})`);
      }
    }

    return new vscode.Hover(md, range);
  }

  private labelReferenceHover(
    name: string,
    sceneName: string,
    range: vscode.Range
  ): vscode.Hover | null {
    if (!this.locationIndex) return null;

    const ss = this.locationIndex.getSceneSymbols(sceneName);
    const label = ss?.labels.get(name);
    if (!label) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**\`${name}\`** — *label not found in \`${sceneName}\`*`);
      return new vscode.Hover(md, range);
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**goto \`${name}\`**\n\n`);
    md.appendMarkdown(`Defined at line ${label.token.lineNumber + 1} in \`${sceneName}\``);

    return new vscode.Hover(md, range);
  }

  private achieveHover(
    codename: string,
    range: vscode.Range
  ): vscode.Hover | null {
    if (!this.locationIndex) return null;

    const found = this.locationIndex.findAchievementDefinition(codename);
    if (!found) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**achieve \`${codename}\`** — *no matching \\*achievement declaration found*`);
      return new vscode.Hover(md, range);
    }

    const { achievement, scene } = found;
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const visibility = achievement.hidden ? "invisible" : "visible";
    md.appendMarkdown(`**achieve \`${codename}\`** *(${visibility})*\n\n`);
    md.appendMarkdown(`**Title:** ${achievement.title.content}\n\n`);

    if (achievement.preDescription) {
      const preText = "content" in achievement.preDescription
        ? achievement.preDescription.content
        : achievement.preDescription.value;
      md.appendMarkdown(`**Pre-earned:** ${preText}\n\n`);
    }

    md.appendMarkdown(`**Post-earned:** ${achievement.postDescription.content}\n\n`);

    md.appendMarkdown(`---\n\n`);
    const link = this.sceneLink(scene, achievement.token.lineNumber);
    md.appendMarkdown(`*Declared in* ${link}`);

    const refs = this.locationIndex.findAchievementReferences(codename);
    if (refs.length > 0) {
      md.appendMarkdown(` · ${refs.length} reference${refs.length !== 1 ? "s" : ""}`);
    }

    return new vscode.Hover(md, range);
  }

  private sceneHover(
    name: string,
    range: vscode.Range
  ): vscode.Hover | null {
    if (!this.locationIndex) return null;

    const ss = this.locationIndex.getSceneSymbols(name);
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    if (!ss) {
      md.appendMarkdown(`**scene \`${name}\`** — *not found in workspace*`);
      return new vscode.Hover(md, range);
    }

    md.appendMarkdown(`**scene \`${name}\`**\n\n`);

    const labels = [...ss.labels.keys()];
    const temps = [...ss.tempVariables.keys()];

    const globalNames: string[] = [];
    for (const [varName, decl] of this.locationIndex.allGlobalDeclarations) {
      if (decl.token.sceneName === name) globalNames.push(varName);
    }

    const parts: string[] = [];
    if (labels.length > 0) {
      const shown = labels.slice(0, 8);
      const suffix = labels.length > 8 ? ` (+${labels.length - 8} more)` : "";
      parts.push(`**Labels:** ${shown.map(l => `\`${l}\``).join(", ")}${suffix}`);
    }
    if (globalNames.length > 0) {
      const shown = globalNames.slice(0, 6);
      const suffix = globalNames.length > 6 ? ` (+${globalNames.length - 6} more)` : "";
      parts.push(`**Globals declared:** ${shown.map(v => `\`${v}\``).join(", ")}${suffix}`);
    }
    if (temps.length > 0) {
      const shown = temps.slice(0, 6);
      const suffix = temps.length > 6 ? ` (+${temps.length - 6} more)` : "";
      parts.push(`**Temps:** ${shown.map(v => `\`${v}\``).join(", ")}${suffix}`);
    }

    md.appendMarkdown(parts.join("\n\n"));

    return new vscode.Hover(md, range);
  }

  private commandHover(
    command: string,
    range: vscode.Range
  ): vscode.Hover | null {
    const info = COMMAND_DOCS[command];
    if (!info) return null;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**\`*${command}\`** — ${info}`);
    return new vscode.Hover(md, range);
  }

  private hasParam(sceneName: string, lowerName: string): boolean {
    const ss = this.locationIndex?.getSceneSymbols(sceneName);
    if (!ss) return false;
    for (const p of ss.paramVariables) {
      if (p.toLowerCase() === lowerName) return true;
    }
    return false;
  }

  private findVariableSummary(lowerName: string): VariableSummary | undefined {
    for (const [key, summary] of this.symbolTable.variables) {
      if (key.toLowerCase() === lowerName) return summary;
    }
    return undefined;
  }

  private findDeclaration(
    lowerName: string,
    currentScene: string
  ): DeclareVariableStatement | null {
    if (!this.locationIndex) return null;

    const ss = this.locationIndex.getSceneSymbols(currentScene);
    if (ss) {
      for (const [key, decl] of ss.tempVariables) {
        if (key.toLowerCase() === lowerName) return decl;
      }
    }

    for (const [key, decl] of this.locationIndex.allGlobalDeclarations) {
      if (key.toLowerCase() === lowerName) return decl;
    }

    return null;
  }

}

function fileToScene(fileName: string): string {
  return fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\.txt$/, "");
}

// Re-export from shared module for local use
import { stringifyExpression, formatLiteral } from "./stringify-expression";

const DECLARATION_KINDS = new Set([
  "DeclareVariable",
  "DeclareArray",
  "Parameters",
]);

const MUTATION_KINDS = new Set([
  "SetVariable",
  "InputText",
  "InputNumber",
  "GenerateRandom",
]);

function lookupVariable(
  state: SerializedVariableState,
  variable: string,
  scene: string,
): AbstractValue | null {
  const name = variable.toLowerCase();
  const tempScene = state.temps[scene];
  if (tempScene && name in tempScene) return tempScene[name];
  if (name in state.globals) return state.globals[name];
  return null;
}

function formatAbstractValue(value: AbstractValue): string {
  switch (value.kind) {
    case "constant": return `\`${formatLiteral(value.value)}\``;
    case "set": {
      const sorted = [...value.values].sort(compareValues);
      const inputTag = value.hasUserInput ? " + user input" : "";
      if (sorted.length <= 9) {
        return `{${sorted.map(v => formatLiteral(v)).join(", ")}}${inputTag}`;
      }
      const mid = Math.floor(sorted.length / 2);
      const picks = sampleAround(sorted, [0, mid, sorted.length - 1], 3);
      const notShown = sorted.length - picks.length;
      const parts: string[] = [];
      let last = -1;
      for (const i of picks) {
        if (last >= 0 && i > last + 1) parts.push("..");
        parts.push(formatLiteral(sorted[i]));
        last = i;
      }
      const suffix = notShown > 0
        ? ` ${notShown} not shown [${formatLiteral(sorted[0])}..${formatLiteral(sorted[mid])}..${formatLiteral(sorted[sorted.length - 1])}]`
        : "";
      return `{${parts.join(", ")}}${suffix}${inputTag}`;
    }
    case "range": return `[${value.min}..${value.max}]`;
    case "input": return "*user input*";
    case "loop": return "*loop-dependent*";
    case "top": return "*unknown*";
    case "bottom": return "*uninitialized*";
  }
}

function sampleAround(arr: unknown[], centres: number[], radius: number): number[] {
  const picked = new Set<number>();
  for (const c of centres) {
    for (let i = Math.max(0, c - radius + 1); i <= Math.min(arr.length - 1, c + radius - 1); i++) {
      picked.add(i);
    }
  }
  return [...picked].sort((a, b) => a - b);
}

function compareValues(a: string | number | boolean, b: string | number | boolean): number {
  if (typeof a === typeof b) {
    if (typeof a === "string") return a.localeCompare(b as string);
    if (typeof a === "number") return (a as number) - (b as number);
    return (a ? 1 : 0) - ((b as boolean) ? 1 : 0);
  }
  return String(a).localeCompare(String(b));
}

const COMMAND_DOCS: Record<string, string> = {
  choice: "Present options to the player. Each `#option` is an indented child.",
  fake_choice: "Present options that don't affect variables. Continues after selection.",
  if: "Conditional branch. Body executes when expression is true.",
  elseif: "Conditional branch following `*if`. Checked when prior conditions are false.",
  else: "Fallback branch. Executes when all prior `*if`/`*elseif` are false.",
  set: "Set a variable to an expression value.",
  create: "Declare a global variable (persists across scenes).",
  temp: "Declare a temporary variable (scene-scoped).",
  goto: "Jump to a label in the current scene.",
  goto_scene: "Jump to another scene, optionally to a specific label.",
  gosub: "Call a subroutine at a label. Returns to the next line after `*return`.",
  gosub_scene: "Call a subroutine in another scene. Returns after `*return`.",
  return: "Return from a `*gosub`/`*gosub_scene` call.",
  label: "Define a named jump target for `*goto`/`*gosub`.",
  finish: "End the current scene. Advances to the next scene in `*scene_list`.",
  ending: "End the game with a final message.",
  delay_ending: "End the game with a delayed final message.",
  page_break: "Insert a page break (\"Next\" button).",
  line_break: "Insert a blank line in the output.",
  input_text: "Prompt the player for text input, stored in a variable.",
  input_number: "Prompt the player for a number, stored in a variable.",
  rand: "Generate a random integer in a range and store in a variable.",
  comment: "A comment line. Not shown to the player.",
  scene_list: "Declare the ordered list of scenes for the game.",
  stat_chart: "Display a statistics chart to the player.",
  achievement: "Define an achievement with a title and description.",
  achieve: "Award an achievement to the player.",
  check_achievements: "Display the achievements screen.",
  image: "Display an image.",
  text_image: "Display an image inline with text.",
  link: "Display a clickable hyperlink.",
  selectable_if: "Make a choice option conditionally selectable.",
  hide_reuse: "Hide a choice option after it has been selected.",
  disable_reuse: "Grey out a choice option after it has been selected.",
  allow_reuse: "Allow a choice option to be selected multiple times.",
  save_checkpoint: "Save game state to a named checkpoint.",
  restore_checkpoint: "Restore game state from a named checkpoint.",
  goto_random_scene: "Jump to a randomly selected scene from a list.",
  create_array: "Declare a global array variable.",
  temp_array: "Declare a temporary array variable.",
  delete: "Delete a variable.",
  delete_array: "Delete an array variable.",
  author: "Set the game author name.",
  ifid: "Set the game's unique identifier (UUID).",
  params: "Declare parameters for a gosub-called label.",
};
