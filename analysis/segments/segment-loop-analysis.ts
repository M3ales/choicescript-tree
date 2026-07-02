import { SegmentGraph, SegmentEdge, SegmentEntry, VariableEffect, DrainTag } from "./data";
import { getOrSet } from "../control-flow-graph/graph-utils";

// ── Tarjan's SCC ─────────────────────────────────────────────────────────────

export interface SccResult {
  components: string[][];
  succs: Map<string, Set<string>>;
}

export const tarjanScc = (graph: SegmentGraph): SccResult => {
  const succs = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    getOrSet(succs, edge.sourceSegmentId, () => new Set<string>()).add(edge.targetSegmentId);
  }

  const ids = Object.keys(graph.segments);
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  const strongConnect = (v: string): void => {
    const vStack: Array<{ node: string; succIter: Iterator<string> }> = [];
    let current = v;

    outer: while (true) {
      if (!index.has(current)) {
        index.set(current, nextIndex);
        lowlink.set(current, nextIndex);
        nextIndex++;
        stack.push(current);
        onStack.add(current);
      }

      const succSet = succs.get(current);
      let iter: Iterator<string>;
      const frame = vStack.length > 0 ? vStack[vStack.length - 1] : null;
      if (frame && frame.node === current) {
        iter = frame.succIter;
      } else {
        iter = succSet ? succSet[Symbol.iterator]() : [][Symbol.iterator]();
        vStack.push({ node: current, succIter: iter });
      }

      while (true) {
        const next = iter.next();
        if (next.done) break;
        const w = next.value;

        if (!index.has(w)) {
          current = w;
          continue outer;
        } else if (onStack.has(w)) {
          lowlink.set(current, Math.min(lowlink.get(current)!, index.get(w)!));
        }
      }

      if (lowlink.get(current) === index.get(current)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== current);
        components.push(component);
      }

      vStack.pop();
      if (vStack.length === 0) break;

      const parent = vStack[vStack.length - 1];
      lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(current)!));
      current = parent.node;
    }
  };

  for (const id of ids) {
    if (!index.has(id)) strongConnect(id);
  }

  return { components, succs };
};

// ── Segment loop classification ──────────────────────────────────────────────

export type SegmentLoopBound =
  | "choice-bounded"
  | "condition-bounded"
  | "unbounded";

export interface SegmentLoop {
  headerIds: string[];
  memberIds: string[];
  backEdges: SegmentEdge[];
  exitEdges: SegmentEdge[];
  bound: SegmentLoopBound;
  infinite: boolean;
  choiceOptionCount: number | null;
  allHideReuse: boolean;
  iterCap: number;
  drainTags: DrainTag[];
}

export interface SegmentLoopAnalysis {
  loops: SegmentLoop[];
  segmentToLoop: Map<string, SegmentLoop>;
  acyclicOrder: string[];
}

export const analyseSegmentLoops = (graph: SegmentGraph): SegmentLoopAnalysis => {
  const { components, succs } = tarjanScc(graph);
  // Tarjan gives reverse topo — reverse for forward order
  components.reverse();

  // Build edge lookup by (source, target) for metadata access
  const edgesBySource = new Map<string, SegmentEdge[]>();
  for (const edge of graph.edges) {
    getOrSet(edgesBySource, edge.sourceSegmentId, () => []).push(edge);
  }

  const isCyclic = (scc: string[]): boolean => {
    if (scc.length > 1) return true;
    const s = succs.get(scc[0]);
    return s !== undefined && s.has(scc[0]);
  };

  const loops: SegmentLoop[] = [];
  const segmentToLoop = new Map<string, SegmentLoop>();
  const acyclicOrder: string[] = [];

  for (const scc of components) {
    if (!isCyclic(scc)) {
      acyclicOrder.push(scc[0]);
      continue;
    }

    const members = new Set(scc);

    // Headers: segments with incoming edges from outside the SCC
    const headerIds: string[] = [];
    for (const segId of scc) {
      const seg = graph.segments[segId];
      if (!seg) continue;
      if (segId === graph.entrySegmentId) {
        headerIds.push(segId);
        continue;
      }
      // Check if any predecessor is outside the SCC
      for (const edge of graph.edges) {
        if (edge.targetSegmentId === segId && !members.has(edge.sourceSegmentId)) {
          headerIds.push(segId);
          break;
        }
      }
    }

    // Back-edges: edges from SCC members back to headers (closing the loop)
    const backEdges: SegmentEdge[] = [];
    const headerSet = new Set(headerIds);
    for (const segId of scc) {
      for (const edge of edgesBySource.get(segId) ?? []) {
        if (headerSet.has(edge.targetSegmentId) && members.has(edge.sourceSegmentId)) {
          backEdges.push(edge);
        }
      }
    }

    // Exit edges: edges from SCC members to segments outside the SCC
    const exitEdges: SegmentEdge[] = [];
    for (const segId of scc) {
      for (const edge of edgesBySource.get(segId) ?? []) {
        if (!members.has(edge.targetSegmentId)) {
          exitEdges.push(edge);
        }
      }
    }

    // Classify: check metadata on back-edges and internal edges
    // Count unique choice options entering the SCC (potential iteration bound)
    const choiceOptionEntries = new Set<string>();
    let allHideReuse = true;
    let hasAnyReuse = false;

    for (const segId of scc) {
      const seg = graph.segments[segId];
      if (!seg) continue;
      for (const entry of seg.entries) {
        if (entry.kind === "choice-option") {
          choiceOptionEntries.add(entry.blockId);
          const reuse = entry.metadata?.effectiveReuse;
          if (reuse === "hide_reuse" || reuse === "disable_reuse") {
            hasAnyReuse = true;
          } else {
            allHideReuse = false;
          }
        }
      }
    }

    // Also check back-edge metadata for reuse
    for (const edge of backEdges) {
      const reuse = edge.metadata?.effectiveReuse;
      if (reuse === "hide_reuse" || reuse === "disable_reuse") {
        hasAnyReuse = true;
      }
    }

    let bound: SegmentLoopBound;
    let choiceOptionCount: number | null = null;

    let drainTags: DrainTag[] = [];

    if (choiceOptionEntries.size > 0 && allHideReuse && hasAnyReuse) {
      bound = "choice-bounded";
      choiceOptionCount = choiceOptionEntries.size;
    } else if (hasConditionGuard(backEdges)) {
      bound = "condition-bounded";
      drainTags = detectDrainTags(scc, graph);
      if (drainTags.length > 0) {
        bound = "choice-bounded";
        choiceOptionCount = drainTags.length;
      }
    } else {
      bound = "unbounded";
    }

    const infinite = exitEdges.length === 0;

    let iterCap: number;
    if (infinite) {
      iterCap = 1;
    } else if (bound === "choice-bounded" && choiceOptionCount !== null) {
      iterCap = choiceOptionCount + 2;
    } else if (bound === "condition-bounded") {
      iterCap = 8;
    } else {
      iterCap = 3;
    }

    const loop: SegmentLoop = {
      headerIds,
      memberIds: scc,
      backEdges,
      exitEdges,
      bound,
      infinite,
      choiceOptionCount,
      allHideReuse: allHideReuse && hasAnyReuse,
      iterCap,
      drainTags,
    };

    loops.push(loop);
    for (const segId of scc) {
      segmentToLoop.set(segId, loop);
    }
    // Add SCC members in their natural order to acyclicOrder
    for (const segId of scc) {
      acyclicOrder.push(segId);
    }
  }

  return { loops, segmentToLoop, acyclicOrder };
};

// Check if any back-edge has a condition guard
const hasConditionGuard = (backEdges: SegmentEdge[]): boolean => {
  for (const edge of backEdges) {
    if (edge.metadata?.conditionStatementId || edge.metadata?.choiceConditionId) {
      return true;
    }
  }
  return false;
};

// ── Drain tag detection (structural pattern matching, no value computation) ──

const unwrapGrouping = (expr: any): any => {
  while (expr && expr.kind === "Grouping") expr = expr.expression;
  return expr;
};

const extractConditionVarName = (expr: any): string | null => {
  if (!expr) return null;
  if (expr.kind === "Identifier") return (expr.token?.value as string)?.toLowerCase() ?? null;
  return null;
};

const collectEntryTags = (
  cond: any,
  segEffects: VariableEffect[],
  segmentId: string,
): DrainTag[] => {
  if (!cond) return [];
  cond = unwrapGrouping(cond);
  if (!cond) return [];

  if (cond.kind === "Binary" && cond.operator?.type === "LogicalAnd") {
    return [
      ...collectEntryTags(cond.left, segEffects, segmentId),
      ...collectEntryTags(cond.right, segEffects, segmentId),
    ];
  }

  const boolTag = matchBooleanFlipTag(cond, segEffects, segmentId);
  if (boolTag) return [boolTag];

  const drainTag = matchMonotoneDrainTag(cond, segEffects, segmentId);
  if (drainTag) return [drainTag];

  return [];
};

const matchBooleanFlipTag = (
  cond: any,
  effects: VariableEffect[],
  segmentId: string,
): DrainTag | null => {
  if (cond.kind !== "Unary" || cond.operator?.type !== "NotOperator") return null;

  const inner = unwrapGrouping(cond.value);
  const varName = extractConditionVarName(inner);
  if (!varName) return null;

  const effect = effects.find(e => e.variable === varName);
  if (!effect) return null;

  const setsTrue = effect.ops.some(op => op.kind === "assign" && op.value === true);
  return setsTrue ? { kind: "boolean-flip", variable: varName, segmentId } : null;
};

const matchMonotoneDrainTag = (
  cond: any,
  segEffects: VariableEffect[],
  segmentId: string,
): DrainTag | null => {
  if (cond.kind !== "Binary") return null;
  const opType = cond.operator?.type;

  let varName: string | null = null;
  let threshold: number | null = null;

  if (opType === "GreaterThanEqualsOperator" || opType === "GreaterThanOperator") {
    varName = extractConditionVarName(unwrapGrouping(cond.left));
    const rhs = unwrapGrouping(cond.right);
    if (rhs?.kind === "Literal" && typeof rhs.value?.value === "number") {
      threshold = rhs.value.value;
      if (opType === "GreaterThanOperator") threshold += 1;
    }
  }

  if (!varName || threshold === null) return null;

  const effect = segEffects.find(e => e.variable === varName);
  if (!effect) return null;

  let drain = 0;
  let hasNonDrain = false;
  for (const op of effect.ops) {
    if (op.kind === "compound" && op.operator === "SubtractionOperator" && op.operand !== null && op.operand > 0) {
      drain += op.operand;
    } else {
      hasNonDrain = true;
    }
  }

  if (hasNonDrain || drain === 0) return null;

  return { kind: "monotone-drain", variable: varName, drain, threshold, segmentId };
};

const detectDrainTags = (
  scc: string[],
  graph: SegmentGraph,
): DrainTag[] => {
  const members = new Set(scc);
  const tags: DrainTag[] = [];
  let hasUnconditionedLoopingOption = false;

  for (const segId of scc) {
    const seg = graph.segments[segId];
    if (!seg) continue;
    for (const entry of seg.entries) {
      if (entry.kind !== "choice-option") continue;
      if (entry.selectableIf) {
        const entryTags = collectEntryTags(entry.selectableIf, seg.effects, segId);
        if (entryTags.length === 0) return [];
        tags.push(...entryTags);
      } else {
        const loopsBack = graph.edges.some(
          e => e.sourceSegmentId === segId && members.has(e.targetSegmentId),
        );
        if (loopsBack) hasUnconditionedLoopingOption = true;
      }
    }
  }

  if (tags.length === 0 || hasUnconditionedLoopingOption) return [];
  return tags;
};
