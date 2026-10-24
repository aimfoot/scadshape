// Text: raised or engraved text at chosen points in a sketch (or at the sketch's origin). The fonts
// are in fonts.ts; the engine only gets the fonts that are used.

import { tangentSide, type TangentSide } from '../faceref';
import { fontById, FONTS } from '../fonts';
import type { Doc } from '../doc';
import type { Vars } from '../expr';
import { add, cross, dot, scale, sketchFrame, sub, toPlane, toWorld, type Frame, type V3 } from '../frame';
import { t } from '../i18n';
import { segmentsFor, type Vec } from '../sketch/geom';
import { FieldReader, inwardOf, num, outwardOf, type BuildCtx, type Built, type FeatureBase, type FeatureKind, type Op, type SketchFeature } from './common';
import { holeCandidates } from './hole';

export interface TextFeature extends FeatureBase {
  type: 'text';
  sketch: string;
  points: string[] | null; // anchor points; null = all standalone points (or the origin if there are none)
  text: string;
  font: string; // id in FONTS
  size: string; // letter height (mm, roughly the cap height)
  halign: 'left' | 'center' | 'right';
  angle: string; // degrees counterclockwise
  depth: string;
  direction: 'normal' | 'reverse';
  op: Op;
  /** Where the text starts, mm along the normal from the sketch plane (e.g. the top of a body). */
  start?: string;
}

/** The points the text is placed at (empty list = origin). */
export function textAnchors(f: TextFeature, sk: SketchFeature): string[] {
  if (f.points) return f.points.filter(id => sk.points[id]);
  return Object.entries(sk.points).filter(([, p]) => p.standalone).map(([id]) => id);
}

/** String as an OpenSCAD literal. */
const scadString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export const text: FeatureKind<TextFeature> = {
  type: 'text',
  label: 'feat.text',
  icon: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
  pick: { kind: 'points' },
  fields: [
    { kind: 'text', key: 'text', label: 'field.text' },
    { kind: 'select', key: 'font', label: 'field.font', options: () => FONTS.map(f => ({ value: f.id, label: f.label })) },
    { kind: 'pair', fields: [
      { kind: 'expr', key: 'size', label: 'field.textSize' },
      { kind: 'expr', key: 'angle', label: 'field.angleShort' },
    ] },
    {
      kind: 'choice',
      key: 'halign',
      options: [
        { value: 'left', label: 'text.left' },
        { value: 'center', label: 'text.center' },
        { value: 'right', label: 'text.right' },
      ],
    },
    {
      kind: 'choice',
      key: 'op',
      options: [
        { value: 'add', label: 'text.emboss' },
        { value: 'remove', label: 'text.engrave' },
      ],
    },
    { kind: 'expr', key: 'depth', label: 'field.depth', unit: 'mm' },
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
    type: 'text', id, name, sketch: sk.id, points: null, text: t('text.default'), font: 'bold', size: '8', halign: 'center',
    angle: '0', depth: '1', direction: outwardOf(sk), op: 'add', start: '0',
  }),

  detail: f => `”${f.text.length > 14 ? `${f.text.slice(0, 13)}…` : f.text}” · ${f.size} mm${f.op === 'remove' ? ` · ${t('text.engraveShort')}` : ''}`,

  usable: () => true,

  changed(f, key, sk) {
    // Engraved text is usually cut into the body, raised text is built outwards (upwards if the
    // sketch is not on a face).
    if (key === 'op') f.direction = f.op === 'remove' ? inwardOf(sk) : outwardOf(sk);
  },

  build(f, sk, ctx) {
    if (!f.text.trim()) return { error: t('err.noText') };
    const r = new FieldReader(ctx);
    const size = r.positive(t('field.textSize'), f.size);
    const depth = r.positive(t('field.depth'), f.depth);
    const angle = r.read(t('field.angle'), f.angle || '0');
    const start = r.read(t('field.start'), f.start || '0');
    if (r.error) return { error: r.error };
    const ids = textAnchors(f, sk);
    const pts = ids.length ? ids.map(id => `[${num(sk.points[id].x)}, ${num(sk.points[id].y)}]`).join(', ') : '[0, 0]';
    const flip = f.direction === 'reverse' ? 'mirror([0, 0, 1]) ' : '';
    // Engraved text starts a hundredth of a mm outside the face so no faces coincide.
    const lift = f.op === 'remove' ? `translate([0, 0, -0.01]) ` : '';
    const h = f.op === 'remove' ? `${depth.code} + 0.01` : depth.code;
    const rot = angle.v ? `rotate(${angle.code}) ` : '';
    const font = fontById(f.font);
    const glyphs = `text(${scadString(f.text)}, size = ${size.code}, font = ${scadString(font.family)}, halign = "${f.halign}", valign = "center", $fn = 24)`;
    // Sketched on a cylinder wall: the text follows the round side instead of a flat slab that
    // only touches it along a line.
    if (ctx.doc) {
      const fr = sketchFrame(sk, ctx.vars, ctx.doc);
      const at = ids.length ? ids.map(id => sk.points[id]) : [{ x: 0, y: 0 }];
      const side = tangentSide(ctx.doc, fr, at, ctx.vars, f.id);
      if (side) return wrapped(f, sk, ctx, fr, side, { at, rot, glyphs, size: size.v, angle: angle.v, depth, start });
    }
    const code =
      `module ${ctx.module}() {\n  ${ctx.place(sk)}for (p = [${pts}])\n` +
      `    translate([p[0], p[1], ${start.code}]) ${flip}${lift}${rot}linear_extrude(height = ${h})\n` +
      `      ${glyphs};\n}`;
    return { code, tools: [{ op: f.op, call: `${ctx.module}();` }] };
  },
};

/** An expression field's value and code. */
type Field = { v: number; code: string };

/**
 * A sketch plane touching a round side, as a frame around the axis: o0 on the axis level with the
 * sketch origin, e1 from the axis to the line of contact, e2 along the circle (e2 × axis = the
 * sketch normal, so the text is not mirrored). m: the sketch's (x, y) → (s along the circle at
 * radius r, t along the axis) = m · (x, y, 1). sgn: 1 if the sketch normal points away from the axis.
 */
function cylinderMap(fr: Frame, side: TangentSide) {
  const ax = side.axis;
  const toAxis = sub(fr.o, side.a);
  const sgn = dot(toAxis, fr.n) >= 0 ? 1 : -1;
  const o0 = add(side.a, scale(ax, dot(toAxis, ax)));
  const e1 = scale(fr.n, sgn);
  const e2 = cross(ax, fr.n);
  const m = [[dot(fr.u, e2), dot(fr.v, e2), dot(sub(fr.o, o0), e2)], [dot(fr.u, ax), dot(fr.v, ax), 0]];
  return { ax, sgn, o0, e1, e2, m };
}

/** Where a text's sketch points are on the model: on the sketch plane, or around the round side it touches. */
export interface TextSurface {
  /** Sketch (x, y) → the world, on the surface. */
  toWorld(p: Vec): V3;
  /** Where a ray (from o along d) meets the surface, in sketch (x, y); null if it misses. */
  fromRay(o: V3, d: V3): Vec | null;
}

export function textSurface(f: TextFeature, sk: SketchFeature, doc: Doc, vars: Vars): TextSurface {
  const fr = sketchFrame(sk, vars, doc);
  const ids = textAnchors(f, sk);
  const side = tangentSide(doc, fr, ids.length ? ids.map(id => sk.points[id]) : [{ x: 0, y: 0 }], vars, f.id);
  if (!side) {
    return {
      toWorld: p => toWorld(fr, p),
      fromRay(o, d) {
        const dn = dot(d, fr.n);
        if (Math.abs(dn) < 1e-9) return null;
        const k = dot(sub(fr.o, o), fr.n) / dn;
        return k > 0 ? toPlane(fr, add(o, scale(d, k))) : null;
      },
    };
  }
  const r = side.r;
  const { ax, sgn, o0, e1, e2, m } = cylinderMap(fr, side);
  return {
    toWorld(p) {
      const s = m[0][0] * p.x + m[0][1] * p.y + m[0][2], tt = m[1][0] * p.x + m[1][1] * p.y;
      return add(o0, scale(ax, tt), scale(e1, r * Math.cos(s / r)), scale(e2, r * Math.sin(s / r)));
    },
    fromRay(o, d) {
      // |q − axis| = r for q = o + k·d, in the plane across the axis. Outside a post: the near
      // crossing; inside a hole (the sketch normal points at the axis): the far one.
      const q0 = sub(o, o0), dq = sub(d, scale(ax, dot(d, ax))), pq = sub(q0, scale(ax, dot(q0, ax)));
      const a = dot(dq, dq), b = 2 * dot(pq, dq), c = dot(pq, pq) - r * r;
      const disc = b * b - 4 * a * c;
      if (a < 1e-12 || disc < 0) return null;
      const k = (-b + (sgn > 0 ? -1 : 1) * Math.sqrt(disc)) / (2 * a);
      if (k <= 0) return null;
      const q = sub(add(o, scale(d, k)), o0);
      const s = r * Math.atan2(dot(q, e2), dot(q, e1)) - m[0][2], tt = dot(q, ax);
      // m's 2×2 part is a rotation: its inverse is the transpose.
      return { x: m[0][0] * s + m[1][0] * tt, y: m[0][1] * s + m[1][1] * tt };
    },
  };
}

/**
 * Text on the round side of an extruded circle/arc that the sketch plane touches. The flat text is
 * laid along the circle (its x as arc length at the radius) in thin strips, each one a wedge
 * around the axis. A strip widens with the distance from the axis (linear_extrude's scale), so the
 * letters' sides point at the axis. Neighbouring wedges overlap by a hair: strips that only touch
 * leave open edges and slivers along every seam (thin lines across the letters).
 */
function wrapped(
  f: TextFeature, sk: SketchFeature, ctx: BuildCtx, fr: Frame, side: TangentSide,
  o: { at: { x: number; y: number }[]; rot: string; glyphs: string; size: number; angle: number; depth: Field; start: Field },
): Built {
  const r = side.r;
  const { ax, sgn, o0, e1, e2, m } = cylinderMap(fr, side);
  const fn = side.fn ?? segmentsFor(r, 2 * Math.PI);
  const step = Math.min(Math.PI / 18, 2 * Math.acos(1 - 0.01 / r)); // a strip is at most 0.01 mm off the circle
  // Raised text goes this far into the body, engraved text starts this far out of it: past the
  // side's facets and the strips' chords.
  const margin = 0.01 + r * (1 - Math.cos(Math.PI / fn)) + r * (1 - Math.cos(step / 2));
  // Distance from the axis = r + sgn·(start + dir·z), z = height in the text's own extrusion.
  const dir = f.direction === 'reverse' ? -1 : 1;
  const k = sgn * dir;
  const into = f.op === 'remove' || f.direction === outwardOf(sk) ? margin : 0;
  const plain = /^[\w.]+$/.test(o.start.code);
  const base = o.start.v === 0 && o.start.code === '0' ? num(r) : `${num(r)} ${sgn > 0 ? '+' : '-'} ${plain ? o.start.code : `(${o.start.code})`}`;
  const depth = /^[\w.]+$/.test(o.depth.code) ? o.depth.code : `(${o.depth.code})`;
  const near = into ? `${base} ${k > 0 ? '-' : '+'} ${num(into)}` : base;
  const far = `${base} ${k > 0 ? '+' : '-'} ${depth}`;
  const [lo, hi] = k > 0 ? [near, far] : [far, near];
  const rLo = r + sgn * o.start.v - (k > 0 ? into : o.depth.v);
  if (!(rLo > 0.01)) return { error: t('err.surfaceTooDeep') };
  // The strips that can hold text: a generous box around each line of text.
  const len = [...f.text].length * o.size * 1.1;
  const x0 = f.halign === 'left' ? 0 : f.halign === 'right' ? -len : -len / 2;
  const ca = Math.cos((o.angle * Math.PI) / 180), sa = Math.sin((o.angle * Math.PI) / 180);
  const ss: number[] = [], ts: number[] = [];
  for (const p of o.at)
    for (const [x, y] of [[x0, -o.size], [x0 + len, -o.size], [x0, o.size], [x0 + len, o.size]]) {
      const px = p.x + x * ca - y * sa, py = p.y + x * sa + y * ca;
      ss.push(m[0][0] * px + m[0][1] * py + m[0][2]);
      ts.push(m[1][0] * px + m[1][1] * py);
    }
  const w = r * step;
  const most = Math.floor(Math.PI / step - 0.5); // no more than once around
  const k0 = Math.max(-most, Math.floor(Math.min(...ss) / w + 0.5));
  const k1 = Math.min(most, Math.ceil(Math.max(...ss) / w - 0.5));
  const h = num(2 * Math.max(...ts.map(Math.abs)) + 2);
  const deg = num((step * 180) / Math.PI), half = num(((step / 2 + 0.001 / r) * 180) / Math.PI);
  const r9 = (x: number) => String(Math.round(x * 1e9) / 1e9).replace(/^-0$/, '0');
  const row = (i: number) => `[${r9(e1[i])}, ${r9(e2[i])}, ${r9(ax[i])}, ${r9(o0[i])}]`;
  const pts = o.at.map(p => `[${num(p.x)}, ${num(p.y)}]`).join(', ');
  const code =
    `module ${ctx.module}() {\n` +
    `  // Around the round side (r = ${num(r)}): strips of ${deg}° that widen away from the axis.\n` +
    `  r0 = ${lo}; r1 = ${hi};\n` +
    `  multmatrix([${row(0)}, ${row(1)}, ${row(2)}, [0, 0, 0, 1]]) for (k = [${k0}:${k1}]) rotate(k * ${deg}) intersection() {\n` +
    `    linear_extrude(height = ${h}, center = true) polygon([[0, 0], [2 * r1, -2 * r1 * tan(${half})], [2 * r1, 2 * r1 * tan(${half})]]);\n` +
    `    multmatrix([[0, 0, 1, r0], [1, 0, 0, 0], [0, 1, 0, 0]]) linear_extrude(height = r1 - r0, scale = [r1 / r0, 1]) scale([r0 / ${num(r)}, 1]) intersection() {\n` +
    `      translate([-k * ${num(w)}, 0]) multmatrix([[${r9(m[0][0])}, ${r9(m[0][1])}, 0, ${r9(m[0][2])}], [${r9(m[1][0])}, ${r9(m[1][1])}, 0, 0], [0, 0, 1, 0]])\n` +
    `        for (p = [${pts}]) translate(p) ${o.rot}${o.glyphs};\n` +
    `      square([${num(2 * r * Math.tan(step / 2) + 0.02)}, ${h}], center = true);\n` +
    `    }\n  }\n}`;
  return { code, tools: [{ op: f.op, call: `${ctx.module}();` }] };
}

export { holeCandidates as textCandidates };
