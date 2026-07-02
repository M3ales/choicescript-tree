import { SegmentGraph } from "../../analysis/segments/data";
import { LinkedCfgs } from "../../analysis/ref-cfg/data";
import { CodeBlock } from "../../analysis/control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { SegmentDataflowResult } from "../../analysis/segments/segment-dataflow";
import { SerializedVariableState } from "../../analysis/dataflow/variable-state";
import { Page, buildPageModel } from "./page-model";
import { generatePageHtml, generateIndexHtml } from "./generate-html";

export interface StaticOutputOptions {
  segmentDataflow?: SegmentDataflowResult;
}

const buildSeedDfState = (statements: Record<string, Statement>): SerializedVariableState => {
  const globals: Record<string, import("../../analysis/dataflow/abstract-value").AbstractValue> = {};
  for (const stmt of Object.values(statements)) {
    if (stmt.kind !== "DeclareVariable") continue;
    const s = stmt as any;
    const name = s.variable?.value?.toLowerCase();
    if (!name) continue;
    const expr = s.expression;
    if (expr?.kind === "Literal" && expr.value?.value != null) {
      globals[name] = { kind: "constant", value: expr.value.value };
    } else {
      globals[name] = { kind: "constant", value: false };
    }
  }
  return { globals, temps: {} };
};

export interface StaticOutputResult {
  files: Map<string, string>;
  entryPageId: string;
  pageCount: number;
}

const generateStatsRedirect = (statsEntryPageId: string): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Stats</title>
<script>
var p=new URLSearchParams(location.search);
var r=p.get("r")||"";
var s=p.get("s")||"";
var d=p.get("dbg")||"";
var q=[];
if(s)q.push("s="+s);
if(r)q.push("r="+r);
if(d)q.push("dbg="+d);
location.replace("${statsEntryPageId}.html"+(q.length?"?"+q.join("&"):""));
</script>
</head>
<body></body>
</html>`;
};

export const renderStaticOutput = (
  segGraph: SegmentGraph,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  linked: LinkedCfgs,
  opts: StaticOutputOptions = {},
): StaticOutputResult => {
  const model = buildPageModel(segGraph, blockIndex, statements, linked);
  const files = new Map<string, string>();

  const segmentStates = opts.segmentDataflow?.segmentStates;
  const cfgEntryStates = opts.segmentDataflow?.cfgEntryStates;

  const seedState: SerializedVariableState | undefined = opts.segmentDataflow
    ? buildSeedDfState(statements)
    : undefined;

  const lookupDfState = (page: Page): SerializedVariableState | undefined => {
    const fromSeg = segmentStates?.get(page.segmentId)?.entry;
    if (fromSeg) return fromSeg;
    const seg = segGraph.segments[page.segmentId];
    if (seg && cfgEntryStates) {
      const fromCfg = cfgEntryStates.get(seg.cfgId);
      if (fromCfg) return fromCfg;
    }
    return seedState;
  };

  for (const [pageId, page] of model.pages) {
    const isStats = model.statsPageIds.has(pageId);
    const dfState = lookupDfState(page);
    const html = generatePageHtml(page, segGraph, model.varMap, isStats, dfState);
    files.set(`${pageId}.html`, html);
  }

  files.set("index.html", generateIndexHtml(model.entryPageId));

  if (model.statsEntryPageId) {
    files.set("stats.html", generateStatsRedirect(model.statsEntryPageId));
  }

  return {
    files,
    entryPageId: model.entryPageId,
    pageCount: model.pages.size,
  };
};
