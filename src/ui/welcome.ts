// Startkortet: syns i 3D-ytan när modellen är tom (eller via ☰ → Kom igång) – fyra steg och
// exempelmodeller (src/examples/models.ts). Det blockerar inte verktygen och försvinner när
// modellen får innehåll, en panel öppnas eller man går in i en skiss.

import { EXAMPLES, buildExample, type ExampleId } from '../examples/models';
import { onLangChange, t, type Key } from '../i18n';
import { createProject } from '../projects';
import { $, el } from './dom';
import { switchProject } from './projects';
import { view } from './render';
import { app, on } from './state';
import { showToast } from './toast';

let dismissed = false; // stängt med × (gäller sessionen)
let forced = false; // öppnat från ☰, även när modellen inte är tom

function update() {
  const empty = app.source === 'model' && app.doc.features.length === 0;
  const free = document.body.dataset.mode === 'part' && $('#featPanel').hidden;
  $('#startCard').hidden = !(free && (forced || (!dismissed && empty)));
}

function openExample(id: ExampleId, nameKey: Key) {
  const name = t(nameKey);
  forced = false;
  view.fitNext = true;
  switchProject(createProject(name, buildExample(id)));
  showToast(t('start.opened', { name }));
  update();
}

function renderExamples() {
  $('#startExamples').replaceChildren(
    ...EXAMPLES.map(ex => {
      const b = el('button', { type: 'button', className: 'example' }, el('b', {}, t(ex.name)), el('small', {}, t(ex.desc)));
      b.addEventListener('click', () => openExample(ex.id, ex.name));
      return b;
    }),
  );
}

/** ☰ → Kom igång. */
export function showStart() {
  forced = true;
  if (!$('#tree').hidden) $('#btnTree').click(); // lådan ligger annars över kortet
  update();
}

export function initStart() {
  renderExamples();
  onLangChange(renderExamples);
  $('#startClose').addEventListener('click', () => {
    dismissed = true;
    forced = false;
    update();
  });
  $('#btnStart').addEventListener('click', showStart);
  on('docChanged', update);
  on('render', update);
  $('#source').addEventListener('change', update);
  const watch = new MutationObserver(update);
  watch.observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
  watch.observe($('#featPanel'), { attributes: true, attributeFilter: ['hidden'] });
  update();
}
