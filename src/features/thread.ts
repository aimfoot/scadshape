// Gänga: utvändig gänga på cylindrar eller invändig gänga i hål, vid valda cirklar i en skiss.
// Utvändig: cylindern skärs bort över gänglängden och ersätts av en gängad stav (avfasad).
// Invändig: en gängtapp dras bort (hålet bör vara högst mutterns innerdiameter).

import { t } from '../i18n';
import { FieldReader, fnFor, num, type FeatureBase, type FeatureKind, type SketchFeature } from './common';
import { METRIC, minorDiameter, nearestMetric, threadScad } from './threads';

export interface ThreadFeature extends FeatureBase {
  type: 'thread';
  sketch: string;
  circles: string[] | null; // cirklarnas id; null = alla cirklar
  mode: 'external' | 'internal';
  size: string; // 'M8' … eller 'custom'
  diameter: string; // nominell diameter (mm)
  pitch: string;
  length: string;
  start: string; // mm längs normalen från skissplanet
  direction: 'normal' | 'reverse';
  clearance: string; // diametralt spel för 3D-utskrift
  chamfer: boolean;
}

/** Cirklar som kan gängas. */
export const threadCandidates = (sk: SketchFeature) => Object.entries(sk.entities).filter(([, e]) => e.type === 'circle').map(([id]) => id);

export function threadCircles(f: ThreadFeature, sk: SketchFeature): string[] {
  return f.circles ? f.circles.filter(id => sk.entities[id]?.type === 'circle') : threadCandidates(sk);
}

const sv = (n: number) => String(n).replace('.', ',');

function applySize(f: ThreadFeature, size: string) {
  f.size = size;
  const m = METRIC[size];
  if (!m) return;
  f.diameter = sv(m.d);
  f.pitch = sv(m.p);
}

/** Föreslå storlek utifrån den första cirkeln: ytterdiameter (utvändig) eller innerdiameter (invändig). */
export function suggestThreadSize(f: ThreadFeature, sk: SketchFeature) {
  const id = threadCircles(f, sk)[0];
  const c = id ? sk.entities[id] : undefined;
  if (c?.type !== 'circle') return;
  applySize(f, nearestMetric(2 * c.r, f.mode === 'external' ? 'major' : 'minor'));
}

export const thread: FeatureKind<ThreadFeature> = {
  type: 'thread',
  label: 'feat.thread',
  icon: '<svg viewBox="0 0 24 24"><path d="M8 3v18M16 3v18"/><path d="M6 6l12 3M6 10l12 3M6 14l12 3M6 18l12 3"/></svg>',
  pick: { kind: 'circles' },
  fields: [
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'external', label: 'thread.external' },
        { value: 'internal', label: 'thread.internal' },
      ],
    },
    {
      kind: 'select',
      key: 'size',
      label: 'field.size',
      options: () => [{ value: 'custom', label: t('field.customSize') }, ...Object.keys(METRIC).map(k => ({ value: k, label: k }))],
    },
    { kind: 'pair', fields: [
      { kind: 'expr', key: 'diameter', label: 'field.diameterShort' },
      { kind: 'expr', key: 'pitch', label: 'field.pitch' },
    ] },
    { kind: 'expr', key: 'length', label: 'field.length', unit: 'mm' },
    { kind: 'expr', key: 'clearance', label: 'field.clearance', unit: 'mm' },
    { kind: 'check', key: 'chamfer', label: 'field.chamferEnds', show: f => f.mode === 'external' },
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

  create(id, name, sk) {
    const f: ThreadFeature = {
      type: 'thread', id, name, sketch: sk.id, circles: null, mode: 'external', size: 'M8', diameter: '8', pitch: '1,25',
      length: '10', start: '0', direction: 'normal', clearance: '0,2', chamfer: true,
    };
    suggestThreadSize(f, sk);
    return f;
  },

  detail: f => `${f.size !== 'custom' ? f.size : `Ø${f.diameter}×${f.pitch}`} · ${t(f.mode === 'external' ? 'thread.externalShort' : 'thread.internalShort')} · ${f.length} mm`,

  usable: sk => threadCandidates(sk).length > 0,

  changed(f, key, sk) {
    if (key === 'diameter' || key === 'pitch') f.size = 'custom';
    if (key === 'size' && f.size !== 'custom') applySize(f, f.size);
    // Nytt läge eller nya cirklar: föreslå storlek igen (om man inte valt egna mått).
    if ((key === 'mode' || key === 'circles') && f.size !== 'custom' && sk) suggestThreadSize(f, sk);
  },

  build(f, sk, ctx) {
    const ids = threadCircles(f, sk);
    if (!ids.length) return { error: t('err.noCircles') };
    const r = new FieldReader(ctx);
    const D = r.positive(t('field.diameter'), f.diameter);
    const P = r.positive(t('field.pitch'), f.pitch);
    const L = r.positive(t('field.length'), f.length);
    const start = r.read(t('field.start'), f.start);
    const c = r.read(t('field.clearance'), f.clearance, v => v >= 0, t('err.notNegative'));
    if (r.error) return { error: r.error };
    if (!(minorDiameter(D.v, P.v) > 0)) return { error: t('err.pitchTooLarge') };
    const flip = f.direction === 'reverse' ? 'rotate([180, 0, 0]) ' : ''; // rotation, inte spegling: gängan ska förbli högergängad
    const at = (id: string) => {
      const e = sk.entities[id] as { c: string; r: number };
      const p = sk.points[e.c];
      return { x: p.x, y: p.y, r: e.r };
    };
    const place = (x: number, y: number, inner: string) => `translate([${num(x)}, ${num(y)}, ${start.code}]) ${flip}${inner}`;
    const parts: string[] = [];
    const clear: string[] = [];
    for (const id of ids) {
      const { x, y, r: rc } = at(id);
      if (f.mode === 'external') {
        // Skär bort cylindern (minst cirkelns radie) och lägg en gängad stav i stället.
        const rr = Math.max(rc, D.v / 2) + 0.02;
        clear.push(place(x, y, `translate([0, 0, -0.01]) cylinder(r = ${num(rr)}, h = ${num(L.v + 0.02)}, $fn = ${fnFor(2 * rr)});`));
        parts.push(place(x, y, threadScad({ R: D.v / 2 - c.v / 2, P: P.v, L: L.v, chamfer: f.chamfer }, '    ')));
      } else {
        parts.push(place(x, y, threadScad({ R: D.v / 2 + c.v / 2, P: P.v, L: L.v + 0.02, z0: -0.01, entry: true }, '    ')));
      }
    }
    const block = (name: string, items: string[]) => `module ${name}() {\n  ${ctx.place(sk)}union() {\n${items.map(i => `    ${i}`).join('\n')}\n  }\n}`;
    if (f.mode === 'external') {
      const code = `${block(`${ctx.module}_clear`, clear)}\n${block(ctx.module, parts)}`;
      return { code, tools: [{ op: 'remove', call: `${ctx.module}_clear();` }, { op: 'add', call: `${ctx.module}();` }] };
    }
    return { code: block(ctx.module, parts), tools: [{ op: 'remove', call: `${ctx.module}();` }] };
  },
};
