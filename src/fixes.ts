// One-tap fixes for the code's problems where the right change is clear: radians()/degrees()
// written out (as the whole angle of sin/cos/tan, radians(a) is just a), the include/use line of a
// library added, assign() → let(), child() → children(), PI in sin/cos/tan/rotate turned into
// degrees (sin(PI/2) → sin(90)), a % * ! modifier removed. Nothing that is a guess ("did you mean
// width?", sin(PI/4 + a)): there the user decides.

import { blank, calls, closing, lineAt, type Call } from './scadcode';

export interface Edit { from: number; to: number; text: string }
export interface Fix {
  edits: Edit[];
  /** The fixed line(s), shown on the button. */
  preview: string;
  /** How many other lines the same fix changes. */
  more: number;
}

export function applyFix(src: string, fix: Fix): string {
  let out = src;
  for (const e of [...fix.edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}

/** A fix from edits, or null if there are none or they overlap. */
function makeFix(src: string, edits: Edit[]): Fix | null {
  if (!edits.length) return null;
  edits = [...edits].sort((a, b) => a.from - b.from);
  for (let i = 1; i < edits.length; i++) if (edits[i].from < edits[i - 1].to) return null;
  const fix: Fix = { edits, preview: '', more: 0 };
  // The first edit's lines in the fixed code (everything before it is unchanged).
  const out = applyFix(src, fix), e = edits[0];
  const a = out.lastIndexOf('\n', e.from - 1) + 1;
  const b = out.indexOf('\n', e.from + Math.max(0, e.text.length - (e.text.endsWith('\n') ? 1 : 0)));
  fix.preview = out.slice(a, b < 0 ? undefined : b).split('\n').map(l => l.trim()).filter(Boolean).join('\n');
  const first = lineAt(src, e.from);
  fix.more = new Set(edits.map(x => lineAt(src, x.from)).filter(l => l !== first)).size;
  return fix;
}

/** `s` with what is inside (…) and […] blanked out: the expression's own level. */
function topLevel(s: string) {
  let d = 0, out = '';
  for (const ch of s) {
    if (ch === ')' || ch === ']') d--;
    out += d > 0 ? ' ' : ch;
    if (ch === '(' || ch === '[') d++;
  }
  return out;
}
/** Does the expression have an operator weaker than * and / on its own level (+, -, ?:, comparisons …)? */
function loose(s: string) {
  const top = topLevel(s).trim();
  for (let i = 0; i < top.length; i++) {
    const ch = top[i], before = top.slice(0, i);
    if ('?:<>=&|!,'.includes(ch)) return true;
    // A binary + or - (not a sign, not 1e-3).
    if ((ch === '+' || ch === '-') && /[\w.)\]$]\s*$/.test(before) && !/\d[eE]$/.test(before)) return true;
  }
  return false;
}
const prevChar = (code: string, i: number) => {
  while (i > 0 && /\s/.test(code[i - 1])) i--;
  return i > 0 ? code[i - 1] : '';
};
const nextChar = (code: string, i: number) => {
  while (i < code.length && /\s/.test(code[i])) i++;
  return code[i] ?? '';
};
/** The innermost call or bracket around position `at` (name '' for plain parentheses, '[' for a list), or null. */
function enclosing(code: string, at: number): Call | null {
  let d = 0;
  for (let i = at - 1; i >= 0; i--) {
    const ch = code[i];
    if (ch === ')' || ch === ']') d++;
    else if (ch === '(' || ch === '[') {
      if (d-- > 0) continue;
      if (ch === '[') return { at: i, name: '[', open: i, close: closing(code, i) };
      const m = /([A-Za-z_$]\w*)\s*$/.exec(code.slice(Math.max(0, i - 40), i));
      return { at: i - (m?.[0].length ?? 0), name: m?.[1] ?? '', open: i, close: closing(code, i) };
    } else if (d === 0 && ';{}'.includes(ch)) return null;
  }
  return null;
}
/** Is `inner` all of `outer`'s argument? */
const whole = (code: string, outer: Call, inner: Call) =>
  !code.slice(outer.open + 1, inner.at).trim() && !code.slice(inner.close + 1, outer.close).trim();

const TRIG = /^(sin|cos|tan)$/;
const INVERSE = /^(asin|acos|atan|atan2)$/;

/** radians(x) / deg2rad(x) → x * PI / 180, degrees(x) / rad2deg(x) → x * 180 / PI, everywhere in the code. */
export function convertFix(src: string, name: string): Fix | null {
  const toDeg = /^(degrees|rad2deg)$/.test(name);
  const code = blank(src);
  const edits: Edit[] = [];
  for (const c of calls(code, name)) {
    const inner = src.slice(c.open + 1, c.close).trim(), innerCode = code.slice(c.open + 1, c.close);
    if (!inner || topLevel(innerCode).includes(',')) return null;
    const outer = enclosing(code, c.at);
    const fn = /^\s*([A-Za-z_]\w*)\s*\(/.exec(innerCode);
    let text: string;
    if (!toDeg && outer && TRIG.test(outer.name) && whole(code, outer, c)) text = inner; // cos(radians(a)) is cos(a)
    else if (!toDeg && insideTrig(code, c)) return null; // cos(radians(a) / 2): not clear what was meant
    else if (toDeg && fn && INVERSE.test(fn[1]) && closing(innerCode, fn.index + fn[0].length - 1) === innerCode.trimEnd().length - 1) text = inner; // atan2 already gives degrees
    else {
      text = `${loose(innerCode) ? `(${inner})` : inner} * ${toDeg ? '180 / PI' : 'PI / 180'}`;
      const p = prevChar(code, c.at), n = nextChar(code, c.close + 1);
      if (!['', '(', '[', ',', '=', ':', '?', '+', '-', '*', '<', '>'].includes(p) || n === '^' || n === '[') text = `(${text})`;
    }
    edits.push({ from: c.at, to: c.close + 1, text });
  }
  return makeFix(src, edits);
}
function insideTrig(code: string, c: Call) {
  for (let o = enclosing(code, c.at); o; o = enclosing(code, o.at)) if (TRIG.test(o.name)) return true;
  return false;
}

/** assign(…) → let(…), child(…) → children(…) (child() meant the first child: children(0)). */
export function renameFix(src: string, from: string, to: string): Fix | null {
  const code = blank(src);
  return makeFix(src, calls(code, from).map(c => ({
    from: c.at, to: c.open + 1,
    text: `${to}(${to === 'children' && !code.slice(c.open + 1, c.close).trim() ? '0' : ''}`,
  })));
}

/** The library's include (BOSL2, with std.scad first) or use (MCAD) line, after the code's other ones. */
export function includeFix(src: string, lib: 'BOSL2' | 'MCAD', file: string): Fix | null {
  const want = lib === 'MCAD' ? [`use <MCAD/${file}>`]
    : [...(file !== 'std.scad' && !/^\s*include\s*<BOSL2\/std\.scad>/m.test(src) ? ['include <BOSL2/std.scad>'] : []), `include <BOSL2/${file}>`];
  const lines = src.split('\n');
  // After the last include/use; without any, after the comment the code starts with.
  let after = -1;
  lines.forEach((l, k) => { if (/^\s*(include|use)\s*</.test(l)) after = k; });
  if (after < 0) while (after + 1 < lines.length - 1 && /^\s*\/\//.test(lines[after + 1])) after++;
  const pos = lines.slice(0, after + 1).reduce((s, l) => s + l.length + 1, 0);
  if (pos > src.length) return makeFix(src, [{ from: src.length, to: src.length, text: `\n${want.join('\n')}` }]);
  return makeFix(src, [{ from: pos, to: pos, text: `${want.join('\n')}\n` }]);
}

/** A % * ! modifier at `at` removed (with the space after it). */
export function removeFix(src: string, at: number): Fix | null {
  return makeFix(src, [{ from: at, to: at + 1 + /^[ \t]*/.exec(src.slice(at + 1))![0].length, text: '' }]);
}

/** The ranges of a call's arguments, a list argument ([0, 0, PI/2]) split into its elements, without name =. */
function leaves(code: string, a: number, b: number) {
  const split = (a: number, b: number) => {
    const out: [number, number][] = [], tl = topLevel(code.slice(a, b));
    let s = a;
    for (let i = 0; i <= tl.length; i++) {
      if (i < tl.length && tl[i] !== ',') continue;
      out.push([s, a + i]);
      s = a + i + 1;
    }
    return out;
  };
  const out: [number, number][] = [];
  for (let [f, t] of split(a, b)) {
    const named = /^\s*[A-Za-z_$]\w*\s*=(?!=)/.exec(code.slice(f, t));
    if (named) f += named[0].length;
    const s = code.slice(f, t), start = f + s.length - s.trimStart().length, end = f + s.trimEnd().length;
    if (code[start] === '[' && closing(code, start) === end - 1) out.push(...split(start + 1, end - 1));
    else out.push([f, t]);
  }
  return out;
}

/** The value of an expression of plain numbers (90 for 180 / 2), or null (also for 180 / 7). */
function evaluate(s: string): number | null {
  if (!/^[\d.\s+\-*/()]+$/.test(s)) return null;
  let i = 0;
  const peek = () => {
    while (/\s/.test(s[i] ?? '')) i++;
    return s[i];
  };
  const num = (): number => {
    const c = peek();
    if (c === '(') {
      i++;
      const v = sum();
      if (peek() !== ')') throw new Error();
      i++;
      return v;
    }
    if (c === '-') return i++, -num();
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) throw new Error();
    i += m[0].length;
    return Number(m[0]);
  };
  const prod = (): number => {
    let v = num();
    for (let c = peek(); c === '*' || c === '/'; c = peek()) v = (i++, c === '*' ? v * num() : v / num());
    return v;
  };
  const sum = (): number => {
    let v = prod();
    for (let c = peek(); c === '+' || c === '-'; c = peek()) v = (i++, c === '+' ? v + prod() : v - prod());
    return v;
  };
  try {
    const v = sum();
    const r = Math.round(v * 1e6) / 1e6;
    return peek() === undefined && Number.isFinite(v) && Math.abs(r - v) < 1e-9 ? r : null;
  } catch {
    return null;
  }
}

/**
 * PI in a sin/cos/tan or rotate() argument made degrees: PI → 180 where the angle is PI times
 * something (sin(i * PI / 3) → sin(i * 180 / 3), rotate([0, 0, PI / 2]) → rotate([0, 0, 90])).
 * Null when an angle adds something to it (PI / 4 + a): a may be degrees or radians.
 */
export function degreesFix(src: string, code: string, c: Call): Fix | null {
  const edits: Edit[] = [];
  let found = 0;
  for (const [from, to] of leaves(code, c.open + 1, c.close)) {
    const s = code.slice(from, to), n = (s.match(/\bPI\b/g) ?? []).length;
    if (!n) continue;
    found += n;
    const tl = topLevel(s);
    if (n > 1 || !/\bPI\b/.test(tl) || loose(s)) return null;
    const pi = from + tl.search(/\bPI\b/);
    const lead = s.length - s.trimStart().length, trail = s.length - s.trimEnd().length;
    const fixed = (src.slice(from, pi) + '180' + src.slice(pi + 2, to)).trim();
    const value = evaluate(fixed);
    edits.push({ from: from + lead, to: to - trail, text: value === null ? fixed : String(value) });
  }
  return found === (code.slice(c.open + 1, c.close).match(/\bPI\b/g) ?? []).length ? makeFix(src, edits) : null;
}
