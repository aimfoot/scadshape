// Reading OpenSCAD code as text, shared by the checks (lint.ts) and the fixes (fixes.ts).

/** The code with comments and the insides of strings blanked out (same length, same lines). */
export function blank(src: string) {
  return src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"/g, m =>
    m.startsWith('"') ? `"${m.slice(1, -1).replace(/[^\n]/g, ' ')}"` : m.replace(/[^\n]/g, ' '));
}
export const lineAt = (src: string, i: number) => src.slice(0, i).split('\n').length;
/** The index of the ) that closes the ( at `open`, or the end. */
export function closing(code: string, open: number) {
  let d = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(' || code[i] === '[') d++;
    else if ((code[i] === ')' || code[i] === ']') && --d === 0) return i;
  }
  return code.length - 1;
}

export interface Call { at: number; name: string; open: number; close: number }
/** Calls of the functions/modules matching `name` (a regex alternative) in blanked code. */
export function calls(code: string, name: string): Call[] {
  return [...code.matchAll(new RegExp(`(?<![\\w$.])(${name})\\s*\\(`, 'g'))].map(m => {
    const open = m.index! + m[0].length - 1;
    return { at: m.index!, name: m[1], open, close: closing(code, open) };
  });
}
