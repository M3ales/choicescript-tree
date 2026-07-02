import { LinkedCfgs, Cfg, CfgExit } from "./data";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { extractEffect } from "../dataflow/extract-definitions";
import { getOrSet, topologicalBlockOrder } from "../control-flow-graph/graph-utils";
import { Graph, Edge, buildCfgGraph } from "./cfg-graph";
import { collectRefsFromStatement } from "./collect-refs";

export type ScopePresence = "must" | "may";

export interface VariableInScope {
  scope: "Global" | "Temporary";
  presence: ScopePresence;
}

export interface CfgScopeEntry {
  cfgId: string;
  scene: string;
  entry: Map<string, VariableInScope>;
  exit: Map<string, VariableInScope>;
  localDefs: string[];
  localDeletes: string[];
  localRefs: string[];
  undefinedRefs: UndefinedRef[];
}

export interface UndefinedRef {
  variable: string;
  cfgId: string;
  scene: string;
  statementId: string;
  statementKind: string;
}

export interface ScopeAnalysis {
  scopes: Map<string, CfgScopeEntry>;
  allUndefinedRefs: UndefinedRef[];
}

export const buildScopeTable = (
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  graph?: Graph,
): ScopeAnalysis => {
  const { predecessors, successors, order, edges } = graph ?? buildCfgGraph(linked);

  const localInfoMap = new Map<string, LocalInfo>();
  for (const cfg of Object.values(linked.cfgs)) {
    localInfoMap.set(cfg.id, extractLocalInfo(cfg, blockIndex, statements));
  }

  const entryScopes = new Map<string, Map<string, VariableInScope>>();
  const exitScopes = new Map<string, Map<string, VariableInScope>>();
  entryScopes.set(linked.entryCfgId, new Map());

  const worklist = new Set<string>(order);
  const maxIterations = order.length * 3;
  let iterations = 0;

  while (worklist.size > 0 && iterations < maxIterations) {
    iterations++;
    const cfgId = pickNext(worklist, order);
    worklist.delete(cfgId);

    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;

    const entry = computeEntryScope(cfgId, cfg, predecessors, exitScopes, linked);
    const prevEntry = entryScopes.get(cfgId);
    const isFirstVisit = !exitScopes.has(cfgId);
    if (!isFirstVisit && prevEntry && scopesEqual(prevEntry, entry)) continue;
    entryScopes.set(cfgId, entry);

    const local = localInfoMap.get(cfgId)!;
    const exit = computeExitScope(entry, local);

    const prevExit = exitScopes.get(cfgId);
    exitScopes.set(cfgId, exit);

    if (!prevExit || !scopesEqual(prevExit, exit)) {
      for (const succ of successors.get(cfgId) ?? []) {
        worklist.add(succ);
      }
    }
  }

  const scopes = new Map<string, CfgScopeEntry>();
  const allUndefinedRefs: UndefinedRef[] = [];

  for (const cfgId of order) {
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    const entry = entryScopes.get(cfgId) ?? new Map();
    const exit = exitScopes.get(cfgId) ?? new Map();
    const local = localInfoMap.get(cfgId)!;

    const undefinedRefs: UndefinedRef[] = [];
    for (const [varName, sites] of local.refs) {
      if (entry.has(varName)) continue;
      if (local.defsBeforeRef.has(varName)) continue;
      if (isBuiltin(varName)) continue;
      for (const site of sites) {
        undefinedRefs.push({
          variable: varName,
          cfgId,
          scene: cfg.scene,
          statementId: site.statementId,
          statementKind: site.statementKind,
        });
      }
    }
    allUndefinedRefs.push(...undefinedRefs);

    scopes.set(cfgId, {
      cfgId,
      scene: cfg.scene,
      entry,
      exit,
      localDefs: [...local.defs.keys()],
      localDeletes: [...local.deletes],
      localRefs: [...local.refs.keys()],
      undefinedRefs,
    });
  }

  return { scopes, allUndefinedRefs };
};

const computeEntryScope = (
  cfgId: string,
  cfg: Cfg,
  predecessors: Map<string, Edge[]>,
  exitScopes: Map<string, Map<string, VariableInScope>>,
  linked: LinkedCfgs,
): Map<string, VariableInScope> => {
  const preds = predecessors.get(cfgId);
  if (!preds || preds.length === 0) return new Map();

  const predScopes: Map<string, VariableInScope>[] = [];
  for (const edge of preds) {
    const predExit = exitScopes.get(edge.from);
    if (!predExit) continue;

    const predScene = linked.cfgs[edge.from]?.scene;
    const crossScene = predScene && predScene !== cfg.scene;

    predScopes.push(crossScene ? cloneScopeMap(predExit) : predExit);
  }

  if (predScopes.length === 0) return new Map();
  if (predScopes.length === 1) return cloneScopeMap(predScopes[0]);
  return joinScopeMaps(predScopes);
};

interface LocalInfo {
  defs: Map<string, { scope: "Global" | "Temporary" }>;
  defsBeforeRef: Set<string>;
  deletes: Set<string>;
  refs: Map<string, { statementId: string; statementKind: string }[]>;
}

const extractLocalInfo = (
  cfg: Cfg,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): LocalInfo => {
  const defs = new Map<string, { scope: "Global" | "Temporary" }>();
  const defsBeforeRef = new Set<string>();
  const deletes = new Set<string>();
  const refs = new Map<string, { statementId: string; statementKind: string }[]>();

  const blockOrder = topologicalBlockOrder(cfg.blocks, cfg.edges);
  for (const blockId of blockOrder) {
    const block = blockIndex[blockId];
    if (!block) continue;

    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;

      if (stmt.kind === "DeleteVariable" || stmt.kind === "DeleteArray") {
        const name = (stmt as any).variable?.value;
        if (name) deletes.add(name);
        continue;
      }

      const stmtRefs = collectRefsFromStatement(stmt);
      for (const v of stmtRefs) {
        getOrSet(refs, v, () => []).push({ statementId: stmtId, statementKind: stmt.kind });
      }

      const effect = extractEffect(stmt);
      if (effect.defines) {
        const name = effect.defines.variable;
        if (!defs.has(name)) {
          defs.set(name, { scope: effect.defines.scope });
          if (!refs.has(name)) defsBeforeRef.add(name);
        }
      }

      if (stmt.kind === "DeclareArray") {
        const arr = stmt as any;
        if (arr.declarations) {
          for (const decl of arr.declarations) {
            const sub = extractEffect(decl);
            if (sub.defines) {
              const name = sub.defines.variable;
              if (!defs.has(name)) {
                defs.set(name, { scope: sub.defines.scope });
                if (!refs.has(name)) defsBeforeRef.add(name);
              }
            }
          }
        }
      }

      if (stmt.kind === "Parameters") {
        const params = stmt as any;
        for (const id of params.identifiers) {
          const name = id.value;
          if (!defs.has(name)) {
            defs.set(name, { scope: "Temporary" });
            if (!refs.has(name)) defsBeforeRef.add(name);
          }
        }
      }
    }
  }

  return { defs, defsBeforeRef, deletes, refs };
};

const computeExitScope = (
  entry: Map<string, VariableInScope>,
  local: LocalInfo,
): Map<string, VariableInScope> => {
  const exit = cloneScopeMap(entry);

  for (const [varName, def] of local.defs) {
    exit.set(varName, { scope: def.scope, presence: "must" });
  }

  for (const varName of local.deletes) {
    exit.delete(varName);
  }

  return exit;
};

const joinScopeMaps = (maps: Map<string, VariableInScope>[]): Map<string, VariableInScope> => {
  const allVars = new Set<string>();
  for (const m of maps) for (const k of m.keys()) allVars.add(k);

  const result = new Map<string, VariableInScope>();
  for (const varName of allVars) {
    let scope: "Global" | "Temporary" = "Temporary";
    let allHave = true;
    for (const m of maps) {
      const v = m.get(varName);
      if (!v) { allHave = false; continue; }
      if (v.scope === "Global") scope = "Global";
    }
    result.set(varName, { scope, presence: allHave ? "must" : "may" });
  }
  return result;
};

const cloneScopeMap = (m: Map<string, VariableInScope>): Map<string, VariableInScope> => {
  const result = new Map<string, VariableInScope>();
  for (const [k, v] of m) result.set(k, { ...v });
  return result;
};

const scopesEqual = (a: Map<string, VariableInScope>, b: Map<string, VariableInScope>): boolean => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const bv = b.get(k);
    if (!bv || bv.scope !== v.scope || bv.presence !== v.presence) return false;
  }
  return true;
};

const pickNext = (worklist: Set<string>, order: string[]): string => {
  for (const id of order) {
    if (worklist.has(id)) return id;
  }
  return worklist.values().next().value!;
};

const BUILTINS = new Set([
  "choice_randomtest", "choice_quicktest", "choice_randomscene",
  "choice_nightmode", "choice_saved_is_allowed", "choice_save_name",
  "choice_time_stamp", "choice_restore_purchases_allowed",
  "choice_purchased_adfree", "choice_is_trial", "choice_is_advertising_supported",
  "choice_is_web", "choice_is_steam", "choice_is_ios", "choice_is_android",
  "choice_is_omnibus", "choice_release_date", "choice_prerelease",
  "choice_subscribe_allowed", "choice_subscribed",
  "true", "false",
]);

const isBuiltin = (name: string): boolean =>
  BUILTINS.has(name) || name.startsWith("choice_");

export interface SerializedCfgScope {
  cfgId: string;
  scene: string;
  entryCount: number;
  exitCount: number;
  mustCount: number;
  mayCount: number;
  localDefs: string[];
  localDeletes: string[];
  localRefs: string[];
  undefinedRefs: string[];
}

export const serializeScopeTable = (analysis: ScopeAnalysis): Array<{ type: string } & Record<string, any>> => {
  const records: Array<{ type: string } & Record<string, any>> = [];

  for (const [, scope] of analysis.scopes) {
    let must = 0, may = 0;
    for (const v of scope.entry.values()) {
      if (v.presence === "must") must++;
      else may++;
    }

    records.push({
      type: "cfgScope",
      cfgId: scope.cfgId,
      scene: scope.scene,
      entryCount: scope.entry.size,
      exitCount: scope.exit.size,
      mustCount: must,
      mayCount: may,
      localDefs: scope.localDefs,
      localDeletes: scope.localDeletes,
      localRefs: scope.localRefs,
      undefinedRefs: scope.undefinedRefs.map(r => r.variable),
    });
  }

  for (const ref of analysis.allUndefinedRefs) {
    records.push({ type: "undefinedRef", ...ref });
  }

  return records;
};
