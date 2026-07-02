import "../../bootstrap";
import { outPath, ensureOutDir, getIO } from "../../out-dir";
import { CfgReconciler, runPipeline } from "../../api";
import type { Scene } from "../../api";
import { renderStaticOutput } from "./render";

const STATIC_DIR = outPath("static");

const scenes = JSON.parse(getIO().readFile(outPath("raw-scenes.json"))) as Scene[];
console.log(`Loaded ${scenes.length} scenes`);

ensureOutDir();

const reconciler = new CfgReconciler({});
const result = runPipeline(scenes, { reconciler });

const { segmentGraph, segmentDataflow, extracted } = result;

console.log(`Segments: ${Object.keys(segmentGraph.segments).length}`);
console.log(`Blocks: ${Object.keys(extracted.blockIndex).length}`);
console.log(`Statements: ${Object.keys(extracted.statements).length}`);

const output = renderStaticOutput(
  segmentGraph,
  extracted.blockIndex,
  extracted.statements,
  extracted.linked,
  { segmentDataflow },
);

const io = getIO();
io.mkdir(STATIC_DIR);

for (const [filename, html] of output.files) {
  io.writeFile(`${STATIC_DIR}/${filename}`, html);
}

console.log(`Generated ${output.pageCount} pages + index.html in ${STATIC_DIR}`);
console.log(`Entry: ${output.entryPageId}.html`);
