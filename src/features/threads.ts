// Metriska gängor (ISO 68-1-profil, enkelgängad högergänga) som OpenSCAD-kod.
//
// Tvärsnittet vinkelrätt mot axeln är r(θ) = profil(θ/2π); en vriden extrudering
// (−360° per stigning) ger då exakt helixen eftersom profilen är symmetrisk.

import { num } from './common';

/** Grova metriska gängor: nominell diameter och stigning (mm). */
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

/** Gängdjup (radiellt) för ISO-profilen: 5/8 av den teoretiska höjden H = 0,866·P. */
export const threadDepth = (p: number) => (5 / 8) * 0.8660254 * p;

/** Hålets diameter för en invändig gänga (mutterns innerdiameter, D − 1,0825·P). */
export const minorDiameter = (d: number, p: number) => d - 1.0825 * p;

/** Närmaste standardgänga till en diameter (som ytter- eller innerdiameter). */
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

/** Radie vid axiell position u (andelar av stigningen, 0 = mitt på toppen). */
function profile(u: number, R: number, h: number) {
  const v = Math.abs(u - Math.round(u)); // 0 … 0,5
  if (v <= 1 / 16) return R;
  if (v < 3 / 8) return R - ((v - 1 / 16) / (5 / 16)) * h;
  return R - h;
}

export interface ThreadOptions {
  /** Gängans yttre radie (redan justerad för spel). */
  R: number;
  /** Stigning (mm). */
  P: number;
  /** Längd längs +z från z0. */
  L: number;
  z0?: number;
  /** Fasa av gängan i båda ändar (utvändig gänga). */
  chamfer?: boolean;
  /** Infasning vid ingången (invändig gänga, z = z0). */
  entry?: boolean;
}

/** OpenSCAD för en gängad stav längs +z. Kordafel ≤ ~0,02 mm. */
export function threadScad(o: ThreadOptions, indent = ''): string {
  const { R, P, L } = o;
  const z0 = o.z0 ?? 0;
  const h = threadDepth(P);
  const N = Math.min(240, Math.max(64, Math.ceil((2 * Math.PI * R) / 0.35)));
  // Vridning per skiva så att kordan mellan skivorna avviker högst ~0,02 mm.
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
