import { SceneAst } from "../../../parser/scene";
import { SceneControlFlowGraph } from "./scene-control-flow-graph";
import { TransitionKind, BlockRef } from "../data";
import { BuilderContext } from "./builder-context";
import { walkStatementList } from "./walk-statement-list";
import { NdjsonWriter } from "../../ndjson";

export const buildControlFlow = (
  scene: SceneAst,
  blockWriter: NdjsonWriter,
): SceneControlFlowGraph => {
  const context: BuilderContext = {
    sceneName: scene.name,
    blocks: {},
    edges: [],
    pendingTransitions: [],
    nextBlockNum: 0,
    nextEdgeNum: 0,
    labelToBlockId: {},
    currentReuseMode: null
  };

  const isTopLevel = true;
  const result = walkStatementList(scene.statements, context, "SceneEntry", isTopLevel);

  for (const deferred of context.pendingTransitions) {
    const edge = context.edges.find((e) => e.id === deferred.edgeId)!;
    const targetBlockId = context.labelToBlockId[deferred.label];
    if (targetBlockId) {
      edge.targetBlockId = targetBlockId;
    } else {
      edge.kind = "Unresolved";
    }
  }

  const externalTransitions: TransitionKind[] = [
    "SceneExit",
    "GameEnd",
    "Return",
    "GotoScene",
    "GoSubSceneCall"
  ];

  const unresolvedEdges = context.edges.filter(
    (e) => e.kind === "Unresolved" ||
      (e.targetBlockId === null && !externalTransitions.includes(e.kind))
  );

  for (const block of Object.values(context.blocks)) {
    blockWriter.write(block);
  }
  blockWriter.flush();

  const blockRefs: Record<string, BlockRef> = {};
  for (const [id, block] of Object.entries(context.blocks)) {
    blockRefs[id] = { id, exitType: block.exitType };
  }

  return {
    sceneName: scene.name,
    blocks: blockRefs,
    blockIndex: context.blocks,
    edges: context.edges,
    entryBlockId: result.entryBlockId,
    labelToBlockId: context.labelToBlockId,
    unresolvedEdges,
  };
};
