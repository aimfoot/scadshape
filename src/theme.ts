// Light/dark theme: the choice (auto = like the phone) is saved; the resolved theme is set as
// data-theme on <html> (the CSS variables in style.css) and announced to the canvas/3D view.

export type ThemeChoice = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'scadshape.theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners: ((t: Theme) => void)[] = [];

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* blocked storage */
  }
  return 'auto';
}

export const currentTheme = (): Theme => {
  const c = themeChoice();
  return c === 'auto' ? (media?.matches ? 'dark' : 'light') : c;
};

/** The browser's status bar color (the same as the toolbar). */
const BAR: Record<Theme, string> = { light: '#ffffff', dark: '#1b2229' };

export function applyTheme() {
  const th = currentTheme();
  document.documentElement.dataset.theme = th;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[th]);
  for (const fn of listeners) fn(th);
}

export function setThemeChoice(c: ThemeChoice) {
  try {
    if (c === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c);
  } catch {
    /* blocked storage: only applies to this session */
  }
  applyTheme();
}

export const onThemeChange = (fn: (t: Theme) => void) => listeners.push(fn);

media?.addEventListener('change', () => themeChoice() === 'auto' && applyTheme());
