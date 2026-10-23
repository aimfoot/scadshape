// Metric threads (ISO 68-1 profile, single-start right-hand thread) as OpenSCAD code.
//
// The cross-section perpendicular to the axis is r(θ) = profile(θ/2π); a twisted extrude (−360° per
// pitch) then gives exactly the helix because the profile is symmetric.

import { num } from './common';

/** Coarse metric threads: nominal diameter and pitch (mm). */
export const METRIC: Record<string, { d: number; p: number }> = {
  M2: { d: 2, p: 0.4 },
  'M2,5': { d: 2.5, p: 0.45 },
  M3: { d: 3, p: 0.5 },
  M4: { d: 4, p: 0.7 },
  M5: { d: 5, p: 0.8 },
  M6: { d: 6, p: 1 },
  M8: { d: 8, p: 1.25 },
  M10: { d: 10, p: 1.5 },
  M12: { d: 12, p: 1.75 },
  M16: { d: 16, p: 2 },
  M20: { d: 20, p: 2.5 },
  M24: { d: 24, p: 3 },
  M30: { d: 30, p: 3.5 },
};

/** Thread depth (radial) for the ISO profile: 5/8 of the theoretical height H = 0.866·P. */
export const threadDepth = (p: number) => (5 / 8) * 0.8660254 * p;

/** The hole's diameter for an internal thread (the nut's minor diameter, D − 1.0825·P). */
export const minorDiameter = (d: number, p: number) => d - 1.0825 * p;

/** The nearest standard thread to a diameter (as major or minor diameter). */
export function nearestMetric(diameter: number, as: 'major' | 'minor'): string {
  let best = 'M8', bestErr = Infinity;
  for (const [k, m] of Object.entries(METRIC)) {
    const err = Math.abs((as === 'major' ? m.d : minorDiameter(m.d, m.p)) - diameter);
    if (err < bestErr) {
      bestErr = err;
      best = k;
    }
  }
  return best;
}

/** Radius at axial position u (fractions of the pitch, 0 = middle of the crest). */
function profile(u: number, R: number, h: number) {
  const v = Math.abs(u - Math.round(u)); // 0 … 0,5
  if (v <= 1 / 16) return R;
  if (v < 3 / 8) return R - ((v - 1 / 16) / (5 / 16)) * h;
  return R - h;
}

export interface ThreadOptions {
  /** The thread's major radius (already adjusted for clearance). */
  R: number;
  /** Pitch (mm). */
  P: number;
  /** Length along +z from z0. */
  L: number;
  z0?: number;
  /** Chamfer the thread at both ends (external thread). */
  chamfer?: boolean;
  /** Lead-in chamfer at the entrance (internal thread, z = z0). */
  entry?: boolean;
}

/** OpenSCAD for a threaded rod along +z. Chord error ≤ ~0.02 mm. */
export function threadScad(o: ThreadOptions, indent = ''): string {
  const { R, P, L } = o;
  const z0 = o.z0 ?? 0;
  const h = threadDepth(P);
  const N = Math.min(240, Math.max(64, Math.ceil((2 * Math.PI * R) / 0.35)));
  // Twist per slice so the chord between slices deviates at most ~0.02 mm.
  const perTurn = Math.min(90, Math.max(24, Math.ceil((2 * Math.PI) / (2 * Math.acos(Math.max(-1, 1 - 0.02 / R))))));
  const slices = Math.max(2, Math.ceil((L / P) * perTurn));
  const pts: string[] = [];
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    const r = profile(i / N, R, h);
    pts.push(`[${num(r * Math.cos(a))}, ${num(r * Math.sin(a))}]`);
  }
  const fn = Math.min(240, N);
  const rod = `linear_extrude(height = ${num(L)}, twist = ${num((-360 * L) / P)}, slices = ${slices}, convexity = 10) polygon([${pts.join(', ')}]);`;
  let body = rod;
  if (o.chamfer) {
    const c = Math.min(h, L / 4);
    const prof = [[0, 0], [R - c, 0], [R, c], [R, L - c], [R - c, L], [0, L]].map(([x, y]) => `[${num(x)}, ${num(y)}]`).join(', ');
    body = `intersection() {\n${indent}  ${rod}\n${indent}  rotate_extrude($fn = ${fn}) polygon([${prof}]);\n${indent}}`;
  } else if (o.entry) {
    body = `union() {\n${indent}  ${rod}\n${indent}  cylinder(h = ${num(h)}, r1 = ${num(R)}, r2 = ${num(R - h)}, $fn = ${fn});\n${indent}}`;
  }
  return z0 ? `translate([0, 0, ${num(z0)}]) ${body}` : body;
}
