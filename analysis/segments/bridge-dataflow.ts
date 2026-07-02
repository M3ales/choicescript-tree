import { LinkedCfgs } from "../ref-cfg/data";
import { DataflowResult, State, StateStore } from "../ref-cfg/dataflow";
import { SerializedVariableState } from "../dataflow/variable-state";
import { SegmentDataflowResult } from "./segment-dataflow";

export const bridgeSegmentDataflow = (
  segmentDataflow: SegmentDataflowResult,
  linked: LinkedCfgs,
): DataflowResult => {
  const stateStore: StateStore = new Map();
  let nextId = 1;

  const allocState = (s: SerializedVariableState): number => {
    const id = nextId++;
    stateStore.set(id, s);
    return id;
  };

  const cfgStates: State[] = [];

  for (const cfg of Object.values(linked.cfgs)) {
    const entryState = segmentDataflow.cfgEntryStates.get(cfg.id);
    if (!entryState) continue;
    cfgStates.push({
      cfgId: cfg.id,
      entryIds: [allocState(entryState)],
      exitIds: [],
    });
  }

  return {
    cfgStates,
    stateStore,
    diagnostics: {
      unresolvedExits: [...linked.unresolvedExits],
      droppedContexts: [],
      missingCfgs: [],
    },
  };
};
