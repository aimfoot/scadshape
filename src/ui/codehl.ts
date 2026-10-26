// Colours in the code editor: the text area's own text is transparent (only the caret and the
// selection show), and a <pre> right behind it shows the same code coloured (scadhl.ts), scrolled
// along with it. It follows typing, and code put in by the app too (the textarea's value setter).

import { scadHtml } from '../scadhl';
import { $ } from './dom';

/** Above this the code is shown without colours (they would slow typing down). */
const MAX_CHARS = 400_000;

export function initCodeHighlight() {
  const ta = $<HTMLTextAreaElement>('#code');
  const pre = $('#codeHl');
  // At once, not in the next frame: the text area's own text is invisible, so a frame late would
  // show a typed letter late.
  const paint = () => {
    const src = ta.value;
    // A trailing newline in a <pre> shows no empty line: add a space so the heights match.
    pre.innerHTML = src.length > MAX_CHARS ? '' : `${scadHtml(src)} `;
    ta.classList.toggle('plain', src.length > MAX_CHARS);
    sync();
  };
  const sync = () => {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  };
  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', sync);
  // The app sets the code too (another model, a fix, a paste): colour that as well.
  const value = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
  Object.defineProperty(ta, 'value', {
    configurable: true,
    get() {
      return value.get!.call(this);
    },
    set(v: string) {
      value.set!.call(this, v);
      paint();
    },
  });
  paint();
}
