export type Presence = "must" | "may";

export type VariableScope = "Global" | "Temporary";

// --- Spaghetti tree node (block-level, intra-CFG) ---

export interface ScopeEntry {
  variable: string;
  scope: VariableScope;
  statementId: string;
}

export interface ScopeNode {
  blockId: string;
  parent: ScopeNode | null;
  defs: ScopeEntry[];
  deletes: Set<string>;
  merged: boolean;
}

export const lookupScope = (node: ScopeNode | null, variable: string): ScopeEntry | null => {
  let current = node;
  while (current) {
    if (current.deletes.has(variable)) return null;
    for (let i = current.defs.length - 1; i >= 0; i--) {
      if (current.defs[i].variable === variable) return current.defs[i];
    }
    current = current.parent;
  }
  return null;
};

export const lookupPresence = (node: ScopeNode | null, variable: string): Presence | null => {
  let current = node;
  let sawMerge = false;
  while (current) {
    if (current.deletes.has(variable)) return null;
    for (let i = current.defs.length - 1; i >= 0; i--) {
      if (current.defs[i].variable === variable) {
        return sawMerge ? "may" : "must";
      }
    }
    if (current.merged) sawMerge = true;
    current = current.parent;
  }
  return null;
};

// --- Flat summary types (derived from spaghetti tree) ---

export interface ScopeDef {
  variable: string;
  scope: VariableScope;
  presence: Presence;
  statementId: string;
  blockId: string;
}

export interface ScopeRef {
  variable: string;
  statementId: string;
  statementKind: string;
  blockId: string;
  external: boolean;
}

export interface ScopeDelete {
  variable: string;
  statementId: string;
  blockId: string;
}

export interface CfgExport {
  variable: string;
  scope: VariableScope;
  presence: Presence;
}

export interface CfgScope {
  cfgId: string;
  scene: string;
  tree: Map<string, ScopeNode>;
  entryNode: ScopeNode | null;
  exitNodes: ScopeNode[];
  defs: ScopeDef[];
  refs: ScopeRef[];
  deletes: ScopeDelete[];
  exports: Map<string, CfgExport>;
  externalRefs: string[];
}

// --- Scene scope (built at ICfg link time) ---

export interface SceneScope {
  scene: string;
  cfgScopes: Map<string, CfgScope>;
  tempDefs: Map<string, VariableScope>;
  globalDefs: Map<string, Presence>;
}

// --- Game scope (built at ICfg link time) ---

export interface GameScope {
  scenes: Map<string, SceneScope>;
  globals: Map<string, GlobalEntry>;
}

export interface GlobalEntry {
  firstDefScene: string;
  firstDefCfgId: string;
  presence: Presence;
}
