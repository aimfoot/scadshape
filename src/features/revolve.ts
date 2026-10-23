// Revolve: chosen regions are rotated around an axis in the sketch's plane.

import { t } from '../i18n';
import { selectedRegionsScad } from '../sketch/codegen';
import { selectRegions } from '../sketch/regions';
import { FieldReader, num, OP_LABEL, type FeatureBase, type FeatureKind, type Op, type SketchFeature, type Vec } from './common';
import { segmentsFor } from '../sketch/geom';

export type RevolveAxis = { kind: 'line'; e: string } | { kind: 'x' } | { kind: 'y' };

export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  sketch: string;
  regions: Vec[] | null;
  axis: RevolveAxis;
  angle: string; // expression (degrees)
  symmetric?: boolean;
  op: Op;
}

/** The axis as a point + unit direction in the sketch's plane. */
export function revolveAxis(f: RevolveFeature, sk: SketchFeature): { a: Vec; d: Vec } | null {
  if (f.axis.kind === 'x') return { a: { x: 0, y: 0 }, d: { x: 1, y: 0 } };
  if (f.axis.kind === 'y') return { a: { x: 0, y: 0 }, d: { x: 0, y: 1 } };
  const l = sk.entities[f.axis.e];
  if (l?.type !== 'line') return null;
  const a = sk.points[l.p1], b = sk.points[l.p2];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  return L > 1e-9 ? { a, d: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } } : null;
}

/** Axes to choose from in the view: the sketch's X/Y axis and all lines. */
export function axisCandidates(sk: SketchFeature): { axis: RevolveAxis; a: Vec; b: Vec }[] {
  const ps = Object.values(sk.points);
  const ext = Math.max(30, ...ps.map(p => Math.abs(p.x)), ...ps.map(p => Math.abs(p.y))) * 1.3;
  const out: { axis: RevolveAxis; a: Vec; b: Vec }[] = [
    { axis: { kind: 'x' }, a: { x: -ext, y: 0 }, b: { x: ext, y: 0 } },
    { axis: { kind: 'y' }, a: { x: 0, y: -ext }, b: { x: 0, y: ext } },
  ];
  for (const [id, e] of Object.entries(sk.entities))
    if (e.type === 'line') out.push({ axis: { kind: 'line', e: id }, a: sk.points[e.p1], b: sk.points[e.p2] });
  return out;
}

export const revolve: FeatureKind<RevolveFeature> = {
  type: 'revolve',
  label: 'feat.revolve',
  icon: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="17" rx="7" ry="2.5"/><path d="M5 17V8M19 17V8"/><ellipse cx="12" cy="8" rx="7" ry="2.5"/></svg>',
  pick: { kind: 'regions', axis: true },
  fields: [
    { kind: 'expr', key: 'angle', label: 'field.angle', unit: '°' },
    { kind: 'check', key: 'symmetric', label: 'field.symmetric' },
    {
      kind: 'choice',
      key: 'op',
      options: [
        { value: 'add', label: 'op.add' },
        { value: 'remove', label: 'op.remove' },
        { value: 'intersect', label: 'op.intersect' },
      ],
    },
  ],

  create: (id, name, sk) => ({ type: 'revolve', id, name, sketch: sk.id, regions: null, axis: { kind: 'y' }, angle: '360', op: 'add' }),

  detail: f => `${f.angle}°${f.op === 'add' ? '' : ` · ${t(OP_LABEL[f.op]).toLowerCase()}`}`,

  usable: () => true,

  build(f, sk, ctx) {
    const { loops, regions } = ctx.regions(sk);
    const sel = selectRegions(regions, loops, f.regions);
    if (!sel.length) return { error: loops.length ? t('err.noRegions') : t('err.sketchNoRegions') };
    const r = new FieldReader(ctx);
    const ang = r.read(t('field.angle'), f.angle, v => v > 0 && v <= 360, t('err.angle360'));
    if (r.error) return { error: r.error };
    const axis = revolveAxis(f, sk);
    if (!axis) return { error: t('err.axisGone') };
    let { d } = axis;
    const { a } = axis;
    let n = { x: -d.y, y: d.x };
    // The profile must lie on one side of the axis.
    let lo = Infinity, hi = -Infinity, rmax = 0;
    for (const i of sel)
      for (const p of loops[regions[i].loop].pts) {
        const rr = (p.x - a.x) * n.x + (p.y - a.y) * n.y;
        lo = Math.min(lo, rr);
        hi = Math.max(hi, rr);
        rmax = Math.max(rmax, Math.abs(rr));
      }
    const eps = 1e-6 * Math.max(1, rmax);
    if (lo < -eps && hi > eps) return { error: t('err.crossesAxis') };
    if (hi <= eps) {
      n = { x: -n.x, y: -n.y };
      d = { x: -d.x, y: -d.y };
    }
    const an = a.x * n.x + a.y * n.y, ad = a.x * d.x + a.y * d.y;
    // 2D: the sketch → profile (x = distance from the axis, y = along the axis); 3D: back to the
    // sketch's plane.
    const m2 = `[[${num(n.x)}, ${num(n.y)}, 0, ${num(-an)}], [${num(d.x)}, ${num(d.y)}, 0, ${num(-ad)}], [0, 0, 1, 0], [0, 0, 0, 1]]`;
    const m3 = `[[${num(n.x)}, 0, ${num(d.x)}, ${num(a.x)}], [${num(n.y)}, 0, ${num(d.y)}, ${num(a.y)}], [0, 1, 0, 0], [0, 0, 0, 1]]`;
    const fn = Math.min(180, segmentsFor(Math.max(rmax, 1), Math.PI * 2, 0.02));
    const start = f.symmetric ? `rotate([0, 0, -${ang.code} / 2]) ` : '';
    const code =
      `module ${ctx.module}() {\n  ${ctx.place(sk)}multmatrix(${m3}) ${start}rotate_extrude(angle = ${ang.code}, $fn = ${fn})\n` +
      `    multmatrix(${m2}) {\n${selectedRegionsScad(loops, regions, sel, '    ')}\n  }\n}`;
    return { code, tools: [{ op: f.op, call: `${ctx.module}();` }] };
  },
};
