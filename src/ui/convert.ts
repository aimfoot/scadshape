// "Convert to sketches": the code in Custom code (or an example) becomes a new model with sketches
// and features (convert/scad2doc.ts). Afterwards the volume is compared with the original, so you
// can see if it is exact.

import { scadToDoc, type ConvertEngine } from '../convert/scad2doc';
import { buildModel } from '../model3d';
import { getLang, t } from '../i18n';
import { createProject } from '../projects';
import { remoteLog } from '../remote';
import { parseBinaryStl } from '../stl';
import { $, store } from './dom';
import { switchProject } from './projects';
import { currentCode, engine, EXAMPLES, setStatus } from './render';
import { app } from './state';
import { showToast } from './toast';

const text = async (src: string, format: 'csg' | 'svg') => {
  const r = await engine.render(src, format, undefined, 120_000);
  if (!r.ok || !r.data) throw new Error(r.log.filter(l => /ERROR/.test(l))[0] ?? t('convert.failed'));
  return new TextDecoder().decode(r.data);
};
const convertEngine: ConvertEngine = { csg: src => text(src, 'csg'), svg: src => text(src, 'svg') };

/** Volume (mm³) of a rendering, or null. */
async function volume(src: string): Promise<number | null> {
  const r = await engine.render(src, 'binstl', undefined, 120_000);
  if (!r.ok || !r.data) return null;
  const p = parseBinaryStl(r.data).positions;
  let v = 0;
  for (let i = 0; i < p.length; i += 9)
    v += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  return Math.abs(v);
}

let busy = false;
export async function convertCode() {
  if (busy || app.source === 'model') return;
  const src = currentCode();
  busy = true;
  const btn = $<HTMLButtonElement>('#btnConvert');
  btn.disabled = true;
  setStatus(t('convert.running'), 'busy');
  try {
    const r = await scadToDoc(src, convertEngine, () => setStatus(t('convert.linking'), 'busy'));
    const example = EXAMPLES.find(x => x.id === app.source);
    const name = example ? t(example.name) : store.get('codeName') || t('convert.defaultName');
    switchProject(createProject(name, r.doc));
    const parts = [
      t('convert.sketches', { n: r.sketches }),
      r.extrudes ? t('convert.extrudes', { n: r.extrudes }) : '',
      r.revolves ? t('convert.revolves', { n: r.revolves }) : '',
      r.codeBlocks ? t('convert.codeBlocks', { n: r.codeBlocks }) : '',
      r.params ? t('convert.params', { n: r.params, m: r.linked }) : '',
    ].filter(Boolean);
    showToast(`${t('convert.done')}: ${parts.join(', ')}`);
    remoteLog('convert', { sketches: r.sketches, extrudes: r.extrudes, revolves: r.revolves, code: r.codeBlocks, params: r.params, linked: r.linked, bytes: src.length });
    // Check: the same volume as the original (circles without $fn are drawn finely in both)?
    const [a, b] = await Promise.all([volume(`${src}\n$fa = 1; $fs = 0.2;\n`), volume(buildModel(r.doc).code)]);
    if (a && b) {
      const d = Math.abs(a - b) / a;
      const pct = (x: number, dec: number) => (x * 100).toLocaleString(getLang() === 'sv' ? 'sv-SE' : 'en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      showToast(d < 0.005 ? t('convert.verified', { d: pct(d, 2) }) : t('convert.differs', { d: pct(d, 1) }), d < 0.005 ? 'info' : 'error');
      remoteLog('convert-check', { diff: d });
    }
  } catch (e) {
    showToast(`${t('convert.failed')}: ${(e as Error).message}`, 'error');
    setStatus(t('convert.failed'), 'error');
  } finally {
    busy = false;
    btn.disabled = false;
  }
}

export function initConvert() {
  $('#codeBar').hidden = app.source === 'model';
  $('#btnClearCode').hidden = app.source === 'model';
  $('#btnConvert').addEventListener('click', () => void convertCode());
}
