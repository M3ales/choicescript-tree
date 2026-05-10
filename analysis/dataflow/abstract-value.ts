export type AbstractValue =
  | { kind: "constant"; value: string | number | boolean }
  | { kind: "set"; values: (string | number | boolean)[]; hasUserInput?: true }
  | { kind: "range"; min: number; max: number }
  | { kind: "input" }
  | { kind: "loop" }
  | { kind: "top" }
  | { kind: "bottom" };

export const MAX_SET_SIZE = 128;

export const bottom: AbstractValue = { kind: "bottom" };
export const top: AbstractValue = { kind: "top" };
export const input: AbstractValue = { kind: "input" };
export const loop: AbstractValue = { kind: "loop" };

export const constant = (value: string | number | boolean): AbstractValue => ({
  kind: "constant",
  value,
});

export const range = (min: number, max: number): AbstractValue => ({
  kind: "range",
  min,
  max,
});

export const set = (values: (string | number | boolean)[], hasUserInput?: true): AbstractValue => {
  const unique = [...new Set(values)];
  if (unique.length === 0) return hasUserInput ? input : bottom;
  if (unique.length === 1 && !hasUserInput) return constant(unique[0]);
  if (unique.length > MAX_SET_SIZE) {
    if (unique.every((v) => typeof v === "number")) {
      const nums = unique as number[];
      return range(Math.min(...nums), Math.max(...nums));
    }
    return top;
  }
  return hasUserInput
    ? { kind: "set", values: unique, hasUserInput: true }
    : { kind: "set", values: unique };
};

export const join = (a: AbstractValue, b: AbstractValue): AbstractValue => {
  if (a.kind === "bottom") return b;
  if (b.kind === "bottom") return a;
  if (a.kind === "top" || b.kind === "top") return top;
  if (a.kind === "input" || b.kind === "input") {
    if (a.kind === "loop" || b.kind === "loop") return top;
    const other = a.kind === "input" ? b : a;
    if (other.kind === "input") return input;
    if (other.kind === "constant") return { kind: "set", values: [other.value], hasUserInput: true };
    if (other.kind === "set") return other.hasUserInput ? other : { ...other, hasUserInput: true };
    return input;
  }
  if (a.kind === "loop" || b.kind === "loop") return loop;

  if (a.kind === "constant" && b.kind === "constant") {
    return a.value === b.value ? a : set([a.value, b.value]);
  }

  if (a.kind === "range" && b.kind === "range") {
    return range(Math.min(a.min, b.min), Math.max(a.max, b.max));
  }

  if (a.kind === "set" && b.kind === "set") {
    const ui = a.hasUserInput || b.hasUserInput || undefined;
    return set([...a.values, ...b.values], ui);
  }

  if (a.kind === "constant" && b.kind === "set") {
    return set([a.value, ...b.values], b.hasUserInput);
  }
  if (a.kind === "set" && b.kind === "constant") {
    return set([...a.values, b.value], a.hasUserInput);
  }

  if (a.kind === "constant" && b.kind === "range") {
    if (typeof a.value === "number") {
      return range(Math.min(a.value, b.min), Math.max(a.value, b.max));
    }
    return top;
  }
  if (a.kind === "range" && b.kind === "constant") {
    return join(b, a);
  }

  if (a.kind === "set" && b.kind === "range") {
    if (a.values.every((v) => typeof v === "number")) {
      const nums = a.values as number[];
      return range(
        Math.min(b.min, ...nums),
        Math.max(b.max, ...nums)
      );
    }
    return top;
  }
  if (a.kind === "range" && b.kind === "set") {
    return join(b, a);
  }

  // Incompatible types
  return top;
};

export const equals = (a: AbstractValue, b: AbstractValue): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "bottom" || a.kind === "top" || a.kind === "input" || a.kind === "loop") return true;
  if (a.kind === "constant" && b.kind === "constant") return a.value === b.value;
  if (a.kind === "range" && b.kind === "range") return a.min === b.min && a.max === b.max;
  if (a.kind === "set" && b.kind === "set") {
    if (!!a.hasUserInput !== !!b.hasUserInput) return false;
    if (a.values.length !== b.values.length) return false;
    const sortedA = [...a.values].sort();
    const sortedB = [...b.values].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }
  return false;
};

export const excludeValue = (
  av: AbstractValue,
  excluded: string | number | boolean
): AbstractValue => {
  if (av.kind === "constant") {
    return av.value === excluded ? bottom : av;
  }
  if (av.kind === "set") {
    const remaining = av.values.filter((v) => v !== excluded);
    if (remaining.length === 0) return av.hasUserInput ? input : bottom;
    if (remaining.length === 1 && !av.hasUserInput) return constant(remaining[0]);
    return av.hasUserInput
      ? { kind: "set", values: remaining, hasUserInput: true }
      : { kind: "set", values: remaining };
  }
  if (av.kind === "range" && typeof excluded === "number") {
    if (excluded === av.min && excluded === av.max) return bottom;
    // Can't precisely exclude a single point from a range; return as-is
    return av;
  }
  return av;
};

export const narrowToValue = (
  av: AbstractValue,
  target: string | number | boolean
): AbstractValue => {
  if (av.kind === "bottom") return bottom;
  if (av.kind === "constant") {
    return av.value === target ? av : bottom;
  }
  if (av.kind === "set") {
    if (av.values.includes(target)) return constant(target);
    return av.hasUserInput ? constant(target) : bottom;
  }
  if (av.kind === "range" && typeof target === "number") {
    return target >= av.min && target <= av.max ? constant(target) : bottom;
  }
  if (av.kind === "top" || av.kind === "input" || av.kind === "loop") return constant(target);
  return av;
};

export const narrowToRange = (
  av: AbstractValue,
  min: number,
  max: number
): AbstractValue => {
  if (av.kind === "bottom") return bottom;
  if (av.kind === "constant" && typeof av.value === "number") {
    return av.value >= min && av.value <= max ? av : bottom;
  }
  if (av.kind === "range") {
    const newMin = Math.max(av.min, min);
    const newMax = Math.min(av.max, max);
    if (newMin > newMax) return bottom;
    if (newMin === newMax) return constant(newMin);
    return range(newMin, newMax);
  }
  if (av.kind === "top" || av.kind === "input" || av.kind === "loop") {
    if (min === max) return constant(min);
    return range(min, max);
  }
  return av;
};
