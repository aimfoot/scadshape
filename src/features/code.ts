// OpenSCAD code as a feature: parts that cannot become sketches (e.g. when converting a .scad file:
// polyhedra from BOSL2, hulls of bodies) or custom code in the middle of the tree. Not tied to any
// sketch.

import { t } from '../i18n';
import { OP_LABEL, type FeatureBase, type FeatureKind, type Op, type SketchFeature } from './common';

export interface CodeFeature extends FeatureBase {
  type: 'code';
  sketch: ''; // no sketch
  code: string;
  op: Op;
}

/** Placeholder for features without a sketch (the world's XY plane). */
export const WORLD_SKETCH: SketchFeature = { type: 'sketch', id: '', name: '', plane: 'XY', points: {}, entities: {}, constraints: [], nextId: 1 };

/** include/use must be at the top of the file – they are lifted out of the module. */
const PREAMBLE = /^\s*(include|use)\s*<[^>]+>\s*;?\s*$/gm;

export const code: FeatureKind<CodeFeature> = {
  type: 'code',
  label: 'feat.code',
  icon: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
  pick: { kind: 'none' },
  fields: [
    { kind: 'code', key: 'code', label: 'feat.code' },
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

  create: (id, name) => ({ type: 'code', id, name, sketch: '', code: 'cube(10);', op: 'add' }),

  detail: f => {
    const n = f.code.split('\n').length;
    return `${t(n === 1 ? 'code.oneLine' : 'code.lines', { n })}${f.op === 'add' ? '' : ` · ${t(OP_LABEL[f.op]).toLowerCase()}`}`;
  },

  usable: () => true,

  build(f, _sk, ctx) {
    if (!f.code.trim()) return { error: t('err.noCode') };
    const preamble = [...f.code.matchAll(PREAMBLE)].map(m => m[0].trim().replace(/;?$/, ''));
    const body = f.code.replace(PREAMBLE, '').trim();
    const code = `module ${ctx.module}() {\n${body.split('\n').map(l => `  ${l}`).join('\n')}\n}`;
    return { code, preamble, tools: [{ op: f.op, call: `${ctx.module}();` }] };
  },
};
