// Extrude: chosen regions in a sketch are pulled out along the plane's normal.

import { t } from '../i18n';
import { selectedRegionsScad } from '../sketch/codegen';
import { selectRegions } from '../sketch/regions';
import { FieldReader, fnFor, inwardOf, num, OP_LABEL, outwardOf, type FeatureBase, type FeatureKind, type Op, type Vec } from './common';

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  sketch: string; // the sketch's feature id
  regions: Vec[] | null; // seeds (points in chosen regions); null = default
  depth: string; // expression (mm)
  direction: 'normal' | 'reverse' | 'symmetric';
  op: Op;
  /** Radius for the profile's corners (vertical edges); empty/0 = sharp. */
  radius?: string;
  /** Edge shape at the ends. */
  edge?: 'none' | 'fillet' | 'chamfer';
  edgeSize?: string;
  edgeWhere?: 'far' | 'near' | 'both';
}

/** Number of layers for a rounded/chamfered edge – about one per 0.2 mm (one print layer). */
const edgeLayers = (e: number) => Math.min(20, Math.max(4, Math.ceil(e / 0.2)));

/**
 * The body from z = 0 to h with rounded/chamfered edges, built from thin layers where the profile
 * is inset (OpenSCAD has no real rounding of 3D edges).
 */
function edgedBody(profile: string, h: { v: number; code: string }, kind: 'fillet' | 'chamfer', e: number, near: boolean, far: boolean): string {
  const N = edgeLayers(e);
  const inset = (u: number) => (kind === 'chamfer' ? u * e : e - Math.sqrt(Math.max(0, e * e - (u * e) ** 2)));
  const parts: string[] = [];
  const zb = near ? e : 0, zt = far ? e : 0;
  const middle = h.v - zb - zt > 1e-9;
  if (middle) parts.push(`translate([0, 0, ${num(zb)}]) linear_extrude(height = ${h.code} - ${num(zb + zt)}) ${profile};`);
  const slab = (z0: string, height: number, u: number) => `translate([0, 0, ${z0}]) linear_extrude(height = ${num(height)}) offset(r = -${num(inset(u))}, $fn = ${fnFor(2 * Math.max(inset(u), 0.5))}) ${profile};`;
  for (let k = 0; k < N; k++) {
    const u = (k + 0.5) / N; // fraction into the edge (middle of the layer)
    // Each layer overlaps the layer below by 0.01 mm so no faces merely touch (except the first
    // layer if it starts at z = 0).
    const ov = k === 0 && !middle && !near ? 0 : 0.01;
    if (far) parts.push(slab(`${h.code} - ${num(e - (k * e) / N + ov)}`, e / N + ov, u));
    if (near) parts.push(slab(num((e * (N - 1 - k)) / N), e / N + 0.01, u));
  }
  return `union() {
${parts.map(p => `    ${p}`).join('\n')}
  }`;
}

export const extrude: FeatureKind<ExtrudeFeature> = {
  type: 'extrude',
  label: 'feat.extrude',
  icon: '<svg viewBox="0 0 24 24"><path d="M5 17l7 3 7-3M5 17V9l7 3 7-3v8M12 12v8M5 9l7-3 7 3"/></svg>',
  pick: { kind: 'regions' },
  fields: [
    { kind: 'expr', key: 'depth', label: 'field.depth', unit: 'mm' },
    {
      kind: 'choice',
      key: 'direction',
      options: [
        { value: 'normal', label: 'dir.up' },
        { value: 'reverse', label: 'dir.down' },
        { value: 'symmetric', label: 'dir.symmetric' },
      ],
    },
    {
      kind: 'choice',
      key: 'op',
      options: [
        { value: 'add', label: 'op.add' },
        { value: 'remove', label: 'op.remove' },
        { value: 'intersect', label: 'op.intersect' },
      ],
    },
    { kind: 'heading', label: 'edge.title' },
    { kind: 'expr', key: 'radius', label: 'field.cornerRadius', unit: 'mm' },
    {
      kind: 'choice',
      key: 'edge',
      options: [
        { value: 'none', label: 'edge.none' },
        { value: 'fillet', label: 'edge.fillet' },
        { value: 'chamfer', label: 'edge.chamfer' },
      ],
    },
    { kind: 'expr', key: 'edgeSize', label: 'edge.size', unit: 'mm', show: f => (f.edge ?? 'none') !== 'none' },
    {
      kind: 'choice',
      key: 'edgeWhere',
      show: f => (f.edge ?? 'none') !== 'none',
      options: [
        { value: 'far', label: 'edge.far' },
        { value: 'near', label: 'edge.near' },
        { value: 'both', label: 'edge.both' },
      ],
    },
  ],

  create: (id, name, sk) => ({
    type: 'extrude', id, name, sketch: sk.id, regions: null, depth: '10', direction: outwardOf(sk), op: 'add',
    radius: '0', edge: 'none', edgeSize: '1', edgeWhere: 'far',
  }),

  detail: f => {
    const dir = f.direction === 'symmetric' ? ' ↕' : f.direction === 'reverse' ? ' ↓' : '';
    const edge = f.edge && f.edge !== 'none' ? ` · ${t(f.edge === 'fillet' ? 'edge.filletShort' : 'edge.chamferShort')} ${f.edgeSize}` : '';
    const op = f.op === 'add' ? '' : ` · ${t(OP_LABEL[f.op]).toLowerCase()}`;
    return `${f.depth} mm${dir}${edge}${op}`;
  },

  usable: () => true,

  changed(f, key, sk) {
    // Sketch on a face: add outwards, remove inwards into the body (symmetric is left alone).
    if (key === 'op' && sk?.outward && f.direction !== 'symmetric') f.direction = f.op === 'remove' ? inwardOf(sk) : outwardOf(sk);
  },

  build(f, sk, ctx) {
    const { loops, regions } = ctx.regions(sk);
    const sel = selectRegions(regions, loops, f.regions);
    if (!sel.length) return { error: loops.length ? t('err.noRegions') : t('err.sketchNoRegions') };
    const r = new FieldReader(ctx);
    const h = r.positive(t('field.depth'), f.depth);
    const rad = r.read(t('field.cornerRadius'), f.radius || '0', v => v >= 0, t('err.notNegative'));
    const edge = f.edge ?? 'none';
    const e = edge === 'none' ? null : r.positive(t('edge.size'), f.edgeSize ?? '');
    if (r.error) return { error: r.error };
    const where = f.edgeWhere ?? 'far';
    if (e && e.v * (where === 'both' ? 2 : 1) > h.v + 1e-9) return { error: t('err.edgeTooLarge') };
    const shape = selectedRegionsScad(loops, regions, sel, '    ')!;
    const m = ctx.module;
    // Corner radius: round both convex and concave corners.
    const profile =
      rad.v > 0
        ? `  offset(r = ${rad.code}, $fn = ${fnFor(2 * rad.v)}) offset(delta = -${rad.code}) offset(r = -${rad.code}, $fn = ${fnFor(2 * rad.v)}) offset(delta = ${rad.code}) {\n${shape}\n  }`
        : `  union() {\n${shape}\n  }`;
    const body = e && edge !== 'none' ? edgedBody(`${m}_profile()`, h, edge, e.v, where !== 'far', where !== 'near') : `linear_extrude(height = ${h.code}) ${m}_profile();`;
    const dir = f.direction === 'symmetric' ? `translate([0, 0, -${h.code} / 2]) ` : f.direction === 'reverse' ? 'mirror([0, 0, 1]) ' : '';
    // Outwards from a round face: extend in to the surface (the seat) so there is no gap.
    const seat = f.op === 'add' && sk.seat && f.direction === outwardOf(sk) ? sk.seat : 0;
    const solid = seat ? `union() {\n    ${body}\n    translate([0, 0, -${num(seat)}]) linear_extrude(height = ${num(seat + 0.01)}) ${m}_profile();\n  }` : body;
    const code = `module ${m}_profile() {\n${profile}\n}\nmodule ${m}() {\n  ${ctx.place(sk)}${dir}${solid}\n}`;
    return { code, tools: [{ op: f.op, call: `${m}();` }] };
  },
};
