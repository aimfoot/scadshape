// Uttryck i mått- och featurefält: tal (komma eller punkt), variabler, + − * / och parenteser.
// "bredd/2 + 5" → värde. Samma syntax är giltig OpenSCAD (efter komma → punkt).

import { t } from './i18n';

export type Vars = ReadonlyMap<string, number>;

const IDENT = /^[A-Za-zÅÄÖåäö_][A-Za-z0-9ÅÄÖåäö_]*/;
export const isIdentifier = (s: string) => IDENT.test(s) && IDENT.exec(s)![0] === s;

export interface ExprResult {
  value: number | null;
  error?: string;
  /** Variabler som uttrycket använder. */
  uses: string[];
}

export function parseExpr(src: string, vars: Vars = new Map()): ExprResult {
  const s = src.replace(/,/g, '.').replace(/\s+/g, '').replace(/(mm|°)$/, '');
  const uses = new Set<string>();
  let i = 0;
  let error: string | undefined;
  const fail = (msg: string) => {
    error ??= msg;
    return null;
  };
  const peek = () => s[i];
  function atom(): number | null {
    const num = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    const id = IDENT.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      uses.add(id[0]);
      const v = vars.get(id[0]);
      return v === undefined ? fail(t('expr.unknownVar', { name: id[0] })) : v;
    }
    return fail(t('expr.expected'));
  }
  function factor(): number | null {
    if (peek() === '-') {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    if (peek() === '(') {
      i++;
      const v = sum();
      if (peek() !== ')') return fail(t('expr.missingParen'));
      i++;
      return v;
    }
    return atom();
  }
  function product(): number | null {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[i++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function sum(): number | null {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[i++];
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  if (!s) return { value: null, error: t('expr.empty'), uses: [] };
  const v = sum();
  if (v !== null && i !== s.length) fail(t('expr.unexpected', { ch: s[i] }));
  if (v !== null && !Number.isFinite(v)) fail(t('expr.invalid'));
  return { value: error ? null : v, error, uses: [...uses] };
}

/** Värdet eller null (bakåtkompatibelt). */
export function evalExpr(src: string, vars?: Vars): number | null {
  return parseExpr(src, vars).value;
}

/** Uttrycket som OpenSCAD-kod (decimalkomma → punkt, variabelnamn via `names`). */
export function exprToScad(src: string, names?: ReadonlyMap<string, string>): string {
  const s = src.trim().replace(/(\d),(\d)/g, '$1.$2');
  if (!names) return s;
  return s.replace(/[A-Za-zÅÄÖåäö_][A-Za-z0-9ÅÄÖåäö_]*/g, id => names.get(id) ?? id);
}

/**
 * OpenSCAD tillåter bara a–z, 0–9 och _ i namn: översätt (höjd → hojd) och gör unika.
 * `taken` är namn som redan används i koden.
 */
export function scadNames(names: string[], taken: Iterable<string> = []): Map<string, string> {
  const used = new Set(taken);
  const out = new Map<string, string>();
  // Namn som redan är giltiga behåller sitt namn; de översatta får ge vika vid krock.
  const valid = (n: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n);
  for (const n of names) if (valid(n) && !used.has(n)) {
    used.add(n);
    out.set(n, n);
  }
  for (const n of names) {
    if (out.has(n)) continue;
    let base = n.replace(/[åäÅÄ]/g, c => (c === c.toUpperCase() ? 'A' : 'a')).replace(/[öÖ]/g, c => (c === 'Ö' ? 'O' : 'o'));
    base = base.replace(/[^A-Za-z0-9_]/g, '_');
    let cand = base;
    for (let k = 2; used.has(cand); k++) cand = `${base}_${k}`;
    used.add(cand);
    out.set(n, cand);
  }
  return out;
}

/** Innehåller uttrycket variabler (och är alltså mer än ett tal)? */
export const isParametric = (src: string) => parseExpr(src).uses.length > 0;
