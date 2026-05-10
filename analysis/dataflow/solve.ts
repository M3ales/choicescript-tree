import { ControlFlowGraph, Transition, isChoiceOptionEdge } from "../control-flow-graph/data";
import { BlockResolver, sceneOf } from "../control-flow-graph/cfg-io";
import { Statement } from "../../parser/statements";
import { narrowState } from "./narrow";
import { evaluateExpression } from "./evaluate-expression";
import { applyBlock } from "./transfer";
import {
  VariableState,
  emptyState,
  joinStates,
  cloneState,
  setVariable,
} from "./variable-state";

export interface SolverResult {
  entryStates: Map<string, VariableState>;
  exitStates: Map<string, VariableState>;
  iterations: number;
}

export const solve = (
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): SolverResult => {
  const successors = buildSuccessors(cfg);
  const order = computeTopologicalOrder(cfg.entryBlockId, successors, Object.keys(cfg.blocks), cfg.sceneOrder);
  const predecessors = buildPredecessors(cfg);

  const exitStates = new Map<string, VariableState>();
  const entryStates = new Map<string, VariableState>();

  for (const blockId of order) {
    if (!cfg.blocks[blockId]) continue;

    let incoming: VariableState;

    if (blockId === cfg.entryBlockId) {
      incoming = emptyState();
    } else {
      incoming = computeIncomingState(
        blockId, predecessors, exitStates, cfg, statements, resolver,
      );
    }

    const blockStmts = resolveStatements(blockId, cfg, resolver, statements);
    const exitState = applyBlock(incoming, blockStmts, sceneOf(blockId));

    entryStates.set(blockId, incoming);
    exitStates.set(blockId, exitState);
  }

  return { entryStates, exitStates, iterations: order.length };
};

const buildSuccessors = (cfg: ControlFlowGraph): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  for (const edge of cfg.edges) {
    if (!edge.targetBlockId) continue;
    let s = map.get(edge.sourceBlockId);
    if (!s) { s = new Set(); map.set(edge.sourceBlockId, s); }
    s.add(edge.targetBlockId);
  }
  return map;
};

const buildPredecessors = (
  cfg: ControlFlowGraph,
): Map<string, Array<{ blockId: string; edges: Transition[] }>> => {
  const map = new Map<string, Array<{ blockId: string; edges: Transition[] }>>();
  for (const edge of cfg.edges) {
    if (!edge.targetBlockId) continue;
    let preds = map.get(edge.targetBlockId);
    if (!preds) { preds = []; map.set(edge.targetBlockId, preds); }
    let entry = preds.find(p => p.blockId === edge.sourceBlockId);
    if (!entry) { entry = { blockId: edge.sourceBlockId, edges: [] }; preds.push(entry); }
    entry.edges.push(edge);
  }
  return map;
};

const computeIncomingState = (
  blockId: string,
  predecessors: Map<string, Array<{ blockId: string; edges: Transition[] }>>,
  exitStates: Map<string, VariableState>,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
): VariableState => {
  let result: VariableState | null = null;
  const blockScene = sceneOf(blockId);
  const block = resolver.resolve(cfg.blocks[blockId]);

  const preds = predecessors.get(blockId);
  if (preds) {
    for (const pred of preds) {
      const predExitState = exitStates.get(pred.blockId);
      if (!predExitState) continue;

      if (!cfg.blocks[pred.blockId]) continue;
      const predScene = sceneOf(pred.blockId);

      const edges = pred.edges.filter(e => !e.metadata.implicitControlFlow);
      if (edges.length === 0) continue;

      let stateForEdge = predExitState;

      for (const edge of edges) {
        stateForEdge = applyEdgeNarrowing(stateForEdge, edge, predScene, statements);
      }

      if (predScene !== blockScene) {
        const crossSceneState = emptyState();
        for (const [k, v] of stateForEdge.globals) {
          crossSceneState.globals.set(k, v);
        }
        stateForEdge = crossSceneState;
      }

      // Bind gosub args to parameter names as temp variables
      if (block?.parameterNames && block.parameterNames.length > 0) {
        const gosubStmt = findGoSubStatement(pred.blockId, resolver, cfg, statements);
        if (gosubStmt?.args) {
          for (let i = 0; i < block.parameterNames.length; i++) {
            const paramName = block.parameterNames[i];
            const argExpr = gosubStmt.args[i];
            if (argExpr) {
              const argVal = evaluateExpression(argExpr, predExitState, predScene);
              stateForEdge = setVariable(stateForEdge, paramName, argVal, "Temporary", blockScene);
            }
          }
        }
      }

      result = result ? joinStates(result, stateForEdge) : cloneState(stateForEdge);
    }
  }

  return result ?? emptyState();
};

const computeTopologicalOrder = (
  entryBlockId: string,
  successors: Map<string, Set<string>>,
  allBlockIds: string[],
  sceneOrder: string[],
): string[] => {
  const visited = new Set<string>();
  const postorder: string[] = [];

  const dfs = (blockId: string) => {
    if (visited.has(blockId)) return;
    visited.add(blockId);
    const succs = successors.get(blockId);
    if (succs) {
      for (const succId of succs) {
        if (!visited.has(succId)) dfs(succId);
      }
    }
    postorder.push(blockId);
  };

  dfs(entryBlockId);
  const reachableOrder = postorder.splice(0).reverse();

  const sceneIndex = new Map(sceneOrder.map((s, i) => [s, i]));
  const remaining = allBlockIds
    .filter((id) => !visited.has(id))
    .sort((a, b) => {
      const sa = a.split(":")[0];
      const sb = b.split(":")[0];
      return (sceneIndex.get(sa) ?? Infinity) - (sceneIndex.get(sb) ?? Infinity);
    });

  for (const blockId of remaining) {
    if (!visited.has(blockId)) dfs(blockId);
  }
  const remainingOrder = postorder.reverse();

  return [...reachableOrder, ...remainingOrder];
};

const applyEdgeNarrowing = (
  state: VariableState,
  edge: Transition,
  scene: string,
  statements: Record<string, Statement>
): VariableState => {
  const kind = edge.kind;

  const condStmtId = edge.metadata.conditionStatementId;
  if (condStmtId == null) return state;

  const condStmt = statements[condStmtId] as any;
  if (!condStmt) return state;

  if (isChoiceOptionEdge(kind)) {
    const condition = condStmt.selectableIf;
    if (!condition) return state;
    return narrowState(state, condition, true, scene);
  }

  if (
    kind !== "IfBranch" &&
    kind !== "ElseIfBranch" &&
    kind !== "ElseBranch" &&
    kind !== "IfFallThrough"
  ) {
    return state;
  }

  const condition = condStmt.expression;
  if (!condition) return state;

  if (kind === "IfBranch" || kind === "ElseIfBranch") {
    return narrowState(state, condition, true, scene);
  }

  if (kind === "ElseBranch" || kind === "IfFallThrough") {
    return narrowState(state, condition, false, scene);
  }

  return state;
};

const resolveStatements = (
  blockId: string,
  cfg: ControlFlowGraph,
  resolver: BlockResolver,
  statements: Record<string, Statement>,
): Statement[] => {
  const ref = cfg.blocks[blockId];
  if (!ref) return [];
  const block = resolver.resolve(ref);
  if (!block) return [];
  const result: Statement[] = [];
  for (const qualifiedId of block.statementIds) {
    const stmt = statements[qualifiedId];
    if (stmt) result.push(stmt);
  }
  return result;
};

const findGoSubStatement = (
  blockId: string,
  resolver: BlockResolver,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
): any | null => {
  const ref = cfg.blocks[blockId];
  if (!ref) return null;
  const block = resolver.resolve(ref);
  if (!block) return null;
  for (let i = block.statementIds.length - 1; i >= 0; i--) {
    const stmt = statements[block.statementIds[i]];
    if (stmt && (stmt.kind === "GoSub" || stmt.kind === "GoSubScene")) {
      return stmt;
    }
  }
  return null;
};
