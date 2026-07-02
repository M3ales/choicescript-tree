import { Guard } from "./cfg-visitor";

export type { Guard } from "./cfg-visitor";

export interface GuardedEffect {
  blockId: string;
  guards: Guard[];
}

export interface ExitGuard {
  exitIndex: number;
  guards: Guard[];
  conditional: boolean;
}

export interface CfgTransfer {
  cfgId: string;
  effects: GuardedEffect[];
  exits: ExitGuard[];
}
