import { readNdjsonSync } from "../ndjson";
import { ControlFlowGraph, StatementIndexEntry, CodeBlock, BlockRef, Transition } from "./data";
import { Statement } from "../../parser/statements";
import { FlattenedSubroutine } from "./inline/flatten-gosubs";

interface CfgRecord {
  type: "meta" | "blockRef" | "edge" | "stmtIndex";
  [key: string]: unknown;
}

export const readCfg = (cfgPath: string): ControlFlowGraph => {
  const records = readNdjsonSync<CfgRecord>(cfgPath);
  const blocks: Record<string, BlockRef> = {};
  const edges: Transition[] = [];
  const statementIndex: Record<string, StatementIndexEntry> = {};
  let entryBlockId = "";
  let sceneOrder: string[] = [];

  for (const rec of records) {
    switch (rec.type) {
      case "meta":
        entryBlockId = rec.entryBlockId as string;
        sceneOrder = rec.sceneOrder as string[];
        break;
      case "blockRef": {
        const { type, ...ref } = rec;
        blocks[ref.id as string] = ref as unknown as BlockRef;
        break;
      }
      case "edge": {
        const { type, ...edge } = rec;
        edges.push(edge as unknown as Transition);
        break;
      }
      case "stmtIndex": {
        const { type, id, ...entry } = rec;
        statementIndex[id as string] = entry as unknown as StatementIndexEntry;
        break;
      }
    }
  }

  return { blocks, edges, statementIndex, entryBlockId, sceneOrder };
};

export function* serialiseCfg(c: ControlFlowGraph) {
  yield { type: "meta", entryBlockId: c.entryBlockId, sceneOrder: c.sceneOrder };
  for (const ref of Object.values(c.blocks)) {
    yield { type: "blockRef", ...ref };
  }
  for (const edge of c.edges) {
    yield { type: "edge", ...edge };
  }
  for (const [id, entry] of Object.entries(c.statementIndex)) {
    yield { type: "stmtIndex", id, ...entry };
  }
}

export const readStatements = (path: string): Record<string, Statement> => {
  const records = readNdjsonSync<{ id: string } & Statement>(path);
  const result: Record<string, Statement> = {};
  for (const { id, ...stmt } of records) {
    result[id] = stmt as Statement;
  }
  return result;
};

export function* serialiseStatements(stmts: Record<string, Statement>) {
  for (const [id, stmt] of Object.entries(stmts)) {
    yield { id, ...stmt };
  }
}

export const readBlockIndex = (path: string): Record<string, CodeBlock> => {
  const records = readNdjsonSync<CodeBlock>(path);
  const result: Record<string, CodeBlock> = {};
  for (const block of records) {
    result[block.id] = block;
  }
  return result;
};

export const readFlattenedGosubs = (path: string): Map<string, FlattenedSubroutine> => {
  const records = readNdjsonSync<Record<string, unknown>>(path);
  const result = new Map<string, FlattenedSubroutine>();
  let current: FlattenedSubroutine | null = null;

  for (const rec of records) {
    switch (rec.type) {
      case "subroutine":
        if (current) result.set(current.entryBlockId, current);
        current = {
          entryBlockId: rec.entryBlockId as string,
          returnBlockIds: rec.returnBlockIds as string[],
          blockRefs: [],
          edges: [],
        };
        break;
      case "blockRef":
        if (current) {
          const { type, subroutine, ...ref } = rec;
          current.blockRefs.push(ref as unknown as BlockRef);
        }
        break;
      case "edge":
        if (current) {
          const { type, subroutine, ...edge } = rec;
          current.edges.push(edge as unknown as Transition);
        }
        break;
    }
  }
  if (current) result.set(current.entryBlockId, current);

  return result;
};

export interface InlineCfgData {
  blockRefs: BlockRef[];
  edges: Transition[];
  statementIndex: Record<string, StatementIndexEntry>;
  entryBlockId: string;
  sceneOrder: string[];
}

export function* serialiseInlineCfg(data: InlineCfgData) {
  yield { type: "meta", entryBlockId: data.entryBlockId, sceneOrder: data.sceneOrder };
  for (const ref of data.blockRefs) {
    yield { type: "blockRef", ...ref };
  }
  for (const edge of data.edges) {
    yield { type: "edge", ...edge };
  }
  for (const [id, entry] of Object.entries(data.statementIndex)) {
    yield { type: "stmtIndex", id, ...entry };
  }
}

export const readInlineCfg = (path: string): ControlFlowGraph => {
  const records = readNdjsonSync<Record<string, unknown>>(path);
  const blocks: Record<string, BlockRef> = {};
  const edges: Transition[] = [];
  const statementIndex: Record<string, StatementIndexEntry> = {};
  let entryBlockId = "";
  let sceneOrder: string[] = [];

  for (const rec of records) {
    switch (rec.type) {
      case "meta":
        entryBlockId = rec.entryBlockId as string;
        sceneOrder = rec.sceneOrder as string[];
        break;
      case "blockRef": {
        const { type, ...ref } = rec;
        const id = ref.id as string;
        blocks[id] = ref as unknown as BlockRef;
        break;
      }
      case "edge": {
        const { type, ...edge } = rec;
        edges.push(edge as unknown as Transition);
        break;
      }
      case "stmtIndex": {
        const { type, id, ...entry } = rec;
        statementIndex[id as string] = entry as unknown as StatementIndexEntry;
        break;
      }
    }
  }

  return { blocks, edges, statementIndex, entryBlockId, sceneOrder };
};

export const sceneOf = (blockId: string): string => blockId.split(":")[0];

export type InlineCfg = ControlFlowGraph & { refs: Record<string, BlockRef> };

export const readInlineCfgRefs = (path: string): InlineCfg => {
  const cfg = readInlineCfg(path);
  return { ...cfg, refs: cfg.blocks };
};

export class BlockResolver {
  private index: Record<string, CodeBlock>;

  constructor(blockIndexPath: string) {
    this.index = readBlockIndex(blockIndexPath);
  }

  resolve(ref: BlockRef): CodeBlock | undefined {
    const sourceId = ref.sourceBlockId ?? ref.id;
    const source = this.index[sourceId];
    if (!source) return undefined;
    return source;
  }

  get(id: string, blocks: Record<string, BlockRef>): CodeBlock | undefined {
    const ref = blocks[id];
    if (!ref) return undefined;
    return this.resolve(ref);
  }
}
