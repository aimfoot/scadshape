// Repeat: every feature can be repeated linearly, in a grid, around an axis or mirrored. The
// properties live directly on the feature (rep*) so the panel shows them as ordinary fields;
// model3d.ts wraps the pattern around the feature's tool (add/remove/intersect).

import { t } from '../i18n';
import { FieldReader, num, type BuildCtx, type Field, type FieldCtx, type SketchFeature, type Tool } from './common';
import type { V3 } from '../frame';

export type RepKind = 'none' | 'linear' | 'grid' | 'circular' | 'mirror';
export type Axis = 'x' | 'y' | 'z';

export interface Repeat {
  rep?: RepKind;
  repAxis?: Axis; // linear/grid: the first direction
  repRotAxis?: Axis | 'circle'; // around axis: the rotation axis (through the origin) or a circle's center
  repCircle?: string; // around circle: "sketch id/entity id" (circle or arc in an earlier sketch)
  repCount?: string;
  repSpacing?: string; // mm (negative = the other way)
  repAxis2?: Axis; // grid: the second direction
  repCount2?: string;
  repSpacing2?: string;
  repAngle?: string; // circular: total angle (360 = evenly around)
  repPlane?: 'yz' | 'xz' | 'xy'; // mirror: the plane through the origin
}

const AXIS_VEC: Record<Axis, string> = { x: '[1, 0, 0]', y: '[0, 1, 0]', z: '[0, 0, 1]' };
const PLANE_NORMAL = { yz: '[1, 0, 0]', xz: '[0, 1, 0]', xy: '[0, 0, 1]' } as const;

const axisChoice = (key: 'repAxis' | 'repAxis2' | 'repRotAxis'): Field<Repeat> => ({
  kind: 'choice',
  key,
  options: [
    { value: 'x', label: 'rep.x' },
    { value: 'y', label: 'rep.y' },
    { value: 'z', label: 'rep.z' },
  ],
});
/** Axis through a circle's center, along the sketch plane's normal (in the world). */
export interface CircleAxis {
  c: V3;
  n: V3;
}

/** Circles and arcs in the sketches before the feature – candidates for "around circle". */
export function repeatCircles(ctx: FieldCtx): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const f of ctx.doc.features.slice(0, ctx.before)) {
    if (f.type !== 'sketch' || f.suppressed) continue;
    for (const [id, e] of Object.entries(f.entities)) {
      if ((e.type !== 'circle' && e.type !== 'arc') || e.construction) continue;
      const c = f.points[e.c];
      const size = e.type === 'circle' ? `Ø${num(2 * e.r)}` : `R${num(Math.hypot(f.points[e.p1].x - c.x, f.points[e.p1].y - c.y))}`;
      out.push({ value: `${f.id}/${id}`, label: `${f.name} · ${size} (${num(c.x)}, ${num(c.y)})` });
    }
  }
  return out;
}

const when = (...kinds: RepKind[]) => (f: Repeat) => kinds.includes(f.rep ?? 'none');

/** The fields in the panel's "Repeat" section (shared by all features). */
export const REPEAT_FIELDS: Field<Repeat>[] = [
  { kind: 'heading', label: 'rep.title' },
  {
    kind: 'select',
    key: 'rep',
    label: 'rep.kind',
    options: () => (['none', 'linear', 'grid', 'circular', 'mirror'] as const).map(k => ({ value: k, label: t(`rep.${k}`) })),
  },
  { ...axisChoice('repAxis'), show: when('linear', 'grid') },
  {
    kind: 'choice',
    key: 'repRotAxis',
    show: when('circular'),
    options: [
      { value: 'x', label: 'rep.x' },
      { value: 'y', label: 'rep.y' },
      { value: 'z', label: 'rep.z' },
      { value: 'circle', label: 'rep.circle' },
    ],
  },
  {
    kind: 'select',
    key: 'repCircle',
    label: 'rep.center',
    show: f => when('circular')(f) && f.repRotAxis === 'circle',
    options: (_f, ctx) => {
      const list = ctx ? repeatCircles(ctx) : [];
      return list.length ? list : [{ value: '', label: t('rep.noCircles') }];
    },
  },
  { kind: 'pair', show: when('linear', 'grid'), fields: [
    { kind: 'expr', key: 'repCount', label: 'rep.count' },
    { kind: 'expr', key: 'repSpacing', label: 'rep.spacing' },
  ] },
  { ...axisChoice('repAxis2'), show: when('grid') },
  { kind: 'pair', show: when('grid'), fields: [
    { kind: 'expr', key: 'repCount2', label: 'rep.count' },
    { kind: 'expr', key: 'repSpacing2', label: 'rep.spacing' },
  ] },
  { kind: 'pair', show: when('circular'), fields: [
    { kind: 'expr', key: 'repCount', label: 'rep.count' },
    { kind: 'expr', key: 'repAngle', label: 'rep.angle' },
  ] },
  {
    kind: 'choice',
    key: 'repPlane',
    show: when('mirror'),
    options: [
      { value: 'yz', label: 'rep.planeYZ' },
      { value: 'xz', label: 'rep.planeXZ' },
      { value: 'xy', label: 'rep.planeXY' },
    ],
  },
];

/** Default values when a pattern is chosen for the first time. */
export function repeatDefaults(f: Repeat) {
  f.repAxis ??= 'x';
  f.repCount ??= '3';
  f.repSpacing ??= '20';
  f.repAxis2 ??= 'y';
  f.repCount2 ??= '2';
  f.repSpacing2 ??= '20';
  f.repAngle ??= '360';
  f.repPlane ??= 'yz';
  f.repRotAxis ??= 'z';
}

/** Short text for the tree ("× 4", "mirrored"). */
export function repeatDetail(f: Repeat): string {
  switch (f.rep ?? 'none') {
    case 'none':
      return '';
    case 'mirror':
      return ` · ${t('rep.mirrored')}`;
    case 'grid':
      return ` · ${f.repCount}×${f.repCount2}`;
    default:
      return ` · ×${f.repCount}`;
  }
}

/** Wrap the pattern around the tools; an error if the values are invalid. */
export function applyRepeat(
  f: Repeat,
  tools: Tool[],
  code: string,
  ctx: Pick<BuildCtx, 'vars' | 'names'> & { circleAxis?: (ref: string) => CircleAxis | null },
): { error: string } | { tools: Tool[] } {
  const kind = f.rep ?? 'none';
  if (kind === 'none') return { tools };
  const r = new FieldReader(ctx);
  const count = (src: string | undefined) => r.read(t('rep.count'), src ?? '', v => Number.isInteger(v) && v >= 1 && v <= 500, t('err.count'));
  let wrap: (call: string) => string;
  if (kind === 'mirror') {
    // A mirror reverses the threads' direction – they would become left-handed.
    if (/twist/.test(code)) return { error: t('err.mirrorThread') };
    const n = PLANE_NORMAL[f.repPlane ?? 'yz'];
    wrap = call => `union() {\n  ${call}\n  mirror(${n}) ${call}\n}`;
  } else if (kind === 'circular') {
    const n = count(f.repCount);
    const ang = r.read(t('rep.angle'), f.repAngle ?? '360', v => v > 0 && v <= 360, t('err.angle360'));
    if (r.error) return { error: r.error };
    // A full turn: n evenly spaced; otherwise the first and last at the ends of the angle.
    const step = Math.abs(ang.v - 360) < 1e-9 ? `${ang.code} / ${n.code}` : n.v > 1 ? `${ang.code} / (${n.code} - 1)` : '0';
    if (f.repRotAxis === 'circle') {
      const ax = f.repCircle ? ctx.circleAxis?.(f.repCircle) : null;
      if (!ax) return { error: t('err.repCircle') };
      const v = (a: V3) => `[${a.map(num).join(', ')}]`;
      const c = v(ax.c), back = v(ax.c.map(x => -x) as V3);
      wrap = call => `for (i = [0 : ${n.code} - 1]) translate(${c}) rotate(a = i * ${step}, v = ${v(ax.n)}) translate(${back}) ${call}`;
    } else wrap = call => `for (i = [0 : ${n.code} - 1]) rotate(a = i * ${step}, v = ${AXIS_VEC[(f.repRotAxis ?? 'z') as Axis]}) ${call}`;
  } else {
    const n = count(f.repCount);
    const s = r.read(t('rep.spacing'), f.repSpacing ?? '');
    const d = AXIS_VEC[f.repAxis ?? 'x'];
    if (kind === 'linear') {
      if (r.error) return { error: r.error };
      wrap = call => `for (i = [0 : ${n.code} - 1]) translate(i * ${s.code} * ${d}) ${call}`;
    } else {
      const n2 = count(f.repCount2);
      const s2 = r.read(t('rep.spacing'), f.repSpacing2 ?? '');
      if (r.error) return { error: r.error };
      if ((f.repAxis2 ?? 'y') === (f.repAxis ?? 'x')) return { error: t('err.sameAxis') };
      const d2 = AXIS_VEC[f.repAxis2 ?? 'y'];
      wrap = call => `for (i = [0 : ${n.code} - 1], j = [0 : ${n2.code} - 1]) translate(i * ${s.code} * ${d} + j * ${s2.code} * ${d2}) ${call}`;
    }
  }
  return { tools: tools.map(tl => ({ op: tl.op, call: wrap(tl.call) })) };
}
