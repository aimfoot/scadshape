// Hål: borras i valda punkter i en skiss – enkelt, försänkt, koniskt eller gängat.

import { t } from '../i18n';
import { FieldReader, fnFor, inwardOf, num, type FeatureBase, type FeatureKind, type SketchFeature } from './common';
import { METRIC, minorDiameter, threadScad } from './threads';

export type HoleKind = 'simple' | 'counterbore' | 'countersink' | 'threaded';

export interface HoleFeature extends FeatureBase {
  type: 'hole';
  sketch: string;
  points: string[] | null; // skisspunkternas id; null = alla fristående punkter
  kind: HoleKind;
  size: string; // förval ('M3' …) eller 'custom'
  diameter: string; // uttryck (mm); för gängat: nominell diameter
  depth: string; // uttryck (mm), ignoreras vid through
  through: boolean;
  cbDiameter: string; // cylindrisk försänkning
  cbDepth: string;
  csDiameter: string; // konisk försänkning
  csAngle: string; // grader (90 för metriska försänkta skruvar)
  pitch?: string; // gängat: stigning
  threadLength?: string; // gängat: gängans längd
  clearance?: string; // gängat: spel (diametralt) för 3D-utskrift
  direction: 'normal' | 'reverse'; // borra längs planets normal eller mot den
  start: string; // var borrningen börjar, mm längs normalen från skissplanet
}

/** Frigångshål (ISO 273, medel), försänkning för insexskruv (DIN 912) och för försänkt skruv (90°). */
export const HOLE_SIZES: Record<string, { d: number; cb: [number, number]; cs: number }> = {
  M2: { d: 2.4, cb: [4.4, 2.3], cs: 4.4 },
  'M2,5': { d: 2.9, cb: [5.5, 2.8], cs: 5.5 },
  M3: { d: 3.4, cb: [6.5, 3.4], cs: 6.6 },
  M4: { d: 4.5, cb: [8, 4.4], cs: 8.8 },
  M5: { d: 5.5, cb: [10, 5.4], cs: 10.4 },
  M6: { d: 6.6, cb: [11, 6.4], cs: 12.4 },
  M8: { d: 9, cb: [15, 8.6], cs: 16.4 },
};
const sv = (n: number) => String(n).replace('.', ',');

/** Fyll i måtten från en skruvstorlek (för gängat: gängans diameter och stigning). */
export function applyHoleSize(h: HoleFeature, size: string) {
  h.size = size;
  if (h.kind === 'threaded') {
    const m = METRIC[size];
    if (!m) return;
    h.diameter = sv(m.d);
    h.pitch = sv(m.p);
    return;
  }
  const s = HOLE_SIZES[size];
  if (!s) return;
  h.diameter = sv(s.d);
  h.cbDiameter = sv(s.cb[0]);
  h.cbDepth = sv(s.cb[1]);
  h.csDiameter = sv(s.cs);
  h.csAngle = '90';
}

/** Punkter som kan få hål: fristående punkter först, sedan cirkel- och bågcentrum. */
export function holeCandidates(sk: SketchFeature): string[] {
  const out = Object.entries(sk.points).filter(([, p]) => p.standalone).map(([id]) => id);
  for (const e of Object.values(sk.entities)) if (e.type !== 'line' && !out.includes(e.c)) out.push(e.c);
  return out;
}

/** Valda hålpunkter (null = alla fristående punkter). */
export function holePoints(h: HoleFeature, sk: SketchFeature): string[] {
  if (h.points) return h.points.filter(id => sk.points[id]);
  return Object.entries(sk.points).filter(([, p]) => p.standalone).map(([id]) => id);
}

const KIND_LABEL = { simple: '', counterbore: 'hole.counterboreShort', countersink: 'hole.countersinkShort', threaded: 'hole.threadedShort' } as const;
const DIMENSION_KEYS = new Set(['diameter', 'cbDiameter', 'cbDepth', 'csDiameter', 'csAngle', 'pitch']);

export const hole: FeatureKind<HoleFeature> = {
  type: 'hole',
  label: 'feat.hole',
  icon: '<svg viewBox="0 0 24 24"><path d="M4 9l8-4 8 4-8 4z"/><path d="M4 9v7l8 4 8-4V9"/><ellipse cx="12" cy="9" rx="2.6" ry="1.3"/><path d="M9.4 9v4.5M14.6 9v4.5" stroke-dasharray="1.5 1.5"/></svg>',
  pick: { kind: 'points' },
  fields: [
    {
      kind: 'choice',
      key: 'kind',
      options: [
        { value: 'simple', label: 'hole.simple' },
        { value: 'counterbore', label: 'hole.counterbore' },
        { value: 'countersink', label: 'hole.countersink' },
        { value: 'threaded', label: 'hole.threaded' },
      ],
    },
    {
      kind: 'select',
      key: 'size',
      label: 'field.size',
      options: f => [{ value: 'custom', label: t('field.customSize') }, ...Object.keys(f.kind === 'threaded' ? METRIC : HOLE_SIZES).map(k => ({ value: k, label: k }))],
    },
    { kind: 'expr', key: 'diameter', label: 'field.diameter', unit: 'mm' },
    { kind: 'pair', show: f => f.kind === 'threaded', fields: [
      { kind: 'expr', key: 'pitch', label: 'field.pitch' },
      { kind: 'expr', key: 'threadLength', label: 'field.threadLength' },
    ] },
    { kind: 'expr', key: 'clearance', label: 'field.clearance', unit: 'mm', show: f => f.kind === 'threaded' },
    { kind: 'check', key: 'through', label: 'field.through' },
    { kind: 'expr', key: 'depth', label: 'field.depth', unit: 'mm', show: f => !f.through },
    { kind: 'heading', label: 'hole.counterbore', show: f => f.kind === 'counterbore' },
    { kind: 'pair', show: f => f.kind === 'counterbore', fields: [
      { kind: 'expr', key: 'cbDiameter', label: 'field.diameterShort' },
      { kind: 'expr', key: 'cbDepth', label: 'field.depthShort' },
    ] },
    { kind: 'heading', label: 'hole.countersink', show: f => f.kind === 'countersink' },
    { kind: 'pair', show: f => f.kind === 'countersink', fields: [
      { kind: 'expr', key: 'csDiameter', label: 'field.diameterShort' },
      { kind: 'expr', key: 'csAngle', label: 'field.angleShort' },
    ] },
    {
      kind: 'choice',
      key: 'direction',
      options: [
        { value: 'normal', label: 'dir.drillUp' },
        { value: 'reverse', label: 'dir.drillDown' },
      ],
    },
    { kind: 'expr', key: 'start', label: 'field.start', unit: 'mm' },
  ],

  create(id, name, sk) {
    const h: HoleFeature = {
      type: 'hole', id, name, sketch: sk.id, points: null, kind: 'simple', size: 'M3', diameter: '', depth: '10', through: true,
      cbDiameter: '', cbDepth: '', csDiameter: '', csAngle: '90', pitch: '0,5', threadLength: '8', clearance: '0,2',
      direction: sk.outward ? inwardOf(sk) : 'normal', start: '0', // på en yta: borra in i kroppen
    };
    applyHoleSize(h, 'M3');
    // Utan fristående punkter: börja med alla kandidater (t.ex. cirkelcentrum).
    if (!Object.values(sk.points).some(p => p.standalone) && holeCandidates(sk).length) h.points = holeCandidates(sk);
    return h;
  },

  detail(f) {
    const k = KIND_LABEL[f.kind];
    return `${f.size !== 'custom' ? f.size : `Ø${f.diameter}`}${k ? ` ${t(k)}` : ''}${f.through ? ` · ${t('hole.throughShort')}` : ''}`;
  },

  usable: sk => holeCandidates(sk).length > 0,

  changed(f, key) {
    if (DIMENSION_KEYS.has(key)) f.size = 'custom';
    if ((key === 'kind' || key === 'size') && f.size !== 'custom') {
      // Byte mellan gängat och frigång: välj samma storlek i den andra tabellen om den finns.
      if (!(f.kind === 'threaded' ? METRIC : HOLE_SIZES)[f.size]) f.size = 'M3';
      applyHoleSize(f, f.size);
    }
  },

  build(f, sk, ctx) {
    const ids = holePoints(f, sk);
    if (!ids.length) return { error: f.points ? t('err.noPoints') : t('err.noStandalonePoints') };
    const r = new FieldReader(ctx);
    const D = r.positive(t('field.diameter'), f.diameter);
    const depth = f.through ? { v: 1000, code: '1000' } : r.positive(t('field.depth'), f.depth);
    const start = r.read(t('field.start'), f.start);
    const e = '0.01'; // överlapp vid ingången så att inga ytor sammanfaller
    // Grundformen borrar mot −z från z = 0.
    const body: string[] = [];
    if (f.kind === 'threaded') {
      const P = r.positive(t('field.pitch'), f.pitch ?? '');
      const L = r.positive(t('field.threadLength'), f.threadLength ?? '');
      const c = r.read(t('field.clearance'), f.clearance ?? '0', v => v >= 0, t('err.notNegative'));
      if (r.error) return { error: r.error };
      const core = minorDiameter(D.v, P.v) + c.v;
      if (!(core > 0)) return { error: t('err.pitchTooLarge') };
      body.push(`rotate([180, 0, 0]) ${threadScad({ R: D.v / 2 + c.v / 2, P: P.v, L: Math.min(L.v, depth.v) + 0.01, z0: -0.01, entry: true }, '      ')}`);
      body.push(`translate([0, 0, -${depth.code}]) cylinder(d = ${num(core)}, h = ${depth.code} + ${e}, $fn = ${fnFor(core)});`);
    } else {
      body.push(`translate([0, 0, -${depth.code}]) cylinder(d = ${D.code}, h = ${depth.code} + ${e}, $fn = ${fnFor(D.v)});`);
      if (f.kind === 'counterbore') {
        const cd = r.read(t('field.cbDiameter'), f.cbDiameter, v => v > D.v, t('err.largerThanHole'));
        const ch = r.positive(t('field.cbDepth'), f.cbDepth);
        body.push(`translate([0, 0, -${ch.code}]) cylinder(d = ${cd.code}, h = ${ch.code} + ${e}, $fn = ${fnFor(cd.v)});`);
      } else if (f.kind === 'countersink') {
        const cd = r.read(t('field.csDiameter'), f.csDiameter, v => v > D.v, t('err.largerThanHole'));
        const ang = r.read(t('field.angle'), f.csAngle, v => v > 0 && v < 180, t('err.angle180'));
        const h = `(${cd.code} - ${D.code}) / 2 / tan(${ang.code} / 2)`;
        body.push(`translate([0, 0, -${h}]) cylinder(d1 = ${D.code}, d2 = ${cd.code}, h = ${h}, $fn = ${fnFor(cd.v)});`);
        body.push(`cylinder(d = ${cd.code}, h = ${e}, $fn = ${fnFor(cd.v)});`);
      }
    }
    if (r.error) return { error: r.error };
    const pts = ids.map(id => `[${num(sk.points[id].x)}, ${num(sk.points[id].y)}]`).join(', ');
    // "normal" borrar längs planets normal (+z) → vänd grundformen (rotation, så att gängor förblir högergängade).
    const flip = f.direction === 'normal' ? ' rotate([180, 0, 0])' : '';
    const code =
      `module ${ctx.module}() {\n  ${ctx.place(sk)}for (p = [${pts}])\n` +
      `    translate([p[0], p[1], ${start.code}])${flip} {\n${body.map(b => `      ${b}`).join('\n')}\n    }\n}`;
    return { code, tools: [{ op: 'remove', call: `${ctx.module}();` }] };
  },
};
