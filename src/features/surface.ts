// Extruderad yta: en rund yta (cylindermantel, avrundning, kon …) förtjockas utåt eller skärs in
// längs sina egna normaler. Ytan är en kopia av modellens facetter när den valdes (ingen skiss).

import { resolveCurveRef, type CurveRef } from '../faceref';
import { t } from '../i18n';
import { segmentsFor } from '../sketch/geom';
import { FieldReader, num, OP_LABEL, type FeatureBase, type FeatureKind } from './common';

export interface SurfaceFeature extends FeatureBase {
  type: 'surface';
  sketch: ''; // ingen skiss
  /** Ytans trianglar i världen, 9 tal per triangel (utåtriktade): används om ref saknas eller inte går att lösa. */
  tris: number[];
  /** Sidan på en extruderad cirkel/båge: ytan byggs om ur den och följer dess mått. */
  ref?: CurveRef;
  depth: string;
  op: 'add' | 'remove';
}

type V3 = [number, number, number];

/**
 * Sluten kropp mellan ytan och en kopia förskjuten längs hörnens normaler: utåt `out` mm och
 * inåt `inn` mm. Sidorna följer ytans kant. Som OpenSCAD-polyhedron (medurs sett utifrån).
 */
export function thickenScad(tris: number[], out: number, inn: number): string {
  const idx = new Map<string, number>();
  const pts: V3[] = [];
  const normals: V3[] = [];
  const vi = (p: V3) => {
    const k = p.map(v => Math.round(v * 1e4)).join(',');
    let i = idx.get(k);
    if (i === undefined) {
      i = pts.length;
      idx.set(k, i);
      pts.push(p);
      normals.push([0, 0, 0]);
    }
    return i;
  };
  const faces: [number, number, number][] = [];
  for (let k = 0; k < tris.length; k += 9) {
    const q = [0, 1, 2].map(j => [tris[k + j * 3], tris[k + j * 3 + 1], tris[k + j * 3 + 2]] as V3);
    const f = q.map(vi) as [number, number, number];
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) continue;
    const u = q[1].map((v, i) => v - q[0][i]), w = q[2].map((v, i) => v - q[0][i]);
    const n: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; // längd = 2·area: viktat
    for (const i of f) for (let a = 0; a < 3; a++) normals[i][a] += n[a];
    faces.push(f);
  }
  const N = pts.length;
  const unitN = normals.map(n => {
    const L = Math.hypot(...n) || 1;
    return n.map(v => v / L) as V3;
  });
  const at = (i: number, d: number) => `[${pts[i].map((v, a) => num(v + unitN[i][a] * d)).join(', ')}]`;
  const points = [...pts.map((_, i) => at(i, out)), ...pts.map((_, i) => at(i, -inn))];
  // Utsidan (moturs sett utifrån i STL:en) → OpenSCAD vill ha medurs: vänd.
  const poly: number[][] = [];
  const directed = new Set(faces.flatMap(([a, b, c]) => [`${a}>${b}`, `${b}>${c}`, `${c}>${a}`]));
  for (const [a, b, c] of faces) {
    poly.push([a, c, b]); // ovansidan
    poly.push([a + N, b + N, c + N]); // undersidan (vänd utåt nedåt)
    for (const [p, q] of [[a, b], [b, c], [c, a]])
      if (!directed.has(`${q}>${p}`)) poly.push([p, q, q + N, p + N]); // kant: sidovägg
  }
  return `polyhedron(points = [${points.join(', ')}], faces = [${poly.map(f => `[${f.join(', ')}]`).join(', ')}], convexity = 10);`;
}

export const surface: FeatureKind<SurfaceFeature> = {
  type: 'surface',
  label: 'feat.surface',
  icon: '<svg viewBox="0 0 24 24"><path d="M4 16c4-6 12-6 16 0"/><path d="M4 11c4-6 12-6 16 0" stroke-dasharray="2 2"/><path d="M12 12V6"/></svg>',
  pick: { kind: 'none' },
  fields: [
    { kind: 'expr', key: 'depth', label: 'field.depth', unit: 'mm' },
    {
      kind: 'choice',
      key: 'op',
      options: [
        { value: 'add', label: 'surface.out' },
        { value: 'remove', label: 'surface.in' },
      ],
    },
  ],

  create: (id, name) => ({ type: 'surface', id, name, sketch: '', tris: [], depth: '2', op: 'add' }),

  detail: f => `${f.depth} mm${f.op === 'add' ? '' : ` · ${t(OP_LABEL[f.op]).toLowerCase()}`}`,

  usable: () => true,

  build(f, _sk, ctx) {
    const r = new FieldReader(ctx);
    const d = r.positive(t('field.depth'), f.depth);
    if (r.error) return { error: r.error };
    const side = f.ref && ctx.doc ? resolveCurveRef(ctx.doc, f.ref, ctx.vars, f.id) : null;
    if (side) {
      // En ring (eller ringsektor för en båge) kring cirkelns centrum, lika hög som extruderingen.
      // Samma $fn som skissens cirkel och 0,02 mm marginal: överlappar sidan rent (cirkeln avviker högst 0,01).
      const out = f.op === 'add' !== f.ref!.inside; // växer utåt från centrum
      const m = 0.02;
      const [rin, rout] = out ? [side.r - m, side.r + d.v] : [side.r - d.v, side.r + m];
      if (!(rin > 0)) return { error: t('err.surfaceTooDeep') };
      const [lo, hi] = f.op === 'add' ? side.span : [side.span[0] - 0.01, side.span[1] + 0.01];
      const fn = segmentsFor(side.r, 2 * Math.PI);
      const deg = (a: number) => num((a * 180) / Math.PI);
      const body = `translate([${num(side.c.x)}, ${num(side.c.y)}, ${num(lo)}]) rotate([0, 0, ${deg(side.a0)}]) rotate_extrude(angle = ${deg(side.sweep)}, $fn = ${fn}) translate([${num(rin)}, 0]) square([${num(rout - rin)}, ${num(hi - lo)}]);`;
      return { code: `module ${ctx.module}() {\n  ${ctx.place(side.sketch)}${body}\n}`, tools: [{ op: f.op, call: `${ctx.module}();` }] };
    }
    if (!f.tris.length) return { error: t('err.noSurface') };
    // En hundradels överlapp mot kroppen så att det smälter ihop (lägg till) eller skär rent (ta bort).
    const body = f.op === 'add' ? thickenScad(f.tris, d.v, 0.01) : thickenScad(f.tris, 0.01, d.v);
    return { code: `module ${ctx.module}() {\n  ${body}\n}`, tools: [{ op: f.op, call: `${ctx.module}();` }] };
  },
};
