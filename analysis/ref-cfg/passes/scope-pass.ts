import { Statement } from "../../../parser/statements";
import { Cfg } from "../data";
import { ExitGuard } from "../cfg-transfer";
import {
  CfgScope, CfgExport, ScopeDef, ScopeRef, ScopeDelete, Presence,
  ScopeNode, ScopeEntry, lookupScope,
} from "../scope-types";
import { CfgVisitor, BlockContext, ExitContext } from "../cfg-visitor";
import { extractEffect } from "../../dataflow/extract-definitions";
import { collectRefsFromStatement } from "../collect-refs";

export class ScopePass implements CfgVisitor<CfgScope> {
  private defs: ScopeDef[] = [];
  private refs: ScopeRef[] = [];
  private deletes: ScopeDelete[] = [];
  private exitNodes: ScopeNode[] = [];

  onStatement(ctx: BlockContext, stmtId: string, stmt: Statement): void {
    if (stmt.kind === "DeleteVariable" || stmt.kind === "DeleteArray") {
      const name = (stmt as any).variable?.value;
      if (name) {
        ctx.scopeNode.deletes.add(name);
        this.deletes.push({ variable: name, statementId: stmtId, blockId: ctx.blockId });
      }
      return;
    }

    const stmtRefs = collectRefsFromStatement(stmt);
    for (const v of stmtRefs) {
      const found = lookupScope(ctx.scopeNode, v);
      this.refs.push({
        variable: v, statementId: stmtId, statementKind: stmt.kind,
        blockId: ctx.blockId, external: !found,
      });
    }

    const effect = extractEffect(stmt);
    if (effect.defines) {
      const entry: ScopeEntry = {
        variable: effect.defines.variable,
        scope: effect.defines.scope,
        statementId: stmtId,
      };
      ctx.scopeNode.defs.push(entry);

      const presence: Presence = ctx.guarded ? "may" : "must";
      this.defs.push({
        variable: entry.variable, scope: entry.scope, presence,
        statementId: stmtId, blockId: ctx.blockId,
      });
    }

    if (stmt.kind === "DeclareArray") {
      const arr = stmt as any;
      if (arr.declarations) {
        for (const decl of arr.declarations) {
          const sub = extractEffect(decl);
          if (sub.defines) {
            const entry: ScopeEntry = {
              variable: sub.defines.variable,
              scope: sub.defines.scope,
              statementId: stmtId,
            };
            ctx.scopeNode.defs.push(entry);

            const presence: Presence = ctx.guarded ? "may" : "must";
            this.defs.push({
              variable: entry.variable, scope: entry.scope, presence,
              statementId: stmtId, blockId: ctx.blockId,
            });
          }
        }
      }
    }

    if (stmt.kind === "Parameters") {
      const params = stmt as any;
      for (const id of params.identifiers) {
        const entry: ScopeEntry = {
          variable: id.value,
          scope: "Temporary",
          statementId: stmtId,
        };
        ctx.scopeNode.defs.push(entry);
        const presence: Presence = ctx.guarded ? "may" : "must";
        this.defs.push({
          variable: entry.variable, scope: entry.scope, presence,
          statementId: stmtId, blockId: ctx.blockId,
        });
      }
    }
  }

  onExit(ctx: ExitContext): void {
    if (ctx.scopeNode) this.exitNodes.push(ctx.scopeNode);
  }

  finish(cfg: Cfg): CfgScope {
    const exports = new Map<string, CfgExport>();
    for (const def of this.defs) {
      const existing = exports.get(def.variable);
      if (!existing || (def.presence === "must" && existing.presence === "may")) {
        exports.set(def.variable, {
          variable: def.variable,
          scope: def.scope,
          presence: def.presence,
        });
      }
    }
    for (const del of this.deletes) {
      exports.delete(del.variable);
    }

    const externalRefs: string[] = [];
    const seenExternal = new Set<string>();
    for (const ref of this.refs) {
      if (ref.external && !seenExternal.has(ref.variable)) {
        seenExternal.add(ref.variable);
        externalRefs.push(ref.variable);
      }
    }

    return {
      cfgId: cfg.id,
      scene: cfg.scene,
      tree: new Map(),
      entryNode: null,
      exitNodes: this.exitNodes,
      defs: this.defs,
      refs: this.refs,
      deletes: this.deletes,
      exports,
      externalRefs,
    };
  }
}
