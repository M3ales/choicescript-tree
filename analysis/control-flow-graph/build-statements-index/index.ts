import { ControlFlowGraph } from "../data";
import { Statement } from "../../../parser/statements";
import { SceneAstWithSymbolTable } from "../../symbol-table/scene-ast-with-symbol-table";
import { buildStatementMap } from "../merge-scenes/statement-map";

export const buildStatementsIndex = (
  cfg: ControlFlowGraph,
  scenes: SceneAstWithSymbolTable[],
): Record<string, Statement> => {
  const neededByScene = new Map<string, Set<number>>();

  const addNeeded = (globalId: string) => {
    const colonIdx = globalId.indexOf(":");
    const sceneName = globalId.substring(0, colonIdx);
    const localId = parseInt(globalId.substring(colonIdx + 1), 10);
    let set = neededByScene.get(sceneName);
    if (!set) { set = new Set(); neededByScene.set(sceneName, set); }
    set.add(localId);
  };

  for (const id of Object.keys(cfg.statementIndex)) addNeeded(id);
  for (const edge of cfg.edges) {
    for (const key of ["conditionStatementId", "optionStatementId", "choiceConditionId"] as const) {
      const stmtId = edge.metadata[key] as string | undefined;
      if (stmtId) addNeeded(stmtId);
    }
  }

  const statements: Record<string, Statement> = {};
  for (const scene of scenes) {
    const needed = neededByScene.get(scene.name);
    if (!needed) continue;
    const stmtMap = new Map<number, Statement>();
    buildStatementMap(scene.statements, stmtMap);
    for (const localId of needed) {
      const stmt = stmtMap.get(localId);
      if (stmt) statements[`${scene.name}:${localId}`] = stmt;
    }
  }
  return statements;
};
