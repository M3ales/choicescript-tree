import { Cfg } from "./data";
import { CfgTransfer } from "./cfg-transfer";
import { CfgScope, CfgExport, ScopeDef, ScopeRef, ScopeDelete } from "./scope-types";
import { CfgSymbols } from "./passes/symbol-table-pass";
import { CasingIssue } from "./passes/casing-pass";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { getIO } from "../../out-dir";

export interface CfgVisitorResults {
  transfer: CfgTransfer;
  scope: CfgScope;
  variables: CfgSymbols;
  casing: CasingIssue[];
}

interface SerializedScope {
  cfgId: string;
  scene: string;
  defs: ScopeDef[];
  refs: ScopeRef[];
  deletes: ScopeDelete[];
  exports: [string, CfgExport][];
  externalRefs: string[];
}

interface CfgCacheEntry {
  hash: string;
  transfer: CfgTransfer;
  scope: SerializedScope;
  variables?: CfgSymbols;
  casing?: CasingIssue[];
}

interface CfgCacheFile {
  [cfgId: string]: CfgCacheEntry;
}

const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

export const hashCfg = (
  cfg: Cfg,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): string => {
  const parts: string[] = [];
  const blockIds = Object.keys(cfg.blocks).sort();
  for (const blockId of blockIds) {
    const block = blockIndex[blockId];
    if (!block) continue;
    parts.push(blockId);
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (stmt) parts.push(JSON.stringify(stmt));
    }
  }
  for (const edge of cfg.edges) {
    parts.push(`${edge.sourceBlockId}->${edge.targetBlockId}:${edge.kind}`);
  }
  for (const exit of cfg.exits) {
    parts.push(`exit:${exit.blockId}:${exit.kind}`);
  }
  return fnv1a(parts.join("|"));
};

const serializeScope = (scope: CfgScope): SerializedScope => ({
  cfgId: scope.cfgId,
  scene: scope.scene,
  defs: scope.defs,
  refs: scope.refs,
  deletes: scope.deletes,
  exports: [...scope.exports],
  externalRefs: scope.externalRefs,
});

const deserializeScope = (s: SerializedScope): CfgScope => ({
  cfgId: s.cfgId,
  scene: s.scene,
  tree: new Map(),
  entryNode: null,
  exitNodes: [],
  defs: s.defs,
  refs: s.refs,
  deletes: s.deletes,
  exports: new Map(s.exports),
  externalRefs: s.externalRefs,
});

export class CfgResultCache {
  private cache: CfgCacheFile = {};
  private hits = 0;
  private misses = 0;

  constructor(private readonly cachePath: string) {
    try {
      this.cache = JSON.parse(getIO().readFile(cachePath));
    } catch {
      this.cache = {};
    }
  }

  lookup(cfgId: string, hash: string): CfgVisitorResults | null {
    const entry = this.cache[cfgId];
    if (entry && entry.hash === hash) {
      this.hits++;
      return {
        transfer: entry.transfer,
        scope: deserializeScope(entry.scope),
        variables: entry.variables ?? { cfgId, scene: "", declarations: [], sets: [], refs: [], labelRefs: [] },
        casing: entry.casing ?? [],
      };
    }
    this.misses++;
    return null;
  }

  store(cfgId: string, hash: string, results: CfgVisitorResults): void {
    this.cache[cfgId] = {
      hash,
      transfer: results.transfer,
      scope: serializeScope(results.scope),
      variables: results.variables,
      casing: results.casing,
    };
  }

  pruneScene(sceneName: string): void {
    const prefix = `${sceneName}:`;
    for (const key of Object.keys(this.cache)) {
      if (key.startsWith(prefix)) delete this.cache[key];
    }
  }

  save(): void {
    getIO().writeFile(this.cachePath, JSON.stringify(this.cache));
  }

  stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }
}
