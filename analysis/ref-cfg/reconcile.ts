import { SceneAst } from "../../parser/scene";
import { buildControlFlow, SceneControlFlowGraph } from "../control-flow-graph/build-scene";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { Cfg } from "./data";
import { CfgTransfer } from "./cfg-transfer";
import { CfgScope } from "./scope-types";
import { CfgSymbols } from "./passes/symbol-table-pass";
import { CasingIssue } from "./passes/casing-pass";
import { extractCfgs } from "./extract-cfgs";
import { SceneCfgCache } from "./scene-cache";
import { CfgResultCache } from "./cfg-cache";
import { NdjsonWriter } from "../ndjson";

const nullWriter: Pick<NdjsonWriter, "write" | "flush"> = {
  write() {},
  flush() {},
};

const emptyDelta = (): DeltaResolution => ({
  scenes: new Set(),
  cfgIds: new Set(),
  blockIds: new Set(),
  statementIds: new Set(),
});

export interface DeltaLine {
  scene: string;
  line: number;
}

export interface DeltaResolution {
  scenes: Set<string>;
  cfgIds: Set<string>;
  blockIds: Set<string>;
  statementIds: Set<string>;
}

export interface ReconcilePlan {
  cfgs: Record<string, Cfg>;
  transfers: Map<string, CfgTransfer>;
  scopes: Map<string, CfgScope>;
  variables: CfgSymbols[];
  casing: CasingIssue[];
  statements: Record<string, Statement>;
  blockIndex: Record<string, CodeBlock>;
  sceneCfgs: Map<string, SceneControlFlowGraph>;
  dirty: DeltaResolution;
}

export interface ReconcileStats {
  scenes: { total: number; cached: number; built: number };
  cfgs: { total: number; cached: number; computed: number };
}

export interface ReconcilerOptions {
  sceneCache?: SceneCfgCache;
  cfgCache?: CfgResultCache;
  blockWriter?: NdjsonWriter;
}

export class CfgReconciler {
  private sceneCache: SceneCfgCache | null;
  private cfgCache: CfgResultCache | null;
  private blockWriter: NdjsonWriter | null;
  private lastPlan: ReconcilePlan | null = null;

  private blockToCfg = new Map<string, string>();
  private stmtToBlock = new Map<string, string>();

  constructor(opts: ReconcilerOptions = {}) {
    this.sceneCache = opts.sceneCache ?? null;
    this.cfgCache = opts.cfgCache ?? null;
    this.blockWriter = opts.blockWriter ?? null;
  }

  reconcile(scenes: SceneAst[]): ReconcilePlan {
    const dirtyScenes = new Set<string>();
    const sceneCfgs = new Map<string, SceneControlFlowGraph>();

    for (const scene of scenes) {
      const cached = this.sceneCache?.lookup(scene.name, scene.statements);
      if (cached) {
        sceneCfgs.set(scene.name, cached);
        continue;
      }
      dirtyScenes.add(scene.name);
      const cfg = buildControlFlow(scene, this.blockWriter ?? nullWriter as NdjsonWriter);
      sceneCfgs.set(scene.name, cfg);
      this.sceneCache?.store(scene.name, scene.statements, cfg);
      this.cfgCache?.pruneScene(scene.name);
    }

    const statements = buildStatementIndex(scenes);
    const blockIndex = buildBlockIndex(sceneCfgs);

    const cfgs: Record<string, Cfg> = {};
    const transfers = new Map<string, CfgTransfer>();
    const scopes = new Map<string, CfgScope>();
    const allVariables: CfgSymbols[] = [];
    const allCasing: CasingIssue[] = [];

    for (const scene of scenes) {
      const sceneCfg = sceneCfgs.get(scene.name);
      if (!sceneCfg) continue;

      const extracted = extractCfgs(scene.name, sceneCfg, statements, this.cfgCache ?? undefined);
      for (const { cfg, transfer, scope, variables, casing } of extracted) {
        cfgs[cfg.id] = cfg;
        transfers.set(cfg.id, transfer);
        scopes.set(cfg.id, scope);
        allVariables.push(variables);
        allCasing.push(...casing);
      }
    }

    this.rebuildIndexes(cfgs, blockIndex);
    const dirty = this.resolveFromScenes(dirtyScenes, cfgs, blockIndex);

    const plan: ReconcilePlan = { cfgs, transfers, scopes, variables: allVariables, casing: allCasing, statements, blockIndex, sceneCfgs, dirty };
    this.lastPlan = plan;
    return plan;
  }

  resolveLines(lines: DeltaLine[]): DeltaResolution {
    if (!this.lastPlan) return emptyDelta();

    const lineKeys = new Set(lines.map(d => `${d.scene}:${d.line}`));
    const statementIds = new Set<string>();
    for (const [stmtId, stmt] of Object.entries(this.lastPlan.statements)) {
      const token = (stmt as any).token;
      if (token && lineKeys.has(`${token.sceneName}:${token.lineNumber}`)) {
        statementIds.add(stmtId);
      }
    }

    return this.resolveFromStatements(statementIds);
  }

  resolveStatementIds(stmtIds: Iterable<string>): DeltaResolution {
    return this.resolveFromStatements(new Set(stmtIds));
  }

  resolveBlockIds(blockIds: Iterable<string>): DeltaResolution {
    const scenes = new Set<string>();
    const set = new Set(blockIds);
    const cfgIds = new Set<string>();
    for (const blockId of set) {
      const cfgId = this.blockToCfg.get(blockId);
      if (cfgId) {
        cfgIds.add(cfgId);
        const cfg = this.lastPlan?.cfgs[cfgId];
        if (cfg) scenes.add(cfg.scene);
      }
    }
    return { scenes, cfgIds, blockIds: set, statementIds: new Set() };
  }

  stats(): ReconcileStats {
    const scene = this.sceneCache?.stats() ?? { hits: 0, misses: 0 };
    const cfg = this.cfgCache?.stats() ?? { hits: 0, misses: 0 };
    return {
      scenes: { total: scene.hits + scene.misses, cached: scene.hits, built: scene.misses },
      cfgs: { total: cfg.hits + cfg.misses, cached: cfg.hits, computed: cfg.misses },
    };
  }

  private rebuildIndexes(
    cfgs: Record<string, Cfg>,
    blockIndex: Record<string, CodeBlock>,
  ): void {
    this.blockToCfg.clear();
    this.stmtToBlock.clear();

    for (const cfg of Object.values(cfgs)) {
      for (const blockId of Object.keys(cfg.blocks)) {
        this.blockToCfg.set(blockId, cfg.id);
      }
    }

    for (const [blockId, block] of Object.entries(blockIndex)) {
      for (const sid of block.statementIds) {
        this.stmtToBlock.set(sid, blockId);
      }
    }
  }

  private resolveFromScenes(
    dirtyScenes: Set<string>,
    cfgs: Record<string, Cfg>,
    blockIndex: Record<string, CodeBlock>,
  ): DeltaResolution {
    const scenes = new Set(dirtyScenes);
    const cfgIds = new Set<string>();
    const blockIds = new Set<string>();
    const statementIds = new Set<string>();

    for (const cfg of Object.values(cfgs)) {
      if (!dirtyScenes.has(cfg.scene)) continue;
      cfgIds.add(cfg.id);
      for (const blockId of Object.keys(cfg.blocks)) {
        blockIds.add(blockId);
        const block = blockIndex[blockId];
        if (block) {
          for (const sid of block.statementIds) statementIds.add(sid);
        }
      }
    }

    return { scenes, cfgIds, blockIds, statementIds };
  }

  private resolveFromStatements(statementIds: Set<string>): DeltaResolution {
    const scenes = new Set<string>();
    const blockIds = new Set<string>();
    const cfgIds = new Set<string>();

    for (const sid of statementIds) {
      const blockId = this.stmtToBlock.get(sid);
      if (!blockId) continue;
      blockIds.add(blockId);

      const cfgId = this.blockToCfg.get(blockId);
      if (cfgId) {
        cfgIds.add(cfgId);
        const cfg = this.lastPlan?.cfgs[cfgId];
        if (cfg) scenes.add(cfg.scene);
      }
    }

    return { scenes, cfgIds, blockIds, statementIds };
  }
}

const buildStatementIndex = (scenes: SceneAst[]): Record<string, Statement> => {
  const index: Record<string, Statement> = {};
  for (const scene of scenes) {
    const walk = (stmts: Statement[]) => {
      for (const stmt of stmts) {
        index[`${scene.name}:${stmt.statementId}`] = stmt;
        if ("body" in stmt && Array.isArray((stmt as any).body)) {
          walk((stmt as any).body);
        }
        if ("options" in stmt && Array.isArray((stmt as any).options)) {
          for (const opt of (stmt as any).options) {
            if (opt.body) walk(opt.body);
          }
        }
        if ("elseIfBranches" in stmt && Array.isArray((stmt as any).elseIfBranches)) {
          for (const branch of (stmt as any).elseIfBranches) {
            index[`${scene.name}:${branch.statementId}`] = branch;
            if (branch.body) walk(branch.body);
          }
        }
        if ("elseBranch" in stmt && (stmt as any).elseBranch) {
          const branch = (stmt as any).elseBranch;
          index[`${scene.name}:${branch.statementId}`] = branch;
          if (branch.body) walk(branch.body);
        }
      }
    };
    walk(scene.statements);
  }
  return index;
};

const buildBlockIndex = (
  sceneCfgs: Map<string, SceneControlFlowGraph>,
): Record<string, CodeBlock> => {
  const index: Record<string, CodeBlock> = {};
  for (const [, sceneCfg] of sceneCfgs) {
    for (const [blockId, block] of Object.entries(sceneCfg.blockIndex)) {
      index[blockId] = block;
    }
  }
  return index;
};
