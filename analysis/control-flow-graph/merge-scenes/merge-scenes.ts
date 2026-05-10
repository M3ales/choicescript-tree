import { SceneAstWithSymbolTable } from "../../symbol-table/scene-ast-with-symbol-table";
import { SceneControlFlowGraph } from "../build-scene/scene-control-flow-graph";
import { ControlFlowGraph, StatementIndexEntry, BlockRef, Transition } from "../data";
import { sceneOf } from "../cfg-io";

const extractSceneOrder = (scenes: SceneAstWithSymbolTable[]): { order: string[]; sceneListScenes: Set<string> } => {
  const startup = scenes.find(s => s.name === "startup");
  if (!startup) {
    const order = scenes.map(s => s.name);
    return { order, sceneListScenes: new Set(order) };
  }

  const sceneListStmt = startup.statements.find(s => s.kind === "SceneList") as any;
  if (!sceneListStmt) {
    const order = scenes.map(s => s.name);
    return { order, sceneListScenes: new Set(order) };
  }

  const ordered: string[] = ["startup"];
  for (const id of sceneListStmt.identifiers) {
    if (id.value !== "startup") {
      ordered.push(id.value);
    }
  }

  const sceneListScenes = new Set(ordered);
  for (const scene of scenes) {
    if (!sceneListScenes.has(scene.name)) {
      ordered.push(scene.name);
    }
  }

  return { order: ordered, sceneListScenes };
};


export const mergeScenes = (
  scenes: SceneAstWithSymbolTable[],
  cfgs: Map<string, SceneControlFlowGraph>,
): ControlFlowGraph => {
  const { order: sceneOrder, sceneListScenes } = extractSceneOrder(scenes);

  const blocks: Record<string, BlockRef> = {};
  const edges: Transition[] = [];
  const statementIndex: Record<string, StatementIndexEntry> = {};

  for (const scene of scenes) {
    const cfg = cfgs.get(scene.name);
    if (!cfg) continue;
    const name = scene.name;

    for (const [id, ref] of Object.entries(cfg.blocks)) {
      blocks[id] = ref;

      for (const stmtId of cfg.blockIndex[id]?.statementIds ?? []) {
        const localId = parseInt(stmtId.split(":")[1], 10);
        statementIndex[stmtId] = {
          scene: name,
          localStatementId: localId,
          blockId: id,
        };
      }
    }

    for (const edge of cfg.edges) {
      edges.push(edge);
    }
  }

  for (const edge of edges) {
    const sourceBlock = blocks[edge.sourceBlockId];
    if (!sourceBlock) continue;
    const sceneName = sceneOf(edge.sourceBlockId);

    if (edge.kind === "GotoScene" && edge.metadata.targetScene) {
      const targetCfg = cfgs.get(edge.metadata.targetScene);
      if (targetCfg) {
        if (edge.metadata.targetSceneLabel) {
          const labelBlockId = targetCfg.labelToBlockId[edge.metadata.targetSceneLabel];
          if (labelBlockId) {
            edge.targetBlockId = labelBlockId;
          }
        } else {
          edge.targetBlockId = targetCfg.entryBlockId;
        }
      }
    }

    if (edge.kind === "GoSubSceneCall" && edge.metadata.targetScene) {
      const targetCfg = cfgs.get(edge.metadata.targetScene);
      if (targetCfg) {
        if (edge.metadata.label) {
          const labelBlockId = targetCfg.labelToBlockId[edge.metadata.label];
          if (labelBlockId) {
            edge.targetBlockId = labelBlockId;
          }
        } else {
          edge.targetBlockId = targetCfg.entryBlockId;
        }
      }
    }

    if (edge.kind === "SceneExit" && (sourceBlock.exitType === "ImplicitEnd" || sourceBlock.exitType === "Finish")) {
      if (sceneListScenes.has(sceneName)) {
        const sceneIdx = sceneOrder.indexOf(sceneName);
        if (sceneIdx >= 0 && sceneIdx < sceneOrder.length - 1) {
          const nextSceneName = sceneOrder[sceneIdx + 1];
          const nextCfg = cfgs.get(nextSceneName);
          if (nextCfg) {
            edge.kind = "SceneProgression";
            edge.targetBlockId = nextCfg.entryBlockId;
          }
        }
      }
    }
  }

  const statsCfg = cfgs.get("choicescript_stats");
  const startupCfg = cfgs.get("startup");
  if (statsCfg && startupCfg) {
    edges.push({
      id: `${startupCfg.entryBlockId}.stats_link`,
      kind: "SceneProgression",
      sourceBlockId: startupCfg.entryBlockId,
      targetBlockId: statsCfg.entryBlockId,
      metadata: { targetScene: "choicescript_stats" },
    });
  }

  const entryBlockId = startupCfg
    ? startupCfg.entryBlockId
    : Object.keys(blocks)[0];

  return {
    blocks,
    edges,
    statementIndex,
    entryBlockId,
    sceneOrder,
  };
};
