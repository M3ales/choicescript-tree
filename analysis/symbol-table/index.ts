import "../../bootstrap";
import { SceneAst } from "../../parser/scene";
import { outPath, ensureOutDir, getIO } from '../../out-dir';
import { buildSymbolTable } from "./build-symbol-table";

const scenes = JSON.parse(getIO().readFile(outPath('parsed.json'))) as SceneAst[];
let result = scenes
  .map(buildSymbolTable);

ensureOutDir();
getIO().writeFile(outPath('symbol-table.json'), JSON.stringify(result, null, 2));
console.log(`Symbol Tables created for ${result.length} scenes`);
