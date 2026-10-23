// Text: raised or engraved text at chosen points in a sketch (or at the sketch's origin). The fonts
// are in fonts.ts; the engine only gets the fonts that are used.

import { fontById, FONTS } from '../fonts';
import { t } from '../i18n';
import { FieldReader, inwardOf, num, outwardOf, type FeatureBase, type FeatureKind, type Op, type SketchFeature } from './common';
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
    const code =
      `module ${ctx.module}() {\n  ${ctx.place(sk)}for (p = [${pts}])\n` +
      `    translate([p[0], p[1], ${start.code}]) ${flip}${lift}${rot}linear_extrude(height = ${h})\n` +
      `      text(${scadString(f.text)}, size = ${size.code}, font = ${scadString(font.family)}, halign = "${f.halign}", valign = "center", $fn = 24);\n}`;
    return { code, tools: [{ op: f.op, call: `${ctx.module}();` }] };
  },
};

export { holeCandidates as textCandidates };
