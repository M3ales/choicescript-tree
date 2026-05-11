import { Transition, TransitionKind, isChoiceOptionEdge } from "../control-flow-graph/data";
import { readNdjsonSync } from "../ndjson";
import { BranchRecord } from "./branch-record";
import { DivergenceRecord } from "./divergence-record";
import { PathAnalysis } from "./path-analysis-result";
import { InlineCfg, sceneOf } from "../control-flow-graph/cfg-io";

export const readPathAnalysis = (path: string): PathAnalysis => {
  const records = readNdjsonSync<DivergenceRecord>(path);
  const divergences: Record<string, DivergenceRecord> = {};
  const splitPoints = new Set<string>();
  for (const rec of records) {
    divergences[rec.blockId] = rec;
    if (rec.isSplitPoint) splitPoints.add(rec.blockId);
  }
  return { divergences, splitPoints };
};

type EdgeIndex = Map<string, Transition[]>;

const buildEdgeIndex = (edges: Transition[]): EdgeIndex => {
  const index = new Map<string, Transition[]>();
  for (const edge of edges) {
    const list = index.get(edge.sourceBlockId) ?? [];
    list.push(edge);
    index.set(edge.sourceBlockId, list);
  }
  return index;
};

const isBranchEdge = (kind: TransitionKind): boolean =>
  kind === "IfBranch" || kind === "ElseIfBranch" || kind === "ElseBranch";

const isTerminalEdge = (kind: TransitionKind): boolean =>
  kind === "GameEnd" || kind === "SceneProgression";

// ---------------------------------------------------------------------------
// Bitset helpers
// ---------------------------------------------------------------------------

const createBitset = (numBits: number): Uint32Array =>
  new Uint32Array(Math.ceil(numBits / 32));

const setBit = (bs: Uint32Array, i: number): void => {
  bs[i >>> 5] |= 1 << (i & 31);
};

const getBit = (bs: Uint32Array, i: number): boolean =>
  (bs[i >>> 5] & (1 << (i & 31))) !== 0;

const bitwiseOrInto = (dst: Uint32Array, src: Uint32Array): void => {
  for (let i = 0; i < dst.length; i++) dst[i] |= src[i];
};

const bitwiseAndAll = (sets: Uint32Array[]): Uint32Array => {
  const result = new Uint32Array(sets[0].length);
  result.set(sets[0]);
  for (let s = 1; s < sets.length; s++) {
    for (let i = 0; i < result.length; i++) result[i] &= sets[s][i];
  }
  return result;
};

const isAnyBitSet = (bs: Uint32Array): boolean => {
  for (let i = 0; i < bs.length; i++) if (bs[i] !== 0) return true;
  return false;
};

// ---------------------------------------------------------------------------
// Iterative Tarjan SCC (array-index based, no iterators)
// ---------------------------------------------------------------------------

interface SCCResult {
  blockToSCC: Map<string, number>;
  sccMembers: string[][];
  condensedSuccessors: Map<number, Set<number>>;
  topoOrder: number[];
}

function computeSCCs(
  blockIds: string[],
  successorArrays: Map<string, string[]>,
): SCCResult {
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const blockToSCC = new Map<string, number>();
  const sccMembers: string[][] = [];
  let nextIndex = 0;

  // Frame: node id + index into its successor array
  const callStack: { id: string; succIdx: number }[] = [];

  for (const startId of blockIds) {
    if (indices.has(startId)) continue;

    // "Call" startId
    indices.set(startId, nextIndex);
    lowlinks.set(startId, nextIndex);
    nextIndex++;
    onStack.add(startId);
    stack.push(startId);
    callStack.push({ id: startId, succIdx: 0 });

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const succs = successorArrays.get(frame.id) ?? [];

      if (frame.succIdx < succs.length) {
        const w = succs[frame.succIdx];
        frame.succIdx++;

        if (!indices.has(w)) {
          // "Recurse" into w
          indices.set(w, nextIndex);
          lowlinks.set(w, nextIndex);
          nextIndex++;
          onStack.add(w);
          stack.push(w);
          callStack.push({ id: w, succIdx: 0 });
        } else if (onStack.has(w)) {
          const myLow = lowlinks.get(frame.id)!;
          const wIdx = indices.get(w)!;
          if (wIdx < myLow) lowlinks.set(frame.id, wIdx);
        }
      } else {
        // All successors processed — check SCC root
        if (lowlinks.get(frame.id) === indices.get(frame.id)) {
          const members: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            blockToSCC.set(w, sccMembers.length);
            members.push(w);
          } while (w !== frame.id);
          sccMembers.push(members);
        }

        callStack.pop();

        // Update parent lowlink
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1];
          const childLow = lowlinks.get(frame.id)!;
          const parentLow = lowlinks.get(parent.id)!;
          if (childLow < parentLow) lowlinks.set(parent.id, childLow);
        }
      }
    }
  }

  // Condensed DAG
  const condensedSuccessors = new Map<number, Set<number>>();
  for (let i = 0; i < sccMembers.length; i++) {
    condensedSuccessors.set(i, new Set());
  }
  for (const id of blockIds) {
    const myScc = blockToSCC.get(id)!;
    for (const succ of successorArrays.get(id) ?? []) {
      const succScc = blockToSCC.get(succ);
      if (succScc !== undefined && succScc !== myScc) {
        condensedSuccessors.get(myScc)!.add(succScc);
      }
    }
  }

  // Kahn's topological sort on condensed DAG
  const inDegree = new Int32Array(sccMembers.length);
  for (const [, succs] of condensedSuccessors) {
    for (const s of succs) inDegree[s]++;
  }
  const topoQueue: number[] = [];
  for (let i = 0; i < sccMembers.length; i++) {
    if (inDegree[i] === 0) topoQueue.push(i);
  }
  const topoOrder: number[] = [];
  while (topoQueue.length > 0) {
    const n = topoQueue.shift()!;
    topoOrder.push(n);
    for (const s of condensedSuccessors.get(n)!) {
      if (--inDegree[s] === 0) topoQueue.push(s);
    }
  }

  return { blockToSCC, sccMembers, condensedSuccessors, topoOrder };
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export const analysePaths = (
  cfg: InlineCfg,
  loopHeaderIds: Set<string>,
): PathAnalysis => {
  const edgesBySource = buildEdgeIndex(cfg.edges);

  const canonicalBlockId = (id: string) => cfg.refs[id]?.sourceBlockId ?? id;

  const choiceBlockIds = new Set<string>();
  for (const id of Object.keys(cfg.refs)) {
    const outEdges = edgesBySource.get(id) ?? [];
    if (outEdges.some((e) => isChoiceOptionEdge(e.kind))) {
      choiceBlockIds.add(id);
    }
  }

  const isStatsChoice = (id: string) =>
    choiceBlockIds.has(id) && sceneOf(id) === "choicescript_stats";

  // Precompute successor arrays (used by SCC + pdom)
  const successorArrays = new Map<string, string[]>();
  const allBlockIds = Object.keys(cfg.refs);
  for (const id of allBlockIds) {
    const succs: string[] = [];
    for (const e of edgesBySource.get(id) ?? []) {
      if (e.targetBlockId) succs.push(e.targetBlockId);
    }
    successorArrays.set(id, succs);
  }

  // =========================================================================
  // Phase 0: Identify divergence points + exit blocks
  // =========================================================================

  const choiceDivergences = new Set<string>();
  const conditionalDivergences = new Set<string>();

  for (const id of allBlockIds) {
    const edges = edgesBySource.get(id) ?? [];
    if (edges.some((e) => isChoiceOptionEdge(e.kind))) {
      choiceDivergences.add(id);
    } else if (edges.some((e) => isBranchEdge(e.kind))) {
      conditionalDivergences.add(id);
    }
  }

  console.log(`  ${choiceDivergences.size} choice, ${conditionalDivergences.size} conditional divergences`);

  // =========================================================================
  // Phase 1: Pre-filter conditionals
  // =========================================================================

  const QUICK_LIMIT = 150;

  const quickFirstChoice = (startId: string): string | null => {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0 && visited.size < QUICK_LIMIT) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (choiceBlockIds.has(id) && !isStatsChoice(id)) return id;
      for (const e of edgesBySource.get(id) ?? []) {
        if (e.targetBlockId && !visited.has(e.targetBlockId) && !isChoiceOptionEdge(e.kind)) {
          queue.push(e.targetBlockId);
        }
      }
    }
    return null;
  };

  const relevantConditionals = new Set<string>();
  let skipped = 0;

  for (const blockId of conditionalDivergences) {
    const edges = edgesBySource.get(blockId) ?? [];

    if (edges.some(e => e.kind === "IfFallThrough")) {
      relevantConditionals.add(blockId);
      continue;
    }

    const branchEdges = edges.filter(e => isBranchEdge(e.kind) && e.targetBlockId);
    let anyChoice = false;
    for (const e of branchEdges) {
      if (quickFirstChoice(e.targetBlockId!)) { anyChoice = true; break; }
    }

    if (anyChoice) {
      relevantConditionals.add(blockId);
    } else {
      skipped++;
    }
  }

  console.log(`  Pre-filter: ${skipped} trivial conditionals skipped, ${relevantConditionals.size} kept`);

  // =========================================================================
  // Phase 2a: Conditional convergence
  // =========================================================================

  const convergence = new Map<string, string | null>();

  // IfFallThrough fast path
  let ftCount = 0;
  for (const blockId of relevantConditionals) {
    const edges = edgesBySource.get(blockId) ?? [];
    const ft = edges.find(e => e.kind === "IfFallThrough");
    if (ft?.targetBlockId) {
      convergence.set(blockId, ft.targetBlockId);
      ftCount++;
    }
  }

  const needConvergence = [...relevantConditionals].filter(id => !convergence.has(id));
  console.log(`  Conditional convergence: ${ftCount} fallthrough, ${needConvergence.length} need BFS`);

  if (needConvergence.length > 0) {
    const CONV_LIMIT = 2_000;
    let convFound = 0;
    for (const blockId of needConvergence) {
      const edges = edgesBySource.get(blockId) ?? [];
      const branchEdges = edges.filter(e => isBranchEdge(e.kind) && e.targetBlockId);
      const branchEntries = branchEdges.map(e => e.targetBlockId!).filter(Boolean);

      if (branchEntries.length < 2) {
        convergence.set(blockId, null);
        continue;
      }

      // BFS from each branch, intersect to find first common block
      const reachableSets = branchEntries.map(entry => {
        const visited = new Set<string>();
        const queue = [entry];
        while (queue.length > 0 && visited.size < CONV_LIMIT) {
          const id = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);
          for (const e of edgesBySource.get(id) ?? []) {
            if (e.targetBlockId && !visited.has(e.targetBlockId) &&
                !isChoiceOptionEdge(e.kind)) {
              queue.push(e.targetBlockId);
            }
          }
        }
        return visited;
      });

      // Find nearest common block via BFS from the conditional itself
      let found: string | null = null;
      const common = new Set([...reachableSets[0]].filter(id =>
        reachableSets.every(s => s.has(id))
      ));

      if (common.size > 0) {
        // BFS from conditional to find nearest common block
        const visited = new Set<string>();
        const queue = [blockId];
        while (queue.length > 0 && !found) {
          const id = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);
          if (id !== blockId && common.has(id)) { found = id; break; }
          for (const e of edgesBySource.get(id) ?? []) {
            if (e.targetBlockId && !visited.has(e.targetBlockId) &&
                !isChoiceOptionEdge(e.kind)) {
              queue.push(e.targetBlockId);
            }
          }
        }
      }

      convergence.set(blockId, found);
      if (found) convFound++;
    }
    console.log(`  ${convFound}/${needConvergence.length} conditionals found convergence via BFS`);
  }

  // =========================================================================
  // Phase 2b: Choice convergence via SCC + reachable choice bitsets
  // =========================================================================

  const choiceBitIndex = new Map<string, number>();
  const bitToChoice: string[] = [];
  for (const id of choiceBlockIds) {
    if (!isStatsChoice(id)) {
      choiceBitIndex.set(id, bitToChoice.length);
      bitToChoice.push(id);
    }
  }
  const numBits = bitToChoice.length;

  if (numBits > 0 && choiceDivergences.size > 0) {
    console.log(`  Computing SCC for ${allBlockIds.length} blocks...`);
    const scc = computeSCCs(allBlockIds, successorArrays);
    console.log(`  ${scc.sccMembers.length} SCCs, propagating reachable choice sets (${numBits} choices)...`);

    // Local choices per SCC
    const sccLocal: Uint32Array[] = new Array(scc.sccMembers.length);
    for (let i = 0; i < scc.sccMembers.length; i++) {
      sccLocal[i] = createBitset(numBits);
      for (const m of scc.sccMembers[i]) {
        const bit = choiceBitIndex.get(m);
        if (bit !== undefined) setBit(sccLocal[i], bit);
      }
    }

    // Propagate in reverse topo (sinks first)
    const sccReachable: Uint32Array[] = new Array(scc.sccMembers.length);
    const revTopo = [...scc.topoOrder].reverse();

    for (const sccId of revTopo) {
      sccReachable[sccId] = createBitset(numBits);
      sccReachable[sccId].set(sccLocal[sccId]);
      for (const succScc of scc.condensedSuccessors.get(sccId)!) {
        bitwiseOrInto(sccReachable[sccId], sccReachable[succScc]);
      }
    }

    const getReachable = (blockId: string): Uint32Array => {
      const s = scc.blockToSCC.get(blockId);
      return s !== undefined ? sccReachable[s] : createBitset(numBits);
    };

    // For each choice divergence: intersect branch sets, BFS for nearest
    for (const choiceId of choiceDivergences) {
      const edges = edgesBySource.get(choiceId) ?? [];
      const optEdges = edges.filter(e => isChoiceOptionEdge(e.kind) && e.targetBlockId);

      if (optEdges.length < 2) {
        convergence.set(choiceId, null);
        continue;
      }

      const branchSets = optEdges.map(e => getReachable(e.targetBlockId!));
      const common = bitwiseAndAll(branchSets);

      if (!isAnyBitSet(common)) {
        convergence.set(choiceId, null);
        continue;
      }

      // BFS from choice block to find nearest common choice
      const choiceCanon = canonicalBlockId(choiceId);
      let nearest: string | null = null;
      const visited = new Set<string>();
      const queue = [choiceId];
      while (queue.length > 0 && !nearest) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        if (id !== choiceId && choiceBlockIds.has(id) && !isStatsChoice(id)) {
          const bit = choiceBitIndex.get(id);
          if (bit !== undefined && getBit(common, bit) && canonicalBlockId(id) !== choiceCanon) {
            nearest = id;
            break;
          }
        }
        for (const e of edgesBySource.get(id) ?? []) {
          if (e.targetBlockId && !visited.has(e.targetBlockId)) {
            queue.push(e.targetBlockId);
          }
        }
      }

      convergence.set(choiceId, nearest);
    }

    console.log(`  Choice convergence computed for ${choiceDivergences.size} choices`);
  } else {
    for (const id of choiceDivergences) convergence.set(id, null);
  }

  // =========================================================================
  // Phase 3: Build divergence records with bounded per-branch walks
  // =========================================================================

  const WALK_LIMIT = 5_000;

  const findEmbeddedChoices = (startId: string, stopAt: string | null): string[] => {
    const choices: string[] = [];
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0 && visited.size < WALK_LIMIT) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      if (stopAt && id === stopAt) continue;
      visited.add(id);
      if (choiceBlockIds.has(id) && !isStatsChoice(id)) {
        choices.push(id);
        continue;
      }
      for (const e of edgesBySource.get(id) ?? []) {
        if (e.targetBlockId && !visited.has(e.targetBlockId) && !isChoiceOptionEdge(e.kind)) {
          queue.push(e.targetBlockId);
        }
      }
    }
    return choices;
  };

  const branchTerminates = (startId: string, stopAt: string | null): boolean => {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0 && visited.size < WALK_LIMIT) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      if (stopAt && id === stopAt) continue;
      visited.add(id);
      const edges = edgesBySource.get(id) ?? [];
      if (edges.some(e => isTerminalEdge(e.kind))) return true;
      if (edges.some(e => isChoiceOptionEdge(e.kind))) continue;
      for (const e of edges) {
        if (e.targetBlockId && !visited.has(e.targetBlockId)) {
          queue.push(e.targetBlockId);
        }
      }
    }
    return false;
  };

  const countReachableChoices = (startId: string, stopAt: string | null): number => {
    const visited = new Set<string>();
    const queue = [startId];
    let count = 0;
    while (queue.length > 0 && visited.size < WALK_LIMIT) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      if (stopAt && id === stopAt) continue;
      visited.add(id);
      if (choiceBlockIds.has(id) && !isStatsChoice(id)) count++;
      for (const e of edgesBySource.get(id) ?? []) {
        if (e.targetBlockId && !visited.has(e.targetBlockId)) {
          queue.push(e.targetBlockId);
        }
      }
    }
    return count;
  };

  const canReachCanonical = (startId: string, targetCanonical: string, limit = 500): boolean => {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0 && visited.size < limit) {
      const id = queue.shift()!;
      if (canonicalBlockId(id) === targetCanonical && id !== startId) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const e of edgesBySource.get(id) ?? []) {
        if (e.targetBlockId && !visited.has(e.targetBlockId)) {
          queue.push(e.targetBlockId);
        }
      }
    }
    return false;
  };

  const divergences: Record<string, DivergenceRecord> = {};
  let processed = 0;
  const totalDivs = choiceDivergences.size + relevantConditionals.size;

  for (const blockId of choiceDivergences) {
    processed++;
    if (processed % 2000 === 0) console.log(`  ... ${processed}/${totalDivs}`);

    const edges = edgesBySource.get(blockId) ?? [];
    const choiceEdges = edges.filter(e => isChoiceOptionEdge(e.kind) && e.targetBlockId);
    const convergeBlockId = convergence.get(blockId) ?? null;
    const isLoop = loopHeaderIds.has(blockId);
    const choiceCanon = canonicalBlockId(blockId);

    const branches: BranchRecord[] = choiceEdges.map(e => {
      const entryId = e.targetBlockId!;
      return {
        edgeKind: e.kind,
        entryBlockId: entryId,
        optionStatementId: e.metadata.optionStatementId,
        choiceConditionId: e.metadata.choiceConditionId,
        embeddedChoices: findEmbeddedChoices(entryId, convergeBlockId),
        terminates: branchTerminates(entryId, convergeBlockId),
        nested: [],
        distToConvergence: 0,
        reachableChoices: countReachableChoices(entryId, convergeBlockId),
        isLoopBack: isLoop && canReachCanonical(entryId, choiceCanon),
      };
    });

    divergences[blockId] = {
      blockId,
      kind: "choice",
      convergeBlockId,
      isLoop,
      isSplitPoint: false,
      parentBlockId: null,
      parentBranchEntryId: null,
      depth: 0,
      branches,
    };
  }

  for (const blockId of relevantConditionals) {
    processed++;
    if (processed % 2000 === 0) console.log(`  ... ${processed}/${totalDivs}`);

    const edges = edgesBySource.get(blockId) ?? [];
    const branchEdges = edges.filter(e => isBranchEdge(e.kind));
    const convergeBlockId = convergence.get(blockId) ?? null;

    const branches: BranchRecord[] = branchEdges
      .filter(e => e.targetBlockId)
      .map(e => {
        const entryId = e.targetBlockId!;
        return {
          edgeKind: e.kind,
          entryBlockId: entryId,
          conditionStatementId: e.metadata.conditionStatementId,
          embeddedChoices: findEmbeddedChoices(entryId, convergeBlockId),
          terminates: branchTerminates(entryId, convergeBlockId),
          nested: [],
          distToConvergence: 0,
          reachableChoices: countReachableChoices(entryId, convergeBlockId),
          isLoopBack: false,
        };
      });

    divergences[blockId] = {
      blockId,
      kind: "conditional",
      convergeBlockId,
      isLoop: false,
      isSplitPoint: false,
      parentBlockId: null,
      parentBranchEntryId: null,
      depth: 0,
      branches,
    };
  }

  // =========================================================================
  // Phase 4: Split points
  // =========================================================================

  const splitPoints = new Set<string>();
  for (const div of Object.values(divergences)) {
    if (div.kind !== "conditional") continue;
    const firstChoices: string[] = [];
    for (const b of div.branches) {
      if (b.embeddedChoices.length > 0) {
        firstChoices.push(canonicalBlockId(b.embeddedChoices[0]));
      } else if (!b.terminates && div.convergeBlockId && choiceBlockIds.has(div.convergeBlockId)) {
        firstChoices.push(canonicalBlockId(div.convergeBlockId));
      }
    }
    const uniqueCanons = new Set(firstChoices);
    if (uniqueCanons.size > 1) {
      div.isSplitPoint = true;
      splitPoints.add(div.blockId);
    }
  }

  return { divergences, splitPoints };
};
