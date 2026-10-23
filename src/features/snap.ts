// Snap hook (cantilever with a barb) or a catch for a hook, at points in a sketch (or at the
// sketch's origin). The beam stands along the plane's normal, centered on the point; the barb
// points at the angle in the plane. The strain at the root (ε = 1.5·t·y/L², straight beam) is shown
// in the panel.

import type { Vars } from '../expr';
import { parseExpr } from '../expr';
import { fmtNum } from '../sketch/geom';
import { t } from '../i18n';
import { FieldReader, inwardOf, num, outwardOf, type FeatureBase, type FeatureKind } from './common';
import { textAnchors } from './text';

export interface SnapFeature extends FeatureBase {
  type: 'snap';
  sketch: string;
  points: string[] | null; // null = all standalone points (or the origin if there are none)
  kind: 'hook' | 'catch';
  length: string; // the beam's length (hook) from the root to the top of the barb
  thickness: string; // the beam's thickness in the bending direction
  width: string;
  overhang: string; // the barb's overhang (= the deflection during assembly)
  retention: 'lock' | 'release'; // back side 90° (locks) or 45° (can be taken apart)
  angle: string; // which way the barb points (degrees counterclockwise from the sketch's X)
  clearance: string; // catch: clearance per side
  depth: string; // catch: depth
  direction: 'normal' | 'reverse';
  start?: string;
}

/** The lead-in angle against the beam (degrees): easy to push in. */
const RAMP = 30;
/** Strain that PLA tolerates in repeated assembly (roughly). */
export const PLA_STRAIN = 0.025;

/** The strain at the root for a straight beam with a rectangular cross-section, or null if the sizes are wrong. */
export function snapStrain(f: Pick<SnapFeature, 'length' | 'thickness' | 'overhang'>, vars: Vars): number | null {
  const L = parseExpr(f.length, vars).value, th = parseExpr(f.thickness, vars).value, y = parseExpr(f.overhang, vars).value;
  if (!(L && th && y) || L <= 0 || th <= 0 || y <= 0) return null;
  return (1.5 * th * y) / (L * L);
}

export const snap: FeatureKind<SnapFeature> = {
  type: 'snap',
  label: 'feat.snap',
  icon: '<svg viewBox="0 0 24 24"><path d="M4 21h16"/><path d="M9 21v-3l1-1V6l-1-1V3h3l4 4-2.5 1.5H12V17l1 1v3"/></svg>',
  pick: { kind: 'points' },
  fields: [
    {
      kind: 'choice',
      key: 'kind',
      options: [
        { value: 'hook', label: 'snap.hook' },
        { value: 'catch', label: 'snap.catch' },
      ],
    },
    { kind: 'pair', fields: [
      { kind: 'expr', key: 'length', label: 'field.length', show: f => f.kind === 'hook' },
      { kind: 'expr', key: 'thickness', label: 'snap.thickness' },
    ] },
    { kind: 'pair', fields: [
      { kind: 'expr', key: 'width', label: 'snap.width' },
      { kind: 'expr', key: 'overhang', label: 'snap.overhang' },
    ] },
    {
      kind: 'choice',
      key: 'retention',
      show: f => f.kind === 'hook',
      options: [
        { value: 'lock', label: 'snap.lock' },
        { value: 'release', label: 'snap.release' },
      ],
    },
    {
      kind: 'note',
      show: f => f.kind === 'hook',
      text: (f, vars) => {
        const e = snapStrain(f, vars);
        if (e === null) return null;
        const pct = fmtNum(e * 100, 1);
        return e > PLA_STRAIN ? { text: t('snap.strainHigh', { pct }), warn: true } : { text: t('snap.strainOk', { pct }) };
      },
    },
    { kind: 'note', show: f => f.kind === 'hook', text: () => ({ text: t('snap.printTip') }) },
    { kind: 'pair', fields: [
      { kind: 'expr', key: 'clearance', label: 'snap.clearance', show: f => f.kind === 'catch' },
      { kind: 'expr', key: 'depth', label: 'snap.depth', show: f => f.kind === 'catch' },
    ] },
    { kind: 'expr', key: 'angle', label: 'snap.angle', unit: '°' },
    {
      kind: 'choice',
      key: 'direction',
      options: [
        { value: 'normal', label: 'dir.up' },
        { value: 'reverse', label: 'dir.down' },
      ],
    },
    { kind: 'expr', key: 'start', label: 'field.start', unit: 'mm' },
  ],

  create: (id, name, sk) => ({
    type: 'snap', id, name, sketch: sk.id, points: null, kind: 'hook', length: '12', thickness: '1,5', width: '6', overhang: '1',
    retention: 'lock', angle: '0', clearance: '0,2', depth: '3', direction: outwardOf(sk), start: '0',
  }),

  detail: f =>
    f.kind === 'hook'
      ? `${t('snap.hook')} · ${f.length} × ${f.thickness} mm`
      : `${t('snap.catch')} · ${f.depth} mm`,

  usable: () => true,

  changed(f, key, sk) {
    // The hook is built outwards from the face, the catch is cut into the body.
    if (key === 'kind') f.direction = f.kind === 'catch' ? inwardOf(sk) : outwardOf(sk);
  },

  build(f, sk, ctx) {
    const r = new FieldReader(ctx);
    const th = r.positive(t('snap.thickness'), f.thickness);
    const b = r.positive(t('snap.width'), f.width);
    const y = r.positive(t('snap.overhang'), f.overhang);
    const angle = r.read(t('snap.angle'), f.angle || '0');
    const start = r.read(t('field.start'), f.start || '0');
    const L = f.kind === 'hook' ? r.positive(t('field.length'), f.length) : null;
    const c = f.kind === 'catch' ? r.read(t('snap.clearance'), f.clearance || '0', v => v >= 0, t('err.notNegative')) : null;
    const depth = f.kind === 'catch' ? r.positive(t('snap.depth'), f.depth) : null;
    if (r.error) return { error: r.error };
    const ids = textAnchors(f as never, sk);
    const pts = ids.length ? ids.map(id => `[${num(sk.points[id].x)}, ${num(sk.points[id].y)}]`).join(', ') : '[0, 0]';
    const flip = f.direction === 'reverse' ? 'mirror([0, 0, 1]) ' : '';
    const rot = angle.v ? `rotate(${angle.code}) ` : '';
    const m = ctx.module;
    let shape: string;
    if (L) {
      // Cross-section in (x, z): the beam x ∈ [−t/2, t/2] from the root to L; the barb towards +x.
      const T = th.v, Y = y.v;
      const ramp = Y / Math.tan((RAMP * Math.PI) / 180);
      const back = f.retention === 'lock' ? 0 : Y; // a 45° back side can be taken apart
      const flat = Math.min(0.4, T / 2);
      const hb = back + flat + ramp; // the barb's height
      if (hb >= L.v - 0.5) return { error: t('err.snapTooShort') };
      const root = Math.min(T / 2, 1); // 45° chamfer at the root (less stress, printable)
      const x0 = -T / 2, x1 = T / 2, z0 = L.v - hb;
      const poly = [
        [x0 - root, 0], [x1 + root, 0], [x1, root], [x1, z0], [x1 + Y, z0 + back], [x1 + Y, z0 + back + flat], [x1, L.v], [x0, L.v], [x0, root],
      ];
      shape = `rotate([90, 0, 0]) linear_extrude(height = ${b.code}, center = true) polygon([${poly.map(([u, v]) => `[${num(u)}, ${num(v)}]`).join(', ')}]);`;
    } else {
      // Catch: the hook (thickness + overhang) plus clearance all around; cuts a hundredth beyond
      // the face.
      const C = c!.v, Tt = th.v, Y = y.v;
      shape = `translate([${num(-Tt / 2 - C)}, -(${b.code}) / 2 - ${num(C)}, -0.01]) cube([${num(Tt + Y + 2 * C)}, ${b.code} + ${num(2 * C)}, ${depth!.code} + 0.01]);`;
    }
    const code =
      `module ${m}() {\n  ${ctx.place(sk)}for (p = [${pts}])\n` +
      `    translate([p[0], p[1], ${start.code}]) ${flip}${rot}${shape}\n}`;
    return { code, tools: [{ op: f.kind === 'hook' ? 'add' : 'remove', call: `${m}();` }] };
  },
};
