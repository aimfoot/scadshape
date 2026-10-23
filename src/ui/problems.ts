// The code's problems under the code (diagnose.ts): one row per problem with its line and a plain
// explanation – tap to go to the line – and "Copy for AI", which puts them on the clipboard as text
// for the AI chat the code came from. The raw log is only shown on request.

import { diagnose, problemsForAi, type Problem } from '../diagnose';
import { t } from '../i18n';
import { PARTS } from '../licenses';
import { $, el } from './dom';
import { showToast } from './toast';

let shown: { problems: Problem[]; src: string } = { problems: [], src: '' };

/** Select line n (1-based) in the code and scroll it into view. */
function gotoLine(n: number) {
  const code = $<HTMLTextAreaElement>('#code');
  const lines = code.value.split('\n');
  const start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
  code.focus({ preventScroll: true });
  code.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0));
  const lh = parseFloat(getComputedStyle(code).lineHeight) || 19.5;
  code.scrollTop = Math.max(0, (n - 1) * lh - code.clientHeight / 3);
}

function row(p: Problem) {
  const b = el('button', { type: 'button' },
    el('span', { className: 'where', textContent: p.line ? t('dx.line', { n: p.line }) : '–' }),
    el('span', { className: 'hint', textContent: p.hint ?? p.message }),
    el('span', { className: 'count', textContent: p.count > 1 ? t('dx.times', { n: p.count }) : '' }),
  );
  if (p.hint) b.append(el('span', { className: 'raw', textContent: p.message }));
  if (p.line) b.addEventListener('click', () => gotoLine(p.line!));
  return el('li', { className: p.severity }, b);
}

/** Show the problems in a render's log. Returns how many there are (follow-ups not counted). */
export function showProblems(log: string[], src: string): number {
  const problems = diagnose(log, src);
  shown = { problems, src };
  const main = problems.filter(p => !p.followUp), follow = problems.filter(p => p.followUp);
  $('#problems').hidden = !problems.length;
  $('#codePanel').classList.toggle('has-problems', problems.length > 0);
  $('#problemsTitle').textContent = main.length === 1 ? t('dx.title1') : t('dx.title', { n: main.length });
  const items = main.map(row);
  if (follow.length) {
    const first = follow.find(p => p.line);
    const b = el('button', { type: 'button' }, el('span', { className: 'where' }), el('span', { className: 'hint', textContent: t('dx.followUps', { n: follow.reduce((s, p) => s + p.count, 0) }) }));
    if (first) b.addEventListener('click', () => gotoLine(first.line!));
    items.push(el('li', { className: 'follow' }, b));
  }
  $('#problemList').replaceChildren(...items);
  return main.length;
}

export const clearProblems = () => showProblems([], '');
export const hasProblems = () => shown.problems.length > 0;

async function copyForAi() {
  const v = PARTS.flatMap(g => g.parts).find(p => p.name === 'OpenSCAD')?.version?.replace(/\s*\(.*\)$/, '');
  const text = problemsForAi(shown.problems, shown.src, v ? `OpenSCAD ${v}` : 'OpenSCAD');
  try {
    await navigator.clipboard.writeText(text);
    showToast(t('dx.copied'));
  } catch {
    // A WebView without clipboard access: the old way.
    const ta = el('textarea', { value: text });
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    showToast(ok ? t('dx.copied') : t('dx.copyFailed'), ok ? 'info' : 'error');
  }
}

export function initProblems() {
  $('#btnCopyProblems').addEventListener('click', () => void copyForAi());
  const full = $('#btnFullLog');
  full.addEventListener('click', () => {
    const on = $('#codePanel').classList.toggle('full-log');
    full.setAttribute('aria-pressed', String(on));
  });
  // The status bar says "· 2 problems": tapping it opens the code with the list.
  $('#status').addEventListener('click', () => {
    if (hasProblems() && $('#codePanel').hidden) $('#btnCode').click();
  });
}
