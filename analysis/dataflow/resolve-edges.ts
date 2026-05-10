import { ControlFlowGraph } from "../control-flow-graph/data";
import { BlockResolver, sceneOf } from "../control-flow-graph/cfg-io";
import { Statement } from "../../parser/statements";
import { evaluateExpression } from "./evaluate-expression";
import { VariableState } from "./variable-state";
import { ResolvedEdge } from "./dataflow-result";

export const resolveEdges = (
  cfg: ControlFlowGraph,
  exitStates: Map<string, VariableState>,
  statements: Record<string, Statement>,
  resolver: BlockResolver
): { resolved: ResolvedEdge[]; unresolved: string[] } => {
  const resolved: ResolvedEdge[] = [];
  const unresolved: string[] = [];

  for (const edge of cfg.edges) {
    if (edge.targetBlockId !== null) continue;
    if (!edge.metadata.dynamicExpression) {
      unresolved.push(edge.id);
      continue;
    }

    const sourceBlock = cfg.blocks[edge.sourceBlockId];
    if (!sourceBlock) {
      unresolved.push(edge.id);
      continue;
    }

    const exitState = exitStates.get(edge.sourceBlockId);
    if (!exitState) {
      unresolved.push(edge.id);
      continue;
    }

    // Find the goto/gosub statement in this block
    const gotoStmt = findDynamicGotoStatement(edge.sourceBlockId, cfg, statements, resolver);
    if (!gotoStmt) {
      unresolved.push(edge.id);
      continue;
    }

    const dynamicExpr = extractDynamicExpression(gotoStmt);
    if (!dynamicExpr) {
      unresolved.push(edge.id);
      continue;
    }

    const value = evaluateExpression(dynamicExpr, exitState, sceneOf(edge.sourceBlockId));

    const possibleValues = extractPossibleStrings(value);
    if (possibleValues.length === 0) {
      unresolved.push(edge.id);
      continue;
    }

    const targets = resolveTargets(
      possibleValues,
      gotoStmt,
      edge,
      cfg,
      resolver
    );

    if (targets.length > 0) {
      resolved.push({
        originalEdgeId: edge.id,
        sourceBlockId: edge.sourceBlockId,
        resolvedTargets: targets,
      });
    } else {
      unresolved.push(edge.id);
    }
  }

  return { resolved, unresolved };
};

const findDynamicGotoStatement = (
  blockId: string,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver
): Statement | null => {
  const ref = cfg.blocks[blockId];
  if (!ref) return null;
  const block = resolver.resolve(ref);
  if (!block) return null;
  for (let i = block.statementIds.length - 1; i >= 0; i--) {
    const stmt = statements[block.statementIds[i]];
    if (!stmt) continue;
    if (
      stmt.kind === "GotoLabel" ||
      stmt.kind === "GotoScene" ||
      stmt.kind === "GoSub" ||
      stmt.kind === "GoSubScene"
    ) {
      return stmt;
    }
  }
  return null;
};

const extractDynamicExpression = (stmt: any): any | null => {
  if (stmt.kind === "GotoLabel" || stmt.kind === "GoSub") {
    if (stmt.label && stmt.label.kind) return stmt.label;
    return null;
  }
  if (stmt.kind === "GotoScene" || stmt.kind === "GoSubScene") {
    if (stmt.label && stmt.label.kind) return stmt.label;
    return null;
  }
  return null;
};

const extractPossibleStrings = (
  value: { kind: string; value?: any; values?: any[] }
): string[] => {
  if (value.kind === "constant" && typeof value.value === "string") {
    return [value.value];
  }
  if (value.kind === "set") {
    return value.values!
      .filter((v: any) => typeof v === "string")
      .map((v: any) => String(v));
  }
  return [];
};

const resolveTargets = (
  possibleLabels: string[],
  stmt: any,
  edge: { sourceBlockId: string; metadata: { targetScene?: string } },
  cfg: ControlFlowGraph,
  resolver: BlockResolver
): { targetBlockId: string; value: string }[] => {
  const targets: { targetBlockId: string; value: string }[] = [];

  for (const label of possibleLabels) {
    if (stmt.kind === "GotoScene" || stmt.kind === "GoSubScene") {
      // Dynamic label within a known target scene
      const targetScene = edge.metadata.targetScene ?? (stmt.scene?.value);
      if (!targetScene) continue;
      const matchingBlock = findLabelInScene(cfg, targetScene, label, resolver);
      if (matchingBlock) {
        targets.push({ targetBlockId: matchingBlock, value: label });
      }
    } else {
      // Dynamic label within the same scene as the source block
      const sourceBlockScene = sceneOf(edge.sourceBlockId);
      const matchingBlock = findLabelInScene(cfg, sourceBlockScene, label, resolver);
      if (matchingBlock) {
        targets.push({ targetBlockId: matchingBlock, value: label });
      }
    }
  }

  return targets;
};

const findLabelInScene = (
  cfg: ControlFlowGraph,
  scene: string,
  label: string,
  resolver: BlockResolver
): string | null => {
  for (const [blockId, ref] of Object.entries(cfg.blocks)) {
    if (sceneOf(blockId) === scene) {
      const block = resolver.resolve(ref);
      if (block?.label === label) return blockId;
    }
  }
  return null;
};
