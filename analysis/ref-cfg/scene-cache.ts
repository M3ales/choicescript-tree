import { SceneControlFlowGraph } from "../control-flow-graph/build-scene/scene-control-flow-graph";
import { getIO } from "../../out-dir";
import { Statement } from "../../parser/statements";

interface CacheEntry {
  hash: string;
  sceneCfg: SceneControlFlowGraph;
}

interface CacheFile {
  [sceneName: string]: CacheEntry;
}

const hashStatements = (statements: Statement[]): string => {
  const s = JSON.stringify(statements);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

export class SceneCfgCache {
  private cache: CacheFile = {};
  private hits = 0;
  private misses = 0;

  constructor(private readonly cachePath: string) {
    try {
      this.cache = JSON.parse(getIO().readFile(cachePath));
    } catch {
      this.cache = {};
    }
  }

  lookup(sceneName: string, statements: Statement[]): SceneControlFlowGraph | null {
    const hash = hashStatements(statements);
    const entry = this.cache[sceneName];
    if (entry && entry.hash === hash) {
      this.hits++;
      return entry.sceneCfg;
    }
    this.misses++;
    return null;
  }

  store(sceneName: string, statements: Statement[], sceneCfg: SceneControlFlowGraph): void {
    const hash = hashStatements(statements);
    this.cache[sceneName] = { hash, sceneCfg };
  }

  save(): void {
    getIO().writeFile(this.cachePath, JSON.stringify(this.cache));
  }

  stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }
}
