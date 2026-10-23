// Document → OpenSCAD. Each feature builds its module (features/*); here the model is assembled in
// tree order: add = union, remove = difference, intersect = intersection.

import { activeCount, isSolidFeature, type Doc, type SketchFeature } from './doc';
import { exprToScad, parseExpr, scadNames } from './expr';
import { applyRepeat } from './features/pattern';
import { WORLD_SKETCH } from './features/code';
import { kindOf, PLANE_ROTATE, type BuildCtx, type SketchRegions, type Tool } from './features';
import { t } from './i18n';
import { codeName } from './names';
import { evalParams } from './params';
import { findLoops, regionsOf } from './sketch/regions';
import { frameScad, sketchFrame, toWorld } from './frame';
import type { Plane } from './sketch/model';

export { PLANE_ROTATE as PLANE_TRANSFORM };
export { revolveAxis } from './features/revolve';

/** Regions in a sketch. */
export function sketchRegions(sk: SketchFeature): SketchRegions {
  const { loops } = findLoops(sk);
  return { loops, regions: regionsOf(loops) };
}

/** Offset along the plane's normal (XY: +Z, XZ: −Y, YZ: +X). */
const OFFSET_VEC: Record<Plane, (o: string) => string> = {
  XY: o => `[0, 0, ${o}]`,
  XZ: o => `[0, -${o}, 0]`,
  YZ: o => `[${o}, 0, 0]`,
};

export interface Model {
  code: string;
  /** Number of features that contribute geometry. */
  solids: number;
  /** Errors per feature id (the feature is skipped). */
  errors: Map<string, string>;
  /** Variable errors by name. */
  paramErrors: Map<string, string>;
}

const indent = (s: string, by = '  ') => s.split('\n').map(l => (l ? by + l : l)).join('\n');

/** The sketch plane's offset as a number (for the 3D view), 0 if it is missing or invalid. */
export function sketchOffset(sk: SketchFeature, vars = evalParams([]).vars): number {
  return sk.offset ? (parseExpr(sk.offset, vars).value ?? 0) : 0;
}

export function buildModel(doc: Doc): Model {
  const { vars, errors: paramErrors } = evalParams(doc.params);
  const errors = new Map<string, string>();
  const active = doc.features.slice(0, activeCount(doc)).filter(f => !f.suppressed);
  const sketches = new Map<string, SketchFeature>();
  const regionCache = new Map<string, SketchRegions>();
  const modules: string[] = [];
  const preamble = new Set<string>(); // include/use from code features
  const tools: Tool[] = [];

  const out = [t('code.header'), ''];
  const okParams = doc.params.filter(p => !paramErrors.has(p.name));
  const names = scadNames(okParams.map(p => p.name));
  if (okParams.length) {
    out.push(t('code.variables'));
    for (const p of okParams) out.push(`${names.get(p.name)} = ${exprToScad(p.expr, names)};${names.get(p.name) !== p.name ? ` // ${p.name}` : ''}`);
    out.push('');
  }

  const place = (sk: SketchFeature) => {
    if (sk.face) return frameScad(sketchFrame(sk, vars, doc));
    let off = '';
    if (sk.offset) {
      const r = parseExpr(sk.offset, vars);
      if (r.value) off = `translate(${OFFSET_VEC[sk.plane](r.uses.length ? `(${exprToScad(sk.offset, names)})` : String(r.value))}) `;
    }
    return off + PLANE_ROTATE[sk.plane];
  };

  for (const f of active) {
    if (f.type === 'sketch') {
      if (f.offset && parseExpr(f.offset, vars).value === null) errors.set(f.id, `${t('field.offset')}: ${parseExpr(f.offset, vars).error}`);
      sketches.set(f.id, f);
      continue;
    }
    const kind = kindOf(f);
    const sk = kind.pick.kind === 'none' ? WORLD_SKETCH : sketches.get(f.sketch);
    if (!sk) {
      errors.set(f.id, doc.features.some(g => g.id === f.sketch) ? t('err.sketchSuppressed') : t('err.sketchMissing'));
      continue;
    }
    const ctx: BuildCtx = {
      vars,
      names,
      module: codeName(f.name),
      place,
      doc,
      regions: s => {
        if (!regionCache.has(s.id)) regionCache.set(s.id, sketchRegions(s));
        return regionCache.get(s.id)!;
      },
    };
    const built = kind.build(f, sk, ctx);
    if ('error' in built) {
      errors.set(f.id, built.error);
      continue;
    }
    const circleAxis = (ref: string) => {
      const [skId, id] = ref.split('/');
      const s = sketches.get(skId);
      const e = s?.entities[id];
      if (!s || (e?.type !== 'circle' && e?.type !== 'arc')) return null;
      const fr = sketchFrame(s, vars, doc);
      return { c: toWorld(fr, s.points[e.c]), n: fr.n };
    };
    const repeated = applyRepeat(f, built.tools, built.code, { ...ctx, circleAxis });
    if ('error' in repeated) {
      errors.set(f.id, repeated.error);
      continue;
    }
    built.tools = repeated.tools;
    if (built.tools[0].op !== 'add' && !tools.length) {
      errors.set(f.id, t('err.noBody', { name: t(kindOf(f).label) }));
      continue;
    }
    for (const line of built.preamble ?? []) preamble.add(line);
    modules.push(`// ${f.name}${sk.name ? ` · ${sk.name}` : ''}\n${built.code}`);
    tools.push(...built.tools);
  }

  // Build the model: a run of "add" is merged into a union.
  let model: string | null = null;
  let adds: string[] = [];
  const flush = () => {
    if (!adds.length) return;
    const parts = model ? [model, ...adds] : adds;
    model = parts.length === 1 ? parts[0] : `union() {\n${parts.map(p => indent(p)).join('\n')}\n}`;
    adds = [];
  };
  for (const tl of tools) {
    if (tl.op === 'add') adds.push(tl.call);
    else {
      flush();
      model = `${tl.op === 'remove' ? 'difference' : 'intersection'}() {\n${indent(model!)}\n${indent(tl.call)}\n}`;
    }
  }
  flush();

  if (preamble.size) out.push(...preamble, '');
  out.push(...modules.flatMap(m => [m, '']));
  if (model) out.push(t('code.model'), model);
  return { code: out.join('\n'), solids: modules.length, errors, paramErrors };
}

/** Sketches not used by any active feature (shown as lines in 3D). */
export function looseSketches(doc: Doc): SketchFeature[] {
  const active = doc.features.slice(0, activeCount(doc)).filter(f => !f.suppressed);
  const used = new Set(active.filter(isSolidFeature).map(f => f.sketch));
  return active.filter((f): f is SketchFeature => f.type === 'sketch' && !used.has(f.id));
}
