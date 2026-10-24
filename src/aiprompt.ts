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

/**
 * What the code says it is: the comment block at its top (the prompt asks the AI to start with one:
 * what it is, then a line per part and how they go together). `title` is its first line, `body` the
 * rest; null without one. Rules like // ====== are left out.
 */
export function codeDescription(src: string): { title: string; body: string } | null {
  const lines: string[] = [];
  const rest = src.replace(/^\s+/, '');
  const block = /^\/\*([\s\S]*?)\*\//.exec(rest);
  if (block) lines.push(...block[1].split('\n').map(l => l.replace(/^\s*\*?\s?/, '')));
  else
    for (const l of rest.split('\n')) {
      const m = /^\s*\/\/+\s?(.*)$/.exec(l);
      if (!m) break;
      lines.push(m[1]);
    }
  const text = lines.map(l => l.trimEnd()).filter(l => !/^[-=*#_~\s]{3,}$/.test(l));
  while (text.length && !text[0].trim()) text.shift();
  while (text.length && !text[text.length - 1].trim()) text.pop();
  if (!text.length || text[0].trim().length < 3) return null;
  return { title: text[0].trim(), body: text.slice(1).join('\n') };
}

/** Does the text look like OpenSCAD code (and not, say, a link or a sentence)? */
export const looksLikeScad = (s: string) =>
  /[;{}]/.test(s) && /\b(cube|cylinder|sphere|polygon|polyhedron|square|circle|text|module|function|linear_extrude|rotate_extrude|union|difference|intersection|hull|translate|include|use)\b/.test(s);
