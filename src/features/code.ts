// OpenSCAD-kod som en feature: delar som inte kan bli skisser (t.ex. vid konvertering av en .scad-fil:
// polyedrar från BOSL2, hull av kroppar) eller egen kod mitt i trädet. Inte knuten till någon skiss.

import { t } from '../i18n';
import { OP_LABEL, type FeatureBase, type FeatureKind, type Op, type SketchFeature } from './common';

export interface CodeFeature extends FeatureBase {
  type: 'code';
  sketch: ''; // ingen skiss
  code: string;
  op: Op;
}

/** Plats-hållare för features utan skiss (världens XY-plan). */
export const WORLD_SKETCH: SketchFeature = { type: 'sketch', id: '', name: '', plane: 'XY', points: {}, entities: {}, constraints: [], nextId: 1 };

/** include/use måste stå överst i filen – de lyfts ut ur modulen. */
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
