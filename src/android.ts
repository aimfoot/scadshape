// The Android app (android/): MainActivity adds window.ScadshapeAndroid before the page loads. In
// the browser it does not exist – then android is null and everything works as usual.

type Bridge = {
  /** Saves the file in Downloads. "" = done, otherwise the error. */
  saveFile(name: string, mime: string, base64: string): string;
  /** Opens Android's share menu with the file. "" = done, otherwise the error. */
  shareFile(name: string, mime: string, base64: string): string;
  /** The system bars' background and whether the icons should be light (dark theme). */
  setBars(color: string, dark: boolean): void;
  /** A file that another app opened/shared to the app: JSON { name, data (base64) }, or "". */
  takeFile(): string;
};

export const android: Bridge | null = (globalThis as { ScadshapeAndroid?: Bridge }).ScadshapeAndroid ?? null;

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(data: string) {
  const s = atob(data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export async function saveViaApp(file: File) {
  const err = android!.saveFile(file.name, file.type, await toBase64(file));
  if (err) throw new Error(err);
}

export async function shareViaApp(file: File) {
  const err = android!.shareFile(file.name, file.type, await toBase64(file));
  if (err) throw new Error(err);
}
