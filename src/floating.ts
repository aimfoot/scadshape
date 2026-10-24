// Parts that start in mid-air: the rendered mesh split into connected bodies, and a body whose
// bottom is above the model's bottom with nothing under it (no other body reaching up to that
// height below it) is reported – it can't be printed like that. A typical AI mistake: a cut that
// takes away the floor a neck or a lid stands on, or parts placed for an assembly.

export interface FloatingPart {
  min: [number, number, number];
  max: [number, number, number];
  /** Height above the bottom of the whole model. */
  above: number;
}

/** Closer than this (mm) counts as touching: the bed, or a body below. Less than a layer. */
const TOUCH = 0.1;

/** Connected bodies of a triangle soup (corners closer than 0.001 mm are the same point): a body index per triangle. */
function bodies(pos: Float32Array): { of: Int32Array; count: number } {
  const n = pos.length / 9, parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // Open addressing on the corners rounded to 0.001 mm: the first triangle seen at each point.
  let size = 1;
  while (size < pos.length / 3 * 2) size <<= 1;
  const keys = new Int32Array(size * 3), owner = new Int32Array(size).fill(-1);
  for (let v = 0; v < pos.length / 3; v++) {
    const x = Math.round(pos[v * 3] * 1000), y = Math.round(pos[v * 3 + 1] * 1000), z = Math.round(pos[v * 3 + 2] * 1000);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    const t = (v / 3) | 0;
    for (;;) {
      if (owner[h] < 0) {
        [keys[h * 3], keys[h * 3 + 1], keys[h * 3 + 2], owner[h]] = [x, y, z, t];
        break;
      }
      if (keys[h * 3] === x && keys[h * 3 + 1] === y && keys[h * 3 + 2] === z) {
        const a = find(owner[h]), b = find(t);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        break;
      }
      h = (h + 1) & (size - 1);
    }
  }
  const of = new Int32Array(n), index = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!index.has(r)) index.set(r, index.size);
    of[i] = index.get(r)!;
  }
  return { of, count: index.size };
}

export function floatingParts(pos: Float32Array): FloatingPart[] {
  const n = pos.length / 9;
  if (!n) return [];
  const { of, count } = bodies(pos);
  if (count < 2) return []; // one body always rests on the bottom of the model
  const min = new Float64Array(count * 3).fill(Infinity), max = new Float64Array(count * 3).fill(-Infinity);
  const volume = new Float64Array(count);
  for (let t = 0; t < n; t++) {
    const p = t * 9;
    for (let k = 0; k < 9; k++) {
      const b = of[t] * 3 + (k % 3), v = pos[p + k];
      if (v < min[b]) min[b] = v;
      if (v > max[b]) max[b] = v;
    }
    volume[of[t]] += pos[p] * (pos[p + 4] * pos[p + 8] - pos[p + 5] * pos[p + 7])
      - pos[p + 1] * (pos[p + 3] * pos[p + 8] - pos[p + 5] * pos[p + 6]) + pos[p + 2] * (pos[p + 3] * pos[p + 7] - pos[p + 4] * pos[p + 6]);
  }
  let bottom = Infinity;
  for (let b = 0; b < count; b++) bottom = Math.min(bottom, min[b * 3 + 2]);
  const out: FloatingPart[] = [];
  for (let b = 0; b < count; b++) {
    const z = min[b * 3 + 2];
    // A shell facing inwards (negative volume) is a closed void inside a body, not a part.
    if (z - bottom <= TOUCH || volume[b] <= 0) continue;
    // Resting on another body: one of its triangles tops out at this height, under this body's footprint.
    let rests = false;
    for (let t = 0; t < n && !rests; t++) {
      if (of[t] === b) continue;
      const p = t * 9;
      const top = Math.max(pos[p + 2], pos[p + 5], pos[p + 8]);
      if (Math.abs(top - z) > TOUCH) continue;
      rests = Math.max(pos[p], pos[p + 3], pos[p + 6]) >= min[b * 3] && Math.min(pos[p], pos[p + 3], pos[p + 6]) <= max[b * 3]
        && Math.max(pos[p + 1], pos[p + 4], pos[p + 7]) >= min[b * 3 + 1] && Math.min(pos[p + 1], pos[p + 4], pos[p + 7]) <= max[b * 3 + 1];
    }
    if (!rests) out.push({ min: [min[b * 3], min[b * 3 + 1], z], max: [max[b * 3], max[b * 3 + 1], max[b * 3 + 2]], above: z - bottom });
  }
  return out;
}
