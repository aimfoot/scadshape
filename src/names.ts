/** Feature name → valid OpenSCAD identifier ("Sketch 1" → sketch_1). */
export function codeName(name: string) {
  const s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z_]/.test(s) ? s : `f_${s}`;
}
