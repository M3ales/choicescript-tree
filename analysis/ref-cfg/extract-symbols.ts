import { LinkedCfgs, Cfg } from "./data";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { extractEffect } from "../dataflow/extract-definitions";
import { topologicalBlockOrder } from "../control-flow-graph/graph-utils";
import { collectRefsFromStatement } from "./collect-refs";

export type SymbolSiteKind = "def" | "ref" | "delete";

export interface SymbolSite {
  variable: string;
  kind: SymbolSiteKind;
  scope: "Global" | "Temporary";
  statementId: string;
  statementKind: string;
  cfgId: string;
  scene: string;
  cfgOrder: number;
}

export interface SymbolTable {
  sites: SymbolSite[];
  variables: Map<string, VariableSummary>;
}

export interface VariableSummary {
  variable: string;
  scope: "Global" | "Temporary";
  isParam?: boolean;
  firstDef: SymbolSite | null;
  firstRef: SymbolSite | null;
  deleted: boolean;
  defCount: number;
  refCount: number;
}

export const extractSymbols = (
  linked: LinkedCfgs,
  cfgOrder: string[],
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): SymbolTable => {
  const sites: SymbolSite[] = [];

  for (let cfgIdx = 0; cfgIdx < cfgOrder.length; cfgIdx++) {
    const cfgId = cfgOrder[cfgIdx];
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;

    const blockOrder = topologicalBlockOrder(cfg.blocks, cfg.edges);
    for (const blockId of blockOrder) {
      const block = blockIndex[blockId];
      if (!block) continue;

      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (!stmt) continue;
        collectStatementSites(stmt, stmtId, cfgId, cfg.scene, cfgIdx, sites);
      }
    }
  }

  const variables = buildSummaries(sites);
  return { sites, variables };
};

const collectStatementSites = (
  stmt: Statement,
  stmtId: string,
  cfgId: string,
  scene: string,
  cfgOrder: number,
  sites: SymbolSite[],
): void => {
  const base = { statementId: stmtId, statementKind: stmt.kind, cfgId, scene, cfgOrder };

  if (stmt.kind === "DeleteVariable" || stmt.kind === "DeleteArray") {
    const name = (stmt as any).variable?.value;
    if (name) {
      sites.push({ ...base, variable: name, kind: "delete", scope: "Global" });
    }
    return;
  }

  const effect = extractEffect(stmt);
  if (effect.defines) {
    sites.push({
      ...base,
      variable: effect.defines.variable,
      kind: "def",
      scope: effect.defines.scope,
    });
  }

  if (stmt.kind === "DeclareArray") {
    const arr = stmt as any;
    if (arr.declarations) {
      for (const decl of arr.declarations) {
        const sub = extractEffect(decl);
        if (sub.defines) {
          sites.push({
            ...base,
            variable: sub.defines.variable,
            kind: "def",
            scope: sub.defines.scope,
          });
        }
      }
    }
  }

  if (stmt.kind === "Parameters") {
    const params = stmt as any;
    for (const id of params.identifiers) {
      sites.push({ ...base, variable: id.value, kind: "def", scope: "Temporary" });
    }
  }

  const refs = collectRefsFromStatement(stmt);
  const defVar = effect.defines?.variable;
  for (const ref of refs) {
    if (ref === defVar) continue;
    sites.push({ ...base, variable: ref, kind: "ref", scope: "Global" });
  }
};

const buildSummaries = (sites: SymbolSite[]): Map<string, VariableSummary> => {
  const map = new Map<string, VariableSummary>();
  for (const site of sites) {
    let summary = map.get(site.variable);
    if (!summary) {
      summary = {
        variable: site.variable,
        scope: site.scope,
        firstDef: null,
        firstRef: null,
        deleted: false,
        defCount: 0,
        refCount: 0,
      };
      map.set(site.variable, summary);
    }

    switch (site.kind) {
      case "def":
        summary.defCount++;
        if (summary.scope === "Global" && site.scope === "Global") summary.scope = site.scope;
        if (site.statementKind === "Parameters") summary.isParam = true;
        if (!summary.firstDef) summary.firstDef = site;
        break;
      case "ref":
        summary.refCount++;
        if (!summary.firstRef) summary.firstRef = site;
        break;
      case "delete":
        summary.deleted = true;
        break;
    }
  }
  return map;
};

export interface SerializedSymbolSite {
  variable: string;
  kind: SymbolSiteKind;
  scope: string;
  statementId: string;
  statementKind: string;
  cfgId: string;
  scene: string;
  cfgOrder: number;
}

export interface SerializedVariableSummary {
  variable: string;
  scope: string;
  isParam?: boolean;
  firstDefCfg: string | null;
  firstDefStatement: string | null;
  firstRefCfg: string | null;
  firstRefStatement: string | null;
  deleted: boolean;
  defCount: number;
  refCount: number;
}

export const serializeSymbolTable = (table: SymbolTable): Array<{ type: string } & Record<string, any>> => {
  const records: Array<{ type: string } & Record<string, any>> = [];

  for (const [, summary] of table.variables) {
    records.push({
      type: "variable",
      variable: summary.variable,
      scope: summary.scope,
      ...(summary.isParam ? { isParam: true } : {}),
      firstDefCfg: summary.firstDef?.cfgId ?? null,
      firstDefStatement: summary.firstDef?.statementId ?? null,
      firstRefCfg: summary.firstRef?.cfgId ?? null,
      firstRefStatement: summary.firstRef?.statementId ?? null,
      deleted: summary.deleted,
      defCount: summary.defCount,
      refCount: summary.refCount,
    });
  }

  for (const site of table.sites) {
    records.push({ type: "site", ...site });
  }

  return records;
};
