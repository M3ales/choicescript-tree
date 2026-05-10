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

  const bfsDistance = (from: string, to: string, limit = 500): number => {
    const visited = new Set<string>();
    const queue: [string, number][] = [[from, 0]];
    while (queue.length > 0 && visited.size < limit) {
      const [id, dist] = queue.shift()!;
      if (id === to) return dist;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const e of edgesBySource.get(id) ?? []) {
        if (e.targetBlockId && !visited.has(e.targetBlockId)) {
          queue.push([e.targetBlockId, dist + 1]);
        }
      }
    }
    return Infinity;
  };

  const BFS_LIMIT = 10_000;

  const findChoiceConvergence = (branchStartIds: string[]): string | null => {
    if (branchStartIds.length < 2) return null;

    const reachableSets = branchStartIds.map((startId) => {
      const reachable = new Set<string>();
      const visited = new Set<string>();
      const queue = [startId];
      while (queue.length > 0 && visited.size < BFS_LIMIT) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        if (choiceBlockIds.has(id) && id !== startId && !isStatsChoice(id)) {
          reachable.add(id);
        }
        for (const e of edgesBySource.get(id) ?? []) {
          if (e.targetBlockId && !visited.has(e.targetBlockId)) {
            queue.push(e.targetBlockId);
          }
        }
      }
      return reachable;
    });

    // A branch start is excluded from its own reachable set (id !== startId),
    // but it may be reachable from all other branches — making it the convergence point.
    // Also, if branch j starts AT the candidate, it trivially reaches it.
    for (let i = 0; i < branchStartIds.length; i++) {
      const candidate = branchStartIds[i];
      if (isStatsChoice(candidate)) continue;
      if (!choiceBlockIds.has(candidate)) continue;
      const reachableFromAllOthers = reachableSets.every(
        (s, j) => j === i || branchStartIds[j] === candidate || s.has(candidate),
      );
      if (reachableFromAllOthers) {
        for (let j = 0; j < reachableSets.length; j++) {
          if (branchStartIds[j] === candidate) reachableSets[j].add(candidate);
        }
      }
    }

    const common = [...reachableSets[0]].filter((id) =>
      reachableSets.every((s) => s.has(id))
    );
    if (common.length === 0) return null;

    common.sort((a, b) => {
      const maxA = Math.max(...branchStartIds.map((s) => bfsDistance(s, a)));
      const maxB = Math.max(...branchStartIds.map((s) => bfsDistance(s, b)));
      return maxA - maxB;
    });

    return common[0];
  };

  const findConditionalConvergence = (
    blockId: string,
    branchEdges: Transition[],
  ): string | null => {
    const outEdges = edgesBySource.get(blockId) ?? [];
    const fallThrough = outEdges.find((e) => e.kind === "IfFallThrough");
    if (fallThrough?.targetBlockId) return fallThrough.targetBlockId;

    const branchEntries = new Set(
      branchEdges.map((e) => e.targetBlockId).filter(Boolean) as string[]
    );
    if (branchEntries.size < 2) return null;

    const candidateCounts = new Map<string, number>();
    for (const entryId of branchEntries) {
      const reachable = new Set<string>();
      const q = [entryId];
      while (q.length > 0 && reachable.size < BFS_LIMIT) {
        const id = q.shift()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        const blockEdges = edgesBySource.get(id) ?? [];
        if (blockEdges.some((e) => isChoiceOptionEdge(e.kind))) continue;
        for (const e of blockEdges) {
          if (
            e.targetBlockId &&
            !branchEntries.has(e.targetBlockId) &&
            !reachable.has(e.targetBlockId)
          ) {
            q.push(e.targetBlockId);
          }
        }
      }
      for (const id of reachable) {
        if (!branchEntries.has(id)) {
          candidateCounts.set(id, (candidateCounts.get(id) ?? 0) + 1);
        }
      }
    }

    for (const [id, count] of candidateCounts) {
      if (count === branchEntries.size) return id;
    }
    return null;
  };

  const findEmbeddedChoices = (
    startId: string,
    stopAt: string | null,
  ): string[] => {
    const choices: string[] = [];
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0 && visited.size < BFS_LIMIT) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      if (stopAt && id === stopAt) continue;
      visited.add(id);
      if (choiceBlockIds.has(id) && !isStatsChoice(id)) {
        choices.push(id);
        continue;
      }
      for (const e of edgesBySource.get(id) ?? []) {
        if (
          e.targetBlockId &&
          !visited.has(e.targetBlockId) &&
          !isChoiceOptionEdge(e.kind)
        ) {
          queue.push(e.targetBlockId);
        }
      }
    }
    return choices;
  };

  const branchTerminates = (
    startId: string,
    stopAt: string | null,
  ): boolean => {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0 && visited.size < BFS_LIMIT) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      if (stopAt && id === stopAt) continue;
      visited.add(id);
      const edges = edgesBySource.get(id) ?? [];
      if (edges.some((e) => isTerminalEdge(e.kind))) return true;
      if (edges.some((e) => isChoiceOptionEdge(e.kind))) continue;
      for (const e of edges) {
        if (e.targetBlockId && !visited.has(e.targetBlockId)) {
          queue.push(e.targetBlockId);
        }
      }
    }
    return false;
  };

  const findNestedDivergences = (
    entryId: string,
    stopAt: string | null,
    allDivergences: Set<string>,
  ): string[] => {
    const nested: string[] = [];
    const visited = new Set<string>();
    const queue = [entryId];
    while (queue.length > 0 && visited.size < BFS_LIMIT) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      if (stopAt && id === stopAt) continue;
      visited.add(id);
      if (allDivergences.has(id) && id !== entryId) {
        nested.push(id);
      }
      const edges = edgesBySource.get(id) ?? [];
      if (isChoiceOptionEdge(edges[0]?.kind) && id !== entryId) continue;
      for (const e of edges) {
        if (
          e.targetBlockId &&
          !visited.has(e.targetBlockId) &&
          !isChoiceOptionEdge(e.kind)
        ) {
          queue.push(e.targetBlockId);
        }
      }
    }
    return nested;
  };

  const countReachableChoices = (startId: string, stopAt: string | null): number => {
    const visited = new Set<string>();
    const queue = [startId];
    let count = 0;
    while (queue.length > 0 && visited.size < BFS_LIMIT) {
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

  const canReachCanonical = (startId: string, targetCanonical: string, limit = 200): boolean => {
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

  const allDivergenceIds = new Set<string>();
  for (const id of Object.keys(cfg.refs)) {
    const edges = edgesBySource.get(id) ?? [];
    if (edges.some((e) => isChoiceOptionEdge(e.kind))) {
      allDivergenceIds.add(id);
    }
    if (edges.some((e) => isBranchEdge(e.kind))) {
      allDivergenceIds.add(id);
    }
  }

  const divergences: Record<string, DivergenceRecord> = {};

  let processed = 0;
  const totalDivergences = allDivergenceIds.size;
  for (const blockId of allDivergenceIds) {
    processed++;
    if (processed % 1000 === 0) {
      console.log(`  ... ${processed}/${totalDivergences} divergence points`);
    }
    const edges = edgesBySource.get(blockId) ?? [];
    const choiceEdges = edges.filter(
      (e) => isChoiceOptionEdge(e.kind) && e.targetBlockId
    );
    const branchEdges = edges.filter((e) => isBranchEdge(e.kind));

    if (choiceEdges.length > 0) {
      const optionTargets = choiceEdges
        .map((e) => e.targetBlockId!)
        .filter(Boolean);

      const isLoop = loopHeaderIds.has(blockId);

      const optionDestinations: string[] = [];
      for (const target of optionTargets) {
        const dest = findOptionDestination(target);
        if (dest) optionDestinations.push(dest);
      }

      const convergeBlockId =
        optionDestinations.length >= 2
          ? findChoiceConvergence(optionDestinations)
          : null;

      const choiceCanonical = canonicalBlockId(blockId);
      const branches: BranchRecord[] = choiceEdges.map((e) => {
        const entryId = e.targetBlockId!;
        return {
          edgeKind: e.kind,
          entryBlockId: entryId,
          optionStatementId: e.metadata.optionStatementId,
          choiceConditionId: e.metadata.choiceConditionId,
          embeddedChoices: findEmbeddedChoices(entryId, convergeBlockId),
          terminates: branchTerminates(entryId, convergeBlockId),
          nested: findNestedDivergences(entryId, convergeBlockId, allDivergenceIds),
          distToConvergence: convergeBlockId ? bfsDistance(entryId, convergeBlockId) : Infinity,
          reachableChoices: countReachableChoices(entryId, convergeBlockId),
          isLoopBack: isLoop && canReachCanonical(entryId, choiceCanonical),
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
    } else if (branchEdges.length > 0) {
      const convergeBlockId = findConditionalConvergence(blockId, branchEdges);

      const branches: BranchRecord[] = branchEdges
        .filter((e) => e.targetBlockId)
        .map((e) => {
          const entryId = e.targetBlockId!;
          return {
            edgeKind: e.kind,
            entryBlockId: entryId,
            conditionStatementId: e.metadata.conditionStatementId,
            embeddedChoices: findEmbeddedChoices(entryId, convergeBlockId),
            terminates: branchTerminates(entryId, convergeBlockId),
            nested: findNestedDivergences(
              entryId,
              convergeBlockId,
              allDivergenceIds,
            ),
            distToConvergence: convergeBlockId ? bfsDistance(entryId, convergeBlockId) : Infinity,
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
  }

  function findOptionDestination(optionEntryId: string): string | null {
    let current = optionEntryId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      if (!cfg.refs[current]) return null;
      const edges = edgesBySource.get(current) ?? [];

      if (edges.some((e) => isChoiceOptionEdge(e.kind))) return current;
      if (edges.some((e) => isBranchEdge(e.kind))) return current;

      const nonChoiceEdges = edges.filter(
        (e) => e.targetBlockId && !isChoiceOptionEdge(e.kind)
      );
      if (nonChoiceEdges.length === 1) {
        current = nonChoiceEdges[0].targetBlockId!;
      } else if (nonChoiceEdges.length === 0) {
        return current;
      } else {
        return current;
      }
    }
    return current;
  }

  for (const div of Object.values(divergences)) {
    for (const branch of div.branches) {
      for (const nestedId of branch.nested) {
        const nested = divergences[nestedId];
        if (nested) {
          nested.parentBlockId = div.blockId;
          nested.parentBranchEntryId = branch.entryBlockId;
        }
      }
    }
  }

  const computeDepth = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const div = divergences[id];
    if (!div || !div.parentBlockId) return 0;
    return 1 + computeDepth(div.parentBlockId, seen);
  };
  for (const div of Object.values(divergences)) {
    div.depth = computeDepth(div.blockId, new Set());
  }

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
