// Små DOM-hjälpare och lagring.

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

/** Skapa ett element med egenskaper och barn. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { dataset, ...rest } = props;
  const e = Object.assign(document.createElement(tag), rest);
  if (dataset) Object.assign(e.dataset, dataset);
  e.append(...children);
  return e;
}

/** localStorage med prefix; tål att lagring saknas (privat läge). */
export const store = {
  get(k: string) {
    try {
      return localStorage.getItem(`scadshape.${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`scadshape.${k}`, v);
    } catch {
      /* privat läge o.d. */
    }
  },
};

export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2).replace('.', ',')} s`);
export const fmtInt = (n: number) => n.toLocaleString('sv-SE');
export const fmtInput = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');

/** Ät upp nästa klick (touch skickar ett klick efter pointerup – det skulle annars träffa en nyss öppnad dialog). */
export function swallowNextClick(ms = 500) {
  const eat = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', eat, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', eat, { capture: true }), ms);
}
