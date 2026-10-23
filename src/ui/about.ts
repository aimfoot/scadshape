// "Om scadshape" (☰): version, licensen och allt som följer med (src/licenses.ts). Licenstexterna
// hämtas ur appens egna filer när man trycker på dem, så det fungerar offline.

import { t } from '../i18n';
import { PARTS, PRIVACY_URL, SCADSHAPE_LICENSE, SOURCE_URL, WEBSITE_URL, type Part } from '../licenses';
import { $, el } from './dom';

const dlg = () => $<HTMLDialogElement>('#aboutDlg');
const texts = new Map<string, Promise<string>>();

function fetchText(file: string) {
  if (!texts.has(file))
    texts.set(file, fetch(file).then(r => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`)))));
  return texts.get(file)!;
}

function showList() {
  $('#aboutText').hidden = true;
  $('#aboutMain').hidden = false;
}

async function showText(title: string, files: string[]) {
  $('#aboutTextTitle').textContent = title;
  const body = $('#aboutTextBody');
  body.textContent = t('about.loading');
  $('#aboutMain').hidden = true;
  $('#aboutText').hidden = false;
  body.scrollTop = 0;
  try {
    const all = await Promise.all(files.map(fetchText));
    body.textContent = all.join(`\n\n${'─'.repeat(40)}\n\n`);
  } catch (e) {
    body.textContent = `${t('about.loadFailed')} (${(e as Error).message})`;
  }
}

function partRow(p: Part) {
  const open = el('button', { type: 'button', className: 'link' }, p.license);
  open.addEventListener('click', () => void showText(p.name, p.files));
  const name = el('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.name);
  return el('li', {}, name, p.version ? el('span', { className: 'muted' }, ` ${p.version}`) : '', ' · ', open);
}

function render() {
  $('#aboutVersion').textContent = __APP_VERSION__ ? t('about.version', { v: __APP_VERSION__ }) : t('about.web');
  const src = $<HTMLAnchorElement>('#aboutSource');
  src.hidden = !SOURCE_URL;
  if (SOURCE_URL) src.href = SOURCE_URL;
  $<HTMLAnchorElement>('#aboutWebsite').href = WEBSITE_URL;
  $<HTMLAnchorElement>('#aboutPrivacy').href = PRIVACY_URL;
  $('#aboutParts').replaceChildren(
    ...PARTS.flatMap(g => [el('h3', {}, t(g.group)), el('ul', { className: 'parts' }, ...g.parts.map(partRow))]),
  );
}

export function initAbout() {
  $('#btnAbout').addEventListener('click', () => {
    render();
    showList();
    dlg().showModal();
  });
  $('#aboutLicense').addEventListener('click', () => void showText('scadshape', [SCADSHAPE_LICENSE]));
  $('#aboutBack').addEventListener('click', showList);
  // Esc/bakåt i en licenstext går tillbaka till listan i stället för att stänga.
  dlg().addEventListener('cancel', e => {
    if ($('#aboutText').hidden) return;
    e.preventDefault();
    showList();
  });
}
