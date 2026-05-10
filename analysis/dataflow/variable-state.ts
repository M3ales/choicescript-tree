import {
  AbstractValue,
  bottom,
  join as joinValue,
  equals as valueEquals,
} from "./abstract-value";

export interface VariableState {
  globals: Map<string, AbstractValue>;
  temps: Map<string, Map<string, AbstractValue>>;
}

export const emptyState = (): VariableState => ({
  globals: new Map(),
  temps: new Map(),
});

export const cloneState = (state: VariableState): VariableState => ({
  globals: new Map(state.globals),
  temps: new Map(
    [...state.temps.entries()].map(([scene, vars]) => [scene, new Map(vars)])
  ),
});

export const getVariable = (
  state: VariableState,
  name: string,
  scene: string
): AbstractValue => {
  const sceneTempVars = state.temps.get(scene);
  if (sceneTempVars?.has(name)) return sceneTempVars.get(name)!;
  if (state.globals.has(name)) return state.globals.get(name)!;
  return bottom;
};

export const setVariable = (
  state: VariableState,
  name: string,
  value: AbstractValue,
  scope: "Global" | "Temporary",
  scene: string
): VariableState => {
  const next = cloneState(state);
  if (scope === "Global") {
    next.globals.set(name, value);
  } else {
    if (!next.temps.has(scene)) next.temps.set(scene, new Map());
    next.temps.get(scene)!.set(name, value);
  }
  return next;
};

export const updateVariable = (
  state: VariableState,
  name: string,
  value: AbstractValue,
  scene: string
): VariableState => {
  const next = cloneState(state);
  const sceneTempVars = next.temps.get(scene);
  if (sceneTempVars?.has(name)) {
    sceneTempVars.set(name, value);
    return next;
  }
  next.globals.set(name, value);
  return next;
};

export const joinStates = (a: VariableState, b: VariableState): VariableState => {
  const result = emptyState();

  const allGlobalKeys = new Set([...a.globals.keys(), ...b.globals.keys()]);
  for (const key of allGlobalKeys) {
    const aVal = a.globals.get(key) ?? bottom;
    const bVal = b.globals.get(key) ?? bottom;
    result.globals.set(key, joinValue(aVal, bVal));
  }

  const allScenes = new Set([...a.temps.keys(), ...b.temps.keys()]);
  for (const scene of allScenes) {
    const aScene = a.temps.get(scene) ?? new Map();
    const bScene = b.temps.get(scene) ?? new Map();
    const merged = new Map<string, AbstractValue>();
    const allKeys = new Set([...aScene.keys(), ...bScene.keys()]);
    for (const key of allKeys) {
      const aVal = aScene.get(key) ?? bottom;
      const bVal = bScene.get(key) ?? bottom;
      merged.set(key, joinValue(aVal, bVal));
    }
    result.temps.set(scene, merged);
  }

  return result;
};

export const joinStateForScenetransition = (
  predecessorExitState: VariableState,
  targetScene: string,
  currentTargetState: VariableState
): VariableState => {
  const result = cloneState(currentTargetState);

  for (const [key, predVal] of predecessorExitState.globals) {
    const curVal = result.globals.get(key) ?? bottom;
    result.globals.set(key, joinValue(curVal, predVal));
  }

  // Temp vars from other scenes are not visible in the target scene,
  // but we preserve the target scene's own temp state
  // (it accumulates from all paths that enter this scene)

  return result;
};

export const statesEqual = (a: VariableState, b: VariableState): boolean => {
  if (a.globals.size !== b.globals.size) return false;
  for (const [key, aVal] of a.globals) {
    const bVal = b.globals.get(key);
    if (!bVal || !valueEquals(aVal, bVal)) return false;
  }

  if (a.temps.size !== b.temps.size) return false;
  for (const [scene, aVars] of a.temps) {
    const bVars = b.temps.get(scene);
    if (!bVars || aVars.size !== bVars.size) return false;
    for (const [key, aVal] of aVars) {
      const bVal = bVars.get(key);
      if (!bVal || !valueEquals(aVal, bVal)) return false;
    }
  }

  return true;
};

export interface SerializedVariableState {
  globals: Record<string, AbstractValue>;
  temps: Record<string, Record<string, AbstractValue>>;
}

export const serializeState = (state: VariableState): SerializedVariableState => ({
  globals: Object.fromEntries(state.globals),
  temps: Object.fromEntries(
    [...state.temps.entries()].map(([scene, vars]) => [
      scene,
      Object.fromEntries(vars),
    ])
  ),
});
