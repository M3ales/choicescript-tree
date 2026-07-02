import { LineEdit } from "./diff-scenes";

export const diffLines = (oldLines: string[], newLines: string[]): LineEdit[] => {
  const n = oldLines.length;
  const m = newLines.length;

  let prefixLen = 0;
  const minLen = Math.min(n, m);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLines[n - 1 - suffixLen] === newLines[m - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldMid = oldLines.slice(prefixLen, n - suffixLen);
  const newMid = newLines.slice(prefixLen, m - suffixLen);

  if (oldMid.length === 0 && newMid.length === 0) return [];

  if (oldMid.length === 0 || newMid.length === 0) {
    return [{
      oldStart: prefixLen,
      oldCount: oldMid.length,
      newStart: prefixLen,
      newCount: newMid.length,
    }];
  }

  const rawEdits = myersDiff(oldMid, newMid);
  const shifted: LineEdit[] = [];
  for (const e of rawEdits) {
    shifted.push({
      oldStart: e.oldStart + prefixLen,
      oldCount: e.oldCount,
      newStart: e.newStart + prefixLen,
      newCount: e.newCount,
    });
  }
  return shifted;
};

interface EditOp {
  type: "insert" | "delete" | "equal";
  oldIdx: number;
  newIdx: number;
}

const myersDiff = (a: string[], b: string[]): LineEdit[] => {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  v.fill(-1);
  const offset = max;
  v[offset + 1] = 0;

  const trace: Int32Array[] = [];

  outer:
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  const ops = backtrack(trace, offset, n, m, a, b);
  return collapseOps(ops);
};

const backtrack = (
  trace: Int32Array[],
  offset: number,
  n: number,
  m: number,
  _a: string[],
  _b: string[],
): EditOp[] => {
  const ops: EditOp[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: "equal", oldIdx: x, newIdx: y });
    }

    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: "insert", oldIdx: x, newIdx: y - 1 });
        y--;
      } else {
        ops.push({ type: "delete", oldIdx: x - 1, newIdx: y });
        x--;
      }
    }
  }

  ops.reverse();
  return ops;
};

const collapseOps = (ops: EditOp[]): LineEdit[] => {
  const edits: LineEdit[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      i++;
      continue;
    }
    let oldStart = ops[i].oldIdx;
    let newStart = ops[i].newIdx;
    let oldCount = 0;
    let newCount = 0;

    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") {
        if (oldCount === 0) oldStart = ops[i].oldIdx;
        oldCount++;
      } else {
        if (newCount === 0) newStart = ops[i].newIdx;
        newCount++;
      }
      i++;
    }

    edits.push({ oldStart, oldCount, newStart, newCount });
  }
  return edits;
};
