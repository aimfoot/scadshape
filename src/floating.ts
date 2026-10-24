// Places that start in mid-air: where the printer would have to begin a layer with nothing under
// it. On the mesh these are local bottoms of the surface – a point or a flat patch with no edge going
// further down – that face downwards (material above), are above the bottom of the model, and have
// nothing topping out at that height under them (another part's upward face). That covers a part
// floating on its own (a cut took away the top a neck stands on) as well as ridges hanging into a
// cavity inside one body. A closed void's floor faces up, and an overhang or a bridge is connected
// to a wall going down, so neither counts.

export interface MidAirStart {
  min: [number, number, number];
  max: [number, number, number];
  /** Height above the bottom of the whole model. */
  above: number;
  /** How many separate places start at this height. */
  count: number;
}

/** Closer than this (mm) counts as touching: the bed, or something below. Less than a layer. */
const TOUCH = 0.1;
/** Edges climbing less than this (mm) are flat: one patch. */
const FLAT = 0.001;

/** One id per corner for corners closer than 0.001 mm (the same point), and how many points there are. */
function weld(pos: Float32Array): { id: Int32Array; count: number } {
  const corners = pos.length / 3;
  let size = 1;
  while (size < corners * 2) size <<= 1;
  const keys = new Int32Array(size * 3), owner = new Int32Array(size).fill(-1), id = new Int32Array(corners);
  let count = 0;
  for (let v = 0; v < corners; v++) {
    const x = Math.round(pos[v * 3] * 1000), y = Math.round(pos[v * 3 + 1] * 1000), z = Math.round(pos[v * 3 + 2] * 1000);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    while (owner[h] >= 0 && !(keys[h * 3] === x && keys[h * 3 + 1] === y && keys[h * 3 + 2] === z)) h = (h + 1) & (size - 1);
    if (owner[h] < 0) [keys[h * 3], keys[h * 3 + 1], keys[h * 3 + 2], owner[h]] = [x, y, z, count++];
    id[v] = owner[h];
  }
  return { id, count };
}

export function midAirStarts(pos: Float32Array): MidAirStart[] {
  const n = pos.length / 9;
  if (!n) return [];
  const { id, count } = weld(pos);
  const z = new Float64Array(count);
  for (let c = 0; c < id.length; c++) z[id[c]] = pos[c * 3 + 2];
  let bottom = Infinity;
  for (let v = 0; v < count; v++) bottom = Math.min(bottom, z[v]);

  // Flat patches: points joined by edges that don't climb.
  const parent = new Int32Array(count);
  for (let v = 0; v < count; v++) parent[v] = v;
  const find = (v: number) => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]];
    return v;
  };
  for (let c = 0; c < id.length; c++) {
    const a = id[c], b = id[c - (c % 3) + ((c % 3) + 1) % 3];
    if (Math.abs(z[a] - z[b]) <= FLAT) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  // Per patch: does an edge go further down, and which way does the surface around it face?
  const down = new Uint8Array(count), facing = new Float64Array(count);
  const up = new Float64Array(n); // per triangle: twice its area times its normal's z
  for (let t = 0; t < n; t++) {
    const p = t * 9;
    up[t] = (pos[p + 3] - pos[p]) * (pos[p + 7] - pos[p + 1]) - (pos[p + 4] - pos[p + 1]) * (pos[p + 6] - pos[p]);
    const r = [find(id[t * 3]), find(id[t * 3 + 1]), find(id[t * 3 + 2])];
    for (let k = 0; k < 3; k++) {
      if (r.indexOf(r[k]) === k) facing[r[k]] += up[t];
      const a = id[t * 3 + k], b = id[t * 3 + (k + 1) % 3];
      if (r[k] === r[(k + 1) % 3]) continue;
      if (z[b] < z[a] - FLAT) down[r[k]] = 1;
      if (z[a] < z[b] - FLAT) down[r[(k + 1) % 3]] = 1;
    }
  }
  // Local bottoms facing down, above the bed: their extent.
  const box = new Map<number, number[]>();
  for (let c = 0; c < id.length; c++) {
    const r = find(id[c]);
    if (down[r] || facing[r] >= 0 || z[r] - bottom <= TOUCH) continue;
    const b = box.get(r) ?? [Infinity, Infinity, -Infinity, -Infinity];
    box.set(r, [Math.min(b[0], pos[c * 3]), Math.min(b[1], pos[c * 3 + 1]), Math.max(b[2], pos[c * 3]), Math.max(b[3], pos[c * 3 + 1])]);
  }
  // Standing on something: an upward face that tops out at this height under it.
  const starts: { z: number; b: number[] }[] = [];
  for (const [r, b] of box) {
    let rests = false;
    for (let t = 0; t < n && !rests; t++) {
      if (up[t] <= 0) continue;
      const p = t * 9, top = Math.max(pos[p + 2], pos[p + 5], pos[p + 8]);
      if (Math.abs(top - z[r]) > TOUCH) continue;
      rests = Math.max(pos[p], pos[p + 3], pos[p + 6]) >= b[0] && Math.min(pos[p], pos[p + 3], pos[p + 6]) <= b[2]
        && Math.max(pos[p + 1], pos[p + 4], pos[p + 7]) >= b[1] && Math.min(pos[p + 1], pos[p + 4], pos[p + 7]) <= b[3];
    }
    if (!rests) starts.push({ z: z[r], b });
  }
  // One entry per height (eight ridges hanging at the same height are one problem).
  const out: MidAirStart[] = [];
  for (const s of starts.sort((a, b) => a.z - b.z)) {
    const last = out.at(-1);
    if (last && s.z - last.min[2] <= TOUCH) {
      last.min = [Math.min(last.min[0], s.b[0]), Math.min(last.min[1], s.b[1]), last.min[2]];
      last.max = [Math.max(last.max[0], s.b[2]), Math.max(last.max[1], s.b[3]), last.max[2]];
      last.count++;
    } else out.push({ min: [s.b[0], s.b[1], s.z], max: [s.b[2], s.b[3], s.z], above: s.z - bottom, count: 1 });
  }
  return out;
}
