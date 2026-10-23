// Small DOM helpers and storage.

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

/** Create an element with properties and children. */
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

/** localStorage with a prefix; tolerates missing storage (private mode). */
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
      /* private mode etc. */
    }
  },
};

export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2).replace('.', ',')} s`);
export const fmtInt = (n: number) => n.toLocaleString('sv-SE');
export const fmtInput = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');

/** Swallow the next click (touch sends a click after pointerup – it would otherwise hit a freshly opened dialog). */
export function swallowNextClick(ms = 500) {
  const eat = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', eat, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', eat, { capture: true }), ms);
}
