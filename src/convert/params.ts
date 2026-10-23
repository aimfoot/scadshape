// Variables for "Convert to sketches". OpenSCAD evaluates the code before the CSG export, so the
// converted model only has numbers. Here the top-level assignments (`width = 60;`) are read from the
// source and become document variables, and every dimension, extrude depth and sketch offset that
// depends on them gets an expression (ParamLinker), so changing a variable changes the model as it
// would change the code.

import type { Doc } from '../doc';
import { parseExpr } from '../expr';
import { evalParams, validateParamName, type Param } from '../params';

interface Assign {
  name: string;
  expr: string;
  hidden: boolean;
}

/** The top-level assignments in source order (comments, strings, modules and include/use skipped). */
function topLevelAssignments(src: string): Assign[] {
  const out: Assign[] = [];
  let depth = 0, stmt = '', hidden = false;
  const flush = () => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*([\s\S]+)$/.exec(stmt.trim());
    if (m) out.push({ name: m[1], expr: m[2].trim(), hidden });
    stmt = '';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      stmt += ' ';
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const body = src.slice(i + 2, end < 0 ? src.length : end);
      // Customizer section: /* [Name] */ – everything after /* [Hidden] */ is hidden.
      const sec = depth === 0 && /^\s*\[([^\]]*)\]\s*$/.exec(body);
      if (sec) hidden = /^\s*hidden\s*$/i.test(sec[1]);
      i = end < 0 ? src.length : end + 1;
      stmt += ' ';
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      if (depth === 0) stmt += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (depth === 0 && ch === '<' && /^\s*(include|use)\s*$/.test(stmt)) {
      const end = src.indexOf('>', i);
      i = end < 0 ? src.length : end;
      stmt = '';
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      if (ch === '}' && depth === 0) {
        stmt = '';
        continue;
      }
    }
    if (depth === 0 && ch === ';') flush();
    else stmt += ch;
  }
  return out;
}

/** Split a vector literal "[a, b, c]" into its elements (null if it is not one). */
function vectorElements(expr: string): string[] | null {
  if (!expr.startsWith('[') || !expr.endsWith(']')) return null;
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of expr.slice(1, -1)) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts.length >= 2 && parts.every(Boolean) ? parts : null;
}

const AXES = ['x', 'y', 'z'];
const tidy = (e: string) => e.replace(/\s+/g, ' ').trim().replace(/(\d)\.(\d)/g, '$1,$2');

interface Analysis {
  params: Param[];
  vars: Map<string, number>; // only those in params
  refs: (e: string) => string;
  /**
   * Variables set to a plain number: code that sets one to its value + its change in `d` (appended,
   * so it wins). The elements of a vector write the whole vector with all their changes.
   */
  free: Map<string, Override>;
}
type Override = (d: ReadonlyMap<string, number>) => string;

/** The source's numeric top-level variables as document variables (vectors become name_x/_y/_z). */
export const scadParams = (src: string): Param[] => analyse(src).params;

function analyse(src: string): Analysis {
  const all = topLevelAssignments(src);
  // A variable assigned twice gets OpenSCAD's last value at the first place – too unusual to mirror.
  const count = new Map<string, number>();
  for (const a of all) count.set(a.name, (count.get(a.name) ?? 0) + 1);
  const vectors = new Map<string, string[]>(); // name → element variable names
  const vars = new Map<string, number>();
  const found: (Param & { hidden: boolean; uses: string[] })[] = [];
  // size[0] / size.x → size_x.
  const elementRefs = (e: string) =>
    e.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\s*(\d+)\s*\]|\.([xyz])\b)/g, (m, name: string, idx?: string, axis?: string) => {
      const els = vectors.get(name);
      const k = idx !== undefined ? Number(idx) : AXES.indexOf(axis!);
      return els?.[k] ?? m;
    });
  const free = new Map<string, Override>();
  const plus = (e: string, d = 0) => (d ? `(${e}) + ${d}` : e);
  const add = (name: string, expr: string, hidden: boolean, override: Override) => {
    if (validateParamName(name, found)) return false;
    const e = elementRefs(expr);
    const r = parseExpr(e, vars);
    if (r.value === null) return false;
    vars.set(name, r.value);
    found.push({ name, expr: tidy(e), hidden, uses: r.uses });
    if (!r.uses.length) free.set(name, override);
    return true;
  };
  for (const a of all) {
    if (count.get(a.name)! > 1) continue;
    const els = vectorElements(a.expr);
    if (els) {
      const names = els.map((_, k) => `${a.name}_${els.length <= 3 ? AXES[k] : k}`);
      const ok = els.map((e, k) => add(names[k], e, a.hidden, d => `${a.name} = [${els.map((x, j) => plus(x, d.get(names[j]))).join(', ')}];`));
      if (ok.every(Boolean)) vectors.set(a.name, names);
      continue;
    }
    add(a.name, a.expr, a.hidden, d => `${a.name} = ${plus(a.expr, d.get(a.name))};`);
  }
  // Hidden variables only come along when a visible one uses them.
  const keep = new Set(found.filter(p => !p.hidden).map(p => p.name));
  for (let i = found.length - 1; i >= 0; i--) if (keep.has(found[i].name)) for (const u of found[i].uses) keep.add(u);
  const params = found.filter(p => keep.has(p.name)).map(({ name, expr }) => ({ name, expr }));
  for (const n of [...free.keys()]) if (!keep.has(n)) free.delete(n);
  return { params, vars: new Map(params.map(p => [p.name, vars.get(p.name)!])), refs: elementRefs, free };
}

interface Candidate {
  expr: string;
  value: number;
}

/**
 * The expressions with variables that are written in the code: `h = thickness + 2` gives
 * "thickness + 2", `cube([width + 2*wall, …])` gives "width + 2*wall". Only these are trusted as
 * combinations – guessing a+b from the values alone links far too much by coincidence.
 */
function codeExpressions(src: string, vars: Map<string, number>, refs: (e: string) => string): Candidate[] {
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"/g, ' ');
  const out = new Map<string, Candidate>();
  for (const frag of code.split(/[()[\]{};,=<>?:!]/)) {
    const e = refs(frag.trim());
    if (!e || /^[A-Za-z_][A-Za-z0-9_]*$/.test(e)) continue;
    const r = parseExpr(e, vars);
    if (r.value === null || !r.uses.length) continue;
    const ex = tidy(e);
    out.set(ex.replace(/\s/g, ''), { expr: ex, value: r.value });
  }
  return [...out.values()];
}

/** Candidates by priority: a variable, an expression in the code, 2*a or a/2 (radius ↔ diameter). */
function candidates(vars: Map<string, number>, code: Candidate[]): Candidate[][] {
  const vs = [...vars].filter(([, v]) => Math.abs(v) > 1e-9);
  return [
    vs.map(([a, x]) => ({ expr: a, value: x })),
    code,
    vs.flatMap(([a, x]) => [{ expr: `2*${a}`, value: 2 * x }, { expr: `${a}/2`, value: x / 2 }]),
  ];
}

// Values from OpenSCAD's SVG export have 6 significant digits.
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a));
/** −e as an expression ("-w/2" → "w/2", "a - 3" → "3 - a", "a + b" → "-(a + b)"). */
function negate(e: string) {
  if (/^-[^+-]*$/.test(e)) return e.slice(1);
  if (/^[^+-]*$/.test(e)) return `-${e}`;
  const m = /^([^+-]+) - ([^+-]+)$/.exec(e);
  return m ? `${m[2]} - ${m[1]}` : `-(${e})`;
}
const numOf = (s: string | undefined) => (s === undefined ? null : parseExpr(s).value);

interface Probe {
  deps: number[][]; // per slot, per free variable
  joint: { values: number[]; vars: Map<string, number> } | null;
}

/** A value in the converted document that can get an expression. */
interface Slot {
  key: string; // the same in every conversion of the same code structure
  v: number; // signed: a position left of/below the origin is negative
  radial: boolean;
  set: (e: string) => void; // e evaluates to v
}

function slots(doc: Doc): Slot[] {
  const out: Slot[] = [];
  doc.features.forEach((f, fi) => {
    if (f.type === 'sketch') {
      f.constraints.forEach((c, ci) => {
        if (!('value' in c) || c.expr || c.type === 'angle' || c.type === 'xangle') return;
        // A position from the origin in the negative direction: the dimension is the magnitude.
        const neg = c.type === 'distance' && c.sign === -1;
        out.push({ key: `${fi}:${ci}:${c.type}`, v: neg ? -c.value : c.value, radial: c.type === 'radius' || c.type === 'diameter', set: e => (c.expr = neg ? negate(e) : e) });
      });
      out.push({ key: `${fi}:offset`, v: numOf(f.offset) ?? 0, radial: false, set: e => (f.offset = e) });
    } else if (f.type === 'extrude') out.push({ key: `${fi}:depth`, v: numOf(f.depth) ?? NaN, radial: false, set: e => (f.depth = e) });
  });
  return out;
}

/** x as p/q with a small q (within the precision of the SVG export), or null. */
function nice(x: number): [number, number] | null {
  if (Math.abs(x) < 0.02) return [0, 1];
  for (const q of [1, 2, 3, 4, 5, 6, 8, 10, 12]) if (Math.abs(x * q - Math.round(x * q)) < 0.02 * q) return [Math.round(x * q), q];
  return null;
}
const num = (x: number) => tidy(String(Math.round(x * 1e6) / 1e6));
/** "a + 3*b - c/2 + 8" from terms and a constant. */
function linear(terms: [string, [number, number]][], c: number): string {
  const used = terms.filter(([, [p]]) => p);
  const parts = [...used.filter(([, [p]]) => p > 0), ...used.filter(([, [p]]) => p < 0)].map(([name, [p, q]]) => {
    const s = Math.sign(p), a = Math.abs(p);
    return (s < 0 ? '-' : '') + (a === 1 ? name : `${a}*${name}`) + (q === 1 ? '' : `/${q}`);
  });
  if (Math.abs(c) > 1e-9) parts.push(num(c));
  return parts.map((t, i) => (i === 0 ? t : t.startsWith('-') ? ` - ${t.slice(1)}` : ` + ${t}`)).join('');
}

/**
 * The code's variables, and how to find the expression for each value in the converted document.
 *
 * Mainly by probing: the code is converted again with each variable nudged, and the change of every
 * value gives its dependence on the variables exactly (wall and r - wall can both be 2, but only one
 * moves by −1 when wall grows). The expression is then a variable or an expression from the code with
 * that value and dependence, or else built from it ("inner_y + 3*wall + gap + 8"). Without probing
 * (it failed or took too long), values are matched to variables and code expressions by value alone.
 */
export class ParamLinker {
  readonly params: Param[];
  private vars: Map<string, number>;
  private free: Map<string, Override>;
  private code: Candidate[] = [];
  private lv: Candidate[][] = [];
  constructor(private src: string) {
    const { params, vars, refs, free } = analyse(src);
    this.params = params;
    this.vars = vars;
    this.free = free;
    if (params.length) {
      this.code = codeExpressions(src, vars, refs);
      this.lv = candidates(vars, this.code);
    }
  }

  /**
   * Give the converted document the variables and link its values to them; returns how many.
   * `reconvert` converts changed code the same way (same choices) as the document was made.
   */
  async link(doc: Doc, reconvert: (src: string) => Promise<Doc>, budgetMs = 30_000): Promise<number> {
    if (!this.params.length) return 0;
    doc.params = this.params.map(p => ({ ...p }));
    const base = slots(doc);
    let probe: Probe | null;
    try {
      probe = await this.probe(base, reconvert, Date.now() + budgetMs);
    } catch {
      probe = null;
    }
    let linked = 0;
    base.forEach((s, i) => {
      if (!Number.isFinite(s.v)) return;
      const e = probe ? this.fromDeps(s, probe.deps[i]) : this.find(s.v, { signed: true, radial: s.radial });
      if (e && (!probe || this.holds(e, probe, i))) {
        s.set(e);
        linked++;
      }
    });
    return linked;
  }

  /** Nudge size for a variable: large enough for the SVG export's 6 digits. */
  private step = (name: string) => 0.1 * Math.max(1, Math.abs(this.vars.get(name)!));

  /** The code with the variables changed by `d`. */
  private nudged(d: ReadonlyMap<string, number>) {
    const lines = new Set([...d.keys()].filter(n => d.get(n)).map(n => this.free.get(n)!(d)));
    return `${this.src}\n${[...lines].join('\n')}\n`;
  }

  /**
   * Per slot, the change per unit of each free variable (0 for one that changes the structure),
   * and the values with all of them changed at once (null if that changes the structure).
   */
  private async probe(base: Slot[], reconvert: (src: string) => Promise<Doc>, deadline: number): Promise<Probe> {
    const names = [...this.free.keys()];
    const deps = base.map(() => names.map(() => 0));
    const steps = new Map<string, number>();
    const run = async (d: ReadonlyMap<string, number>) => {
      if (Date.now() > deadline) throw new Error('timeout');
      let s: Slot[];
      try {
        s = slots(await reconvert(this.nudged(d)));
      } catch {
        return null;
      }
      return s.length === base.length && s.every((x, i) => x.key === base[i].key) ? s : null;
    };
    for (const [k, name] of names.entries()) {
      // Up first, down if that changes the structure (a loop count, a shape becoming another).
      for (const d of [this.step(name), -this.step(name)]) {
        const s = await run(new Map([[name, d]]));
        if (!s) continue;
        s.forEach((x, i) => (deps[i][k] = (x.v - base[i].v) / d));
        steps.set(name, d);
        break;
      }
    }
    const all = await run(steps);
    return { deps, joint: all && { values: all.map(x => x.v), vars: evalParams(this.params.map(p => (steps.has(p.name) ? { ...p, expr: String(this.vars.get(p.name)! + steps.get(p.name)!) } : p))).vars } };
  }

  /**
   * Does the expression also hold with all variables changed at once? One variable at a time only
   * shows the slope along each: m*z looks like a sum of m and z terms until both change.
   */
  private holds(e: string, probe: Probe, i: number) {
    if (!probe.joint) return probe.deps[i].filter(x => Math.abs(x) > 0.02).length <= 1;
    const want = probe.joint.values[i], got = parseExpr(e, probe.joint.vars).value;
    return got !== null && Math.abs(got - want) < 2e-3 * Math.max(1, Math.abs(want));
  }

  /** The variables' and code expressions' values and dependences (computed, so exact). */
  private depCandidates = (() => {
    let cache: { lists: (Candidate & { d: number[] })[][] } | null = null;
    return () => {
      if (cache) return cache.lists;
      const names = [...this.free.keys()];
      const nudged = names.map(n => {
        const ps = this.params.map(p => (p.name === n ? { ...p, expr: String(this.vars.get(n)! + 1) } : p));
        return evalParams(ps).vars;
      });
      const dep = (expr: string, value: number) => nudged.map(vs => (parseExpr(expr, vs).value ?? NaN) - value);
      const withDep = (cs: Candidate[]) => cs.map(c => ({ ...c, d: dep(c.expr, c.value) }));
      const params = this.params.map(p => ({ expr: p.name, value: this.vars.get(p.name)! }));
      const lists = [
        withDep(params.filter(c => Math.abs(c.value) > 1e-9)),
        withDep(this.code),
        withDep(params.flatMap(c => [{ expr: `2*${c.expr}`, value: 2 * c.value }, { expr: `${c.expr}/2`, value: c.value / 2 }])),
      ];
      cache = { lists };
      return lists;
    };
  })();

  /** The expression for a slot from its dependence on the free variables, or null (a constant). */
  private fromDeps(s: Slot, dep: number[]): string | null {
    const names = [...this.free.keys()];
    const k = dep.map(nice);
    if (k.some(x => !x)) return null; // not linear in the variables: keep the number
    if (k.every(x => x![0] === 0)) return null;
    const exact = k.map(x => x![0] / x![1]);
    const sameDep = (d: number[], sign: number) => d.every((x, i) => Math.abs(sign * x - exact[i]) < 1e-6);
    const [params, code, radial] = this.depCandidates();
    // With the dependence already exact, the value may differ by the SVG export's rounding and
    // fitted arcs (a hole's center at 5,0007 is the code's w/2).
    const close = (v: number) => Math.abs(v - s.v) < 2e-3 * Math.max(1, Math.abs(s.v));
    for (const list of s.radial ? [params, code, radial] : [params, code])
      for (const sign of [1, -1])
        for (const c of list) if (sameDep(c.d, sign) && close(sign * c.value)) return sign > 0 ? c.expr : negate(c.expr);
    // A variable or code expression with the same dependence, plus a round constant (t + 2).
    let best: string | null = null, off = Infinity;
    for (const c of [...params, ...code]) {
      if (!sameDep(c.d, 1)) continue;
      const rest = s.v - c.value;
      if (Math.abs(rest * 100 - Math.round(rest * 100)) > 1e-4 * Math.max(1, Math.abs(s.v))) continue;
      if (Math.abs(rest) >= off) continue;
      // "wall + 2" plus 1 → "wall + 3".
      const tail = /^(.*\S) ([+-]) (\d+(?:,\d+)?)$/.exec(c.expr);
      const [head, k] = tail ? [tail[1], (tail[2] === '-' ? -1 : 1) * Number(tail[3].replace(',', '.')) + rest] : [c.expr, rest];
      const kk = Math.round(k * 100) / 100;
      [best, off] = [kk ? `${head}${kk < 0 ? ' - ' : ' + '}${num(Math.abs(kk))}` : head, Math.abs(rest)];
    }
    if (best) return best;
    const c0 = s.v - exact.reduce((sum, x, i) => sum + x * this.vars.get(names[i])!, 0);
    return linear(names.map((n, i) => [n, k[i]!]), Math.abs(c0 - Math.round(c0 * 1e4) / 1e4) < 1e-4 * Math.max(1, Math.abs(s.v)) ? Math.round(c0 * 1e4) / 1e4 : c0);
  }

  /**
   * The expression for the value, or null if none or several match at the same priority. `signed`
   * also tries −value (a coordinate or offset); 2*a and a/2 are only tried for radii and diameters
   * (`radial`).
   */
  find(value: number, { signed = false, radial = false } = {}): string | null {
    const hit = (v: number) => {
      for (const list of radial ? this.lv : this.lv.slice(0, 2)) {
        const hits = new Set(list.filter(c => same(c.value, v)).map(c => c.expr));
        if (hits.size) return hits.size === 1 ? [...hits][0] : null;
      }
      return null;
    };
    if (Math.abs(value) < 1e-9 || !Number.isFinite(value)) return null;
    const e = hit(value);
    if (e || !signed) return e;
    const n = hit(-value);
    return n && negate(n);
  }

  /** How well a coordinate is explained: 2 = it is 0, 1 = a variable expression, 0 = not. */
  explains(v: number) {
    return Math.abs(v) < 1e-9 ? 2 : this.find(v, { signed: true }) ? 1 : 0;
  }

}
