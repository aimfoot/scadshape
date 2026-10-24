// The code's problems under the code (diagnose.ts): one row per problem with its line and a plain
// explanation – tap to go to the line – and "Copy for AI", which puts them on the clipboard as text
// for the AI chat the code came from. Where the change is clear, a Fix button under the row shows the
// fixed line and makes the change (fixes.ts). The raw log is only shown on request.

import { diagnose, problemsForAi, type Problem } from '../diagnose';
import { applyFix } from '../fixes';
import { t } from '../i18n';
import { PARTS } from '../licenses';
import { remoteLog } from '../remote';
import { copyText } from './clipboard';
import { $, $$, el } from './dom';
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

/** Apply a fix to the code as if typed (undo keeps working, and it renders by itself). */
function applyFixToCode(p: Problem) {
  const code = $<HTMLTextAreaElement>('#code');
  // Typed since the render: the fix's places are no longer right.
  if (code.value !== shown.src || code.readOnly) {
    showToast(t('fix.stale'), 'error');
    return;
  }
  const edits = p.fix!.edits, after = applyFix(shown.src, p.fix!);
  const from = Math.min(...edits.map(e => e.from)), to = Math.max(...edits.map(e => e.to));
  const scroll = code.scrollTop;
  code.focus({ preventScroll: true });
  code.setSelectionRange(from, to);
  const text = after.slice(from, after.length - (shown.src.length - to));
  if (!document.execCommand('insertText', false, text)) {
    code.value = after;
    code.dispatchEvent(new Event('input'));
  }
  code.scrollTop = scroll;
  code.blur(); // no keyboard over the list
  for (const b of $$<HTMLButtonElement>('#problemList .fix')) b.disabled = true; // until the new render
  remoteLog('code-fix', { message: p.message.slice(0, 80) });
}

function row(p: Problem) {
  const b = el('button', { type: 'button', className: 'row' },
    el('span', { className: 'where', textContent: p.line ? t('dx.line', { n: p.line }) : p.mesh ? t('dx.model') : '–' }),
    el('span', { className: 'hint', textContent: p.hint ?? p.message }),
    el('span', { className: 'count', textContent: p.count > 1 ? t('dx.times', { n: p.count }) : '' }),
  );
  if (p.hint) b.append(el('span', { className: 'raw', textContent: p.message }));
  if (p.line) b.addEventListener('click', () => gotoLine(p.line!));
  const li = el('li', { className: p.severity }, b);
  if (p.fix && !$<HTMLTextAreaElement>('#code').readOnly) {
    const f = el('button', { type: 'button', className: 'fix' },
      el('strong', { textContent: t('fix.button') }),
      el('code', { textContent: p.fix.preview }),
      el('span', { className: 'count', textContent: p.fix.more ? t('fix.more', { n: p.fix.more }) : '' }),
    );
    f.addEventListener('click', () => applyFixToCode(p));
    li.append(f);
  }
  return li;
}

/** Show the problems in a render's log (plus `extra`: the model's own, meshProblems). Returns how many there are (follow-ups and notes not counted). */
export function showProblems(log: string[], src: string, extra: Problem[] = []): number {
  const problems = [...diagnose(log, src), ...extra];
  shown = { problems, src };
  const main = problems.filter(p => !p.followUp), follow = problems.filter(p => p.followUp);
  $('#problems').hidden = !problems.length;
  $('#codePanel').classList.toggle('has-problems', problems.length > 0);
  $('#problemsTitle').textContent = main.length === 1 ? t('dx.title1') : t('dx.title', { n: main.length });
  const items = main.map(row);
  if (follow.length) {
    const first = follow.find(p => p.line);
    const b = el('button', { type: 'button', className: 'row' }, el('span', { className: 'where' }), el('span', { className: 'hint', textContent: t('dx.followUps', { n: follow.reduce((s, p) => s + p.count, 0) }) }));
    if (first) b.addEventListener('click', () => gotoLine(first.line!));
    items.push(el('li', { className: 'follow' }, b));
  }
  $('#problemList').replaceChildren(...items);
  return main.filter(p => p.severity !== 'note').length;
}

export const clearProblems = () => showProblems([], '');
export const hasProblems = () => shown.problems.length > 0;

async function copyForAi() {
  const v = PARTS.flatMap(g => g.parts).find(p => p.name === 'OpenSCAD')?.version?.replace(/\s*\(.*\)$/, '');
  const ok = await copyText(problemsForAi(shown.problems, shown.src, v ? `OpenSCAD ${v}` : 'OpenSCAD'));
  showToast(ok ? t('dx.copied') : t('dx.copyFailed'), ok ? 'info' : 'error');
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
