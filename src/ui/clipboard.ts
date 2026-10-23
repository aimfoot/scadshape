// The clipboard: through the Android app's bridge when there is one (a WebView often has no
// navigator.clipboard), otherwise the browser's.

import { android } from '../android';

/** Put text on the clipboard; false if that was not possible. */
export async function copyText(text: string, label = 'scadshape'): Promise<boolean> {
  if (android) {
    android.copyText(label, text);
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Without clipboard access: the old way.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** The text on the clipboard, or null if it can't be read (the user can still paste by hand). */
export async function readClipboard(): Promise<string | null> {
  if (android) return android.readClipboard();
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
