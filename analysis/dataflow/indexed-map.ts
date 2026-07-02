import { AbstractValue, bottom, join as joinAbstract } from "./abstract-value";
import { FNV_OFFSET, fnvMixStr, fnvMixInt } from "../../utils/fnv";

// ── Interned per-value hash ─────────────────────────────────────────────────

const VH = Symbol("vh");
const _f64 = new Float64Array(1);
const _u32 = new Uint32Array(_f64.buffer);

const computeValueHash = (val: AbstractValue): number => {
  switch (val.kind) {
    case "bottom": return 0x10000;
    case "top":    return 0x20000;
    case "input":  return 0x30000;
    case "loop":   return 0x40000;
    case "constant": {
      const v = val.value;
      if (typeof v === "boolean") return v ? 0x50001 : 0x50000;
      if (typeof v === "number") {
        if (v === (v | 0)) return fnvMixInt(0x60000, v | 0);
        _f64[0] = v;
        return fnvMixInt(fnvMixInt(0x60000, _u32[0]), _u32[1]);
      }
      return fnvMixStr(0x70000, v);
    }
    case "range": {
      _f64[0] = val.min;
      const h = fnvMixInt(fnvMixInt(0x80000, _u32[0]), _u32[1]);
      _f64[0] = val.max;
      return fnvMixInt(fnvMixInt(h, _u32[0]), _u32[1]);
    }
    case "set": {
      let h = fnvMixInt(0x90000, val.hasUserInput ? 1 : 0);
      for (const v of val.values) {
        if (typeof v === "number") {
          if (v === (v | 0)) { h = fnvMixInt(h, v | 0); }
          else { _f64[0] = v; h = fnvMixInt(fnvMixInt(h, _u32[0]), _u32[1]); }
        } else if (typeof v === "boolean") {
          h = fnvMixInt(h, v ? 1 : 0);
        } else {
          h = fnvMixStr(h, v);
        }
      }
      return h;
    }
  }
  return 0;
};

export const valueHash = (val: AbstractValue): number => {
  let vh = (val as any)[VH];
  if (vh !== undefined) return vh;
  vh = computeValueHash(val);
  (val as any)[VH] = vh;
  return vh;
};

const contrib = (nameHash: number, val: AbstractValue): number =>
  fnvMixInt(nameHash, valueHash(val));

// ── IndexedTempMap ──────────────────────────────────────────────────────────
// Flat-array backed temp variable store. SceneView adapters let variable-state
// code do .get(scene).get(name) / .set(name, value) while reading/writing
// the flat array. COW + incremental XOR hash, same as IndexedMap.

class SceneView {
  private _owner: IndexedTempMap;
  readonly scene: string;
  readonly _indices: Map<string, number>;

  constructor(owner: IndexedTempMap, scene: string) {
    this._owner = owner;
    this.scene = scene;
    this._indices = new Map();
  }

  get size(): number { return this._indices.size; }

  get(key: string): AbstractValue | undefined {
    const idx = this._indices.get(key);
    return idx !== undefined ? this._owner.values[idx] : undefined;
  }

  set(key: string, value: AbstractValue): this {
    let idx = this._indices.get(key);
    if (idx !== undefined) {
      this._owner._setAt(idx, value);
    } else {
      idx = this._owner._addEntry(this.scene, key, value);
      this._indices.set(key, idx);
    }
    return this;
  }

  has(key: string): boolean {
    const idx = this._indices.get(key);
    if (idx === undefined) return false;
    return this._owner.values[idx].kind !== "bottom";
  }

  clear(): void {
    for (const [, idx] of this._indices) {
      this._owner._setAt(idx, bottom);
    }
  }

  *[Symbol.iterator](): IterableIterator<[string, AbstractValue]> {
    for (const [name, idx] of this._indices) {
      const v = this._owner.values[idx];
      if (v.kind !== "bottom") yield [name, v];
    }
  }

  forEach(fn: (value: AbstractValue, key: string) => void): void {
    for (const [name, idx] of this._indices) {
      const v = this._owner.values[idx];
      if (v.kind !== "bottom") fn(v, name);
    }
  }
}

export class IndexedTempMap {
  private _scenes: Map<string, SceneView> = new Map();
  private _nameHashes: number[];
  values: AbstractValue[];
  private _shared = false;
  private _xorHash: number;
  private _size: number;

  constructor() {
    this._nameHashes = [];
    this.values = [];
    this._xorHash = 0;
    this._size = 0;
  }

  get xorHash(): number { return this._xorHash; }
  get size(): number { return this._scenes.size; }

  isAllTop(): boolean {
    for (let i = 0; i < this._size; i++) {
      if (this.values[i].kind !== "top") return false;
    }
    return true;
  }

  private ensureOwned(): void {
    if (this._shared) {
      this.values = this.values.slice();
      this._shared = false;
    }
  }

  _setAt(idx: number, value: AbstractValue): void {
    const old = this.values[idx];
    if (old !== value) {
      this.ensureOwned();
      this._xorHash ^= contrib(this._nameHashes[idx], old) ^ contrib(this._nameHashes[idx], value);
      this.values[idx] = value;
    }
  }

  _addEntry(scene: string, name: string, value: AbstractValue): number {
    this.ensureOwned();
    const idx = this._size++;
    if (idx < this.values.length) {
      this._xorHash ^= contrib(this._nameHashes[idx], this.values[idx]) ^ contrib(this._nameHashes[idx], value);
      this.values[idx] = value;
    } else {
      const nh = fnvMixStr(fnvMixStr(FNV_OFFSET, scene), name);
      this._nameHashes.push(nh);
      this._xorHash ^= contrib(nh, value);
      this.values.push(value);
    }
    return idx;
  }

  addScene(scene: string): SceneView {
    let sv = this._scenes.get(scene);
    if (!sv) {
      sv = new SceneView(this, scene);
      this._scenes.set(scene, sv);
    }
    return sv;
  }

  get(scene: string): SceneView | undefined {
    return this._scenes.get(scene);
  }

  has(scene: string): boolean {
    return this._scenes.has(scene);
  }

  set(scene: string, vars: Map<string, AbstractValue>): this {
    let sv = this._scenes.get(scene);
    if (!sv) {
      sv = new SceneView(this, scene);
      this._scenes.set(scene, sv);
    }
    for (const [k, v] of vars) sv.set(k, v);
    return this;
  }

  shareValues(): AbstractValue[] {
    this._shared = true;
    return this.values;
  }

  adoptValues(src: AbstractValue[], hash: number): void {
    if (src.length < this._size) {
      src = src.slice();
      while (src.length < this._size) src.push(bottom);
      this.values = src;
      this._shared = false;
      this.recomputeXorHash();
    } else {
      this.values = src;
      this._shared = true;
      this._xorHash = hash;
    }
  }

  takeValues(src: AbstractValue[]): void {
    while (src.length < this._size) src.push(bottom);
    this.values = src;
    this._shared = false;
    this.recomputeXorHash();
  }

  cloneValues(): AbstractValue[] {
    return this.values.slice(0, this._size);
  }

  joinValues(src: AbstractValue[]): void {
    const len = Math.min(src.length, this._size);
    const nh = this._nameHashes;
    for (let i = 0; i < len; i++) {
      if (this.values[i] !== src[i]) {
        const old = this.values[i];
        const joined = joinAbstract(old, src[i]);
        if (joined !== old) {
          this.ensureOwned();
          this._xorHash ^= contrib(nh[i], old) ^ contrib(nh[i], joined);
          this.values[i] = joined;
        }
      }
    }
  }

  private recomputeXorHash(): void {
    let h = 0;
    const nh = this._nameHashes;
    const sz = this._size;
    for (let i = 0; i < sz; i++) {
      h ^= contrib(nh[i], this.values[i]);
    }
    this._xorHash = h;
  }

  *[Symbol.iterator](): IterableIterator<[string, SceneView]> {
    yield* this._scenes;
  }

  /** Restore all values to bottom (for full restoreTemps) */
  clearAllValues(): void {
    this.ensureOwned();
    this.values.fill(bottom, 0, this._size);
    this._xorHash = 0;
    const bh = valueHash(bottom);
    const nh = this._nameHashes;
    for (let i = 0; i < this._size; i++) {
      this._xorHash ^= contrib(nh[i], bottom);
    }
  }
}

// ── IndexedMap ──────────────────────────────────────────────────────────────

export class IndexedMap {
  readonly index: Map<string, number>;
  readonly names: string[];
  values: AbstractValue[];
  private _shared = false;
  private _nameHashes: number[];
  private _xorHash: number;

  constructor(index: Map<string, number>, names: string[], values?: AbstractValue[]) {
    this.index = index;
    this.names = names;
    this.values = values ?? new Array(index.size).fill(bottom);
    this._nameHashes = new Array(names.length);
    this._xorHash = 0;
    for (let i = 0; i < names.length; i++) {
      this._nameHashes[i] = fnvMixStr(FNV_OFFSET, names[i]);
      this._xorHash ^= contrib(this._nameHashes[i], this.values[i]);
    }
  }

  get xorHash(): number { return this._xorHash; }

  private ensureOwned(): void {
    if (this._shared) {
      this.values = this.values.slice();
      this._shared = false;
    }
  }

  private recomputeXorHash(): void {
    let h = 0;
    const nh = this._nameHashes;
    const vals = this.values;
    const len = this.names.length;
    for (let i = 0; i < len; i++) {
      h ^= contrib(nh[i], vals[i] ?? bottom);
    }
    this._xorHash = h;
  }

  get size(): number { return this.names.length; }

  get(key: string): AbstractValue | undefined {
    const idx = this.index.get(key);
    return idx !== undefined ? this.values[idx] : undefined;
  }

  set(key: string, value: AbstractValue): this {
    let idx = this.index.get(key);
    if (idx !== undefined) {
      const old = this.values[idx];
      if (old !== value) {
        this.ensureOwned();
        this._xorHash ^= contrib(this._nameHashes[idx], old) ^ contrib(this._nameHashes[idx], value);
        this.values[idx] = value;
      }
    } else {
      this.ensureOwned();
      idx = this.names.length;
      this.index.set(key, idx);
      this.names.push(key);
      const nh = fnvMixStr(FNV_OFFSET, key);
      this._nameHashes.push(nh);
      this._xorHash ^= contrib(nh, value);
      this.values.push(value);
    }
    return this;
  }

  has(key: string): boolean {
    return this.index.has(key);
  }

  isAllTop(): boolean {
    for (let i = 0; i < this.values.length; i++) {
      if (this.values[i].kind !== "top") return false;
    }
    return true;
  }

  clear(): void {
    this.ensureOwned();
    this.values.fill(bottom);
    this.recomputeXorHash();
  }

  *[Symbol.iterator](): IterableIterator<[string, AbstractValue]> {
    for (let i = 0; i < this.names.length; i++) {
      yield [this.names[i], this.values[i]];
    }
  }

  entries(): IterableIterator<[string, AbstractValue]> {
    return this[Symbol.iterator]();
  }

  forEach(fn: (value: AbstractValue, key: string) => void): void {
    for (let i = 0; i < this.names.length; i++) {
      fn(this.values[i], this.names[i]);
    }
  }

  cloneValues(): AbstractValue[] {
    const len = this.names.length;
    const result = this.values.slice(0, len);
    while (result.length < len) result.push(bottom);
    return result;
  }

  clone(): IndexedMap {
    return new IndexedMap(this.index, this.names, this.values.slice());
  }

  shareValues(): AbstractValue[] {
    this._shared = true;
    return this.values;
  }

  adoptValues(src: AbstractValue[], hash?: number): void {
    const len = this.names.length;
    if (src.length < len) {
      src = src.slice();
      while (src.length < len) src.push(bottom);
      this.values = src;
      this._shared = false;
      this.recomputeXorHash();
    } else {
      this.values = src;
      this._shared = true;
      if (hash !== undefined) this._xorHash = hash;
      else this.recomputeXorHash();
    }
  }

  takeValues(src: AbstractValue[]): void {
    const len = this.names.length;
    while (src.length < len) src.push(bottom);
    this.values = src;
    this._shared = false;
    this.recomputeXorHash();
  }

  joinValues(src: AbstractValue[]): void {
    if (src === this.values) return;
    const len = Math.min(src.length, this.values.length);
    const nh = this._nameHashes;
    for (let i = 0; i < len; i++) {
      const old = this.values[i];
      const srcVal = src[i];
      if (old === srcVal || old.kind === "top") continue;
      const joined = joinAbstract(old, srcVal);
      if (joined !== old) {
        this.ensureOwned();
        this._xorHash ^= contrib(nh[i], old) ^ contrib(nh[i], joined);
        this.values[i] = joined;
      }
    }
  }
}
