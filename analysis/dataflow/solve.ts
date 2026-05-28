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

export interface SolverCallbacks {
  onBlock?: (blockId: string, entryState: VariableState, exitState: VariableState) => void;
  pinnedBlocks?: Set<string>;
}

export interface SolverResult {
  exitStates: Map<string, VariableState>;
  iterations: number;
}

export const solve = (
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
  callbacks?: SolverCallbacks,
): SolverResult => {
  const successors = buildSuccessors(cfg);
  const order = computeTopologicalOrder(cfg.entryBlockId, successors, Object.keys(cfg.blocks), cfg.sceneOrder);
  const predecessors = buildPredecessors(cfg);

  const exitStates = new Map<string, VariableState>();

  const orderSet = new Set(order);
  const remainingSuccessors = new Map<string, number>();
  for (const blockId of order) {
    const succs = successors.get(blockId);
    let count = 0;
    if (succs) {
      for (const s of succs) {
        if (orderSet.has(s)) count++;
      }
    }
    remainingSuccessors.set(blockId, count);
  }

  const pinned = callbacks?.pinnedBlocks;
  const onBlock = callbacks?.onBlock;
  let evicted = 0;

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

    if (onBlock) onBlock(blockId, incoming, exitState);

    exitStates.set(blockId, exitState);

    const preds = predecessors.get(blockId);
    if (preds) {
      for (const pred of preds) {
        const rem = (remainingSuccessors.get(pred.blockId) ?? 0) - 1;
        remainingSuccessors.set(pred.blockId, rem);
        if (rem <= 0 && (!pinned || !pinned.has(pred.blockId))) {
          exitStates.delete(pred.blockId);
          evicted++;
        }
      }
    }
  }

  console.log(`  Evicted ${evicted} intermediate states`);

  return { exitStates, iterations: order.length };
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

const iterativeDfs = (
  startId: string,
  successors: Map<string, Set<string>>,
  visited: Set<string>,
  postorder: string[],
): void => {
  if (visited.has(startId)) return;
  const stack: Array<{ blockId: string; iter: Iterator<string> | null }> = [];
  visited.add(startId);
  const succs = successors.get(startId);
  stack.push({ blockId: startId, iter: succs ? succs.values() : null });

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    let pushed = false;
    if (frame.iter) {
      for (let next = frame.iter.next(); !next.done; next = frame.iter.next()) {
        const succId = next.value;
        if (!visited.has(succId)) {
          visited.add(succId);
          const s = successors.get(succId);
          stack.push({ blockId: succId, iter: s ? s.values() : null });
          pushed = true;
          break;
        }
      }
    }
    if (!pushed) {
      postorder.push(frame.blockId);
      stack.pop();
    }
  }
};

const computeTopologicalOrder = (
  entryBlockId: string,
  successors: Map<string, Set<string>>,
  allBlockIds: string[],
  sceneOrder: string[],
): string[] => {
  const visited = new Set<string>();
  const postorder: string[] = [];

  iterativeDfs(entryBlockId, successors, visited, postorder);
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
    iterativeDfs(blockId, successors, visited, postorder);
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
