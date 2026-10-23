// Code from an AI chat: "Copy prompt" (on the start card and in the code bar) gives the AI the app's
// rules, "Paste code" puts the code from the clipboard in Custom code. Pasting an answer with
// ``` fences into the code keeps only the code, and text shared from another app (Android) opens
// the same way.

import { aiPrompt, codeFromChat, looksLikeScad } from '../aiprompt';
import { BED_PRESETS, parseBedChoice } from '../bed';
import { t } from '../i18n';
import { PARTS } from '../licenses';
import { remoteLog } from '../remote';
import { copyText, readClipboard } from './clipboard';
import { $, store } from './dom';
import { currentBed, setSource, view } from './render';
import { showToast } from './toast';

const code = () => $<HTMLTextAreaElement>('#code');

async function copyPrompt() {
  const version = PARTS.flatMap(g => g.parts).find(p => p.name === 'OpenSCAD')?.version?.replace(/\s*\(.*\)$/, '');
  const printer = BED_PRESETS.find(p => p.id === parseBedChoice(store.get('bed')).preset)?.name ?? null;
  const ok = await copyText(aiPrompt({ version: version ? `OpenSCAD ${version}` : 'OpenSCAD', bed: currentBed(), printer }));
  showToast(ok ? t('ai.promptCopied') : t('dx.copyFailed'), ok ? 'info' : 'error');
  remoteLog('ai-prompt', { ok });
}

/** Custom code, with the code panel open. */
function openCustomCode() {
  setSource('custom');
  if ($('#codePanel').hidden) $('#btnCode').click();
}

/** Replace the code with `text` as if typed (the code's undo keeps working, and it renders). */
function putCode(text: string) {
  const ta = code();
  ta.focus({ preventScroll: true });
  ta.select();
  if (!document.execCommand('insertText', false, text)) {
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
  }
  ta.setSelectionRange(0, 0);
  ta.scrollTop = 0;
  ta.blur(); // no keyboard over the new model
}

/** Open code from an AI chat (an answer with or without ``` fences). Returns false if it is not code. */
export function receiveCode(text: string): boolean {
  const src = codeFromChat(text);
  if (!looksLikeScad(src)) return false;
  view.fitNext = true;
  openCustomCode();
  putCode(src);
  remoteLog('ai-code', { bytes: src.length, fenced: src !== `${text.trim()}\n` });
  return true;
}

async function pasteCode() {
  const text = await readClipboard();
  if (text && receiveCode(text)) {
    showToast(t('ai.pasted'));
    return;
  }
  // Nothing readable (or not code): paste by hand – the whole code is selected, so it is replaced.
  openCustomCode();
  code().focus();
  code().select();
  showToast(text === null ? t('ai.pasteHere') : t('ai.noCode'), text === null ? 'info' : 'error');
}

export function initAiFlow() {
  $('#startPrompt').addEventListener('click', () => void copyPrompt());
  $('#startPaste').addEventListener('click', () => void pasteCode());
  $('#btnPrompt').addEventListener('click', () => void copyPrompt());
  // A whole chat answer pasted into the code: keep only the code block.
  code().addEventListener('paste', e => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!/```/.test(text) || code().readOnly) return;
    const src = codeFromChat(text);
    if (!looksLikeScad(src)) return;
    e.preventDefault();
    document.execCommand('insertText', false, src);
    showToast(t('ai.fencesRemoved'));
  });
}
