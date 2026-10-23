// Languages (Swedish/English). Texts in code are fetched with t('key', {params}); texts in HTML are
// marked with data-i18n="key" (also -title, -aria, -placeholder). The dictionaries are in
// i18n-en.ts and i18n-sv.ts.

import { sv } from './i18n-sv';
import { en } from './i18n-en';

export type Lang = 'sv' | 'en';
export type Key = keyof typeof en;
export const LANGS: Record<Lang, string> = { sv: 'Svenska', en: 'English' };

const DICTS: Record<Lang, Record<Key, string>> = { sv, en };
const STORE_KEY = 'scadshape.lang';

function initialLang(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem(STORE_KEY);
    if (saved === 'sv' || saved === 'en') return saved;
  } catch {
    /* no storage */
  }
  const nav = globalThis.navigator?.language ?? 'en';
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
    /* private mode etc. */
  }
  if (globalThis.document) {
    document.documentElement.lang = l;
    applyI18n();
  }
  for (const cb of listeners) cb();
}

/** Called when the language changes (to redraw dynamic texts). */
export function onLangChange(cb: () => void) {
  listeners.add(cb);
}

/** A text in all languages (e.g. to recognise default names). */
export const allLangs = (key: Key) => Object.values(DICTS).map(d => d[key]);

/** Translate; {name} in the text is replaced by params.name. */
export function t(key: Key, params?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

/** Set texts on elements marked with data-i18n*. */
export function applyI18n(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria as Key));
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder as Key);
}
