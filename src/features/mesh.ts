// Imported body: an STL file (stored in blobs.ts) that is added, subtracted or intersected. Not
// tied to any sketch. Order: (centered on the plate) → scale → rotate → move.

import { blobsLoaded, hasBlob, importPath } from '../blobs';
import { t } from '../i18n';
import { FieldReader, num, OP_LABEL, type FeatureBase, type FeatureKind, type Op } from './common';

export interface MeshFeature extends FeatureBase {
  type: 'mesh';
  sketch: ''; // no sketch
  /** The file's hash in blobs.ts. */
  file: string;
  fileName: string;
  triangles: number;
  /** The file's extent (mm) – for "centered on the plate". */
  min: [number, number, number];
  max: [number, number, number];
  /** Move the body so the bottom lies at Z = 0 with the middle at the origin, before the other transforms. */
  center: boolean;
  x: string;
  y: string;
  z: string;
  rx: string;
  ry: string;
  rz: string;
  /** Scale in percent. */
  scale: string;
  op: Op;
}

export const mesh: FeatureKind<MeshFeature> = {
  type: 'mesh',
  label: 'feat.mesh',
  icon: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9M8 5.2l8 4.6M16 5.2L8 9.8"/></svg>',
  pick: { kind: 'none' },
  fields: [
    { kind: 'check', key: 'center', label: 'mesh.center' },
    { kind: 'heading', label: 'mesh.move' },
    { kind: 'pair', fields: [{ kind: 'expr', key: 'x', label: 'mesh.x', unit: 'mm' }, { kind: 'expr', key: 'y', label: 'mesh.y', unit: 'mm' }] },
    { kind: 'expr', key: 'z', label: 'mesh.z', unit: 'mm' },
    { kind: 'heading', label: 'mesh.rotate' },
    { kind: 'pair', fields: [{ kind: 'expr', key: 'rx', label: 'mesh.rx', unit: '°' }, { kind: 'expr', key: 'ry', label: 'mesh.ry', unit: '°' }] },
    { kind: 'expr', key: 'rz', label: 'mesh.rz', unit: '°' },
    { kind: 'expr', key: 'scale', label: 'mesh.scale', unit: '%' },
    {
      kind: 'choice',
      key: 'op',
      options: [
        { value: 'add', label: 'op.add' },
        { value: 'remove', label: 'op.remove' },
        { value: 'intersect', label: 'op.intersect' },
      ],
    },
  ],

  create: (id, name) => ({
    type: 'mesh', id, name, sketch: '', file: '', fileName: '', triangles: 0, min: [0, 0, 0], max: [0, 0, 0],
    center: true, x: '0', y: '0', z: '0', rx: '0', ry: '0', rz: '0', scale: '100', op: 'add',
  }),

  detail: f =>
    `${f.fileName} · ${t('mesh.triangles', { n: f.triangles.toLocaleString('sv-SE') })}${f.op === 'add' ? '' : ` · ${t(OP_LABEL[f.op]).toLowerCase()}`}`,

  usable: () => true,

  build(f, _sk, ctx) {
    if (!f.file) return { error: t('err.noFile') };
    if (blobsLoaded() && !hasBlob(f.file)) return { error: t('err.fileMissing', { name: f.fileName }) };
    const r = new FieldReader(ctx);
    const x = r.read('X', f.x || '0'), y = r.read('Y', f.y || '0'), z = r.read('Z', f.z || '0');
    const rx = r.read(t('mesh.rx'), f.rx || '0'), ry = r.read(t('mesh.ry'), f.ry || '0'), rz = r.read(t('mesh.rz'), f.rz || '0');
    const scale = r.positive(t('mesh.scale'), f.scale || '100');
    if (r.error) return { error: r.error };
    const parts: string[] = [];
    if (x.v || y.v || z.v || x.code !== '0' || y.code !== '0' || z.code !== '0') parts.push(`translate([${x.code}, ${y.code}, ${z.code}])`);
    if (rx.v || ry.v || rz.v) parts.push(`rotate([${rx.code}, ${ry.code}, ${rz.code}])`);
    if (scale.v !== 100) parts.push(`scale(${scale.code} / 100)`);
    if (f.center) {
      const c = [-(f.min[0] + f.max[0]) / 2, -(f.min[1] + f.max[1]) / 2, -f.min[2]];
      if (c.some(v => Math.abs(v) > 1e-9)) parts.push(`translate([${c.map(num).join(', ')}])`);
    }
    const code = `module ${ctx.module}() {\n  ${parts.map(p => `${p} `).join('')}import("${importPath(f.file)}", convexity = 10); // ${f.fileName}\n}`;
    return { code, tools: [{ op: f.op, call: `${ctx.module}();` }] };
  },
};
