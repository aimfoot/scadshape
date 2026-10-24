// What the code says it is: the comment block at the top of example or custom code (the AI prompt
// asks for one: what it is, a line per part and how they go together), shown above the status bar.
// Its first line shows; a tap opens the rest. Closed with ×, it stays away until the comment changes.

import { codeDescription } from '../aiprompt';
import { $ } from './dom';

let shown = '', closed = '';

function setOpen(open: boolean) {
  $('#modelNoteBody').hidden = !open || !$('#modelNoteBody').textContent;
  $('#modelNoteToggle').setAttribute('aria-expanded', String(open));
}

/** Show the top comment of `src` (null: none, e.g. the user's own model). */
export function showModelNote(src: string | null) {
  const d = src ? codeDescription(src) : null;
  const key = d ? `${d.title}\n${d.body}` : '';
  const note = $('#modelNote');
  note.hidden = !d || key === closed;
  if (!d || key === shown) return;
  shown = key;
  $('#modelNoteTitle').textContent = d.title;
  $('#modelNoteBody').textContent = d.body;
  setOpen(false);
}

export function initModelNote() {
  $('#modelNoteToggle').addEventListener('click', () => setOpen($('#modelNoteToggle').getAttribute('aria-expanded') !== 'true'));
  $('#modelNoteClose').addEventListener('click', () => {
    closed = shown;
    $('#modelNote').hidden = true;
  });
}
