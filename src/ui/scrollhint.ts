// The toolbars can be swiped when the buttons do not fit (portrait): fade the edge where there is
// more to see, so it is clear the row continues (classes more-start/more-end, style.css).

const EDGE = 2;

function update(el: HTMLElement) {
  const horizontal = el.scrollWidth > el.clientWidth + EDGE;
  const pos = horizontal ? el.scrollLeft : el.scrollTop;
  const room = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
  el.classList.toggle('scroll-x', horizontal);
  el.classList.toggle('more-start', room > EDGE && pos > EDGE);
  el.classList.toggle('more-end', room > EDGE && pos < room - EDGE);
}

export function initScrollHints() {
  for (const el of document.querySelectorAll<HTMLElement>('.toolbar')) {
    const run = () => update(el);
    el.addEventListener('scroll', run, { passive: true });
    new ResizeObserver(run).observe(el);
    // Buttons that are shown/hidden (sketch mode, tools) change the width without the size
    // changing.
    new MutationObserver(run).observe(el, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    run();
  }
}
