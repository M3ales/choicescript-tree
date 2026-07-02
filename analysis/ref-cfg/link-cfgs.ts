import { SceneAst } from "../../parser/scene";
import { SceneControlFlowGraph } from "../control-flow-graph/build-scene/scene-control-flow-graph";
import { Cfg, CfgExit, LinkedCfgs, RefStatementIndexEntry } from "./data";
import { makeCfgId } from "./extract-cfgs";

const extractSceneOrder = (scenes: SceneAst[]): { order: string[]; sceneListScenes: Set<string> } => {
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
    if (id.value !== "startup") ordered.push(id.value);
  }

  const sceneListScenes = new Set(ordered);
  for (const scene of scenes) {
    if (!sceneListScenes.has(scene.name)) ordered.push(scene.name);
  }

  return { order: ordered, sceneListScenes };
};

export const linkCfgs = (
  scenes: SceneAst[],
  allCfgs: Record<string, Cfg>,
  sceneCfgs: Map<string, SceneControlFlowGraph>,
): LinkedCfgs => {
  const { order: sceneOrder, sceneListScenes } = extractSceneOrder(scenes);

  const unresolvedExits: CfgExit[] = [];

  for (const cfg of Object.values(allCfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type !== "unresolved" && exit.target.type !== "terminal") continue;

      if (exit.kind === "GotoScene" && exit.metadata.targetScene) {
        const targetScene = exit.metadata.targetScene;
        const targetLabel = exit.metadata.targetSceneLabel ?? "";
        const resolved = makeCfgId(targetScene, targetLabel);
        if (allCfgs[resolved]) {
          exit.target = { type: "cfg", cfgId: resolved };
        } else {
          exit.target = { type: "unresolved" };
          unresolvedExits.push(exit);
        }
        continue;
      }

      if (exit.kind === "GoSubSceneCall" && exit.metadata.targetScene) {
        const targetScene = exit.metadata.targetScene;
        const label = exit.metadata.label ?? "";
        const resolved = makeCfgId(targetScene, label);
        if (allCfgs[resolved]) {
          exit.target = { type: "cfg", cfgId: resolved };
        } else {
          exit.target = { type: "unresolved" };
          unresolvedExits.push(exit);
        }
        continue;
      }

      if (exit.kind === "SceneExit") {
        if (sceneListScenes.has(cfg.scene)) {
          const sceneIdx = sceneOrder.indexOf(cfg.scene);
          if (sceneIdx >= 0 && sceneIdx < sceneOrder.length - 1) {
            const nextScene = sceneOrder[sceneIdx + 1];
            if (sceneListScenes.has(nextScene)) {
              const nextId = makeCfgId(nextScene, "");
              if (allCfgs[nextId]) {
                exit.kind = "SceneProgression";
                exit.target = { type: "cfg", cfgId: nextId };
                continue;
              }
            }
          }
        }
        exit.target = { type: "terminal" };
        continue;
      }

      unresolvedExits.push(exit);
    }
  }

  const statsCfgIds: string[] = [];
  for (const cfg of Object.values(allCfgs)) {
    if (cfg.scene === "choicescript_stats") statsCfgIds.push(cfg.id);
  }

  const statementIndex: Record<string, RefStatementIndexEntry> = {};
  for (const [sceneName, sceneCfg] of sceneCfgs) {
    for (const [blockId, codeBlock] of Object.entries(sceneCfg.blockIndex)) {
      for (const stmtId of codeBlock.statementIds) {
        const colonIdx = stmtId.indexOf(":");
        const localId = colonIdx >= 0 ? stmtId.slice(colonIdx + 1) : stmtId;
        statementIndex[stmtId] = {
          scene: sceneName,
          localStatementId: localId,
          blockId,
        };
      }
    }
  }

  const startupEntry = makeCfgId("startup", "");
  const entryCfgId = allCfgs[startupEntry] ? startupEntry : Object.keys(allCfgs)[0];

  return {
    cfgs: allCfgs,
    loops: {},
    unresolvedExits,
    sceneOrder: sceneOrder.filter(s => s !== "choicescript_stats"),
    entryCfgId,
    statementIndex,
    statsCfgIds,
  };
};
