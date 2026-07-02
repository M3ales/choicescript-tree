import { setIO } from "../../out-dir";
import { MemoryIO } from "../../io/memory-io";
import { CfgReconciler, runPipeline } from "../../api";
import type { Scene } from "../../api";
import { renderStaticOutput } from "./render";

setIO(new MemoryIO());

const scenes: Scene[] = [
  {
    sourceUrl: "test://startup",
    name: "startup",
    content: `*create name "World"
*create strength 50

Hello, \${name}!

Your strength is \${strength}.

*page_break Continue

You continue your journey.

*choice
  #Fight the dragon.
    You draw your sword!
    *set strength 75
    *finish
  #Run away.
    You flee into the night.
    *set strength 25
    *finish
  #Try to talk.
    The dragon listens.
    *finish
`,
    error: undefined,
    flow: [],
  },
];

const reconciler = new CfgReconciler({});
const result = runPipeline(scenes, { reconciler });

console.log("Segments:", Object.keys(result.segmentGraph.segments).length);
console.log("Edges:", result.segmentGraph.edges.length);

const output = renderStaticOutput(
  result.segmentGraph,
  result.extracted.blockIndex,
  result.extracted.statements,
  result.extracted.linked,
);

console.log("\nGenerated files:");
for (const [name, content] of output.files) {
  console.log(`  ${name} (${content.length} bytes)`);
}

console.log("\n--- index.html ---");
console.log(output.files.get("index.html"));

for (const [name, content] of output.files) {
  if (name === "index.html") continue;
  console.log(`\n--- ${name} ---`);
  console.log(content);
}

