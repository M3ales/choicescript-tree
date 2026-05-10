import "../../../bootstrap";
import { readCfg, readStatements, BlockResolver } from "../cfg-io";
import { writeNdjson } from "../../ndjson";
import { flattenSubroutines, FlattenedSubroutine } from "./flatten-gosubs";
import { outPath } from "../../../out-dir";

const cfg = readCfg(outPath("cfg.ndjson"));
const statements = readStatements(outPath("game-statements.ndjson"));
const resolver = new BlockResolver(outPath("block-index.ndjson"));

console.log(`Flatten gosubs: ${Object.keys(cfg.blocks).length} blocks, ${cfg.edges.length} edges, ${Object.keys(statements).length} statements`);

const result = flattenSubroutines(cfg, statements, resolver);

console.log(`  ${result.totalEntries} unique subroutines, ${result.totalLoopsUnrolled} loops unrolled, ${result.totalNested} nested calls inlined`);

let totalBlocks = 0;
let totalEdges = 0;
for (const sub of result.subroutines) {
  totalBlocks += sub.blockRefs.length;
  totalEdges += sub.edges.length;
}

console.log(`  Flattened: ${totalBlocks} block refs, ${totalEdges} edges across ${result.subroutines.length} subroutines`);

function* serialise(subs: FlattenedSubroutine[]) {
  for (const sub of subs) {
    yield {
      type: "subroutine",
      entryBlockId: sub.entryBlockId,
      returnBlockIds: sub.returnBlockIds,
      blockCount: sub.blockRefs.length,
      edgeCount: sub.edges.length,
    };
    for (const ref of sub.blockRefs) {
      yield { type: "blockRef", subroutine: sub.entryBlockId, ...ref };
    }
    for (const edge of sub.edges) {
      yield { type: "edge", subroutine: sub.entryBlockId, ...edge };
    }
  }
}

const count = writeNdjson(outPath("flattened-gosubs.ndjson"), serialise(result.subroutines));
console.log(`Wrote flattened-gosubs.ndjson (${count} records)`);
