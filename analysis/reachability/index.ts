import "../../bootstrap";
import { readInlineCfg, readStatements, BlockResolver, sceneOf } from "../control-flow-graph/cfg-io";
import { Transition, isChoiceOptionEdge } from "../control-flow-graph/data";
import { evaluateExpression } from "../dataflow/evaluate-expression";
import { applyStatement } from "../dataflow/transfer";
import { narrowState } from "../dataflow/narrow";
import {
  VariableState,
  emptyState,
  cloneState,
  joinStates,
  setVariable,
} from "../dataflow/variable-state";
import { Statement } from "../../parser/statements";
import { writeNdjson } from "../ndjson";
import { outPath } from "../../out-dir";

const cfg = readInlineCfg(outPath("inline-cfg.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));

// --- Build adjacency structures ---

const successorEdges = new Map<string, Transition[]>();
const predecessorEdges = new Map<string, Transition[]>();

for (const edge of cfg.edges) {
  const src = successorEdges.get(edge.sourceBlockId) ?? [];
  src.push(edge);
  successorEdges.set(edge.sourceBlockId, src);

  if (edge.targetBlockId) {
    const dst = predecessorEdges.get(edge.targetBlockId) ?? [];
    dst.push(edge);
    predecessorEdges.set(edge.targetBlockId, dst);
  }
}

// --- Forward walk with abstract state ---
// Single-pass topological walk (like solve.ts) but focused on reachability:
// - Evaluate if/else conditions to determine which branches are taken
// - Evaluate selectable_if to determine which choice options are available
// - Track which edges are definitely taken, definitely dead, or conditional

type EdgeVerdict = "reachable" | "unreachable" | "conditional";

const edgeVerdicts = new Map<string, EdgeVerdict>();
const reachableBlocks = new Set<string>();
const entryStates = new Map<string, VariableState>();
const exitStates = new Map<string, VariableState>();

// Topological order via DFS post-order
const computeOrder = (): string[] => {
  const visited = new Set<string>();
  const postorder: string[] = [];

  const dfs = (blockId: string) => {
    if (visited.has(blockId)) return;
    visited.add(blockId);
    const succs = successorEdges.get(blockId) ?? [];
    for (const edge of succs) {
      if (edge.targetBlockId && !visited.has(edge.targetBlockId)) {
        dfs(edge.targetBlockId);
      }
    }
    postorder.push(blockId);
  };

  dfs(cfg.entryBlockId);
  return postorder.reverse();
};

const order = computeOrder();

console.log(`Reachability analysis: ${Object.keys(cfg.blocks).length} blocks, ${cfg.edges.length} edges`);
console.log(`  ${order.length} blocks reachable from entry by graph structure`);

// Process blocks in topological order
for (const blockId of order) {
  const ref = cfg.blocks[blockId];
  if (!ref) continue;

  // Compute incoming state by joining predecessor exit states
  let incoming: VariableState;

  if (blockId === cfg.entryBlockId) {
    incoming = emptyState();
    reachableBlocks.add(blockId);
  } else {
    const preds = predecessorEdges.get(blockId) ?? [];
    const reachablePreds = preds.filter(
      (e) => edgeVerdicts.get(e.id) !== "unreachable" && exitStates.has(e.sourceBlockId)
    );

    if (reachablePreds.length === 0) continue;

    incoming = computeIncoming(blockId, reachablePreds, statements);
    reachableBlocks.add(blockId);
  }

  entryStates.set(blockId, incoming);

  // Apply block statements
  const blockScene = sceneOf(blockId);
  let state = incoming;
  for (const stmtId of resolver.resolve(ref)?.statementIds ?? []) {
    const stmt = statements[stmtId];
    if (stmt) state = applyStatement(state, stmt, blockScene);
  }
  exitStates.set(blockId, state);

  // Evaluate outgoing edges
  const outEdges = successorEdges.get(blockId) ?? [];
  classifyOutgoingEdges(outEdges, state, blockId, statements);
}

function computeIncoming(
  blockId: string,
  inEdges: Transition[],
  statements: Record<string, Statement>,
): VariableState {
  let result: VariableState | null = null;
  const blockScene = sceneOf(blockId);
  const block = resolver.resolve(cfg.blocks[blockId]);

  for (const edge of inEdges) {
    const predExit = exitStates.get(edge.sourceBlockId);
    if (!predExit) continue;
    if (!cfg.blocks[edge.sourceBlockId]) continue;
    const predScene = sceneOf(edge.sourceBlockId);

    let s = applyEdgeNarrowing(predExit, edge, predScene, statements);

    // Cross-scene: drop temp vars
    if (predScene !== blockScene) {
      const crossScene = emptyState();
      for (const [k, v] of s.globals) crossScene.globals.set(k, v);
      s = crossScene;
    }

    // Bind gosub params
    if (block?.parameterNames && block.parameterNames.length > 0) {
      const gosubStmt = findGoSubStatement(edge.sourceBlockId, statements);
      if (gosubStmt?.args) {
        for (let i = 0; i < block.parameterNames.length; i++) {
          const argExpr = gosubStmt.args[i];
          if (argExpr) {
            const argVal = evaluateExpression(argExpr, predExit, predScene);
            s = setVariable(s, block.parameterNames[i], argVal, "Temporary", blockScene);
          }
        }
      }
    }

    result = result ? joinStates(result, s) : cloneState(s);
  }

  return result ?? emptyState();
}

function applyEdgeNarrowing(
  state: VariableState,
  edge: Transition,
  scene: string,
  statements: Record<string, Statement>,
): VariableState {
  const condStmtId = edge.metadata.conditionStatementId;
  if (condStmtId == null) return state;
  const condStmt = statements[condStmtId] as any;
  if (!condStmt) return state;

  if (isChoiceOptionEdge(edge.kind)) {
    const condition = condStmt.selectableIf?.expression ?? condStmt.selectableIf;
    if (!condition) return state;
    return narrowState(state, condition, true, scene);
  }

  if (edge.kind === "IfBranch" || edge.kind === "ElseIfBranch") {
    if (condStmt.expression) return narrowState(state, condStmt.expression, true, scene);
  }
  if (edge.kind === "ElseBranch" || edge.kind === "IfFallThrough") {
    if (condStmt.expression) return narrowState(state, condStmt.expression, false, scene);
  }

  return state;
}

function classifyOutgoingEdges(
  edges: Transition[],
  state: VariableState,
  blockId: string,
  statements: Record<string, Statement>,
) {
  const blockScene = sceneOf(blockId);
  const ifElse = edges.filter((e) =>
    e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch" || e.kind === "IfFallThrough"
  );
  const choiceEdges = edges.filter((e) => isChoiceOptionEdge(e.kind));
  const other = edges.filter((e) =>
    e.kind !== "IfBranch" && e.kind !== "ElseIfBranch" && e.kind !== "ElseBranch" &&
    e.kind !== "IfFallThrough" && !isChoiceOptionEdge(e.kind)
  );

  // Non-conditional edges are always reachable
  for (const e of other) {
    edgeVerdicts.set(e.id, "reachable");
  }

  // Classify if/else branches
  if (ifElse.length > 0) {
    classifyIfElse(ifElse, state, blockScene, statements);
  }

  // Classify choice options
  if (choiceEdges.length > 0) {
    classifyChoiceOptions(choiceEdges, state, blockScene, statements);
  }
}

function classifyIfElse(
  edges: Transition[],
  state: VariableState,
  scene: string,
  statements: Record<string, Statement>,
) {
  const branches = edges.filter((e) => e.kind === "IfBranch" || e.kind === "ElseIfBranch");
  const elseBranch = edges.find((e) => e.kind === "ElseBranch");
  const fallThrough = edges.find((e) => e.kind === "IfFallThrough");

  let anyDefinitelyTrue = false;
  let allDefinitelyResolved = true;

  for (const branch of branches) {
    const condId = branch.metadata.conditionStatementId;
    if (!condId) { edgeVerdicts.set(branch.id, "conditional"); allDefinitelyResolved = false; continue; }
    const condStmt = statements[condId] as any;
    if (!condStmt?.expression) { edgeVerdicts.set(branch.id, "conditional"); allDefinitelyResolved = false; continue; }

    const result = evaluateExpression(condStmt.expression, state, scene);

    if (result.kind === "constant" && result.value === true) {
      edgeVerdicts.set(branch.id, anyDefinitelyTrue ? "unreachable" : "reachable");
      anyDefinitelyTrue = true;
      // All subsequent branches are unreachable
      for (const later of branches) {
        if (!edgeVerdicts.has(later.id)) edgeVerdicts.set(later.id, "unreachable");
      }
      break;
    } else if (result.kind === "constant" && result.value === false) {
      edgeVerdicts.set(branch.id, "unreachable");
    } else {
      edgeVerdicts.set(branch.id, "conditional");
      allDefinitelyResolved = false;
    }
  }

  // Else/fallthrough
  const fb = elseBranch ?? fallThrough;
  if (fb) {
    if (anyDefinitelyTrue && allDefinitelyResolved) {
      edgeVerdicts.set(fb.id, "unreachable");
    } else if (!anyDefinitelyTrue && allDefinitelyResolved && branches.every(
      (b) => edgeVerdicts.get(b.id) === "unreachable"
    )) {
      edgeVerdicts.set(fb.id, "reachable");
    } else {
      edgeVerdicts.set(fb.id, "conditional");
    }
  }
  // If there's both an else and a fallthrough, handle the other one
  if (elseBranch && fallThrough) {
    if (!edgeVerdicts.has(fallThrough.id)) {
      edgeVerdicts.set(fallThrough.id, anyDefinitelyTrue ? "unreachable" : "conditional");
    }
  }
}

function classifyChoiceOptions(
  edges: Transition[],
  state: VariableState,
  scene: string,
  statements: Record<string, Statement>,
) {
  for (const edge of edges) {
    const optId = edge.metadata.optionStatementId;
    const condId = edge.metadata.conditionStatementId;

    let verdict: EdgeVerdict = "reachable";

    if (optId) {
      const optStmt = statements[optId] as any;
      if (optStmt?.selectableIf) {
        const expr = optStmt.selectableIf.expression ?? optStmt.selectableIf;
        const r = evaluateExpression(expr, state, scene);
        if (r.kind === "constant" && r.value === false) verdict = "unreachable";
        else if (r.kind !== "constant" || r.value !== true) verdict = "conditional";
      }
    }

    if (verdict !== "unreachable" && condId && condId !== optId) {
      const condStmt = statements[condId] as any;
      if (condStmt?.expression) {
        const r = evaluateExpression(condStmt.expression, state, scene);
        if (r.kind === "constant" && r.value === false) verdict = "unreachable";
        else if (r.kind !== "constant" || r.value !== true) {
          if (verdict === "reachable") verdict = "conditional";
        }
      }
    }

    edgeVerdicts.set(edge.id, verdict);
  }
}

function findGoSubStatement(blockId: string, statements: Record<string, Statement>): any | null {
  const ref = cfg.blocks[blockId];
  if (!ref) return null;
  const block = resolver.resolve(ref);
  if (!block) return null;
  for (let i = block.statementIds.length - 1; i >= 0; i--) {
    const stmt = statements[block.statementIds[i]];
    if (stmt && (stmt.kind === "GoSub" || stmt.kind === "GoSubScene")) return stmt;
  }
  return null;
}

// --- Results ---

const allBlockIds = Object.keys(cfg.blocks);
const unreachableBlocks = allBlockIds.filter((id) => !reachableBlocks.has(id));

// Edges from unreachable source blocks are unreachable
for (const edge of cfg.edges) {
  if (!edgeVerdicts.has(edge.id) && !reachableBlocks.has(edge.sourceBlockId)) {
    edgeVerdicts.set(edge.id, "unreachable");
  }
}

const edgeStats = { reachable: 0, unreachable: 0, conditional: 0, unclassified: 0 };
for (const edge of cfg.edges) {
  const v = edgeVerdicts.get(edge.id);
  if (v === "reachable") edgeStats.reachable++;
  else if (v === "unreachable") edgeStats.unreachable++;
  else if (v === "conditional") edgeStats.conditional++;
  else edgeStats.unclassified++;
}

// Dedup unreachable blocks by source block id — inlined copies map back to their original
const dedupedUnreachable = new Map<string, { sourceId: string; inlineIds: string[]; sourceBlockId: string }>();
for (const id of unreachableBlocks) {
  const ref = cfg.blocks[id];
  if (!ref) continue;
  const sourceId = ref.sourceBlockId ?? id;
  const existing = dedupedUnreachable.get(sourceId);
  if (existing) {
    existing.inlineIds.push(id);
  } else {
    dedupedUnreachable.set(sourceId, { sourceId, inlineIds: [id], sourceBlockId: id });
  }
}

console.log();
console.log(`Blocks: ${reachableBlocks.size} reachable, ${unreachableBlocks.length} unreachable (of ${allBlockIds.length})`);
console.log(`  Deduped: ${dedupedUnreachable.size} unique source blocks (${unreachableBlocks.length} including inlined copies)`);
console.log(`Edges: ${edgeStats.reachable} reachable, ${edgeStats.unreachable} unreachable, ${edgeStats.conditional} conditional, ${edgeStats.unclassified} unclassified`);

// Group deduped unreachable blocks by scene
const unreachableByScene = new Map<string, { raw: number; deduped: number; stmts: number }>();
for (const [, entry] of dedupedUnreachable) {
  const scene = sceneOf(entry.sourceBlockId);
  const ref = cfg.blocks[entry.sourceBlockId];
  const block = ref ? resolver.resolve(ref) : undefined;
  const existing = unreachableByScene.get(scene) ?? { raw: 0, deduped: 0, stmts: 0 };
  existing.raw += entry.inlineIds.length;
  existing.deduped++;
  existing.stmts += block?.statementIds.length ?? 0;
  unreachableByScene.set(scene, existing);
}

if (unreachableByScene.size > 0) {
  console.log(`\nUnreachable blocks by scene (deduped / raw):`);
  for (const [scene, stats] of [...unreachableByScene.entries()].sort((a, b) => b[1].raw - a[1].raw)) {
    console.log(`  ${scene}: ${stats.deduped} source blocks (${stats.raw} with inlined), ${stats.stmts} statements`);
  }
}

// Unreachable choice options (edges with verdict "unreachable" that are ChoiceOption kind)
const unreachableChoices: { edge: Transition; label: string }[] = [];
for (const edge of cfg.edges) {
  if (!isChoiceOptionEdge(edge.kind)) continue;
  if (edgeVerdicts.get(edge.id) !== "unreachable") continue;
  const optId = edge.metadata.optionStatementId;
  let label = edge.targetBlockId ?? "?";
  if (optId) {
    const optStmt = statements[optId] as any;
    if (optStmt) {
      label = optStmt.token?.rawText ?? optStmt.parsedSegments?.[0]?.text ?? optId;
      if (label.length > 80) label = label.slice(0, 77) + "...";
    }
  }
  unreachableChoices.push({ edge, label });
}

if (unreachableChoices.length > 0) {
  console.log(`\nUnreachable choice options: ${unreachableChoices.length}`);
  for (const { edge, label } of unreachableChoices.slice(0, 20)) {
    console.log(`  ${sceneOf(edge.sourceBlockId)}:${edge.sourceBlockId} → "${label}"`);
  }
  if (unreachableChoices.length > 20) {
    console.log(`  ... and ${unreachableChoices.length - 20} more`);
  }
}

// Dead-end reachable blocks (no reachable outgoing edges, not a game-end block)
const deadEnds: string[] = [];
for (const blockId of reachableBlocks) {
  const outEdges = successorEdges.get(blockId) ?? [];
  if (outEdges.length === 0) continue;
  const hasGameEnd = outEdges.some((e) => e.kind === "GameEnd");
  if (hasGameEnd) continue;
  const hasUnresolved = outEdges.some((e) => e.kind === "GotoScene" && !e.targetBlockId);
  if (hasUnresolved) continue;
  const anyReachable = outEdges.some((e) => {
    const v = edgeVerdicts.get(e.id);
    return v === "reachable" || v === "conditional";
  });
  if (!anyReachable) deadEnds.push(blockId);
}

if (deadEnds.length > 0) {
  console.log(`\nDead-end blocks (reachable but all outgoing edges unreachable): ${deadEnds.length}`);
  for (const id of deadEnds.slice(0, 20)) {
    const ref = cfg.blocks[id];
    const block = ref ? resolver.resolve(ref) : undefined;
    console.log(`  ${sceneOf(id)}:${id} (${block?.statementIds.length ?? 0} statements, exit: ${ref?.exitType})`);
  }
  if (deadEnds.length > 20) console.log(`  ... and ${deadEnds.length - 20} more`);
}

// --- Write output ---

function* records() {
  yield {
    type: "meta",
    totalBlocks: allBlockIds.length,
    reachableBlocks: reachableBlocks.size,
    unreachableBlocks: unreachableBlocks.length,
    unreachableBlocksDeduped: dedupedUnreachable.size,
    edges: edgeStats,
    unreachableChoiceOptions: unreachableChoices.length,
    deadEndBlocks: deadEnds.length,
  };

  for (const [sourceId, entry] of dedupedUnreachable) {
    const ref = cfg.blocks[entry.sourceBlockId];
    const block = ref ? resolver.resolve(ref) : undefined;
    yield {
      type: "unreachable-block",
      id: sourceId,
      scene: sceneOf(entry.sourceBlockId),
      entryType: block?.entryType,
      exitType: ref?.exitType,
      statementCount: block?.statementIds.length ?? 0,
      inlinedCopies: entry.inlineIds.length,
    };
  }

  for (const edge of cfg.edges) {
    const v = edgeVerdicts.get(edge.id);
    if (v === "unreachable") {
      yield {
        type: "unreachable-edge",
        id: edge.id,
        kind: edge.kind,
        sourceBlockId: edge.sourceBlockId,
        targetBlockId: edge.targetBlockId,
        label: isChoiceOptionEdge(edge.kind)
          ? unreachableChoices.find((c) => c.edge.id === edge.id)?.label
          : undefined,
      };
    }
  }

  for (const blockId of deadEnds) {
    const ref = cfg.blocks[blockId];
    const block = ref ? resolver.resolve(ref) : undefined;
    yield {
      type: "dead-end",
      id: blockId,
      scene: sceneOf(blockId),
      exitType: ref?.exitType,
      statementCount: block?.statementIds.length ?? 0,
    };
  }
}

const count = writeNdjson(outPath("reachability.ndjson"), records());
console.log(`\nWrote reachability.ndjson (${count} records)`);
