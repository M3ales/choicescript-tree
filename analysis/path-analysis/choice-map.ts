import { Transition, isChoiceOptionEdge } from "../control-flow-graph/data";
import { PathAnalysis } from "./path-analysis-result";
import { ChoiceOptionStatement, Statement } from "../../parser/statements";
import { InlineCfg, sceneOf } from "../control-flow-graph/cfg-io";

export interface MappedChoice {
  kind: "choice";
  blockId: string;
  canonicalId: string;
  num: number;
  isHub: boolean;
  length?: number;
}

export interface ChoiceMapBranch {
  kind: "branch";
  optionLabels: string[];
  fromChoiceNum: number;
  convergeBlockId: string | null;
  children: ChoiceMapEntry[];
  length?: number;
}

export interface ChoiceMapRef {
  kind: "ref";
  blockId: string;
  canonicalId: string;
  targetNum: number;
  length?: number;
}

export interface ChoiceMapConditionalSplit {
  kind: "conditional-split";
  blockId: string;
  num: number;
  branches: {
    conditionStatementId: string | null;
    isElse: boolean;
    choiceBlockId: string;
    choiceCanonicalId: string;
    children: ChoiceMapEntry[];
  }[];
  length?: number;
}

export type ChoiceMapEntry =
  | MappedChoice
  | ChoiceMapBranch
  | ChoiceMapRef
  | ChoiceMapConditionalSplit;

export interface ChoiceMap {
  entries: ChoiceMapEntry[];
  choiceCount: number;
  numByCanonical: Map<string, number>;
  splitBlockIds: Set<string>;
  warnings: string[];
}

export function buildChoiceMap(
  cfg: InlineCfg,
  pathAnalysis: PathAnalysis,
  loopHeaderIds: Set<string>,
  statements: Record<string, Statement>,
): ChoiceMap {
  const edgesBySource = new Map<string, Transition[]>();
  for (const edge of cfg.edges) {
    const list = edgesBySource.get(edge.sourceBlockId) ?? [];
    list.push(edge);
    edgesBySource.set(edge.sourceBlockId, list);
  }

  const canonMap = new Map<string, string>();
  for (const id of Object.keys(cfg.refs)) {
    const ref = cfg.refs[id];
    canonMap.set(id, ref.sourceBlockId ?? id);
  }
  for (const [id, c] of canonMap) {
    let resolved = c;
    const seen = new Set<string>();
    while (canonMap.has(resolved) && canonMap.get(resolved) !== resolved && !seen.has(resolved)) {
      seen.add(resolved);
      resolved = canonMap.get(resolved)!;
    }
    if (resolved !== c) canonMap.set(id, resolved);
  }
  const canon = (id: string) => canonMap.get(id) ?? id;

  const choiceIds = new Set<string>();
  for (const id of Object.keys(cfg.refs)) {
    if ((edgesBySource.get(id) ?? []).some(e => isChoiceOptionEdge(e.kind)))
      choiceIds.add(id);
  }
  const hubIds = new Set([...choiceIds].filter(id => loopHeaderIds.has(id)));
  const isChoice = (id: string) =>
    choiceIds.has(id) && sceneOf(id) !== "choicescript_stats";

  const isSplitPoint = (id: string) => pathAnalysis.splitPoints.has(id);

  const findFirstChoice = (from: string): string | null => {
    if (isChoice(from)) return from;
    const vis = new Set<string>();
    const q = [from];
    while (q.length > 0) {
      const id = q.shift()!;
      if (vis.has(id)) continue;
      vis.add(id);
      if (isChoice(id)) return id;
      for (const e of edgesBySource.get(id) ?? []) {
        if (e.targetBlockId && !vis.has(e.targetBlockId) && !isChoiceOptionEdge(e.kind))
          q.push(e.targetBlockId);
      }
    }
    return null;
  };

  const warnings: string[] = [];

  const isBranchEdge = (e: Transition) =>
    e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch" || e.kind === "IfFallThrough";

  const traceToNextChoice = (from: string, boundary: string | null): string | null => {
    const vis = new Set<string>();
    const q = [from];
    while (q.length > 0) {
      const id = q.shift()!;
      if (vis.has(id)) continue;
      vis.add(id);
      if (isChoice(id)) return id;
      if (isSplitPoint(id)) return id;
      if (boundary && canon(id) === boundary) return null;

      const edges = edgesBySource.get(id) ?? [];
      if (edges.length === 0 || edges.some(e => e.kind === "GameEnd")) return null;
      if (edges.some(e => e.kind === "GotoScene" && !e.targetBlockId)) {
        const scene = sceneOf(id);
        warnings.push(`traceToNextChoice: unresolved *goto_scene at ${id} (${scene}) — cannot follow path`);
        return null;
      }

      const ifs = edges.filter(e => isBranchEdge(e));
      if (ifs.length > 0) {
        const div = pathAnalysis.divergences[id];
        if (div) {
          const branchChoices = div.branches
            .filter(b => b.embeddedChoices.length > 0)
            .map(b => b.embeddedChoices[0]);
          const uniqueCanons = new Set(branchChoices.map(c => canon(c)));
          if (uniqueCanons.size === 1) return branchChoices[0];
        }
        if (div?.convergeBlockId) q.push(div.convergeBlockId);
        continue;
      }

      for (const e of edges) {
        if (e.targetBlockId && !isChoiceOptionEdge(e.kind) && e.kind !== "GameEnd")
          q.push(e.targetBlockId);
      }
    }
    return null;
  };

  const getOptionLabel = (edge: Transition): string => {
    const stmt = edge.metadata.optionStatementId
      ? statements[edge.metadata.optionStatementId]
      : null;
    if (stmt?.kind === "ChoiceOption")
      return (stmt as ChoiceOptionStatement).token?.rawText ?? "?";
    return edge.targetBlockId ?? "?";
  };

  interface DestGroup {
    labels: string[];
    entryIds: string[];
    actualDest: string | null;
  }

  const groupDests = (
    choiceBlockId: string,
    boundary: string | null,
  ): Map<string | null, DestGroup> => {
    const edges = (edgesBySource.get(choiceBlockId) ?? [])
      .filter(e => isChoiceOptionEdge(e.kind) && e.targetBlockId);
    const groups = new Map<string | null, DestGroup>();

    for (const edge of edges) {
      const entry = edge.targetBlockId!;
      const dest = traceToNextChoice(entry, boundary);
      const key = dest ? canon(dest) : null;
      const group = groups.get(key) ?? { labels: [], entryIds: [], actualDest: dest };
      group.labels.push(getOptionLabel(edge));
      group.entryIds.push(entry);
      groups.set(key, group);
    }
    return groups;
  };

  const resolveConvergence = (
    convergeBlockId: string,
    entries: ChoiceMapEntry[],
    until: string | null,
    depth = 0,
  ): string | null => {
    let blockId: string | null = convergeBlockId;
    const vis = new Set<string>();

    while (blockId && !vis.has(blockId)) {
      vis.add(blockId);

      if (isChoice(blockId)) return blockId;

      const edges = edgesBySource.get(blockId) ?? [];
      if (edges.length === 0 || edges.some(e => e.kind === "GameEnd")) return null;
      if (edges.some(e => e.kind === "GotoScene" && !e.targetBlockId)) {
        const scene = sceneOf(blockId);
        warnings.push(`resolveConvergence: unresolved *goto_scene at ${blockId} (${scene}) — cannot follow path`);
        return null;
      }

      const ifs = edges.filter(isBranchEdge);
      if (ifs.length > 0) {
        const branchInfos: {
          conditionStatementId: string | null;
          isElse: boolean;
          choice: string | null;
        }[] = [];
        for (const edge of ifs) {
          if (!edge.targetBlockId) continue;
          branchInfos.push({
            conditionStatementId: edge.metadata.conditionStatementId ?? null,
            isElse: edge.kind === "ElseBranch" || edge.kind === "ElseIfBranch" || edge.kind === "IfFallThrough",
            choice: findFirstChoice(edge.targetBlockId),
          });
        }

        const withChoice = branchInfos.filter(b => b.choice !== null);
        const uniqueChoices = new Set(withChoice.map(b => canon(b.choice!)));

        if (uniqueChoices.size <= 1) {
          if (uniqueChoices.size === 1) return withChoice[0].choice;
          const div = pathAnalysis.divergences[blockId];
          if (div?.convergeBlockId) { blockId = div.convergeBlockId; continue; }
          return null;
        }

        const splitNum = ++nextNum;
        numByCanonical.set(blockId, splitNum);
        splitBlockIds.add(blockId);
        entries.push({
          kind: "conditional-split",
          blockId,
          num: splitNum,
          branches: withChoice.map(b => ({
            conditionStatementId: b.conditionStatementId,
            isElse: b.isElse,
            choiceBlockId: b.choice!,
            choiceCanonicalId: canon(b.choice!),
            children: walkFrom(b.choice!, until, depth + 1),
          })),
        });
        return null;
      }

      const linear = edges.filter(e =>
        e.targetBlockId && !isChoiceOptionEdge(e.kind) && e.kind !== "GameEnd",
      );
      blockId = linear.length >= 1 ? linear[0].targetBlockId : null;
    }

    return null;
  };

  const findAllFirstChoices = (from: string): string[] => {
    const choices: string[] = [];
    const vis = new Set<string>();
    const q = [from];
    while (q.length > 0) {
      const id = q.shift()!;
      if (vis.has(id)) continue;
      vis.add(id);
      if (isChoice(id)) { choices.push(id); continue; }
      for (const e of edgesBySource.get(id) ?? []) {
        if (e.targetBlockId && !vis.has(e.targetBlockId) && !isChoiceOptionEdge(e.kind) && e.kind !== "GameEnd")
          q.push(e.targetBlockId);
      }
    }
    return choices;
  };

  const computeDepthCeilings = (): Map<string, number> => {
    const ceilings = new Map<string, number>();
    const queue: [string, number][] = [];

    for (const c of findAllFirstChoices(cfg.entryBlockId)) {
      queue.push([c, 0]);
    }

    while (queue.length > 0) {
      queue.sort((a, b) => a[1] - b[1]);
      const [choiceId, depth] = queue.shift()!;
      const c = canon(choiceId);

      if (ceilings.has(c) && ceilings.get(c)! <= depth) continue;
      ceilings.set(c, depth);

      const div = pathAnalysis.divergences[choiceId];
      const convergenceBlockId = div?.convergeBlockId ?? null;
      const convergenceCanons = new Set(
        convergenceBlockId
          ? findAllFirstChoices(convergenceBlockId).map(id => canon(id))
          : [],
      );

      const optionEdges = (edgesBySource.get(choiceId) ?? [])
        .filter(e => isChoiceOptionEdge(e.kind) && e.targetBlockId);
      const branchByEntry = new Map(div?.branches.map(b => [b.entryBlockId, b]) ?? []);

      const destsByCanon = new Map<string, { blockId: string; maxSize: number }>();
      for (const edge of optionEdges) {
        const entry = edge.targetBlockId!;
        const size = branchByEntry.get(entry)?.reachableChoices ?? 0;
        for (const fc of findAllFirstChoices(entry)) {
          const fc_c = canon(fc);
          if (fc_c === c) continue;
          const existing = destsByCanon.get(fc_c);
          if (!existing || size > existing.maxSize) {
            destsByCanon.set(fc_c, { blockId: fc, maxSize: size });
          }
        }
      }

      if (convergenceCanons.size > 0) {
        for (const [dc, info] of destsByCanon) {
          if (convergenceCanons.has(dc)) continue;
          if (!ceilings.has(dc) || depth + 1 < ceilings.get(dc)!)
            queue.push([info.blockId, depth + 1]);
        }
        for (const convChoice of (convergenceBlockId ? findAllFirstChoices(convergenceBlockId) : [])) {
          const cc = canon(convChoice);
          if (cc === c) continue;
          if (!ceilings.has(cc) || depth < ceilings.get(cc)!)
            queue.push([convChoice, depth]);
        }
      } else {
        const entries = [...destsByCanon.entries()];
        if (entries.length === 0) continue;

        entries.sort((a, b) => a[1].maxSize - b[1].maxSize);
        const main = entries[entries.length - 1];

        for (const [dc, info] of entries.slice(0, -1)) {
          if (!ceilings.has(dc) || depth + 1 < ceilings.get(dc)!)
            queue.push([info.blockId, depth + 1]);
        }
        if (!ceilings.has(main[0]) || depth < ceilings.get(main[0])!)
          queue.push([main[1].blockId, depth]);
      }
    }

    return ceilings;
  };

  const deferAboveDepth = computeDepthCeilings();
  console.log(`  ${deferAboveDepth.size} depth ceilings computed`);

  const visited = new Set<string>();
  const numByCanonical = new Map<string, number>();
  const splitBlockIds = new Set<string>();
  let nextNum = 0;

  const shouldDefer = (c: string, depth: number): boolean => {
    const maxDepth = deferAboveDepth.get(c);
    return maxDepth !== undefined && depth > maxDepth;
  };

  const walkFrom = (startBlockId: string, until: string | null, depth = 0): ChoiceMapEntry[] => {
    const entries: ChoiceMapEntry[] = [];
    let currentId: string | null = resolveConvergence(startBlockId, entries, until, depth);

    while (currentId) {
      if (isSplitPoint(currentId)) {
        currentId = resolveConvergence(currentId, entries, until, depth);
        continue;
      }

      const c = canon(currentId);
      if (until && c === until) break;
      if (shouldDefer(c, depth)) break;

      if (visited.has(c)) {
        entries.push({ kind: "ref", blockId: currentId, canonicalId: c, targetNum: numByCanonical.get(c)! });
        break;
      }

      visited.add(c);
      const num = ++nextNum;
      numByCanonical.set(c, num);

      const isHub = hubIds.has(currentId) || hubIds.has(c);
      entries.push({ kind: "choice", blockId: currentId, canonicalId: c, num, isHub });

      const dests = groupDests(currentId, until);
      const nullGroup = dests.get(null);
      if (nullGroup) {
        for (const entryId of nullGroup.entryIds) {
          const label = getOptionLabel(
            (edgesBySource.get(currentId) ?? []).find(
              e => isChoiceOptionEdge(e.kind) && e.targetBlockId === entryId,
            )!,
          );
          const children: ChoiceMapEntry[] = [];
          resolveConvergence(entryId, children, until, depth + 1);
          if (children.length > 0) {
            entries.push({
              kind: "branch",
              optionLabels: [label],
              fromChoiceNum: num,
              convergeBlockId: null,
              children,
            });
          }
        }
      }
      const activeKeys = [...dests.keys()].filter(
        (k): k is string => k !== null && k !== until && !shouldDefer(k, depth),
      );

      if (activeKeys.length === 0) {
        currentId = null;
      } else if (activeKeys.length === 1) {
        const group = dests.get(activeKeys[0])!;
        currentId = resolveConvergence(group.entryIds[0], entries, until, depth);
      } else if (isHub) {
        currentId = walkHub(currentId, c, num, dests, activeKeys, entries, until, depth);
      } else {
        currentId = walkDivergence(currentId, num, dests, activeKeys, entries, until, depth);
      }
    }

    return entries;
  };

  const walkHub = (
    choiceId: string,
    choiceCanon: string,
    num: number,
    dests: Map<string | null, DestGroup>,
    activeKeys: string[],
    entries: ChoiceMapEntry[],
    until: string | null,
    depth: number,
  ): string | null => {
    const div = pathAnalysis.divergences[choiceId];
    const branchByEntry = new Map(
      div?.branches.map(b => [b.entryBlockId, b]) ?? [],
    );

    const loopBacks: DestGroup[] = [];
    const exits: { group: DestGroup; size: number }[] = [];

    for (const key of activeKeys) {
      if (key === choiceCanon) continue;
      const group = dests.get(key)!;
      const isLoopBack = group.entryIds.some(
        e => branchByEntry.get(e)?.isLoopBack ?? false,
      );
      if (isLoopBack) {
        loopBacks.push(group);
      } else {
        const size = Math.max(
          ...group.entryIds.map(e => branchByEntry.get(e)?.reachableChoices ?? 0),
          0,
        );
        exits.push({ group, size });
      }
    }

    for (const group of loopBacks) {
      if (group.actualDest) {
        entries.push({
          kind: "branch",
          optionLabels: group.labels,
          fromChoiceNum: num,
          convergeBlockId: choiceId,
          children: walkFrom(group.entryIds[0], choiceCanon, depth + 1),
        });
      }
    }

    if (exits.length === 0) return null;
    if (exits.length === 1) return exits[0].group.actualDest;

    const converge = div?.convergeBlockId ?? null;
    if (converge) {
      const convergeCanon = canon(converge);
      exits.sort((a, b) => a.size - b.size);
      for (const { group } of exits) {
        if (group.actualDest) {
          entries.push({
            kind: "branch",
            optionLabels: group.labels,
            fromChoiceNum: num,
            convergeBlockId: converge,
            children: walkFrom(group.entryIds[0], convergeCanon, depth + 1),
          });
        }
      }
      return resolveConvergence(converge, entries, until, depth);
    }

    exits.sort((a, b) => a.size - b.size);
    const main = exits[exits.length - 1];
    for (const { group } of exits.slice(0, -1)) {
      if (group.actualDest) {
        entries.push({
          kind: "branch",
          optionLabels: group.labels,
          fromChoiceNum: num,
          convergeBlockId: null,
          children: walkFrom(group.entryIds[0], until, depth + 1),
        });
      }
    }
    return main.group.actualDest;
  };

  const walkDivergence = (
    choiceId: string,
    num: number,
    dests: Map<string | null, DestGroup>,
    activeKeys: string[],
    entries: ChoiceMapEntry[],
    until: string | null,
    depth: number,
  ): string | null => {
    const div = pathAnalysis.divergences[choiceId];
    const branchByEntry = new Map(
      div?.branches.map(b => [b.entryBlockId, b]) ?? [],
    );
    const converge = div?.convergeBlockId ?? null;

    const sorted = activeKeys.map(key => {
      const group = dests.get(key)!;
      const size = Math.max(
        ...group.entryIds.map(e => branchByEntry.get(e)?.reachableChoices ?? 0),
        0,
      );
      return { key, group, size };
    });

    if (converge) {
      const convergeCanon = canon(converge);
      sorted.sort((a, b) => a.size - b.size);
      for (const { group } of sorted) {
        if (group.actualDest) {
          entries.push({
            kind: "branch",
            optionLabels: group.labels,
            fromChoiceNum: num,
            convergeBlockId: converge,
            children: walkFrom(group.entryIds[0], convergeCanon, depth + 1),
          });
        }
      }
      return resolveConvergence(converge, entries, until, depth);
    }

    sorted.sort((a, b) => a.size - b.size);
    const main = sorted[sorted.length - 1];
    for (const { group } of sorted.slice(0, -1)) {
      if (group.actualDest) {
        entries.push({
          kind: "branch",
          optionLabels: group.labels,
          fromChoiceNum: num,
          convergeBlockId: null,
          children: walkFrom(group.entryIds[0], until, depth + 1),
        });
      }
    }
    return main?.group.actualDest ?? null;
  };

  const countChoices = (entries: ChoiceMapEntry[]): number => {
    let n = 0;
    for (const e of entries) {
      switch (e.kind) {
        case "choice": n++; break;
        case "branch": n += countChoices(e.children); break;
        case "conditional-split":
          for (const b of e.branches) n += countChoices(b.children);
          break;
      }
    }
    return n;
  };

  const computeLengths = (entries: ChoiceMapEntry[]): void => {
    for (const e of entries) {
      switch (e.kind) {
        case "choice":
          e.length = 1;
          break;
        case "ref":
          e.length = 0;
          break;
        case "branch":
          computeLengths(e.children);
          e.length = countChoices(e.children);
          break;
        case "conditional-split":
          for (const b of e.branches) computeLengths(b.children);
          e.length = e.branches.reduce(
            (sum, b) => sum + countChoices(b.children), 0,
          );
          break;
      }
    }
  };

  const findScopeViolations = (tree: ChoiceMapEntry[]): Set<string> => {
    const violated = new Set<string>();
    const choiceDepths = new Map<string, number>();

    const collectDepths = (es: ChoiceMapEntry[], d: number) => {
      for (const e of es) {
        if (e.kind === "choice") choiceDepths.set(e.canonicalId, d);
        else if (e.kind === "branch") collectDepths(e.children, d + 1);
        else if (e.kind === "conditional-split")
          for (const b of e.branches) collectDepths(b.children, d + 1);
      }
    };
    collectDepths(tree, 0);

    const checkRefs = (es: ChoiceMapEntry[], d: number) => {
      for (const e of es) {
        if (e.kind === "ref") {
          const targetDepth = choiceDepths.get(e.canonicalId);
          if (targetDepth !== undefined && d < targetDepth) {
            violated.add(e.canonicalId);
          }
        } else if (e.kind === "branch") checkRefs(e.children, d + 1);
        else if (e.kind === "conditional-split")
          for (const b of e.branches) checkRefs(b.children, d + 1);
      }
    };
    checkRefs(tree, 0);

    return violated;
  };

  let entries = walkFrom(cfg.entryBlockId, null);

  // Some pre-computed ceilings may be unreachable — the tree structure can't
  // reach the choice at the pre-computed depth. Drop those ceilings so the
  // choice is placed at its natural depth, then iterate to fix any resulting
  // violations (usually 2-3 passes vs 8+ without pre-computation).
  let droppedCeilings = 0;
  for (const [c] of deferAboveDepth) {
    if (!visited.has(c)) { deferAboveDepth.delete(c); droppedCeilings++; }
  }
  if (droppedCeilings > 0) {
    console.log(`  ${droppedCeilings} unreachable ceiling(s) dropped, re-walking...`);
    visited.clear();
    numByCanonical.clear();
    nextNum = 0;
    warnings.length = 0;
    entries = walkFrom(cfg.entryBlockId, null);
  }

  for (let pass = 0; pass < 5; pass++) {
    const violations = findScopeViolations(entries);
    if (violations.size === 0) break;
    console.log(`  pass ${pass}: ${violations.size} violation(s)`);

    const refDepths = new Map<string, number>();
    const collectRefDepths = (es: ChoiceMapEntry[], d: number) => {
      for (const e of es) {
        if (e.kind === "ref") {
          const prev = refDepths.get(e.canonicalId);
          if (prev === undefined || d < prev) refDepths.set(e.canonicalId, d);
        }
        if (e.kind === "branch") collectRefDepths(e.children, d + 1);
        else if (e.kind === "conditional-split")
          for (const b of e.branches) collectRefDepths(b.children, d + 1);
      }
    };
    collectRefDepths(entries, 0);

    for (const c of violations) {
      const refD = refDepths.get(c) ?? 0;
      const prev = deferAboveDepth.get(c);
      if (prev === undefined || refD < prev) deferAboveDepth.set(c, refD);
    }

    visited.clear();
    numByCanonical.clear();
    nextNum = 0;
    warnings.length = 0;
    entries = walkFrom(cfg.entryBlockId, null);

    for (const [c] of deferAboveDepth) {
      if (!visited.has(c)) deferAboveDepth.delete(c);
    }
  }

  computeLengths(entries);
  return { entries, choiceCount: nextNum, numByCanonical, splitBlockIds, warnings };
}
