import { AbstractValue, equals as valueEquals } from "./abstract-value";
import { VariableState, getVariable } from "./variable-state";
import { extractEffect } from "./extract-definitions";
import { extractVariableReads } from "./evaluate-expression";
import { applyStatement } from "./transfer";
import { Statement } from "../../parser/statements";
import { ControlFlowGraph, Transition, isChoiceOptionEdge } from "../control-flow-graph/data";
import { BlockResolver } from "../control-flow-graph/cfg-io";
import { getIO } from "../../out-dir";

export type BlockVariableEntry =
  | { entry: AbstractValue; exit: AbstractValue }
  | AbstractValue;

export interface StatementRecord {
  reads?: Record<string, AbstractValue>;
  write?: { variable: string; before: AbstractValue; after: AbstractValue };
}

export interface BlockRecord {
  id: string;
  scene: string;
  vars: Record<string, BlockVariableEntry>;
  stmts?: Record<string, StatementRecord>;
}

const collectReferencedVars = (
  blockId: string,
  scene: string,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver,
  incomingEdges: Transition[],
  outgoingEdges: Transition[]
): Set<string> => {
  const vars = new Set<string>();
  const ref = cfg.blocks[blockId];
  if (!ref) return vars;
  const block = resolver.resolve(ref);
  if (!block) return vars;

  // Variables read or written by statements in this block
  for (const stmtId of block.statementIds) {
    const stmt = statements[stmtId];
    if (!stmt) continue;

    const effect = extractEffect(stmt);
    if (effect.defines) {
      vars.add(effect.defines.variable);
      if (effect.defines.valueExpression) {
        for (const v of extractVariableReads(effect.defines.valueExpression)) {
          vars.add(v);
        }
      }
      if (effect.defines.compoundExpression) {
        for (const v of extractVariableReads(effect.defines.compoundExpression)) {
          vars.add(v);
        }
      }
    }

    // Read vars from expressions in conditional statements, gotos, etc.
    const s = stmt as any;
    if (s.expression) {
      for (const v of extractVariableReads(s.expression)) vars.add(v);
    }
    if (s.assignment) {
      for (const v of extractVariableReads(s.assignment)) vars.add(v);
    }
  }

  // Variables narrowed by incoming edge conditions
  for (const edge of incomingEdges) {
    const kind = edge.kind;
    if (
      kind !== "IfBranch" &&
      kind !== "ElseIfBranch" &&
      kind !== "ElseBranch" &&
      kind !== "IfFallThrough"
    )
      continue;

    const condStmtId = edge.metadata.conditionStatementId;
    if (condStmtId == null) continue;

    const condStmt = statements[condStmtId] as any;
    if (condStmt?.expression) {
      for (const v of extractVariableReads(condStmt.expression)) {
        vars.add(v);
      }
    }
  }

  // Variables referenced by outgoing ChoiceOption selectableIf conditions
  for (const edge of outgoingEdges) {
    if (!isChoiceOptionEdge(edge.kind)) continue;
    const condStmtId = edge.metadata.conditionStatementId;
    if (condStmtId == null) continue;
    const condStmt = statements[condStmtId] as any;
    if (condStmt?.selectableIf) {
      for (const v of extractVariableReads(condStmt.selectableIf)) {
        vars.add(v);
      }
    }
  }

  return vars;
};

export const writeBlockStates = (
  path: string,
  blocks: Map<
    string,
    { scene: string; entryState: VariableState; exitState: VariableState }
  >,
  cfg: ControlFlowGraph,
  statements: Record<string, Statement>,
  resolver: BlockResolver
): number => {
  // Build incoming and outgoing edges per block
  const incomingEdges = new Map<string, Transition[]>();
  const outgoingEdges = new Map<string, Transition[]>();
  for (const edge of cfg.edges) {
    if (edge.targetBlockId) {
      let list = incomingEdges.get(edge.targetBlockId);
      if (!list) { list = []; incomingEdges.set(edge.targetBlockId, list); }
      list.push(edge);
    }
    let out = outgoingEdges.get(edge.sourceBlockId);
    if (!out) { out = []; outgoingEdges.set(edge.sourceBlockId, out); }
    out.push(edge);
  }

  const chunks: string[] = [];
  let count = 0;

  for (const [blockId, { scene, entryState, exitState }] of blocks) {
    const referenced = collectReferencedVars(
      blockId,
      scene,
      cfg,
      statements,
      resolver,
      incomingEdges.get(blockId) ?? [],
      outgoingEdges.get(blockId) ?? []
    );

    const vars: Record<string, BlockVariableEntry> = {};
    for (const name of referenced) {
      const entryVal = getVariable(entryState, name, scene);
      const exitVal = getVariable(exitState, name, scene);
      if (entryVal.kind === "bottom" && exitVal.kind === "bottom") continue;
      vars[name] = valueEquals(entryVal, exitVal)
        ? exitVal
        : { entry: entryVal, exit: exitVal };
    }

    const stmts: Record<string, StatementRecord> = {};
    const blockRef = cfg.blocks[blockId];
    const block = blockRef ? resolver.resolve(blockRef) : undefined;
    if (block) {
      let currentState = entryState;
      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (!stmt) continue;

        const effect = extractEffect(stmt);
        const s = stmt as any;
        const rec: StatementRecord = {};

        const readVars = new Set<string>();
        if (effect.defines) {
          if (effect.defines.valueExpression) {
            for (const v of extractVariableReads(effect.defines.valueExpression))
              readVars.add(v);
          }
          if (effect.defines.compoundExpression) {
            for (const v of extractVariableReads(effect.defines.compoundExpression))
              readVars.add(v);
          }
        }
        if (s.expression && !effect.defines?.compoundExpression) {
          for (const v of extractVariableReads(s.expression)) readVars.add(v);
        }
        if (s.selectableIf) {
          for (const v of extractVariableReads(s.selectableIf)) readVars.add(v);
        }

        const writtenVar = effect.defines?.variable;
        if (writtenVar) readVars.delete(writtenVar);

        const reads: Record<string, AbstractValue> = {};
        for (const name of readVars) {
          const val = getVariable(currentState, name, scene);
          if (val.kind !== "bottom") reads[name] = val;
        }
        if (Object.keys(reads).length > 0) rec.reads = reads;

        if (writtenVar) {
          const before = getVariable(currentState, writtenVar, scene);
          const nextState = applyStatement(currentState, stmt, scene);
          const after = getVariable(nextState, writtenVar, scene);
          rec.write = { variable: writtenVar, before, after };
          currentState = nextState;
        } else {
          currentState = applyStatement(currentState, stmt, scene);
        }

        if (rec.write && rec.write.before.kind === "bottom" && rec.write.after.kind === "bottom") {
          delete rec.write;
        }
        if (rec.reads || rec.write) {
          stmts[stmtId] = rec;
        }
      }
    }

    const record: BlockRecord = { id: blockId, scene, vars };
    if (Object.keys(stmts).length > 0) record.stmts = stmts;
    chunks.push(JSON.stringify(record));
    count++;
  }

  getIO().writeFile(path, chunks.join("\n") + "\n");
  return count;
};

export const readBlockStates = (
  path: string
): Map<string, BlockRecord> => {
  const result = new Map<string, BlockRecord>();
  const content = getIO().readFile(path);
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const block = JSON.parse(line) as BlockRecord;
    result.set(block.id, block);
  }
  return result;
};
