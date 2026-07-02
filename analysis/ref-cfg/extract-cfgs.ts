import { SceneControlFlowGraph } from "../control-flow-graph/build-scene/scene-control-flow-graph";
import { BlockRef, Transition, TransitionKind, isGoSubReturn, isGoSubCall } from "../control-flow-graph/data";
import { TransitionMetadata } from "../control-flow-graph/data/transition-metadata";
import { isConditionalBranch, isChoiceOptionEdge } from "../control-flow-graph/data/transition-kind";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { Cfg, CfgExit } from "./data";
import { CfgTransfer } from "./cfg-transfer";
import { CfgScope, ScopeNode } from "./scope-types";
import { CfgVisitor, Guard, BlockContext, ExitContext } from "./cfg-visitor";
import { TransferPass } from "./passes/transfer-pass";
import { ScopePass } from "./passes/scope-pass";
import { SymbolTablePass, CfgSymbols } from "./passes/symbol-table-pass";
import { CasingPass, CasingIssue } from "./passes/casing-pass";
import { buildEdgesBySource, getOrSet, topologicalBlockOrder } from "../control-flow-graph/graph-utils";
import { CfgResultCache, hashCfg } from "./cfg-cache";

export interface ExtractedCfg {
  cfg: Cfg;
  transfer: CfgTransfer;
  scope: CfgScope;
  variables: CfgSymbols;
  casing: CasingIssue[];
}

export const makeCfgId = (scene: string, label: string): string =>
  `${scene.toLowerCase()}:${label}`;

// --- Scene decomposition: find all entry points in a scene CFG ---

export interface SceneEntryPoints {
  entryBlockIds: Set<string>;
  blockIdToLabel: Map<string, string>;
  edgesBySource: Map<string, Transition[]>;
}

export const findEntryPoints = (sceneCfg: SceneControlFlowGraph): SceneEntryPoints => {
  const entryBlockIds = new Set<string>();
  entryBlockIds.add(sceneCfg.entryBlockId);
  for (const blockId of Object.values(sceneCfg.labelToBlockId)) {
    entryBlockIds.add(blockId);
  }

  const blockIdToLabel = new Map<string, string>();
  blockIdToLabel.set(sceneCfg.entryBlockId, "");
  for (const [label, blockId] of Object.entries(sceneCfg.labelToBlockId)) {
    blockIdToLabel.set(blockId, label);
  }

  const edgesBySource = buildEdgesBySource(sceneCfg.edges);

  const ownerLabel = resolveBlockOwners(entryBlockIds, blockIdToLabel, edgesBySource);

  const contCounters = new Map<string, number>();
  for (const edge of sceneCfg.edges) {
    if (!isGoSubReturn(edge.kind) || !edge.targetBlockId) continue;
    if (entryBlockIds.has(edge.targetBlockId)) continue;

    const sourceEdges = edgesBySource.get(edge.sourceBlockId) ?? [];
    const hasCall = sourceEdges.some(e => isGoSubCall(e.kind));
    if (!hasCall) continue;

    entryBlockIds.add(edge.targetBlockId);
    if (!blockIdToLabel.has(edge.targetBlockId)) {
      const parent = ownerLabel.get(edge.sourceBlockId) ?? "";
      const idx = contCounters.get(parent) ?? 0;
      contCounters.set(parent, idx + 1);
      const prefix = parent || "__entry";
      blockIdToLabel.set(edge.targetBlockId, `${prefix}__cont_${idx}`);
    }
  }

  return { entryBlockIds, blockIdToLabel, edgesBySource };
};

// --- Single CFG extraction + visitor execution (pure, no cache) ---

export const extractOneCfg = (
  sceneName: string,
  sceneCfg: SceneControlFlowGraph,
  statements: Record<string, Statement>,
  entryBlockId: string,
  entryPoints?: SceneEntryPoints,
): ExtractedCfg => {
  const ep = entryPoints ?? findEntryPoints(sceneCfg);

  if (!ep.entryBlockIds.has(entryBlockId)) {
    throw new Error(
      `Block "${entryBlockId}" is not an entry point in scene "${sceneName}"`,
    );
  }

  const label = ep.blockIdToLabel.get(entryBlockId)!;
  const cfg = extractStructure(
    sceneName, label, entryBlockId,
    ep.entryBlockIds, ep.blockIdToLabel, sceneCfg.blocks, ep.edgesBySource,
  );

  const transferPass = new TransferPass();
  const scopePass = new ScopePass();
  const variablePass = new SymbolTablePass();
  const casingPass = new CasingPass();
  runCfgVisitors(cfg, sceneCfg.blockIndex, statements, [transferPass, scopePass, variablePass, casingPass]);

  return { cfg, transfer: transferPass.finish(cfg), scope: scopePass.finish(cfg), variables: variablePass.finish(cfg), casing: casingPass.finish(cfg) };
};

// --- Batch extraction for all CFGs in a scene (used by reconciler with cache) ---

export const extractCfgs = (
  sceneName: string,
  sceneCfg: SceneControlFlowGraph,
  statements: Record<string, Statement>,
  cache?: CfgResultCache,
): ExtractedCfg[] => {
  const ep = findEntryPoints(sceneCfg);

  const results: ExtractedCfg[] = [];
  for (const entryId of ep.entryBlockIds) {
    const label = ep.blockIdToLabel.get(entryId)!;
    const cfg = extractStructure(
      sceneName, label, entryId,
      ep.entryBlockIds, ep.blockIdToLabel, sceneCfg.blocks, ep.edgesBySource,
    );

    const hash = cache ? hashCfg(cfg, sceneCfg.blockIndex, statements) : "";
    const cached = cache?.lookup(cfg.id, hash);

    if (cached) {
      results.push({ cfg, transfer: cached.transfer, scope: cached.scope, variables: cached.variables, casing: cached.casing });
      continue;
    }

    const transferPass = new TransferPass();
    const scopePass = new ScopePass();
    const variablePass = new SymbolTablePass();
    const casingPass = new CasingPass();
    runCfgVisitors(cfg, sceneCfg.blockIndex, statements, [transferPass, scopePass, variablePass, casingPass]);

    const transfer = transferPass.finish(cfg);
    const scope = scopePass.finish(cfg);
    const variables = variablePass.finish(cfg);
    const casing = casingPass.finish(cfg);

    cache?.store(cfg.id, hash, { transfer, scope, variables, casing });
    results.push({ cfg, transfer, scope, variables, casing });
  }

  return results;
};

// --- Infrastructure: single topo walk, all visitors see each statement ---

export const runCfgVisitors = (
  cfg: Cfg,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  visitors: CfgVisitor<unknown>[],
): void => {
  const order = topologicalBlockOrder(cfg.blocks, cfg.edges);
  const edgesByTarget = buildEdgesByTarget(cfg);
  const idom = computeDominators(cfg.entryBlockId, order, edgesByTarget);

  const blockGuards = new Map<string, Guard[]>();
  blockGuards.set(cfg.entryBlockId, []);

  const scopeNodes = new Map<string, ScopeNode>();

  for (const blockId of order) {
    if (!blockGuards.has(blockId)) {
      const inEdges = edgesByTarget.get(blockId) ?? [];
      if (inEdges.length === 1) {
        const edge = inEdges[0];
        const parentGuards = blockGuards.get(edge.sourceBlockId) ?? [];
        if (isBranchEdge(edge)) {
          blockGuards.set(blockId, [
            ...parentGuards,
            { branchBlockId: edge.sourceBlockId, edgeKind: edge.kind, metadata: edge.metadata },
          ]);
        } else {
          blockGuards.set(blockId, parentGuards);
        }
      } else {
        const dom = idom.get(blockId);
        blockGuards.set(blockId, dom ? (blockGuards.get(dom) ?? []) : []);
      }
    }

    const block = blockIndex[blockId];
    if (!block) continue;

    const guards = blockGuards.get(blockId)!;
    const inEdges = edgesByTarget.get(blockId) ?? [];

    let parentNode: ScopeNode | null = null;
    let merged = false;
    if (blockId === cfg.entryBlockId) {
      parentNode = null;
    } else if (inEdges.length === 1) {
      parentNode = scopeNodes.get(inEdges[0].sourceBlockId) ?? null;
    } else {
      const dom = idom.get(blockId);
      parentNode = dom ? (scopeNodes.get(dom) ?? null) : null;
      merged = true;
    }

    const scopeNode: ScopeNode = {
      blockId,
      parent: parentNode,
      defs: [],
      deletes: new Set(),
      merged,
    };
    scopeNodes.set(blockId, scopeNode);

    const ctx: BlockContext = {
      blockId,
      guards,
      guarded: guards.length > 0,
      scopeNode,
    };

    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      for (const v of visitors) {
        v.onStatement(ctx, stmtId, stmt);
      }
    }
  }

  for (let i = 0; i < cfg.exits.length; i++) {
    const exit = cfg.exits[i];
    const guards = blockGuards.get(exit.blockId) ?? [];
    const exitCtx: ExitContext = {
      exitIndex: i,
      exit,
      guards,
      conditional: guards.some(g => g.metadata.conditionStatementId != null),
      scopeNode: scopeNodes.get(exit.blockId) ?? null,
    };
    for (const v of visitors) {
      v.onExit?.(exitCtx);
    }
  }
};

// --- CFG structure extraction ---

const extractStructure = (
  sceneName: string,
  label: string,
  entryBlockId: string,
  allEntryPoints: Set<string>,
  blockIdToLabel: Map<string, string>,
  allBlocks: Record<string, BlockRef>,
  edgesBySource: Map<string, Transition[]>,
): Cfg => {
  const id = makeCfgId(sceneName, label);
  const blocks: Record<string, BlockRef> = {};
  const internalEdges: Transition[] = [];
  const exits: CfgExit[] = [];

  const visited = new Set<string>();
  const queue: string[] = [entryBlockId];
  let qi = 0;

  while (qi < queue.length) {
    const blockId = queue[qi++];
    if (visited.has(blockId)) continue;
    visited.add(blockId);

    const ref = allBlocks[blockId];
    if (!ref) continue;
    blocks[blockId] = ref;

    const outEdges = edgesBySource.get(blockId) ?? [];

    for (const edge of outEdges) {
      if (isGoSubReturn(edge.kind)) continue;

      if (!edge.targetBlockId) {
        const target = edge.kind === "Return"
          ? { type: "return" as const }
          : edge.kind === "GameEnd"
            ? { type: "terminal" as const }
            : { type: "unresolved" as const };
        const exit: CfgExit = { blockId, kind: edge.kind, target, metadata: edge.metadata };
        if (isGoSubCall(edge.kind)) {
          const contBlockId = findContinuation(blockId, edgesBySource);
          if (contBlockId) {
            const contLabel = blockIdToLabel.get(contBlockId);
            if (contLabel !== undefined) {
              exit.continuation = makeCfgId(sceneName, contLabel);
            }
          }
        }
        exits.push(exit);
        continue;
      }

      if (allEntryPoints.has(edge.targetBlockId)) {
        const targetLabel = blockIdToLabel.get(edge.targetBlockId)!;
        const exit: CfgExit = {
          blockId,
          kind: edge.kind,
          target: { type: "cfg", cfgId: makeCfgId(sceneName, targetLabel) },
          metadata: edge.metadata,
        };
        if (isGoSubCall(edge.kind)) {
          const contBlockId = findContinuation(blockId, edgesBySource);
          if (contBlockId) {
            const contLabel = blockIdToLabel.get(contBlockId);
            if (contLabel !== undefined) {
              exit.continuation = makeCfgId(sceneName, contLabel);
            }
          }
        }
        exits.push(exit);
        continue;
      }

      internalEdges.push(edge);
      if (!visited.has(edge.targetBlockId)) {
        queue.push(edge.targetBlockId);
      }
    }
  }

  for (const edge of internalEdges) {
    if (!blocks[edge.targetBlockId!]) {
      throw new Error(
        `CFG "${id}": internal edge from "${edge.sourceBlockId}" targets "${edge.targetBlockId}" which is not in this CFG`,
      );
    }
    if (isNavigationEdge(edge.kind)) {
      throw new Error(
        `CFG "${id}": navigation edge kind "${edge.kind}" from "${edge.sourceBlockId}" must be an exit, not an internal edge`,
      );
    }
  }

  return { id, scene: sceneName, entryBlockId, blocks, edges: internalEdges, exits };
};

const resolveBlockOwners = (
  entryBlockIds: Set<string>,
  blockIdToLabel: Map<string, string>,
  edgesBySource: Map<string, Transition[]>,
): Map<string, string> => {
  const owner = new Map<string, string>();
  for (const entryId of entryBlockIds) {
    const label = blockIdToLabel.get(entryId)!;
    const visited = new Set<string>();
    const queue = [entryId];
    let qi = 0;
    while (qi < queue.length) {
      const blockId = queue[qi++];
      if (visited.has(blockId)) continue;
      visited.add(blockId);
      owner.set(blockId, label);
      for (const edge of edgesBySource.get(blockId) ?? []) {
        if (!edge.targetBlockId) continue;
        if (entryBlockIds.has(edge.targetBlockId) && edge.targetBlockId !== entryId) continue;
        if (isGoSubReturn(edge.kind)) continue;
        queue.push(edge.targetBlockId);
      }
    }
  }
  return owner;
};

const findContinuation = (
  blockId: string,
  edgesBySource: Map<string, Transition[]>,
): string | undefined => {
  const edges = edgesBySource.get(blockId) ?? [];
  for (const edge of edges) {
    if (isGoSubReturn(edge.kind) && edge.targetBlockId) {
      return edge.targetBlockId;
    }
  }
  return undefined;
};

const navigationEdgeKinds: Set<TransitionKind> = new Set([
  "Goto", "GotoScene", "GoSubCall", "GoSubSceneCall",
  "SceneExit", "SceneProgression", "GameEnd", "Return",
]);

const isNavigationEdge = (kind: TransitionKind): boolean =>
  navigationEdgeKinds.has(kind);

// --- Dominator helpers ---

const isBranchEdge = (edge: { kind: TransitionKind }): boolean =>
  isConditionalBranch(edge.kind) || isChoiceOptionEdge(edge.kind);

const buildEdgesByTarget = (
  cfg: Cfg,
): Map<string, Array<{ sourceBlockId: string; kind: TransitionKind; metadata: TransitionMetadata }>> => {
  const map = new Map<string, Array<{ sourceBlockId: string; kind: TransitionKind; metadata: TransitionMetadata }>>();
  for (const edge of cfg.edges) {
    if (!edge.targetBlockId || !cfg.blocks[edge.targetBlockId]) continue;
    getOrSet(map, edge.targetBlockId, () => []).push({
      sourceBlockId: edge.sourceBlockId,
      kind: edge.kind,
      metadata: edge.metadata,
    });
  }
  return map;
};

const computeDominators = (
  entryId: string,
  order: string[],
  edgesByTarget: Map<string, Array<{ sourceBlockId: string }>>,
): Map<string, string> => {
  const orderIndex = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    orderIndex.set(order[i], i);
  }

  const idom = new Map<string, string>();
  idom.set(entryId, entryId);

  let changed = true;
  while (changed) {
    changed = false;
    for (const blockId of order) {
      if (blockId === entryId) continue;

      const preds = (edgesByTarget.get(blockId) ?? [])
        .map(e => e.sourceBlockId)
        .filter(p => idom.has(p));

      if (preds.length === 0) continue;

      let newIdom = preds[0];
      for (let i = 1; i < preds.length; i++) {
        newIdom = intersect(newIdom, preds[i], idom, orderIndex);
      }

      if (idom.get(blockId) !== newIdom) {
        idom.set(blockId, newIdom);
        changed = true;
      }
    }
  }

  return idom;
};

const intersect = (
  a: string,
  b: string,
  idom: Map<string, string>,
  orderIndex: Map<string, number>,
): string => {
  let fingerA = a;
  let fingerB = b;
  while (fingerA !== fingerB) {
    const idxA = orderIndex.get(fingerA) ?? 0;
    const idxB = orderIndex.get(fingerB) ?? 0;
    if (idxA > idxB) {
      fingerA = idom.get(fingerA) ?? fingerA;
    } else {
      fingerB = idom.get(fingerB) ?? fingerB;
    }
    if (fingerA === idom.get(fingerA) && fingerB === idom.get(fingerB)) break;
  }
  return fingerA;
};
