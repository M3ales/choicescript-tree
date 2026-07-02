import {
  AbstractValue,
  bottom,
  join as joinValue,
  equals as valueEquals,
} from "./abstract-value";

export interface VariableState {
  parent: VariableState | null;
  globals: Map<string, AbstractValue>;
  temps: Map<string, Map<string, AbstractValue>>;
}

export const emptyState = (): VariableState => ({
  parent: null,
  globals: new Map(),
  temps: new Map(),
});

export const cloneState = (state: VariableState): VariableState => ({
  parent: state,
  globals: new Map(),
  temps: new Map(),
});

export const copyState = (state: VariableState): VariableState => {
  const mat = materialize(state);
  const globals = new Map(mat.globals);
  const temps = new Map<string, Map<string, AbstractValue>>();
  for (const [scene, vars] of mat.temps) temps.set(scene, new Map(vars));
  return { parent: null, globals, temps };
};

export const getVariable = (
  state: VariableState,
  name: string,
  scene: string
): AbstractValue => {
  const lower = name.toLowerCase();
  let current: VariableState | null = state;
  while (current) {
    const val = current.temps.get(scene)?.get(lower);
    if (val !== undefined) return val;
    current = current.parent;
  }
  current = state;
  while (current) {
    if (current.globals.has(lower)) return current.globals.get(lower)!;
    current = current.parent;
  }
  return bottom;
};

export const isTempVariable = (
  state: VariableState,
  name: string,
  scene: string,
): boolean => {
  const lower = name.toLowerCase();
  let current: VariableState | null = state;
  while (current) {
    if (current.temps.get(scene)?.has(lower)) return true;
    current = current.parent;
  }
  return false;
};

export const hasGlobal = (
  state: VariableState,
  name: string,
): boolean => {
  const lower = name.toLowerCase();
  let current: VariableState | null = state;
  while (current) {
    if (current.globals.has(lower)) return true;
    current = current.parent;
  }
  return false;
};

export const setVariable = (
  state: VariableState,
  name: string,
  value: AbstractValue,
  scope: "Global" | "Temporary",
  scene: string
): VariableState => {
  const lower = name.toLowerCase();
  const next = cloneState(state);
  if (scope === "Global") {
    next.globals.set(lower, value);
  } else {
    next.temps.set(scene, new Map([[lower, value]]));
  }
  return next;
};

export const updateVariable = (
  state: VariableState,
  name: string,
  value: AbstractValue,
  scene: string
): VariableState => {
  const lower = name.toLowerCase();
  const next = cloneState(state);
  if (isTempVariable(state, name, scene)) {
    if (!next.temps.has(scene)) next.temps.set(scene, new Map());
    next.temps.get(scene)!.set(lower, value);
  } else {
    next.globals.set(lower, value);
  }
  return next;
};

export const setVariableMut = (
  state: VariableState,
  name: string,
  value: AbstractValue,
  scope: "Global" | "Temporary",
  scene: string
): void => {
  const lower = name.toLowerCase();
  if (scope === "Global") {
    state.globals.set(lower, value);
  } else {
    if (!state.temps.has(scene)) state.temps.set(scene, new Map());
    state.temps.get(scene)!.set(lower, value);
  }
};

export const updateVariableMut = (
  state: VariableState,
  name: string,
  value: AbstractValue,
  scene: string
): void => {
  const lower = name.toLowerCase();
  if (isTempVariable(state, name, scene)) {
    if (!state.temps.has(scene)) state.temps.set(scene, new Map());
    state.temps.get(scene)!.set(lower, value);
  } else {
    state.globals.set(lower, value);
  }
};

export const materialize = (state: VariableState): VariableState => {
  if (!state.parent) return state;
  const chain: VariableState[] = [];
  let current: VariableState | null = state;
  while (current) {
    chain.push(current);
    current = current.parent;
  }
  const result: VariableState = { parent: null, globals: new Map(), temps: new Map() };
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [k, v] of chain[i].globals) result.globals.set(k, v);
    for (const [scene, vars] of chain[i].temps) {
      if (!result.temps.has(scene)) result.temps.set(scene, new Map());
      const sceneMap = result.temps.get(scene)!;
      for (const [k, v] of vars) sceneMap.set(k, v);
    }
  }
  return result;
};

export const materializeInto = (target: VariableState, source: VariableState): void => {
  const mat = materialize(source);
  target.parent = null;
  target.globals.clear();
  for (const [k, v] of mat.globals) target.globals.set(k, v);
  for (const [, vars] of target.temps) vars.clear();
  for (const [scene, vars] of mat.temps) {
    if (!target.temps.has(scene)) target.temps.set(scene, new Map());
    const sceneMap = target.temps.get(scene)!;
    for (const [k, v] of vars) sceneMap.set(k, v);
  }
};

export const joinStates = (a: VariableState, b: VariableState): VariableState => {
  const am = materialize(a);
  const bm = materialize(b);

  const globals = new Map<string, AbstractValue>();

  for (const [key, aVal] of am.globals) {
    const bVal = bm.globals.get(key);
    if (bVal === undefined || aVal === bVal || aVal.kind === "top") {
      globals.set(key, aVal);
    } else {
      globals.set(key, joinValue(aVal, bVal));
    }
  }
  for (const [key, bVal] of bm.globals) {
    if (!am.globals.has(key)) globals.set(key, bVal);
  }

  const temps = new Map<string, Map<string, AbstractValue>>();

  for (const [scene, aScene] of am.temps) {
    const bScene = bm.temps.get(scene);
    if (!bScene) {
      temps.set(scene, new Map(aScene));
      continue;
    }
    const merged = new Map<string, AbstractValue>();
    for (const [key, aVal] of aScene) {
      const bVal = bScene.get(key);
      merged.set(key, bVal !== undefined ? joinValue(aVal, bVal) : aVal);
    }
    for (const [key, bVal] of bScene) {
      if (!aScene.has(key)) merged.set(key, bVal);
    }
    temps.set(scene, merged);
  }
  for (const [scene, bScene] of bm.temps) {
    if (!am.temps.has(scene)) temps.set(scene, new Map(bScene));
  }

  return { parent: null, globals, temps };
};

export const joinStatesMut = (target: VariableState, source: VariableState): void => {
  const sm = materialize(source);

  for (const [key, sVal] of sm.globals) {
    const tVal = getVariable(target, key, "");
    if (tVal === sVal) continue;
    if (tVal.kind === "bottom") {
      target.globals.set(key, sVal);
    } else if (tVal.kind !== "top") {
      target.globals.set(key, joinValue(tVal, sVal));
    }
  }

  for (const [scene, sScene] of sm.temps) {
    if (!target.temps.has(scene)) target.temps.set(scene, new Map());
    const tScene = target.temps.get(scene)!;
    for (const [key, sVal] of sScene) {
      const tVal = getVariable(target, key, scene);
      if (tVal === sVal) continue;
      if (tVal.kind === "bottom") {
        tScene.set(key, sVal);
      } else if (tVal.kind !== "top") {
        tScene.set(key, joinValue(tVal, sVal));
      }
    }
  }
};

export const joinStateForScenetransition = (
  predecessorExitState: VariableState,
  targetScene: string,
  currentTargetState: VariableState
): VariableState => {
  const result = cloneState(currentTargetState);

  const predMat = materialize(predecessorExitState);
  for (const [key, predVal] of predMat.globals) {
    const curVal = getVariable(currentTargetState, key, "");
    result.globals.set(key, joinValue(curVal.kind === "bottom" ? bottom : curVal, predVal));
  }

  return result;
};

export const statesEqual = (a: VariableState, b: VariableState): boolean => {
  const am = materialize(a);
  const bm = materialize(b);

  if (am.globals.size !== bm.globals.size) return false;
  for (const [key, aVal] of am.globals) {
    const bVal = bm.globals.get(key);
    if (!bVal || !valueEquals(aVal, bVal)) return false;
  }

  if (am.temps.size !== bm.temps.size) return false;
  for (const [scene, aVars] of am.temps) {
    const bVars = bm.temps.get(scene);
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

export const serializeState = (state: VariableState): SerializedVariableState => {
  const mat = materialize(state);
  const temps: Record<string, Record<string, AbstractValue>> = {};
  for (const [scene, vars] of mat.temps) {
    temps[scene] = Object.fromEntries(vars);
  }
  return { globals: Object.fromEntries(mat.globals), temps };
};
