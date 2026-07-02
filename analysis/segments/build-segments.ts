import { LinkedCfgs, Cfg } from "../ref-cfg/data";
import { isChoiceOptionEdge, isGoSubCall } from "../control-flow-graph/data/transition-kind";
import { Transition } from "../control-flow-graph/data/transition";
import { CodeBlock } from "../control-flow-graph/data/code-block";
import { Statement } from "../../parser/statements";
import { ChoiceOptionStatement } from "../../parser/statements/choice-option";
import { extractEffect } from "../dataflow/extract-definitions";
import { getOrSet } from "../control-flow-graph/graph-utils";
import {
  Segment,
  SegmentEntry,
  SegmentExit,
  SegmentGraph,
  SegmentEdge,
  GosubBinding,
  VariableEffect,
  EffectOp,
} from "./data";

interface BlockLocation {
  cfgId: string;
  cfg: Cfg;
}

const buildBlockToCfg = (linked: LinkedCfgs): Map<string, BlockLocation> => {
  const map = new Map<string, BlockLocation>();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      map.set(blockId, { cfgId: cfg.id, cfg });
    }
  }
  return map;
};

const buildGlobalEdgesBySource = (linked: LinkedCfgs): Map<string, Transition[]> => {
  const map = new Map<string, Transition[]>();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const edge of cfg.edges) {
      getOrSet(map, edge.sourceBlockId, () => []).push(edge);
    }
  }
  return map;
};

interface SegmentSeed {
  entry: SegmentEntry;
  startBlockId: string;
}

const findSeeds = (
  linked: LinkedCfgs,
  blockToCfg: Map<string, BlockLocation>,
  edgesBySource: Map<string, Transition[]>,
): SegmentSeed[] => {
  const seeds: SegmentSeed[] = [];

  const entryCfg = linked.cfgs[linked.entryCfgId];
  if (entryCfg) {
    seeds.push({
      entry: {
        cfgId: linked.entryCfgId,
        blockId: entryCfg.entryBlockId,
        kind: "game-start",
      },
      startBlockId: entryCfg.entryBlockId,
    });
  }


  for (const cfg of Object.values(linked.cfgs)) {
    for (const edge of cfg.edges) {
      if (edge.kind === "InputReturn" && edge.targetBlockId) {
        const loc = blockToCfg.get(edge.targetBlockId);
        if (loc) {
          seeds.push({
            entry: {
              cfgId: loc.cfgId,
              blockId: edge.targetBlockId,
              kind: "input-continuation",
            },
            startBlockId: edge.targetBlockId,
          });
        }
        continue;
      }

      if (!isChoiceOptionEdge(edge.kind) || !edge.targetBlockId) continue;

      const loc = blockToCfg.get(edge.targetBlockId);
      if (!loc) continue;

      seeds.push({
        entry: {
          cfgId: loc.cfgId,
          blockId: edge.targetBlockId,
          kind: "choice-option",
          edgeKind: edge.kind,
          metadata: edge.metadata,
        },
        startBlockId: edge.targetBlockId,
      });
    }
  }

  return seeds;
};

interface FloodResult {
  blockIds: string[];
  exits: SegmentExit[];
  gosubBindings: GosubBinding[];
}

const floodFromBlock = (
  startBlockId: string,
  owningCfgId: string,
  linked: LinkedCfgs,
  blockToCfg: Map<string, BlockLocation>,
  edgesBySource: Map<string, Transition[]>,
): FloodResult => {
  const blockIds: string[] = [];
  const exits: SegmentExit[] = [];
  const gosubBindings: GosubBinding[] = [];
  const visitedBlocks = new Set<string>();

  const queue: string[] = [startBlockId];
  let qi = 0;

  while (qi < queue.length) {
    const blockId = queue[qi++];
    if (visitedBlocks.has(blockId)) continue;
    visitedBlocks.add(blockId);

    const loc = blockToCfg.get(blockId);
    if (!loc) continue;

    blockIds.push(blockId);

    const ref = loc.cfg.blocks[blockId];
    if (!ref) continue;

    if (ref.exitType === "Choice") {
      exits.push({ cfgId: loc.cfgId, blockId, kind: "choice" });
      continue;
    }

    if (ref.exitType === "Input") {
      exits.push({ cfgId: loc.cfgId, blockId, kind: "input" });
      continue;
    }

    if (ref.exitType === "Finish" || ref.exitType === "Ending" || ref.exitType === "ImplicitEnd") {
      exits.push({ cfgId: loc.cfgId, blockId, kind: "terminal" });
      continue;
    }

    const outEdges = edgesBySource.get(blockId) ?? [];
    for (const edge of outEdges) {
      if (isChoiceOptionEdge(edge.kind)) continue;

      if (edge.targetBlockId && !visitedBlocks.has(edge.targetBlockId)) {
        queue.push(edge.targetBlockId);
      }
    }

    for (const exit of loc.cfg.exits) {
      if (exit.blockId !== blockId) continue;

      if (exit.target.type === "terminal" || exit.kind === "GameEnd") {
        exits.push({ cfgId: loc.cfgId, blockId, kind: "terminal" });
        continue;
      }

      if (exit.target.type !== "cfg") continue;

      const targetCfg = linked.cfgs[exit.target.cfgId];
      if (!targetCfg) continue;

      if (isGoSubCall(exit.kind)) {
        gosubBindings.push({
          callerCfgId: loc.cfgId,
          callerBlockId: blockId,
          targetCfgId: exit.target.cfgId,
          continuationCfgId: exit.continuation && linked.cfgs[exit.continuation]
            ? exit.continuation
            : undefined,
        });
        queue.push(targetCfg.entryBlockId);
        if (exit.continuation) {
          const contCfg = linked.cfgs[exit.continuation];
          if (contCfg) queue.push(contCfg.entryBlockId);
        }
        continue;
      }

      queue.push(targetCfg.entryBlockId);
    }
  }

  return { blockIds, exits, gosubBindings };
};

const extractSegmentEffects = (
  blockIds: string[],
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): VariableEffect[] => {
  const byVar = new Map<string, EffectOp[]>();

  for (const blockId of blockIds) {
    const block = blockIndex[blockId];
    if (!block) continue;
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      const effect = extractEffect(stmt);
      if (!effect.defines) continue;

      const varName = effect.defines.variable.toLowerCase();
      const ops = getOrSet(byVar, varName, () => [] as EffectOp[]);

      if (!effect.defines.isCompoundAssignment) {
        const expr = effect.defines.valueExpression;
        const val = extractLiteralValue(expr);
        ops.push({ kind: "assign", value: val });
      } else {
        const compound = effect.defines.compoundExpression;
        if (compound && (compound as any).kind === "Binary") {
          const bin = compound as any;
          const opType = bin.operator?.type;
          const rhs = extractNumericLiteral(bin.right);
          ops.push({ kind: "compound", operator: opType ?? "?", operand: rhs });
        } else {
          ops.push({ kind: "compound", operator: "?", operand: null });
        }
      }
    }
  }

  return [...byVar.entries()].map(([variable, ops]) => ({ variable, ops }));
};

const extractLiteralValue = (expr: any): unknown => {
  if (!expr) return undefined;
  if (expr.kind === "Literal") return expr.value?.value;
  if (expr.kind === "Grouping") return extractLiteralValue(expr.expression);
  return undefined;
};

const extractNumericLiteral = (expr: any): number | null => {
  if (!expr) return null;
  if (expr.kind === "Literal" && typeof expr.value?.value === "number") return expr.value.value;
  if (expr.kind === "Grouping") return extractNumericLiteral(expr.expression);
  return null;
};

const resolveSelectableIf = (
  entry: SegmentEntry,
  statements: Record<string, Statement>,
): void => {
  const stmtId = entry.metadata?.conditionStatementId;
  if (!stmtId || entry.metadata?.choiceConditionKind !== "selectable_if") return;
  const stmt = statements[stmtId] as ChoiceOptionStatement | undefined;
  if (stmt?.selectableIf) {
    entry.selectableIf = stmt.selectableIf;
  }
};

const PASSTHROUGH_KINDS = new Set([
  "ChoiceOption", "GotoLabel", "GotoScene", "Label",
]);

const resolvePassthrough = (
  startBlockId: string,
  linked: LinkedCfgs,
  blockToCfg: Map<string, BlockLocation>,
  edgesBySource: Map<string, Transition[]>,
  blockIndex: Record<string, CodeBlock> | undefined,
  statements: Record<string, Statement> | undefined,
): string => {
  if (!blockIndex || !statements) return startBlockId;

  let current = startBlockId;
  const visited = new Set<string>();

  while (!visited.has(current)) {
    visited.add(current);

    const block = blockIndex[current];
    if (!block) break;

    const hasContent = block.statementIds.some(sid => {
      const stmt = statements[sid];
      return stmt != null && !PASSTHROUGH_KINDS.has(stmt.kind);
    });
    if (hasContent) break;

    const loc = blockToCfg.get(current);
    if (!loc) break;

    let nextBlock: string | null = null;
    for (const exit of loc.cfg.exits) {
      if (exit.blockId !== current) continue;
      if (exit.target.type === "cfg" && !isGoSubCall(exit.kind)) {
        const targetCfg = linked.cfgs[exit.target.cfgId];
        if (targetCfg) { nextBlock = targetCfg.entryBlockId; break; }
      }
    }

    if (!nextBlock) {
      const outEdges = (edgesBySource.get(current) ?? [])
        .filter(e => !isChoiceOptionEdge(e.kind) && e.targetBlockId);
      if (outEdges.length === 1) nextBlock = outEdges[0].targetBlockId!;
    }

    if (nextBlock) current = nextBlock;
    else break;
  }

  return current;
};

export const buildSegments = (
  linked: LinkedCfgs,
  blockIndex?: Record<string, CodeBlock>,
  statements?: Record<string, Statement>,
): SegmentGraph => {
  const blockToCfg = buildBlockToCfg(linked);
  const edgesBySource = buildGlobalEdgesBySource(linked);
  const seeds = findSeeds(linked, blockToCfg, edgesBySource);

  const segments: Record<string, Segment> = {};
  const segmentByEntry = new Map<string, string>();
  let nextId = 0;

  for (const seed of seeds) {
    const effectiveStart = resolvePassthrough(
      seed.startBlockId, linked, blockToCfg, edgesBySource, blockIndex, statements,
    );

    if (segmentByEntry.has(effectiveStart)) {
      const existingId = segmentByEntry.get(effectiveStart)!;
      if (statements) resolveSelectableIf(seed.entry, statements);
      seed.entry.blockId = effectiveStart;
      const effectiveLoc = blockToCfg.get(effectiveStart);
      if (effectiveLoc) seed.entry.cfgId = effectiveLoc.cfgId;
      segments[existingId].entries.push(seed.entry);
      continue;
    }

    const result = floodFromBlock(effectiveStart, seed.entry.cfgId, linked, blockToCfg, edgesBySource);
    const id = `seg_${nextId++}`;

    seed.entry.blockId = effectiveStart;
    const effectiveLoc = blockToCfg.get(effectiveStart);
    if (effectiveLoc) seed.entry.cfgId = effectiveLoc.cfgId;

    if (statements) resolveSelectableIf(seed.entry, statements);

    const effects = (blockIndex && statements)
      ? extractSegmentEffects(result.blockIds, blockIndex, statements)
      : [];

    segments[id] = {
      id,
      cfgId: seed.entry.cfgId,
      entries: [seed.entry],
      exits: result.exits,
      blockIds: result.blockIds,
      gosubBindings: result.gosubBindings,
      effects,
    };

    segmentByEntry.set(effectiveStart, id);
  }

  const edges: SegmentEdge[] = [];
  for (const segment of Object.values(segments)) {
    for (const exit of segment.exits) {
      if (exit.kind === "choice") {
        const outEdges = edgesBySource.get(exit.blockId) ?? [];
        for (const edge of outEdges) {
          if (!isChoiceOptionEdge(edge.kind) || !edge.targetBlockId) continue;

          const effectiveTarget = resolvePassthrough(
            edge.targetBlockId, linked, blockToCfg, edgesBySource, blockIndex, statements,
          );
          const targetSegId = segmentByEntry.get(effectiveTarget);
          if (targetSegId) {
            edges.push({
              sourceSegmentId: segment.id,
              targetSegmentId: targetSegId,
              exitBlockId: exit.blockId,
              entryBlockId: effectiveTarget,
              metadata: edge.metadata,
            });
          }
        }
      } else if (exit.kind === "input") {
        const outEdges = edgesBySource.get(exit.blockId) ?? [];
        for (const edge of outEdges) {
          if (edge.kind !== "InputReturn" || !edge.targetBlockId) continue;

          const targetSegId = segmentByEntry.get(edge.targetBlockId);
          if (targetSegId) {
            edges.push({
              sourceSegmentId: segment.id,
              targetSegmentId: targetSegId,
              exitBlockId: exit.blockId,
              entryBlockId: edge.targetBlockId,
            });
          }
        }
      }
    }
  }

  const entryCfg = linked.cfgs[linked.entryCfgId];
  const entrySegmentId = entryCfg
    ? segmentByEntry.get(entryCfg.entryBlockId) ?? Object.keys(segments)[0]
    : Object.keys(segments)[0];

  return { segments, edges, entrySegmentId };
};
