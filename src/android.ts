// Android-appen (android/): MainActivity lägger in window.ScadshapeAndroid innan sidan laddas.
// I webbläsaren finns den inte – då är android null och allt går som vanligt.

type Bridge = {
  /** Sparar filen i Hämtade filer. "" = klart, annars felet. */
  saveFile(name: string, mime: string, base64: string): string;
  /** Öppnar Androids dela-meny med filen. "" = klart, annars felet. */
  shareFile(name: string, mime: string, base64: string): string;
  /** Systemradernas bakgrund och om ikonerna ska vara ljusa (mörkt tema). */
  setBars(color: string, dark: boolean): void;
  /** Fil som en annan app öppnade/delade till appen: JSON { name, data (base64) }, eller "". */
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
