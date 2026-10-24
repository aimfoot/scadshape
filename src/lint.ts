// Checks for mistakes OpenSCAD renders without a word: sin(PI/2) (OpenSCAD's angles are degrees),
// adding up in a loop (variables can't change), % / * / ! left in front of a part (it is left out of
// the model), a font the app doesn't have (silently replaced), a huge $fn, an assembly of parts that
// will be merged into one body. They join OpenSCAD's own problems in diagnose.ts.

import { FAMILIES, fontAlias } from './fonts';
import { t } from './i18n';
import type { Problem } from './diagnose';
import { degreesFix, removeFix, type Fix } from './fixes';
import { blank, calls as callsIn, lineAt } from './scadcode';

export function lint(src: string): Problem[] {
  const code = blank(src);
  const out: Problem[] = [];
  const add = (at: number, severity: Problem['severity'], fragment: string, hint: string, fix?: Fix | null) =>
    out.push({ severity, message: fragment.replace(/\s+/g, ' ').trim(), line: lineAt(src, at), count: 1, hint, followUp: false, check: true, ...(fix ? { fix } : {}) });
  const calls = (name: string) => callsIn(code, name).map(c => ({ ...c, arg: code.slice(c.open + 1, c.close), text: src.slice(c.at, c.close + 1) }));

  // Angles in radians: OpenSCAD's sin/cos/tan and rotate() take degrees.
  for (const c of calls('sin|cos|tan')) if (/\bPI\b/.test(c.arg) && !/180/.test(c.arg)) add(c.at, 'warn', c.text, t('lint.trigRadians', { fn: c.name }), degreesFix(src, code, c));
  for (const c of calls('rotate')) if (/\bPI\b/.test(c.arg) && !/180/.test(c.arg)) add(c.at, 'warn', c.text, t('lint.rotateRadians'), degreesFix(src, code, c));

  // A font the app doesn't have: fontconfig falls back to Liberation Sans without a warning. A name
  // with an alias of the same letter widths (Arial → Liberation Sans) is fine; another alias is
  // mentioned.
  for (const c of calls('text')) {
    const f = /\bfont\s*=\s*"([^"]*)"/.exec(src.slice(c.at, c.at + c.text.length));
    const family = f?.[1].split(':')[0].trim();
    if (!f || !family || FAMILIES.includes(family)) continue;
    const alias = fontAlias(family);
    if (alias?.same) continue;
    if (alias) add(c.at + f.index, 'note', `font = "${f[1]}"`, t('lint.fontAlias', { font: family, used: alias.family }));
    else add(c.at + f.index, 'warn', `font = "${f[1]}"`, t('lint.font', { font: family, fonts: FAMILIES.join(', ') }));
  }

  // $fn far above what a print needs: slow, above all on a phone.
  for (const m of code.matchAll(/\$fn\s*=\s*(\d+(?:\.\d+)?)/g)) if (Number(m[1]) > 180) add(m.index!, 'note', m[0], t('lint.fnHigh', { n: m[1] }));

  // Statements: adding up in a loop, modifiers in front of parts, top-level colored parts.
  let brace = 0, paren = 0, start = 0, sawEq = false, prev = '';
  const colors: number[] = [];
  // Per open {: is it a for loop's body? (In a module, x = f(x) gives a parameter a default: fine.)
  // Judged on the head without its (…): list comprehensions in parameters are not loops.
  const loops: boolean[] = [];
  const bare = (s: string) => {
    for (let prev = ''; prev !== s; ) [prev, s] = [s, s.replace(/\([^()]*\)|\[[^[\]]*\]/g, ' ')];
    return s;
  };
  const isLoop = (head: string) => /\b(for|intersection_for)\b/.test(bare(head)) && !/^\s*(module|function)\b/.test(head);
  /** name + …, … + name or concat(name, …): an attempt to add up (not c ? … : name * 2, a choice). */
  const addsUp = (name: string, rhs: string) => {
    const n = `(?<![\\w$])${name}(?![\\w$])`;
    return !rhs.includes('?') && new RegExp(`^\\s*${n}\\s*[-+*/]|[-+*/]\\s*${n}\\s*$|^\\s*concat\\s*\\(\\s*${n}\\s*,`).test(rhs);
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[') paren++;
    else if (ch === ')' || ch === ']') paren = Math.max(0, paren - 1);
    else if (paren === 0) {
      if (ch === '{' || ch === '}' || ch === ';') {
        if (ch === ';') {
          // name = name + …: a new variable each time round, nothing adds up.
          const stmt = code.slice(start, i).trim();
          const m = /(?:^|\)\s*)([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(stmt);
          const inLoop = loops.includes(true) || isLoop(stmt);
          if (m && inLoop && addsUp(m[1], m[2])) add(start + code.slice(start).search(/\S/), 'warn', src.slice(start, i + 1), t('lint.accumulate', { name: m[1] }));
        }
        if (ch === '{') {
          brace++;
          loops.push(isLoop(code.slice(start, i)));
        }
        if (ch === '}') {
          brace = Math.max(0, brace - 1);
          loops.pop();
        }
        [start, sawEq, prev] = [i + 1, false, ch];
        continue;
      }
      if (ch === '=' && code[i + 1] !== '=' && !'<>!='.includes(code[i - 1])) sawEq = true;
      // % * ! at the head of a statement (not in an expression) are modifiers.
      if ('%*!'.includes(ch) && !sawEq && ['', ';', '{', '}', ')'].includes(prev) && /^\s*[A-Za-z_]/.test(code.slice(i + 1, i + 40))) {
        const key = ch === '%' ? 'lint.modBackground' : ch === '*' ? 'lint.modDisable' : 'lint.modOnly';
        add(i, 'warn', src.slice(i, src.indexOf('\n', i) < 0 ? undefined : src.indexOf('\n', i)), t(key), removeFix(src, i));
      }
      if (brace === 0 && /^color\s*\(/.test(code.slice(i, i + 12)) && code.slice(start, i).trim() === '') colors.push(i);
    }
    if (!/\s/.test(ch)) prev = ch;
  }
  if (colors.length >= 3) add(colors[0], 'note', 'color(…)', t('lint.assembly', { n: colors.length }));
  return out;
}
