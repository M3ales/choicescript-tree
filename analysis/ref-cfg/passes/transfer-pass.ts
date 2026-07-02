import { Statement } from "../../../parser/statements";
import { StatementTypes } from "../../../parser/statements/statement-types";
import { Cfg } from "../data";
import { CfgTransfer, GuardedEffect, ExitGuard } from "../cfg-transfer";
import { CfgVisitor, BlockContext, ExitContext } from "../cfg-visitor";

const EFFECT_KINDS: Set<StatementTypes> = new Set([
  "SetVariable",
  "DeclareVariable",
  "DeclareArray",
  "Parameters",
  "DeleteVariable",
  "DeleteArray",
  "GenerateRandom",
  "InputText",
  "InputNumber",
  "Achieve",
  "Round",
  "Length",
]);

export const isEffectStatement = (kind: StatementTypes): boolean =>
  EFFECT_KINDS.has(kind);

export class TransferPass implements CfgVisitor<CfgTransfer> {
  private allBlocks = new Map<string, BlockContext["guards"]>();
  private exits: ExitGuard[] = [];

  onStatement(ctx: BlockContext, _stmtId: string, _stmt: Statement): void {
    if (!this.allBlocks.has(ctx.blockId)) {
      this.allBlocks.set(ctx.blockId, ctx.guards);
    }
  }

  onExit(ctx: ExitContext): void {
    this.exits.push({
      exitIndex: ctx.exitIndex,
      guards: ctx.guards,
      conditional: ctx.conditional,
    });
  }

  finish(cfg: Cfg): CfgTransfer {
    const effects: GuardedEffect[] = [];
    for (const [blockId, guards] of this.allBlocks) {
      effects.push({ blockId, guards });
    }
    return { cfgId: cfg.id, effects, exits: this.exits };
  }
}
