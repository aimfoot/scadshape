// Variabler: dialogen (namn = uttryck), variabelknappar under uttrycksfält och omräkning av skissmått.

import { parseExpr } from '../expr';
import { t } from '../i18n';
import { evalParams, validateParamName } from '../params';
import { syncSketchParams } from '../paramsync';
import { remoteLog } from '../remote';
import { fmtNum } from '../sketch/geom';
import { $, el } from './dom';
import { app, emit, vars } from './state';
import { showToast } from './toast';

// ---- Variabelknappar (telefonens sifferknappsats saknar bokstäver) -------------------------------

const chipRows = new Set<{ box: HTMLElement; target: () => HTMLInputElement | null }>();

function fillChips(box: HTMLElement, target: () => HTMLInputElement | null) {
  box.replaceChildren(
    ...app.doc.params.map(p => {
      const b = el('button', { type: 'button', textContent: p.name });
      b.addEventListener('pointerdown', e => e.preventDefault()); // behåll fokus i fältet
      b.addEventListener('click', () => {
        const input = target();
        if (!input) return;
        const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
        input.value = input.value.slice(0, s) + p.name + input.value.slice(e);
        input.setSelectionRange(s + p.name.length, s + p.name.length);
        input.focus();
        input.dispatchEvent(new Event('input'));
      });
      return b;
    }),
  );
}

/** En rad variabelknappar som skriver in i fältet som `target` ger. */
export function chipRow(target: () => HTMLInputElement | null): HTMLElement {
  const box = el('div', { className: 'chips' });
  // Gamla rader (från stängda paneler) städas bort när de inte längre sitter i dokumentet.
  for (const r of chipRows) if (!r.box.isConnected) chipRows.delete(r);
  chipRows.add({ box, target });
  fillChips(box, target);
  return box;
}

export function refreshChips() {
  for (const r of chipRows) fillChips(r.box, r.target);
}

// ---- Dialogen -------------------------------------------------------------------------------------

const dlg = () => $<HTMLDialogElement>('#paramsDlg');

/** Variablerna har ändrats: räkna om skissmått som använder dem och bygg om. */
function applyParams() {
  const v = vars();
  const errs: string[] = [];
  for (const f of app.doc.features)
    if (f.type === 'sketch') {
      const r = syncSketchParams(f, v, app.solver);
      if (r.error) errs.push(r.error);
    }
  if (errs.length) showToast(errs[0], 'error');
  remoteLog('params-change', { params: app.doc.params, errors: errs });
  renderParams();
  refreshChips();
  emit('docChanged');
}

function renderParams() {
  const { vars: v, errors } = evalParams(app.doc.params);
  $('#paramList').replaceChildren(
    ...app.doc.params.map(p => {
      const input = el('input', { value: p.expr, autocapitalize: 'off', spellcheck: false });
      input.setAttribute('aria-label', t('params.valueOf', { name: p.name }));
      input.addEventListener('change', () => {
        p.expr = input.value;
        applyParams();
      });
      const val = el('small');
      if (errors.has(p.name)) {
        val.textContent = '⚠';
        val.title = errors.get(p.name)!;
        val.className = 'err';
      } else val.textContent = `= ${fmtNum(v.get(p.name)!, 4)}`;
      const del = el('button', { className: 'icon danger', type: 'button', textContent: '✕' });
      del.setAttribute('aria-label', t('params.delete', { name: p.name }));
      del.addEventListener('click', () => {
        app.doc.params.splice(app.doc.params.indexOf(p), 1);
        applyParams();
      });
      return el('div', { className: 'param' }, el('b', { textContent: p.name }), input, val, del);
    }),
  );
}

export function openParams() {
  renderParams();
  $('#paramError').hidden = true;
  dlg().showModal();
}

export function initParams() {
  $('#paramAdd').addEventListener('submit', e => {
    e.preventDefault();
    const nameEl = $<HTMLInputElement>('#paramName'), exprEl = $<HTMLInputElement>('#paramExpr');
    const name = nameEl.value.trim(), expr = exprEl.value.trim();
    const exprErr = parseExpr(expr, vars()).error;
    const err = validateParamName(name, app.doc.params) ?? (exprErr ? `${t('params.value')}: ${exprErr}` : null);
    if (err) {
      $('#paramError').textContent = err;
      $('#paramError').hidden = false;
      return;
    }
    $('#paramError').hidden = true;
    app.doc.params.push({ name, expr });
    nameEl.value = exprEl.value = '';
    applyParams();
  });
}
