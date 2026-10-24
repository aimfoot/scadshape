// The code's problems in plain words: OpenSCAD's ERROR/WARNING lines are merged (Haiku-style code can
// give the same warning thousands of times), placed on a line of the user's code (also when the
// error is inside a library: the TRACE says where it was called from) and explained, with the
// typical mistakes of AI-written code recognised (radians(), +=, Python loops, a forgotten BOSL2
// include …). problemsForAi() writes them as text to paste back into the AI chat.

import { fitsBed, meshSize, type Bed } from './bed';
import { convertFix, includeFix, renameFix, type Fix } from './fixes';
import { flatCeilings } from './ceilings';
import { midAirStarts } from './floating';
import { overhangs } from './overhangs';
import { FAMILIES } from './fonts';
import { t } from './i18n';
import { BOSL2_NAMES, MCAD_NAMES } from './libnames.gen';
import { LIBRARIES } from './libs';
import { lint } from './lint';

export interface Problem {
  /** note: maybe intended (not counted in the status bar). */
  severity: 'error' | 'warn' | 'note';
  /** OpenSCAD's own message, without the file and line; for a check (lint.ts) the code it is about. */
  message: string;
  /** Line in the user's code (1-based), or null. */
  line: number | null;
  count: number;
  /** Plain-language explanation and what to do, or null. */
  hint: string | null;
  /** A consequence of another problem (an undefined value used further on). */
  followUp: boolean;
  /** Found by the app's own check of the code (lint.ts), not by OpenSCAD. */
  check?: true;
  /** A one-tap fix, where the right change is clear (fixes.ts). */
  fix?: Fix;
  /** Found in the rendered model (meshProblems), not in a line of the code. */
  mesh?: true;
}

const USER_FILE = '/in.scad';
const LOCATION = /\s+in file ([^,]+), line (\d+)\.?\s*$/;
const FOLLOW_UP = /undefined operation|could not be converted|Unable to convert|expected number, found undefined|undef\b/;

/** Functions AI code reaches for that OpenSCAD does not have, and what to write instead. */
const MISSING_FUNCTIONS: Record<string, string> = {
  radians: 'x * PI / 180',
  degrees: 'x * 180 / PI',
  deg2rad: 'x * PI / 180',
  rad2deg: 'x * 180 / PI',
  clamp: 'min(max(x, lo), hi)',
  range: '[a : b]',
  int: 'floor(x)',
  mod: 'x % y',
  atan2d: 'atan2(y, x)',
};

/** Thread modules of libraries the app doesn't have (Thingiverse threads.scad and the like), which AI code reaches for. */
const THREAD_NAMES = /^(screw_thread|metric_thread|english_thread|thread|threads|thread_for_screw|thread_for_nut|trapezoidal_thread|ScrewThread|ScrewHole|AugerThread|RodStart|RodEnd)$/;

let bosl2: Map<string, string> | null = null, mcad: Map<string, string> | null = null;
/** The BOSL2 file that defines a name ("std.scad", "gears.scad" …), or null. */
function bosl2File(name: string): string | null {
  if (!bosl2) {
    bosl2 = new Map();
    for (const [file, names] of Object.entries(BOSL2_NAMES)) for (const n of names.split(' ')) bosl2.set(n, file);
  }
  return bosl2.get(name) ?? null;
}
/** The MCAD file that defines a name, or null. involute_gears first: its gear() is the one AI code means. */
function mcadFile(name: string): string | null {
  if (!mcad) {
    mcad = new Map();
    const files = Object.entries(MCAD_NAMES).sort(([a], [b]) => Number(b === 'involute_gears.scad') - Number(a === 'involute_gears.scad'));
    for (const [file, names] of files) for (const n of names.split(' ')) if (!mcad.has(n)) mcad.set(n, file);
  }
  return mcad.get(name) ?? null;
}
/** "comes from BOSL2/MCAD, include it" for a library name, or null. */
function libraryHint(name: string): string | null {
  const b = bosl2File(name);
  if (b) return t('dx.bosl2', { name, file: b });
  const m = mcadFile(name);
  return m ? t('dx.mcadName', { name, file: m }) : null;
}

/** Edit distance with swapped neighbours as one edit (widht → width), for "did you mean". */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
/** A name in the code close to `name` (a typo), or null. */
function closest(name: string, candidates: Iterable<string>) {
  let best: string | null = null, bd = Infinity;
  for (const c of candidates) {
    if (c === name) continue;
    const dd = distance(name.toLowerCase(), c.toLowerCase());
    if (dd < bd) [best, bd] = [c, dd];
  }
  return best && bd <= Math.max(1, Math.floor(name.length / 4)) ? best : null;
}

const names = (src: string, re: RegExp) => new Set([...src.matchAll(re)].map(m => m[1]));

/** Why a syntax error happened, from the text of the line (and the one before: OpenSCAD often stops at the next token). */
function syntaxHint(lines: string[], line: number | null): string {
  const near = line ? [lines[line - 1] ?? '', lines[line - 2] ?? ''].join('\n') : '';
  if (/(\+\+|--|[-+*/]=)(?!=)/.test(near.replace(/<=|>=|==|!=/g, ''))) return t('dx.compoundAssign');
  if (/\bfor\s+\w+\s+in\b|\brange\s*\(/.test(near)) return t('dx.pythonFor');
  if (/\breturn\b/.test(near)) return t('dx.returnStmt');
  if (/\b(let|const|var)\s+\w+\s*=/.test(near) && !/\blet\s*\(/.test(near)) return t('dx.jsDecl');
  if (/\b(Math|math)\.\w+/.test(near)) return t('dx.jsMath');
  if (/\b(elif|else\s*:|def)\b/.test(near)) return t('dx.python');
  return t('dx.syntax');
}

function hintFor(msg: string, line: number | null, src: string, lines: string[]): string | null {
  let m: RegExpExecArray | null;
  if ((m = /Ignoring unknown function '(\w+)'/.exec(msg))) {
    const n = m[1];
    if (MISSING_FUNCTIONS[n]) return t('dx.missingFunction', { name: n, instead: MISSING_FUNCTIONS[n] });
    const lib = libraryHint(n);
    if (lib) return lib;
    if (THREAD_NAMES.test(n)) return t('dx.threads', { name: n });
    const typo = closest(n, names(src, /\bfunction\s+([A-Za-z_]\w*)/g));
    return typo ? t('dx.didYouMean', { name: typo }) : t('dx.unknownFunction', { name: n });
  }
  if ((m = /Ignoring unknown module '(\w+)'/.exec(msg))) {
    const n = m[1];
    if (n === 'assign') return t('dx.assign');
    if (n === 'child') return t('dx.child');
    const lib = libraryHint(n);
    if (lib) return lib;
    if (THREAD_NAMES.test(n)) return t('dx.threads', { name: n });
    const typo = closest(n, names(src, /\bmodule\s+([A-Za-z_]\w*)/g));
    return typo ? t('dx.didYouMean', { name: typo }) : t('dx.unknownModule', { name: n });
  }
  if ((m = /Ignoring unknown variable "(\w+)"/.exec(msg))) {
    if (/^(Math|math)$/.test(m[1])) return t('dx.jsMath');
    const typo = closest(m[1], names(src, /\b([A-Za-z_]\w*)\s*=(?!=)/g));
    return typo ? t('dx.didYouMean', { name: typo }) : t('dx.unknownVariable', { name: m[1] });
  }
  if (/Non-ASCII identifiers/.test(msg)) return t('dx.nonAscii');
  if (/syntax error/.test(msg)) return syntaxHint(lines, line);
  if (/Mixing 2D and 3D/.test(msg)) return t('dx.mix2d3d');
  if ((m = /Can't (?:open library|find include file) '([^']+)'/.exec(msg)))
    return t('dx.noLibrary', { name: m[1], libs: LIBRARIES.map(l => l.name).join(', ') });
  if (/Can't open import file/.test(msg)) return t('dx.importFile');
  if ((m = /Can't get font (.+)/.exec(msg))) return t('dx.font', { font: m[1].trim(), fonts: FAMILIES.join(', ') });
  if ((m = /"(\w+)" was assigned on line (\d+) but was overwritten/.exec(msg))) return t('dx.overwritten', { name: m[1] });
  if (/^Assertion/.test(msg)) return t('dx.assertion');
  if (/top level object is empty/.test(msg)) return t('dx.empty');
  if (/top level object is not a 3D object/.test(msg)) return t('dx.not3d');
  if (FOLLOW_UP.test(msg)) return t('dx.undef');
  return null;
}

/** The fix for an OpenSCAD message where the change is clear (the same cases as the hints), or null. */
function fixFor(msg: string, src: string): Fix | null {
  const m = /Ignoring unknown (function|module) '(\w+)'/.exec(msg);
  if (!m) return null;
  const n = m[2];
  if (m[1] === 'function' && /^(radians|degrees|deg2rad|rad2deg)$/.test(n)) return convertFix(src, n);
  if (m[1] === 'function' && MISSING_FUNCTIONS[n]) return null;
  if (m[1] === 'module' && n === 'assign') return renameFix(src, 'assign', 'let');
  if (m[1] === 'module' && n === 'child') return renameFix(src, 'child', 'children');
  const b = bosl2File(n);
  if (b) return includeFix(src, 'BOSL2', b);
  const mc = mcadFile(n);
  return mc ? includeFix(src, 'MCAD', mc) : null;
}

/** The problems in an OpenSCAD log, merged and explained, in the order they first appear. */
export function diagnose(log: string[], src: string): Problem[] {
  const lines = src.split('\n');
  const out: Problem[] = [];
  const byKey = new Map<string, Problem>();
  let last: Problem | null = null;
  for (const raw of log) {
    const text = raw.trim();
    // An error inside a library (or without a place) is placed on the user's line that called it.
    if (text.startsWith('TRACE:')) {
      const loc = LOCATION.exec(text);
      if (last && last.line === null && loc && loc[1] === USER_FILE) last.line = Number(loc[2]);
      continue;
    }
    let severity: Problem['severity'], msg: string;
    const m = /^(ERROR|WARNING):\s*(.*)$/.exec(text);
    if (m) [severity, msg] = [m[1] === 'ERROR' ? 'error' : 'warn', m[2]];
    else if (/^Current top level object is (empty|not a 3D object)/.test(text)) [severity, msg] = ['error', text.replace(/\.$/, '')];
    else continue;
    let line: number | null = null;
    const loc = LOCATION.exec(msg) ?? /, import\(\) at line (\d+)$/.exec(msg);
    if (loc) {
      msg = msg.slice(0, loc.index).replace(/\.$/, '');
      if (loc.length === 2) line = Number(loc[1]);
      else if (loc[1] === USER_FILE) line = Number(loc[2]);
    }
    const key = `${severity}|${msg}|${line}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.count++;
      last = seen;
      continue;
    }
    const p: Problem = { severity, message: msg, line, count: 1, hint: null, followUp: FOLLOW_UP.test(msg) };
    byKey.set(key, p);
    out.push(p);
    last = p;
  }
  // "The result is empty / not 3D" only says something when nothing else does.
  const real = out.filter(p => !/^Current top level object is/.test(p.message));
  const list = real.length ? real : out;
  // Follow-ups only count as such when there is a cause to point at.
  const hasCause = list.some(p => !p.followUp);
  const found = list.map(p => {
    const fix = fixFor(p.message, src);
    return { ...p, followUp: p.followUp && hasCause, hint: hintFor(p.message, p.line, src, lines), ...(fix ? { fix } : {}) };
  });
  // With the app's own checks (what OpenSCAD renders without a word), in the order of the code.
  return [...found, ...lint(src)].sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
}

/** Problems in the rendered model itself: too big for the printer (when `bed` is given), places that
 * start in mid-air (floating.ts), one row per height, long flat ceilings (ceilings.ts) and overhangs
 * steeper than 45° (overhangs.ts). */
export function meshProblems(positions: Float32Array, bed?: Bed): Problem[] {
  const mm = (v: number) => String(Math.round(v * 10) / 10 || 0);
  const row = (where: string, hint: string): Problem =>
    ({ severity: 'warn', message: where, line: null, count: 1, followUp: false, check: true, mesh: true, hint });
  const mid = midAirStarts(positions).slice(0, 5).map(p => {
    const [x, y] = [0, 1].map(k => `${mm(p.min[k])}…${mm(p.max[k])}`);
    const args = { x, y, z: mm(p.min[2]), h: mm(p.above), n: p.count };
    return row(`x ${x}, y ${y}, z ${mm(p.min[2])}`, p.count > 1 ? t('mesh.floatingN', args) : t('mesh.floating', args));
  });
  const ceilings = flatCeilings(positions).slice(0, 3).map(c => {
    const [x, y] = [0, 1].map(k => `${mm(c.min[k])}…${mm(c.max[k])}`);
    const text = t('mesh.ceiling', { x, y, z: mm(c.z), span: String(Math.round(c.span)) });
    return row(`x ${x}, y ${y}, z ${mm(c.z)}`, c.openBelow ? `${text} ${t('mesh.ceilingOpen')}` : text);
  });
  const over = overhangs(positions).slice(0, 3).map(o => {
    const [x, y, z] = [0, 1, 2].map(k => `${mm(o.min[k])}…${mm(o.max[k])}`);
    return row(`x ${x}, y ${y}, z ${z}`, t('mesh.overhang', { x, y, z, angle: String(Math.round(o.angle)) }));
  });
  // Said in the status bar too, but the AI only hears of it from this list.
  const size = meshSize(positions), dims = (v: number[]) => v.map(mm).join(' × ');
  const big = bed && positions.length && !fitsBed(size, bed)
    ? [row(`${dims(size)} mm`, t('mesh.tooBig', { size: dims(size), bed: dims([bed.w, bed.d, bed.h]) }))]
    : [];
  return [...big, ...mid, ...ceilings, ...over];
}

/** The problems as text for an AI chat: OpenSCAD's messages with their lines of code. */
export function problemsForAi(problems: Problem[], src: string, version: string): string {
  const lines = src.split('\n');
  const main = problems.filter(p => !p.followUp);
  const follow = problems.filter(p => p.followUp).reduce((n, p) => n + p.count, 0);
  const out = [t('dx.ai.intro', { version, libs: LIBRARIES.map(l => l.name).join(', ') }), ''];
  for (const p of main) {
    const times = p.count > 1 ? ` (${t('dx.ai.times', { n: p.count })})` : '';
    // A check is not an OpenSCAD message: say what it found instead.
    const what = p.check ? `${t('dx.ai.check')}: ${p.hint}` : `${p.severity === 'error' ? 'ERROR' : 'WARNING'}: ${p.message}${times}`;
    out.push(`${p.line ? `${t('dx.ai.line', { n: p.line })}: ` : ''}${what}`);
    const code = p.line ? lines[p.line - 1]?.trim() : '';
    if (code) out.push(`    ${code}`);
    // The app's explanation steers the AI (without it, an unknown thread module gets "fixed" by dropping the thread).
    if (!p.check && p.hint) out.push(`    ${t('dx.ai.hint')}: ${p.hint}`);
  }
  if (follow) out.push('', t('dx.ai.followUps', { n: follow }));
  out.push('', t('dx.ai.ask'));
  return out.join('\n');
}
