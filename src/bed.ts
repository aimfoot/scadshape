// The printer's build volume (☰ → Settings): drawn under the model in the 3D view, and the status
// bar warns when the model does not fit. Bambu Lab A1 mini by default.

export type Bed = { w: number; d: number; h: number };

export const BED_PRESETS: { id: string; name: string; bed: Bed }[] = [
  { id: 'a1mini', name: 'Bambu Lab A1 mini', bed: { w: 180, d: 180, h: 180 } },
  { id: 'a1', name: 'Bambu Lab A1 / P1S / X1', bed: { w: 256, d: 256, h: 256 } },
  { id: 'mk4', name: 'Prusa MK4', bed: { w: 250, d: 210, h: 220 } },
  { id: 'mini', name: 'Prusa MINI', bed: { w: 180, d: 180, h: 180 } },
  { id: 'ender3', name: 'Creality Ender-3', bed: { w: 220, d: 220, h: 250 } },
];
export const DEFAULT_BED = 'a1mini';

/** The saved choice: a preset id, or 'custom' with its own sizes. */
export type BedChoice = { preset: string } & Partial<Bed>;

/** The build volume for a choice (an unknown preset → the default; bad custom sizes → the default's). */
export function bedOf(c: BedChoice | null): Bed {
  const def = BED_PRESETS.find(p => p.id === DEFAULT_BED)!.bed;
  if (c?.preset === 'custom') {
    const ok = (v: unknown): v is number => typeof v === 'number' && v > 0 && v < 10000;
    return { w: ok(c.w) ? c.w : def.w, d: ok(c.d) ? c.d : def.d, h: ok(c.h) ? c.h : def.h };
  }
  return BED_PRESETS.find(p => p.id === c?.preset)?.bed ?? def;
}

export function parseBedChoice(json: string | null): BedChoice {
  try {
    const c = JSON.parse(json ?? '');
    if (c && typeof c.preset === 'string') return c;
  } catch {
    /* not saved yet */
  }
  return { preset: DEFAULT_BED };
}

/** Does a model of size sx × sy × sz fit (turned 90° on the plate if that helps)? */
export function fitsBed(size: [number, number, number], bed: Bed): boolean {
  const [sx, sy, sz] = size, e = 1e-3;
  return sz <= bed.h + e && ((sx <= bed.w + e && sy <= bed.d + e) || (sx <= bed.d + e && sy <= bed.w + e));
}

/** A model's size (x, y, z) from its triangles. */
export function meshSize(pos: Float32Array): [number, number, number] {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    if (pos[i] < mn[k]) mn[k] = pos[i];
    if (pos[i] > mx[k]) mx[k] = pos[i];
  }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}
