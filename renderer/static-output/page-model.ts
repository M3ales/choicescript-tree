import { SegmentGraph, SegmentEdge, VariableEffect } from "../../analysis/segments/data";
import { LinkedCfgs, Cfg } from "../../analysis/ref-cfg/data";
import { CodeBlock } from "../../analysis/control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { ProseStatement } from "../../parser/statements/prose";
import { PageBreakStatement } from "../../parser/statements/page-break";
import { ChoiceOptionStatement } from "../../parser/statements/choice-option";
import { IfStatement } from "../../parser/statements/if";
import { InputTextStatement } from "../../parser/statements/input-text";
import { InputNumberStatement } from "../../parser/statements/input-number";
import { StatChartStatement } from "../../parser/statements/stat-chart";
import { Expression } from "../../parser/expressions";
import { isChoiceOptionEdge } from "../../analysis/control-flow-graph/data/transition-kind";
import { Transition } from "../../analysis/control-flow-graph/data/transition";

export interface PageSection {
  content: PageContent[];
  buttonText: string;
}

export interface Page {
  id: string;
  segmentId: string;
  sections: PageSection[];
  exit: PageExit;
}

export type PageContent =
  | { kind: "prose"; statement: ProseStatement }
  | { kind: "line-break" }
  | { kind: "effect"; statement: Statement }
  | { kind: "conditional"; expression: Expression; ifBody: PageContent[]; elseIfBranches: { expression: Expression; body: PageContent[] }[]; elseBranch: PageContent[] | null }
  | { kind: "stat-chart"; statement: StatChartStatement };

export type PageExit =
  | { kind: "choice"; options: PageChoiceOption[] }
  | { kind: "input"; inputKind: "text" | "number"; variable: string; targetPageId: string; min?: Expression; max?: Expression }
  | { kind: "terminal" };

export interface PageChoiceOption {
  label: string;
  optionStatement: ChoiceOptionStatement | null;
  targetPageId: string;
  selectableIf: Expression | null;
  reuse: string | null;
}

export interface PageModel {
  pages: Map<string, Page>;
  entryPageId: string;
  varMap: VarMap;
  statsPageIds: Set<string>;
  statsEntryPageId: string | null;
}

export interface VarMap {
  nameToKey: Map<string, string>;
  keyToName: Map<string, string>;
  defaults: Map<string, { value: unknown; type: "bool" | "number" | "string" }>;
  pools: Map<string, (string | number | boolean)[]>;
}

const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const toBase62 = (n: number): string => {
  if (n < 62) return BASE62[n];
  let result = "";
  while (n > 0) {
    result = BASE62[n % 62] + result;
    n = Math.floor(n / 62);
  }
  return result;
};

const collectLiteralValues = (
  statements: Record<string, Statement>,
): { pools: Map<string, (string | number | boolean)[]>; unpoolable: Set<string> } => {
  const valuesPerVar = new Map<string, Set<string>>();
  const unpoolable = new Set<string>();

  const addValue = (name: string, val: string | number | boolean) => {
    const key = name.toLowerCase();
    if (unpoolable.has(key)) return;
    const set = valuesPerVar.get(key) ?? new Set<string>();
    set.add(JSON.stringify(val));
    valuesPerVar.set(key, set);
  };

  const markUnpoolable = (name: string) => {
    const key = name.toLowerCase();
    unpoolable.add(key);
    valuesPerVar.delete(key);
  };

  for (const stmt of Object.values(statements)) {
    if (stmt.kind === "DeclareVariable") {
      const s = stmt as any;
      const name = s.variable?.value;
      if (!name) continue;
      const expr = s.expression;
      if (expr?.kind === "Literal" && expr.value?.value != null) {
        addValue(name, expr.value.value);
      }
    }
    if (stmt.kind === "SetVariable") {
      const s = stmt as any;
      if (s.assignment) {
        const varName = extractVarName(s.expression);
        if (!varName) continue;
        const rhs = s.assignment;
        if (rhs.kind === "Literal" && rhs.value?.value != null) {
          addValue(varName, rhs.value.value);
        } else {
          markUnpoolable(varName);
        }
      } else if (s.expression?.kind === "Binary") {
        const varName = extractVarName(s.expression.left);
        if (varName) markUnpoolable(varName);
      }
    }
  }

  const pools = new Map<string, (string | number | boolean)[]>();
  for (const [name, jsonSet] of valuesPerVar) {
    if (unpoolable.has(name)) continue;
    const values = [...jsonSet].map(j => JSON.parse(j) as string | number | boolean);
    if (values.length <= 1 || values.length > 200) continue;
    values.sort((a, b) => String(a).localeCompare(String(b)));
    pools.set(name, values);
  }

  return { pools, unpoolable };
};

const buildVarMap = (
  statements: Record<string, Statement>,
): VarMap => {
  const nameToKey = new Map<string, string>();
  const keyToName = new Map<string, string>();
  const defaults = new Map<string, { value: unknown; type: "bool" | "number" | "string" }>();
  const pools = new Map<string, (string | number | boolean)[]>();

  const allVars = new Set<string>();
  for (const stmt of Object.values(statements)) {
    if (stmt.kind === "DeclareVariable") {
      const s = stmt as any;
      const name = s.variable?.value?.toLowerCase();
      if (!name) continue;
      allVars.add(name);
      const expr = s.expression;
      if (expr?.kind === "Literal") {
        const val = expr.value?.value;
        const type = typeof val === "boolean" ? "bool" as const
          : typeof val === "number" ? "number" as const
          : "string" as const;
        defaults.set(name, { value: val, type });
      }
    }
    if (stmt.kind === "SetVariable") {
      const s = stmt as any;
      const name = extractVarName(s.expression);
      if (name) allVars.add(name.toLowerCase());
    }
  }

  const sorted = [...allVars].sort();
  for (let i = 0; i < sorted.length; i++) {
    const key = toBase62(i);
    nameToKey.set(sorted[i], key);
    keyToName.set(key, sorted[i]);
  }

  const { pools: literalPools } = collectLiteralValues(statements);
  for (const [name, pool] of literalPools) {
    if (allVars.has(name)) {
      pools.set(name, pool);
    }
  }

  return { nameToKey, keyToName, defaults, pools };
};

const extractVarName = (expr: any): string | null => {
  if (!expr) return null;
  if (expr.kind === "Identifier" && expr.token) return expr.token.value ?? expr.token.content ?? null;
  return null;
};

const linearizeBlocks = (
  blockIds: string[],
  entryBlockId: string,
  linked: LinkedCfgs,
): string[] => {
  const blockSet = new Set(blockIds);

  const edgesBySource = new Map<string, Transition[]>();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const edge of cfg.edges) {
      if (!blockSet.has(edge.sourceBlockId)) continue;
      const list = edgesBySource.get(edge.sourceBlockId);
      if (list) list.push(edge);
      else edgesBySource.set(edge.sourceBlockId, [edge]);
    }
  }

  const order: string[] = [];
  const visited = new Set<string>();
  const queue = [entryBlockId];
  let qi = 0;

  while (qi < queue.length) {
    const bid = queue[qi++];
    if (visited.has(bid) || !blockSet.has(bid)) continue;
    visited.add(bid);
    order.push(bid);

    const outEdges = edgesBySource.get(bid) ?? [];
    for (const edge of outEdges) {
      if (isChoiceOptionEdge(edge.kind)) continue;
      if (edge.targetBlockId && blockSet.has(edge.targetBlockId) && !visited.has(edge.targetBlockId)) {
        queue.push(edge.targetBlockId);
      }
    }
  }

  for (const bid of blockIds) {
    if (!visited.has(bid)) order.push(bid);
  }

  return order;
};

const collectIfChildIds = (stmt: Statement): Set<string> => {
  const ids = new Set<string>();
  const walk = (stmts: Statement[]) => {
    for (const s of stmts) {
      if (s.statementId != null) ids.add(String(s.statementId));
      if (s.kind === "If") {
        const ifS = s as IfStatement;
        walk(ifS.body);
        for (const b of ifS.elseIfBranches) walk(b.body);
        if (ifS.elseBranch) walk(ifS.elseBranch.body);
      }
    }
  };
  if (stmt.kind === "If") {
    const ifS = stmt as IfStatement;
    walk(ifS.body);
    for (const b of ifS.elseIfBranches) walk(b.body);
    if (ifS.elseBranch) walk(ifS.elseBranch.body);
  }
  return ids;
};

const collectStatements = (
  blockOrder: string[],
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): Statement[] => {
  const result: Statement[] = [];
  const childIds = new Set<string>();

  for (const blockId of blockOrder) {
    const block = blockIndex[blockId];
    if (!block) continue;
    const stmts = block.statementIds.map(id => statements[id]).filter(Boolean);
    const achSet = new Set<number>();
    for (let i = 0; i < stmts.length; i++) {
      if (stmts[i].kind === "Achievement") achSet.add(i);
    }
    for (let i = 0; i < stmts.length; i++) {
      if (achSet.has(i)) continue;
      if (stmts[i].kind === "Prose" || stmts[i].kind === "LineBreak") {
        let prevNonProse = i - 1;
        while (prevNonProse >= 0 && (stmts[prevNonProse].kind === "Prose" || stmts[prevNonProse].kind === "LineBreak")) prevNonProse--;
        if (prevNonProse >= 0 && achSet.has(prevNonProse)) continue;
      }

      const stmtId = block.statementIds[i];
      const rawId = stmtId.indexOf(":") >= 0 ? stmtId.split(":").slice(1).join(":") : stmtId;
      if (childIds.has(rawId) || childIds.has(stmtId)) continue;

      if (stmts[i].kind === "If") {
        const kids = collectIfChildIds(stmts[i]);
        for (const kid of kids) childIds.add(kid);
      }

      result.push(stmts[i]);
    }
  }
  return result;
};

const statementsToContent = (stmts: Statement[]): PageContent[] => {
  const content: PageContent[] = [];
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "Prose":
        content.push({ kind: "prose", statement: stmt as ProseStatement });
        break;
      case "LineBreak":
        content.push({ kind: "line-break" });
        break;
      case "SetVariable":
      case "DeclareVariable":
        content.push({ kind: "effect", statement: stmt });
        break;
      case "If": {
        const ifStmt = stmt as IfStatement;
        content.push({
          kind: "conditional",
          expression: ifStmt.expression,
          ifBody: statementsToContent(ifStmt.body),
          elseIfBranches: ifStmt.elseIfBranches.map(b => ({
            expression: b.expression,
            body: statementsToContent(b.body),
          })),
          elseBranch: ifStmt.elseBranch ? statementsToContent(ifStmt.elseBranch.body) : null,
        });
        break;
      }
      case "StatChart":
        content.push({ kind: "stat-chart", statement: stmt as StatChartStatement });
        break;
      case "Achievement":
      case "CheckAchievements":
      case "Achieve":
      case "SceneList":
      case "OpposedPair":
      case "Percent":
      case "Text":
      case "Author":
      case "Comment":
      case "Choice":
      case "FakeChoice":
      case "InputText":
      case "InputNumber":
      case "PageBreak":
      case "GotoLabel":
      case "GotoScene":
      case "GoSub":
      case "GoSubScene":
      case "Return":
      case "Finish":
      case "Ending":
      case "Label":
      case "Image":
      case "TextImage":
      case "Link":
      case "Parameters":
      case "ChoiceOption":
      case "SelectableIf":
      case "AllowReuse":
      case "HideReuse":
      case "DisableReuse":
      case "GameIdentifier":
        break;
      default:
        break;
    }
  }
  return content;
};

const findEntryBlockForSegment = (
  segmentId: string,
  segGraph: SegmentGraph,
): string | null => {
  const seg = segGraph.segments[segmentId];
  if (!seg || seg.entries.length === 0) return null;
  return seg.entries[0].blockId;
};

const findInputStatement = (
  blockId: string,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): (PageExit & { kind: "input" }) | null => {
  const block = blockIndex[blockId];
  if (!block) return null;
  for (const stmtId of block.statementIds) {
    const stmt = statements[stmtId];
    if (stmt?.kind === "InputText") {
      const it = stmt as InputTextStatement;
      return {
        kind: "input",
        inputKind: "text",
        variable: (it.storeInto?.value ?? "").toLowerCase(),
        targetPageId: "",
      };
    }
    if (stmt?.kind === "InputNumber") {
      const inStmt = stmt as InputNumberStatement;
      return {
        kind: "input",
        inputKind: "number",
        variable: (inStmt.storeInto?.value ?? "").toLowerCase(),
        targetPageId: "",
        min: inStmt.min,
        max: inStmt.max,
      };
    }
  }
  return null;
};

export const buildPageModel = (
  segGraph: SegmentGraph,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  linked: LinkedCfgs,
): PageModel => {
  const pages = new Map<string, Page>();
  const varMap = buildVarMap(statements);

  const statsCfgSet = new Set(linked.statsCfgIds);
  const statsBlockIds = new Set<string>();
  for (const cfgId of linked.statsCfgIds) {
    const cfg = linked.cfgs[cfgId];
    if (cfg) for (const blockId of Object.keys(cfg.blocks)) statsBlockIds.add(blockId);
  }

  const segToPage = new Map<string, string>();
  const statsSegIds = new Set<string>();
  let pageNum = 0;
  for (const [segId, seg] of Object.entries(segGraph.segments)) {
    segToPage.set(segId, `page_${pageNum++}`);
    if (seg.blockIds.some(bid => statsBlockIds.has(bid))) {
      statsSegIds.add(segId);
    }
  }

  for (const [segId, segment] of Object.entries(segGraph.segments)) {
    const entryBlock = findEntryBlockForSegment(segId, segGraph);
    if (!entryBlock) continue;

    const blockOrder = linearizeBlocks(segment.blockIds, entryBlock, linked);
    const allStmts = collectStatements(blockOrder, blockIndex, statements);

    const sections: PageSection[] = [];
    let current: Statement[] = [];

    for (const stmt of allStmts) {
      if (stmt.kind === "PageBreak") {
        const pb = stmt as PageBreakStatement;
        const buttonText = pb.buttonText?.content?.trim() || "Next";
        sections.push({ content: statementsToContent(current), buttonText });
        current = [];
      } else {
        current.push(stmt);
      }
    }

    const lastContent = statementsToContent(current);

    let exit: PageExit;
    const inputExit = segment.exits.find(e => e.kind === "input");
    if (segment.exits.some(e => e.kind === "choice")) {
      exit = { kind: "choice", options: [] };
    } else if (inputExit) {
      const inputStmt = findInputStatement(inputExit.blockId, blockIndex, statements);
      if (inputStmt) {
        exit = inputStmt;
      } else {
        exit = { kind: "terminal" };
      }
    } else {
      exit = { kind: "terminal" };
    }

    if (sections.length > 0) {
      sections.push({ content: lastContent, buttonText: "" });
    } else {
      sections.push({ content: lastContent, buttonText: "" });
    }

    const pageId = segToPage.get(segId)!;
    pages.set(pageId, {
      id: pageId,
      segmentId: segId,
      sections,
      exit,
    });
  }

  // Second pass: resolve choice options
  for (const edge of segGraph.edges) {
    const sourceSegment = segGraph.segments[edge.sourceSegmentId];
    if (!sourceSegment) continue;

    const sourcePageId = segToPage.get(edge.sourceSegmentId);
    if (!sourcePageId) continue;
    const sourcePage = pages.get(sourcePageId);
    if (!sourcePage || sourcePage.exit.kind !== "choice") continue;

    const targetPageId = segToPage.get(edge.targetSegmentId);
    if (!targetPageId || !pages.has(targetPageId)) continue;

    const optionStmtId = edge.metadata?.optionStatementId;
    let optionStmt: ChoiceOptionStatement | null = null;
    let label = "???";
    let selectableIf: Expression | null = null;
    let reuse: string | null = null;

    if (optionStmtId) {
      const stmt = statements[optionStmtId];
      if (stmt?.kind === "ChoiceOption") {
        optionStmt = stmt as ChoiceOptionStatement;
        label = optionStmt.token.rawText ?? "???";
        selectableIf = optionStmt.selectableIf;
        reuse = optionStmt.reuse;
      }
    }

    sourcePage.exit.options.push({
      label,
      optionStatement: optionStmt,
      targetPageId,
      selectableIf,
      reuse,
    });
  }

  // Resolve input exit targets
  for (const edge of segGraph.edges) {
    const sourceSegment = segGraph.segments[edge.sourceSegmentId];
    if (!sourceSegment) continue;
    if (!sourceSegment.exits.some(e => e.kind === "input")) continue;

    const sourcePageId = segToPage.get(edge.sourceSegmentId);
    if (!sourcePageId) continue;
    const sourcePage = pages.get(sourcePageId);
    if (!sourcePage || sourcePage.exit.kind !== "input") continue;

    const targetPageId = segToPage.get(edge.targetSegmentId);
    if (targetPageId) {
      sourcePage.exit.targetPageId = targetPageId;
    }
  }

  const entryPageId = segToPage.get(segGraph.entrySegmentId) ?? "page_0";

  const statsPageIds = new Set<string>();
  for (const segId of statsSegIds) {
    const pageId = segToPage.get(segId);
    if (pageId) statsPageIds.add(pageId);
  }

  let statsEntryPageId: string | null = null;
  if (statsPageIds.size > 0) {
    const firstStatsPage = Array.from(statsPageIds)[0];
    statsEntryPageId = firstStatsPage;
  }

  return { pages, entryPageId, varMap, statsPageIds, statsEntryPageId };
};
