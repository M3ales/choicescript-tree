import "../../bootstrap";
import { SceneAst } from "../../parser/scene";
import { Statement } from "../../parser/statements";
import { readNdjsonSync, writeNdjson } from "../ndjson";
import { serialiseStatements } from "./cfg-io";
import { buildStatementMap } from "./merge-scenes/statement-map";
import { outPath, getIO } from "../../out-dir";

interface CfgRecord {
  type: string;
  [key: string]: unknown;
}

const scenes = JSON.parse(getIO().readFile(outPath("parsed.json"))) as SceneAst[];

const neededByScene = new Map<string, Set<number>>();

const addNeeded = (globalId: string) => {
  const colonIdx = globalId.indexOf(":");
  const sceneName = globalId.substring(0, colonIdx);
  const localId = parseInt(globalId.substring(colonIdx + 1), 10);
  let set = neededByScene.get(sceneName);
  if (!set) { set = new Set(); neededByScene.set(sceneName, set); }
  set.add(localId);
};

import { existsSync } from "fs";

const cfgPaths = [outPath("cfg.ndjson")];
const statsPath = outPath("cfg-stats.ndjson");
if (existsSync(statsPath)) cfgPaths.push(statsPath);

for (const cfgPath of cfgPaths) {
  const records = readNdjsonSync<CfgRecord>(cfgPath);
  for (const rec of records) {
    if (rec.type === "stmtIndex") {
      addNeeded(rec.id as string);
    }
    if (rec.type === "edge") {
      const meta = rec.metadata as Record<string, unknown> | undefined;
      if (!meta) continue;
      for (const key of ["conditionStatementId", "optionStatementId", "choiceConditionId"]) {
        const stmtId = meta[key] as string | undefined;
        if (stmtId) addNeeded(stmtId);
      }
    }
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
    if (stmt) {
      statements[`${scene.name}:${localId}`] = stmt;
    }
  }
}

const count = writeNdjson(outPath("game-statements.ndjson"), serialiseStatements(statements));
console.log(`Statements: ${count} extracted from ${scenes.length} scenes`);
