import { Statement } from "../../../parser/statements";
import { AnalysisError } from "../../errors";
import { LinkedCfgs, CfgExit } from "../data";
import { CodeBlock } from "../../control-flow-graph/data/code-block";
import { TransitionKind } from "../../control-flow-graph/data/transition-kind";
import { Transition } from "../../control-flow-graph/data/transition";
import { SceneControlFlowGraph } from "../../control-flow-graph/build-scene/scene-control-flow-graph";

export interface NavigationError extends AnalysisError {
  targetScene?: string;
  targetLabel?: string;
}

const navigationExitKinds: Set<TransitionKind> = new Set([
  "Goto", "GotoScene", "GoSubCall", "GoSubSceneCall",
]);

const lastStatementInBlock = (
  blockId: string,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): Statement | undefined => {
  const block = blockIndex[blockId];
  if (!block || block.statementIds.length === 0) return undefined;
  const lastId = block.statementIds[block.statementIds.length - 1];
  return statements[lastId];
};

export const checkUnresolvedLocalEdges = (
  sceneCfg: SceneControlFlowGraph,
  statements: Record<string, Statement>,
): NavigationError[] => {
  const errors: NavigationError[] = [];

  for (const edge of sceneCfg.unresolvedEdges) {
    if (edge.metadata.dynamicExpression) continue;

    const stmt = lastStatementInBlock(edge.sourceBlockId, sceneCfg.blockIndex, statements);
    if (!stmt) continue;

    const label = edge.metadata.label;
    if (label) {
      errors.push({
        message: `Label "${label}" not found in scene "${sceneCfg.sceneName}"`,
        statement: stmt,
        severity: "Error",
        solutionCode: 0,
        targetLabel: label,
        context: {},
      });
    }
  }

  return errors;
};

export const checkUnresolvedExits = (
  linked: LinkedCfgs,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  sceneCfgs: Map<string, SceneControlFlowGraph>,
): NavigationError[] => {
  const errors: NavigationError[] = [];

  for (const exit of linked.unresolvedExits) {
    if (exit.metadata.dynamicExpression) continue;
    if (!navigationExitKinds.has(exit.kind)) continue;

    const stmt = lastStatementInBlock(exit.blockId, blockIndex, statements);
    if (!stmt) continue;

    const targetScene = exit.metadata.targetScene;
    const targetLabel = exit.metadata.targetSceneLabel ?? exit.metadata.label;

    if (targetScene && targetLabel) {
      const foundInScenes: { scene: string; line: number }[] = [];
      for (const [name, cfg] of sceneCfgs) {
        if (name.toLowerCase() === targetScene.toLowerCase()) continue;
        const blockId = cfg.labelToBlockId[targetLabel];
        if (blockId !== undefined) {
          const block = cfg.blockIndex[blockId];
          const firstStmtId = block?.statementIds[0];
          const firstStmt = firstStmtId ? statements[firstStmtId] : undefined;
          const line = (firstStmt as any)?.token?.lineNumber ?? 0;
          foundInScenes.push({ scene: name, line });
        }
      }
      errors.push({
        message: `Label "${targetLabel}" not found in scene "${targetScene}"`,
        statement: stmt,
        severity: "Error",
        solutionCode: 0,
        targetScene,
        targetLabel,
        context: { tryDownload: targetLabel, foundInScenes },
      });
    } else if (targetScene) {
      errors.push({
        message: `Scene "${targetScene}" not found`,
        statement: stmt,
        severity: "Error",
        solutionCode: 1,
        targetScene,
        context: { tryFetchScene: targetScene },
      });
    } else if (targetLabel) {
      errors.push({
        message: `Label "${targetLabel}" not found`,
        statement: stmt,
        severity: "Error",
        solutionCode: 0,
        targetLabel,
        context: {},
      });
    }
  }

  return errors;
};

export const checkNavigation = (
  linked: LinkedCfgs,
  sceneCfgs: Map<string, SceneControlFlowGraph>,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
): NavigationError[] => {
  const errors: NavigationError[] = [];

  for (const [, sceneCfg] of sceneCfgs) {
    errors.push(...checkUnresolvedLocalEdges(sceneCfg, statements));
  }

  errors.push(...checkUnresolvedExits(linked, blockIndex, statements, sceneCfgs));

  return errors;
};
