import { Statement } from "../../../parser/statements";
import { Expression } from "../../../parser/expressions";
import { CodeBlock } from "../../control-flow-graph/data/code-block";
import { CfgTransfer } from "../cfg-transfer";
import { State, StateStore } from "../dataflow";
import { VariableState, getVariable } from "../../dataflow/variable-state";
import {
  DataflowVisitor, DataflowBlockContext, DataflowWalkInput, runDataflowVisitors,
} from "./dataflow-visitor";
import { extractEffect } from "../../dataflow/extract-definitions";
import { extractExpressions } from "../collect-refs";

const BUILTINS = new Set([
  "choice_randomtest", "choice_quicktest", "choice_randomscene",
  "choice_nightmode", "choice_saved_is_allowed", "choice_save_name",
  "choice_time_stamp", "choice_restore_purchases_allowed",
  "choice_purchased_adfree", "choice_is_trial", "choice_is_advertising_supported",
  "choice_is_web", "choice_is_steam", "choice_is_ios", "choice_is_android",
  "choice_is_omnibus", "choice_release_date", "choice_prerelease",
  "choice_subscribe_allowed", "choice_subscribed",
  "true", "false",
]);

const isBuiltin = (name: string): boolean =>
  BUILTINS.has(name) || name.startsWith("choice_");

export type UndeclaredViolationKind = "set" | "reference";

interface IdentifierLocation {
  name: string;
  line: number;
  position: number;
}

export interface UndeclaredSetViolation {
  cfgId: string;
  blockId: string;
  statementId: string;
  scene: string;
  variable: string;
  line: number;
  position: number;
  statementKind: string;
  kind: UndeclaredViolationKind;
}

const collectIdentifierLocations = (expr: any, out: IdentifierLocation[]): void => {
  if (!expr) return;
  if (expr.token?.type === "Identifier" && expr.token.value) {
    out.push({ name: expr.token.value, line: expr.token.lineNumber, position: expr.token.position });
    return;
  }
  if (expr.identifier?.value) {
    out.push({ name: expr.identifier.value, line: expr.identifier.lineNumber, position: expr.identifier.position });
  }
  if (expr.left) collectIdentifierLocations(expr.left, out);
  if (expr.right) collectIdentifierLocations(expr.right, out);
  if (expr.value && expr.operator) collectIdentifierLocations(expr.value, out);
  if (expr.expression && !expr.identifier) collectIdentifierLocations(expr.expression, out);
  if (expr.selector) collectIdentifierLocations(expr.selector, out);
};

const collectRefsWithLocations = (stmt: Statement): IdentifierLocation[] => {
  const exprs = extractExpressions(stmt);
  const out: IdentifierLocation[] = [];
  for (const expr of exprs) {
    collectIdentifierLocations(expr, out);
  }
  return out;
};

const getWriteTargetLocation = (stmt: Statement): IdentifierLocation | null => {
  const s = stmt as any;
  if (s.assignment) {
    const expr = s.expression;
    if (expr?.token?.type === "Identifier" && expr.token.value) {
      return { name: expr.token.value, line: expr.token.lineNumber, position: expr.token.position };
    }
  } else if (s.expression?.left?.token?.type === "Identifier") {
    const tok = s.expression.left.token;
    return { name: tok.value, line: tok.lineNumber, position: tok.position };
  }
  return null;
};

export class VerifySetDeclarationsPass implements DataflowVisitor<UndeclaredSetViolation[]> {
  private violations: UndeclaredSetViolation[] = [];
  private statements: Record<string, Statement>;
  private seen = new Set<string>();
  private knownDeclared = new Set<string>();

  constructor(statements: Record<string, Statement>) {
    this.statements = statements;
  }

  onBlock(ctx: DataflowBlockContext): void {
    if (ctx.dead) return;

    const locallyDefined = new Set<string>();

    for (const stmtId of ctx.block.statementIds) {
      const stmt = this.statements[stmtId];
      if (!stmt) continue;

      if (stmt.kind === "Parameters") {
        for (const id of (stmt as any).identifiers) {
          if (id?.value) locallyDefined.add(id.value);
        }
      }

      const writeVar = this.checkWrite(ctx, stmtId, stmt);
      this.checkReferences(ctx, stmtId, stmt, writeVar, locallyDefined);

      if (stmt.kind === "DeclareVariable") {
        const s = stmt as any;
        if (s.identifier?.value) locallyDefined.add(s.identifier.value);
      }
    }
  }

  private checkReferences(
    ctx: DataflowBlockContext, stmtId: string, stmt: Statement,
    writeTarget: string | null, locallyDefined?: Set<string>,
  ): void {
    const refs = collectRefsWithLocations(stmt);
    for (const ref of refs) {
      if (isBuiltin(ref.name)) continue;
      if (ref.name === writeTarget) continue;
      if (locallyDefined?.has(ref.name)) continue;

      const existing = getVariable(ctx.state, ref.name, ctx.scene);
      if (existing.kind !== "bottom") {
        this.knownDeclared.add(ref.name.toLowerCase());
        continue;
      }

      const key = `ref:${ctx.cfgId}:${stmtId}:${ref.name}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);

      this.violations.push({
        cfgId: ctx.cfgId,
        blockId: ctx.blockId,
        statementId: stmtId,
        scene: ctx.scene,
        variable: ref.name,
        line: ref.line,
        position: ref.position,
        statementKind: stmt.kind,
        kind: "reference",
      });
    }
  }

  private checkWrite(ctx: DataflowBlockContext, stmtId: string, stmt: Statement): string | null {
    if (stmt.kind !== "SetVariable") return null;

    const effect = extractEffect(stmt);
    if (!effect.defines) return null;

    const name = effect.defines.variable;
    if (isBuiltin(name)) return name;

    const existing = getVariable(ctx.state, name, ctx.scene);
    if (existing.kind !== "bottom") {
      this.knownDeclared.add(name.toLowerCase());
      return name;
    }

    const key = `set:${ctx.cfgId}:${stmtId}:${name}`;
    if (this.seen.has(key)) return name;
    this.seen.add(key);

    const loc = getWriteTargetLocation(stmt);
    this.violations.push({
      cfgId: ctx.cfgId,
      blockId: ctx.blockId,
      statementId: stmtId,
      scene: ctx.scene,
      variable: name,
      line: loc?.line ?? -1,
      position: loc?.position ?? -1,
      statementKind: stmt.kind,
      kind: "set",
    });
    return name;
  }

  finish(): UndeclaredSetViolation[] {
    return this.violations.filter(
      v => !this.knownDeclared.has(v.variable.toLowerCase()),
    );
  }
}

export const verifySetDeclarations = (
  transfers: Map<string, CfgTransfer>,
  dataflowStates: State[],
  stateStore: StateStore,
  blockIndex: Record<string, CodeBlock>,
  statements: Record<string, Statement>,
  cfgScenes: Map<string, string>,
): UndeclaredSetViolation[] => {
  const input: DataflowWalkInput = { transfers, dataflowStates, stateStore, blockIndex, statements, cfgScenes };
  const [violations] = runDataflowVisitors<[UndeclaredSetViolation[]]>(
    input, [new VerifySetDeclarationsPass(statements)],
  );
  return violations;
};
