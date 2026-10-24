// The feature tree (☰): list, errors, suppressed, rollback marker and the action menu (⋯).

import { activeCount, dependents, removeFeature, type Feature, type SketchFeature } from '../doc';
import { kindOf } from '../features';
import { repeatDetail } from '../features/pattern';
import { t } from '../i18n';
import { PLANE_NAMES } from '../sketch/model';
import { planeFrame } from '../frame';
import { $, $$, el } from './dom';
import { app, emit } from './state';

const SKETCH_ICON =
  '<svg viewBox="0 0 24 24"><path d="M4 18 L10 6 L20 14"/><circle class="dot" cx="4" cy="18" r="1.6"/><circle class="dot" cx="10" cy="6" r="1.6"/><circle class="dot" cx="20" cy="14" r="1.6"/></svg>';

/** What happens when a feature is tapped (set by main: sketch mode or the panel). */
export const treeActions = { edit: (_f: Feature) => {} };

/** The sketch's plane: "Top +t", "Front −20", "Top, moved" (e.g. a lid beside its box) or "Slanted face". */
export function planeLabel(f: SketchFeature): string {
  if (f.face) {
    const pf = planeFrame(f.plane);
    const same = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
    return same(f.face.u, pf.u) && same(f.face.v, pf.v) ? t('plane.moved', { plane: t(PLANE_NAMES[f.plane]) }) : t('plane.slantedFace');
  }
  return t(PLANE_NAMES[f.plane]) + (f.offset && f.offset !== '0' ? (f.offset.startsWith('-') ? ` −${f.offset.slice(1)}` : ` +${f.offset}`) : '');
}

function detail(f: Feature): string {
  if (f.type === 'sketch') return planeLabel(f);
  return kindOf(f).detail(f) + repeatDetail(f);
}

export function renderTree() {
  const doc = app.doc;
  const active = activeCount(doc);
  const errors = app.previewDoc ? new Map<string, string>() : app.model.errors;
  const items: HTMLElement[] = [];
  const rollbar = () => {
    const b = el('button', { type: 'button', textContent: t('tree.toEnd') });
    b.addEventListener('click', () => {
      doc.rollback = null;
      emit('docChanged');
    });
    return el('li', { className: 'rollbar' }, t('tree.rolledBack'), b);
  };
  doc.features.forEach((f, i) => {
    if (doc.rollback !== null && i === doc.rollback) items.push(rollbar());
    const open = el('button', { className: 'feature', type: 'button', title: errors.get(f.id) ?? '' });
    if (errors.has(f.id)) open.classList.add('err');
    if (f.suppressed) open.classList.add('suppressed');
    open.innerHTML = f.type === 'sketch' ? SKETCH_ICON : kindOf(f).icon;
    open.append(el('span', { textContent: f.name }), el('small', { textContent: detail(f) }));
    open.addEventListener('click', () => treeActions.edit(f));
    const more = el('button', { className: 'icon', type: 'button', textContent: '⋯' });
    more.setAttribute('aria-label', t('tree.more', { name: f.name }));
    more.addEventListener('click', () => openMenu(f));
    items.push(el('li', { className: i >= active ? 'rolled' : '' }, open, more));
  });
  if (doc.rollback !== null && doc.rollback >= doc.features.length) items.push(rollbar());
  $('#featureList').replaceChildren(...items);
  $('#treeEmpty').hidden = doc.features.length > 0;
}

// ---- The action menu -------------------------------------------------------------------------

const menu = () => $<HTMLDialogElement>('#featMenu');
let menuFeature: Feature | null = null;

function openMenu(f: Feature) {
  menuFeature = f;
  $('#fmTitle').textContent = f.name;
  const err = app.model.errors.get(f.id);
  $('#fmError').textContent = err ? `⚠ ${err}` : '';
  $('#fmError').hidden = !err;
  $('[data-fm="suppress"]').textContent = t(f.suppressed ? 'tree.unsuppress' : 'tree.suppress');
  menu().showModal();
}

export function initTree() {
  for (const b of $$<HTMLButtonElement>('[data-fm]'))
    b.addEventListener('click', () => {
      const f = menuFeature;
      menu().close();
      if (!f) return;
      const doc = app.doc;
      const i = doc.features.indexOf(f);
      switch (b.dataset.fm) {
        case 'edit':
          return treeActions.edit(f);
        case 'suppress':
          f.suppressed = !f.suppressed || undefined;
          break;
        case 'rollback':
          doc.rollback = i + 1 >= doc.features.length ? null : i + 1;
          break;
        case 'delete': {
          const deps = f.type === 'sketch' ? dependents(doc, f.id) : [];
          const msg = deps.length ? t('tree.deleteWithDeps', { name: f.name, deps: deps.map(d => d.name).join(', ') }) : t('tree.deleteOne', { name: f.name });
          if (!confirm(msg)) return;
          removeFeature(doc, f);
          break;
        }
      }
      emit('docChanged');
    });
}
