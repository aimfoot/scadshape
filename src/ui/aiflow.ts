// Code from an AI chat: "Copy prompt" (on the start card and in Code's toolbar) gives the AI the app's
// rules, and "Paste code" (on the start card) makes the code from the clipboard the model, in Code.
// Pasting an answer with ``` fences into the code keeps only the code, and text shared from another
// app (Android) opens as a model the same way.

import { aiPrompt, codeDescription, codeFromChat, looksLikeScad } from '../aiprompt';
import { BED_PRESETS, parseBedChoice } from '../bed';
import { t } from '../i18n';
import { PARTS } from '../licenses';
import { remoteLog } from '../remote';
import { copyText, readClipboard } from './clipboard';
import { $, store } from './dom';
import { currentBed } from './render';
import { openCode, switchWork } from './workmode';
import { showToast } from './toast';

const code = () => $<HTMLTextAreaElement>('#code');

async function copyPrompt() {
  const version = PARTS.flatMap(g => g.parts).find(p => p.name === 'OpenSCAD')?.version?.replace(/\s*\(.*\)$/, '');
  const printer = BED_PRESETS.find(p => p.id === parseBedChoice(store.get('bed')).preset)?.name ?? null;
  const ok = await copyText(aiPrompt({ version: version ? `OpenSCAD ${version}` : 'OpenSCAD', bed: currentBed(), printer }));
  showToast(ok ? t('ai.promptCopied') : t('dx.copyFailed'), ok ? 'info' : 'error');
  remoteLog('ai-prompt', { ok });
}

/** Open code from an AI chat (an answer with or without ``` fences) as the model, named by its top
 * comment. Returns false if it is not code. */
export function receiveCode(text: string): boolean {
  const src = codeFromChat(text);
  if (!looksLikeScad(src)) return false;
  openCode(src, codeDescription(src)?.title || t('project.pasted'));
  code().blur(); // no keyboard over the new model
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
  switchWork('code');
  code().focus();
  code().select();
  showToast(text === null ? t('ai.pasteHere') : t('ai.noCode'), text === null ? 'info' : 'error');
}

export function initAiFlow() {
  // From the start card: copying the prompt goes on to Code, where the answer is pasted.
  $('#startPrompt').addEventListener('click', () => {
    switchWork('code');
    void copyPrompt();
  });
  $('#startPaste').addEventListener('click', () => void pasteCode());
  $('#btnPrompt').addEventListener('click', () => void copyPrompt());
  // A whole chat answer pasted into the code: keep only the code block.
  code().addEventListener('paste', e => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!/```/.test(text)) return;
    const src = codeFromChat(text);
    if (!looksLikeScad(src)) return;
    e.preventDefault();
    document.execCommand('insertText', false, src);
    showToast(t('ai.fencesRemoved'));
  });
}
