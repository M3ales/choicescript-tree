import { LinkedCfgs } from "./data";

export function* serialiseLinkedCfgs(linked: LinkedCfgs) {
  yield {
    type: "meta",
    entryCfgId: linked.entryCfgId,
    sceneOrder: linked.sceneOrder,
    statsCfgIds: linked.statsCfgIds,
    cfgCount: Object.keys(linked.cfgs).length,
  };

  for (const cfg of Object.values(linked.cfgs)) {
    yield {
      type: "cfg",
      id: cfg.id,
      entryBlockId: cfg.entryBlockId,
      blockCount: Object.keys(cfg.blocks).length,
      edgeCount: cfg.edges.length,
      exitCount: cfg.exits.length,
    };

    for (const ref of Object.values(cfg.blocks)) {
      yield { type: "block", cfgId: cfg.id, ...ref };
    }

    for (const edge of cfg.edges) {
      yield { type: "edge", cfgId: cfg.id, ...edge };
    }

    for (const exit of cfg.exits) {
      yield {
        type: "exit",
        cfgId: cfg.id,
        blockId: exit.blockId,
        kind: exit.kind,
        target: exit.target,
        metadata: exit.metadata,
        ...(exit.continuation ? { continuation: exit.continuation } : {}),
      };
    }
  }

  for (const [id, entry] of Object.entries(linked.statementIndex)) {
    yield { type: "stmtIndex", id, ...entry };
  }
}
