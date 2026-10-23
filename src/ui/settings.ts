// ☰ → Settings: language, theme (both wired in main.ts), the printer's build volume and About.

import { BED_PRESETS, bedOf, parseBedChoice, type BedChoice } from '../bed';
import { parseExpr } from '../expr';
import { t } from '../i18n';
import { $, fmtInput, store } from './dom';
import { applyBed } from './render';

const dlg = () => $<HTMLDialogElement>('#settingsDlg');
const preset = () => $<HTMLSelectElement>('#bedPreset');
const SIZES = [['bedW', 'w'], ['bedD', 'd'], ['bedH', 'h']] as const;

function fillPresets() {
  const sel = preset();
  sel.replaceChildren(
    ...BED_PRESETS.map(p => new Option(`${p.name} · ${p.bed.w} × ${p.bed.d} × ${p.bed.h}`, p.id)),
    new Option(t('bed.custom'), 'custom'),
  );
}

/** Show the saved choice. */
function syncBed() {
  const c = parseBedChoice(store.get('bed'));
  const sel = preset();
  sel.value = c.preset;
  if (sel.selectedIndex < 0) sel.value = BED_PRESETS[0].id;
  const bed = bedOf(c);
  for (const [id, k] of SIZES) $<HTMLInputElement>(`#${id}`).value = fmtInput(bed[k]);
  $('#bedCustom').hidden = sel.value !== 'custom';
}

function saveBed() {
  const c: BedChoice = { preset: preset().value };
  if (c.preset === 'custom')
    for (const [id, k] of SIZES) {
      const v = parseExpr($<HTMLInputElement>(`#${id}`).value.replace(',', '.')).value;
      if (v !== null && v > 0) c[k] = v;
    }
  store.set('bed', JSON.stringify(c));
  $('#bedCustom').hidden = c.preset !== 'custom';
  applyBed();
}

export function initSettings() {
  fillPresets();
  $('#btnSettings').addEventListener('click', () => {
    syncBed();
    dlg().showModal();
  });
  preset().addEventListener('change', () => {
    // A preset's sizes are the starting point for a custom one.
    if (preset().value !== 'custom') {
      const bed = bedOf({ preset: preset().value });
      for (const [id, k] of SIZES) $<HTMLInputElement>(`#${id}`).value = fmtInput(bed[k]);
    }
    saveBed();
  });
  for (const [id] of SIZES) $(`#${id}`).addEventListener('change', saveBed);
}

/** Language change: the "Custom size" option. */
export function refreshSettingsTexts() {
  const v = preset().value;
  fillPresets();
  preset().value = v;
}
