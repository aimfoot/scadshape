// Språk (svenska/engelska). Texter i koden hämtas med t('nyckel', {parametrar});
// texter i HTML märks med data-i18n="nyckel" (även -title, -aria, -placeholder).
// Ordböckerna ligger i i18n-sv.ts och i18n-en.ts.

import { sv } from './i18n-sv';
import { en } from './i18n-en';

export type Lang = 'sv' | 'en';
export type Key = keyof typeof sv;
export const LANGS: Record<Lang, string> = { sv: 'Svenska', en: 'English' };

const DICTS: Record<Lang, Record<Key, string>> = { sv, en };
const STORE_KEY = 'scadshape.lang';

function initialLang(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem(STORE_KEY);
    if (saved === 'sv' || saved === 'en') return saved;
  } catch {
    /* ingen lagring */
  }
  const nav = globalThis.navigator?.language ?? 'sv';
  return nav.toLowerCase().startsWith('sv') ? 'sv' : 'en';
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();

export const getLang = () => lang;

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try {
    globalThis.localStorage?.setItem(STORE_KEY, l);
  } catch {
    /* privat läge o.d. */
  }
  if (globalThis.document) {
    document.documentElement.lang = l;
    applyI18n();
  }
  for (const cb of listeners) cb();
}

/** Anropas när språket byts (för att rita om dynamiska texter). */
export function onLangChange(cb: () => void) {
  listeners.add(cb);
}

/** En text på alla språk (t.ex. för att känna igen standardnamn). */
export const allLangs = (key: Key) => Object.values(DICTS).map(d => d[key]);

/** Översätt; {namn} i texten ersätts med params.namn. */
export function t(key: Key, params?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? DICTS.sv[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

/** Sätt texter på element märkta med data-i18n*. */
export function applyI18n(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria as Key));
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder as Key);
}
