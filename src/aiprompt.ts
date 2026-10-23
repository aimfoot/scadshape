// OpenSCAD from an AI chat: the prompt to give the AI (what this app can run, and the rules that
// avoid the mistakes diagnose.ts/lint.ts look for), and the code picked out of a chat answer.

import type { Bed } from './bed';
import { FAMILIES } from './fonts';
import { t } from './i18n';
import { LIBRARIES } from './libs';

/** The prompt for the AI chat, in the app's language; the user's wish goes at the end. */
export function aiPrompt(o: { version: string; bed: Bed; printer: string | null }): string {
  const size = `${o.bed.w} × ${o.bed.d} × ${o.bed.h} mm`;
  return t('ai.prompt', {
    version: o.version,
    libs: LIBRARIES.map(l => l.name).join(', '),
    fonts: FAMILIES.join(', '),
    printer: o.printer ? `${o.printer} (${size})` : size,
  });
}

/**
 * The code in a chat answer: the OpenSCAD block (the longest, if several) when the answer has
 * ``` fences, otherwise the text as it is.
 */
export function codeFromChat(text: string): string {
  const blocks = [...text.matchAll(/```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)```/g)].map(m => ({ lang: m[1].toLowerCase(), code: m[2] }));
  if (!blocks.length) return text.trim() ? `${text.trim()}\n` : '';
  const scad = blocks.filter(b => b.lang === 'openscad' || b.lang === 'scad');
  const pick = (scad.length ? scad : blocks).reduce((a, b) => (b.code.length > a.code.length ? b : a));
  return `${pick.code.replace(/\s+$/, '')}\n`;
}

/** Does the text look like OpenSCAD code (and not, say, a link or a sentence)? */
export const looksLikeScad = (s: string) =>
  /[;{}]/.test(s) && /\b(cube|cylinder|sphere|polygon|polyhedron|square|circle|text|module|function|linear_extrude|rotate_extrude|union|difference|intersection|hull|translate|include|use)\b/.test(s);
