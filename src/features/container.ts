// Container: a closed profile becomes a box/jar with wall and floor, and optionally a lid placed
// beside it (for printing). Push-fit lids fit any profile; screw lids need a circle.

import { t, type Key } from '../i18n';
import { selectedRegionsScad } from '../sketch/codegen';
import { ORIGIN, newId, type SketchData } from '../sketch/model';
import { findLoops, selectRegions } from '../sketch/regions';
import { FieldReader, fnFor, num, type FeatureBase, type FeatureKind, type SketchFeature, type Vec } from './common';
import { threadDepth, threadScad } from './threads';

export type LidKind = 'none' | 'lip' | 'snap' | 'screw';

export interface ContainerFeature extends FeatureBase {
  type: 'container';
  sketch: string;
  regions: Vec[] | null;
  height: string; // total height (mm)
  wall: string;
  floor: string; // floor thickness (also the lid's thickness)
  radius: string; // rounding of the vertical outer corners (0 = sharp)
  lid: LidKind;
  lipHeight: string; // push-fit/snap lid: the lip's height
  /** Snap lid: how far the bead sticks out on the lid's lip (the groove in the wall follows). */
  snapDepth?: string;
  threadLength: string; // screw lid: the thread's length
  pitch: string; // screw lid: pitch
  clearance: string; // clearance per side between lid and container
  /** Number of compartments in the sketch's X and Y directions (dividers as thick as the wall); 1 = no dividers. */
  cellsX?: string;
  cellsY?: string;
}

/** Minimum wall thickness inside the thread. */
const MIN_NECK_WALL = 1.2;
const DEFAULT_CLEARANCE: Record<LidKind, string> = { none: '0,2', lip: '0,2', snap: '0,2', screw: '0,3' };
/** Snap lid: the groove's extra depth and height beyond the bead, and the minimum wall behind the groove. */
const GROOVE_EXTRA = 0.15;
const MIN_GROOVE_WALL = 0.8;
/** Layers for bead and groove = the print's layer height (45° flanks are built as steps, like the print). */
const SNAP_STEP = 0.2;

/** Fill an empty sketch with a centered 80 × 60 rectangle with dimensions (when there is no sketch). */
export function containerTemplate(sk: SketchData) {
  sk.points[ORIGIN] ??= { x: 0, y: 0 };
  const p = [[-40, -30], [40, -30], [40, 30], [-40, 30]].map(([x, y]) => {
    const id = newId(sk, 'p');
    sk.points[id] = { x, y };
    return id;
  });
  const lines = p.map((a, i) => {
    const id = newId(sk, 'e');
    sk.entities[id] = { type: 'line', p1: a, p2: p[(i + 1) % 4] };
    return id;
  });
  const diag = newId(sk, 'e');
  sk.entities[diag] = { type: 'line', p1: p[0], p2: p[2], construction: true };
  const c = (o: object) => sk.constraints.push({ id: newId(sk, 'c'), ...o } as SketchData['constraints'][number]);
  lines.forEach((e, i) => c({ type: i % 2 ? 'vertical' : 'horizontal', e }));
  c({ type: 'midpoint', p: ORIGIN, e: diag });
  c({ type: 'distance', p1: p[0], p2: p[1], dir: 'h', value: 80 });
  c({ type: 'distance', p1: p[1], p2: p[2], dir: 'v', value: 60 });
}

export const container: FeatureKind<ContainerFeature> = {
  type: 'container',
  label: 'feat.container',
  icon: '<svg viewBox="0 0 24 24"><path d="M5 9v9l7 3 7-3V9"/><path d="M5 9l7 3 7-3-7-3z"/><path d="M8 9.2l4 1.6 4-1.6"/><path d="M4 5.5l8-3 8 3" stroke-dasharray="2 1.5"/></svg>',
  pick: { kind: 'regions' },
  fields: [
    { kind: 'expr', key: 'height', label: 'field.height', unit: 'mm' },
    { kind: 'pair', fields: [
      { kind: 'expr', key: 'wall', label: 'field.wall' },
      { kind: 'expr', key: 'floor', label: 'field.floor' },
    ] },
    { kind: 'expr', key: 'radius', label: 'field.cornerRadius', unit: 'mm', show: f => f.lid !== 'screw' },
    { kind: 'heading', label: 'container.cells', show: f => f.lid !== 'screw' },
    { kind: 'pair', show: f => f.lid !== 'screw', fields: [
      { kind: 'expr', key: 'cellsX', label: 'container.cellsX' },
      { kind: 'expr', key: 'cellsY', label: 'container.cellsY' },
    ] },
    { kind: 'heading', label: 'container.lid' },
    {
      kind: 'choice',
      key: 'lid',
      options: [
        { value: 'none', label: 'container.lidNone' },
        { value: 'lip', label: 'container.lidLip' },
        { value: 'snap', label: 'container.lidSnap' },
        { value: 'screw', label: 'container.lidScrew' },
      ],
    },
    { kind: 'expr', key: 'lipHeight', label: 'field.lipHeight', unit: 'mm', show: f => f.lid === 'lip' || f.lid === 'snap' },
    { kind: 'expr', key: 'snapDepth', label: 'container.snapDepth', unit: 'mm', show: f => f.lid === 'snap' },
    { kind: 'pair', show: f => f.lid === 'screw', fields: [
      { kind: 'expr', key: 'threadLength', label: 'field.threadLen' },
      { kind: 'expr', key: 'pitch', label: 'field.pitch' },
    ] },
    { kind: 'expr', key: 'clearance', label: 'field.clearanceSide', unit: 'mm', show: f => f.lid !== 'none' },
  ],

  create: (id, name, sk) => ({
    type: 'container', id, name, sketch: sk.id, regions: null, height: '40', wall: '2', floor: '2', radius: '4',
    lid: 'lip', lipHeight: '6', snapDepth: '0,6', threadLength: '8', pitch: '2', clearance: '0,2', cellsX: '1', cellsY: '1',
  }),

  detail: f => `${f.height} mm · ${t('field.wall').toLowerCase()} ${f.wall}${f.lid === 'none' ? '' : ` · ${t(f.lid === 'lip' ? 'container.lidLipShort' : f.lid === 'snap' ? 'container.lidSnapShort' : 'container.lidScrewShort')}`}`,

  usable: sk => findLoops(sk).loops.length > 0,

  changed(f, key) {
    // Lid change: switch to that lid's default clearance unless a custom one was typed.
    if (key === 'lid' && Object.values(DEFAULT_CLEARANCE).includes(f.clearance)) f.clearance = DEFAULT_CLEARANCE[f.lid];
  },

  build(f, sk, ctx) {
    const { loops, regions } = ctx.regions(sk);
    const sel = selectRegions(regions, loops, f.regions);
    if (!sel.length) return { error: loops.length ? t('err.noRegions') : t('err.sketchNoRegions') };
    const r = new FieldReader(ctx);
    const H = r.positive(t('field.height'), f.height);
    const w = r.positive(t('field.wall'), f.wall);
    const fl = r.positive(t('field.floor'), f.floor);
    const c = f.lid === 'none' ? { v: 0, code: '0' } : r.read(t('field.clearanceSide'), f.clearance, v => v >= 0, t('err.notNegative'));
    if (r.error) return { error: r.error };
    if (fl.v >= H.v) return { error: t('err.floorTooThick') };
    const m = ctx.module;
    if (f.lid === 'screw') return screwContainer(f, sk, ctx, sel.length === 1 && !regions[sel[0]].holes.length ? loops[regions[sel[0]].loop].circle : undefined, { H: H.v, w: w.v, fl: fl.v, c: c.v });

    const rad = r.read(t('field.cornerRadius'), f.radius || '0', v => v >= 0, t('err.notNegative'));
    const lipH = f.lid === 'lip' || f.lid === 'snap' ? r.positive(t('field.lipHeight'), f.lipHeight) : null;
    const sd = f.lid === 'snap' ? r.positive(t('container.snapDepth'), f.snapDepth || '0,6') : null;
    const cells = (src: string | undefined, label: Key) => r.read(t(label), src || '1', v => Number.isInteger(v) && v >= 1 && v <= 50, t('err.cells')).v;
    const nx = cells(f.cellsX, 'container.cellsX'), ny = cells(f.cellsY, 'container.cellsY');
    if (r.error) return { error: r.error };
    const shape = selectedRegionsScad(loops, regions, sel, '    ')!;
    const profile = rad.v > 0 ? `  offset(r = ${rad.code}, $fn = ${fnFor(2 * rad.v)}) offset(delta = -${rad.code}) {\n${shape}\n  }` : `  union() {\n${shape}\n  }`;
    const xs = sel.flatMap(i => loops[regions[i].loop].pts.map(p => p.x));
    const ys = sel.flatMap(i => loops[regions[i].loop].pts.map(p => p.y));
    // Snap lid: a bead near the tip of the lid's lip and a groove at the same height in the wall.
    const snapGeo = sd && lipH ? snapGeometry({ H: H.v, w: w.v, c: c.v, d: sd.v, fl: fl.v, lipH: lipH.v, rad: rad.v, m }) : null;
    if (snapGeo && 'error' in snapGeo) return snapGeo;
    const shell =
      `difference() {\n    linear_extrude(height = ${H.code}) ${m}_profile();\n` +
      `    translate([0, 0, ${fl.code}]) linear_extrude(height = ${H.code}) offset(r = -${w.code}, $fn = ${fnFor(2 * rad.v)}) ${m}_profile();\n` +
      (snapGeo ? `    ${snapGeo.groove}\n` : '') +
      `  }`;
    const walls = dividers(nx, ny, { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }, w.v);
    // The dividers end below the lid's lip so the lid fits.
    const divTop = H.v - (lipH ? lipH.v + 0.5 : 0);
    const body = walls.length
      ? `union() {\n  ${shell}\n  intersection() {\n    translate([0, 0, ${fl.code} - 0.01]) linear_extrude(height = ${num(divTop)} - ${fl.code} + 0.01) offset(delta = -${w.code} + 0.01) ${m}_profile();\n` +
        `    union() {\n${walls.map(c => `      ${c}`).join('\n')}\n    }\n  }\n  }`
      : shell;
    const lines = [`module ${m}_profile() {\n${profile}\n}`, `module ${m}() {\n  ${ctx.place(sk)}${body}\n}`];
    const tools = [{ op: 'add' as const, call: `${m}();` }];
    if (lipH) {
      // The lid lies beside it, lip up: a plate + a ring that fits inside the wall.
      const dx = num(Math.max(...xs) - Math.min(...xs) + 10);
      lines.push(
        `module ${m}_lid() {\n  ${ctx.place(sk)}translate([${dx}, 0, 0]) {\n    linear_extrude(height = ${fl.code}) ${m}_profile();\n` +
          `    translate([0, 0, ${fl.code} - 0.01]) linear_extrude(height = ${lipH.code} + 0.01) difference() {\n` +
          `      offset(r = -(${w.code} + ${c.code}), $fn = ${fnFor(2 * rad.v)}) ${m}_profile();\n      offset(r = -(2 * ${w.code} + ${c.code}), $fn = ${fnFor(2 * rad.v)}) ${m}_profile();\n    }\n` +
          (snapGeo ? `    ${snapGeo.bead}\n` : '') +
          `  }\n}`,
      );
      tools.push({ op: 'add', call: `${m}_lid();` });
    }
    return { code: lines.join('\n'), tools };
  },
};

/**
 * Bead on the lid's lip and groove in the wall (snap lid), as layers with 45° flanks. The lip goes
 * lipH into the box from the top edge; the bead sits near the tip. The lid's lip is offset −(w + c)
 * from the profile; the bead sticks out d, i.e. d − c into the wall (= the snap). The layers are
 * the print layers (0.2 mm, counted from the plate for both lid and box): layers that share a print
 * layer give steps the slicer cannot print.
 */
function snapGeometry(o: { H: number; w: number; c: number; d: number; fl: number; lipH: number; rad: number; m: string }): { bead: string; groove: string } | { error: string } {
  const { H, w, c, d, fl, lipH, rad, m } = o;
  if (d - c < 0.1) return { error: t('err.snapTooSmall') };
  const G = d + GROOVE_EXTRA; // the groove's tip, measured from the surface of the lid's lip
  if (w - (G - c) < MIN_GROOVE_WALL) return { error: t('err.snapWallThin') };
  const L = SNAP_STEP;
  const floorL = (v: number) => Math.floor(v / L + 1e-6) * L, ceilL = (v: number) => Math.ceil(v / L - 1e-6) * L;
  const bh = Math.ceil((2 * d + 0.4) / L - 1e-9) * L; // the bead's height, whole layers
  // The bead's lower edge in the lid's print (lip up), near the lip's tip, on a layer.
  const zb = Math.round((fl + lipH - bh - 0.6) / L) * L;
  const s = zb - fl + bh / 2; // the bead's middle, from the root of the lip
  if (s - bh / 2 < 0.4) return { error: t('err.snapLipLow') };
  // In the box the bead lies between H − s ∓ bh/2; the groove is rounded outwards to the layers,
  // with a margin.
  const g0 = floorL(H - s - bh / 2 - GROOVE_EXTRA), g1 = ceilL(H - s + bh / 2 + GROOVE_EXTRA);
  const fn = fnFor(2 * rad);
  const band = (z0: number, h: number, peak: number, slice: (off: string) => string) => {
    const n = Math.max(1, Math.round(h / L));
    return (
      `for (i = [0 : ${n - 1}]) let(z = ${num(z0)} + i * ${num(L)}, e = max(0, min(z + ${num(L / 2)} - ${num(z0)}, ${num(peak)}, ${num(z0 + h)} - z - ${num(L / 2)}))) ` +
      `translate([0, 0, z]) linear_extrude(height = ${num(L + 0.001)}) ${slice('e')}`
    );
  };
  // The bead: the lip wall bulges out with the same thickness (a thicker wall leaves a gap between
  // the loops that the slicer does not fill, and springs worse). Coordinates from the lid's plate.
  const bead = band(zb, bh, d, e =>
    `difference() { offset(r = -(${num(w + c)}) + ${e}, $fn = ${fn}) ${m}_profile(); offset(r = -(${num(2 * w + c)}) + ${e}, $fn = ${fn}) ${m}_profile(); }`);
  // The groove (in the box's coordinates): the whole area inside the groove's tip is cut away in
  // every layer (it is hollow in there anyway; the dividers end below the lip).
  const groove = band(g0, g1 - g0, G, e => `offset(r = -(${num(w + c)}) + ${e}, $fn = ${fn}) ${m}_profile();`);
  return { bead, groove };
}

/** Dividers for nx × ny compartments within the profile's outer size (then clipped to the inside). */
function dividers(nx: number, ny: number, b: { x0: number; x1: number; y0: number; y1: number }, w: number): string[] {
  const out: string[] = [];
  const H = 1000; // clipped by intersection
  const ix0 = b.x0 + w, ix1 = b.x1 - w, iy0 = b.y0 + w, iy1 = b.y1 - w; // inner size
  for (let i = 1; i < nx; i++) out.push(`translate([${num(ix0 + ((ix1 - ix0) * i) / nx - w / 2)}, ${num(b.y0)}, 0]) cube([${num(w)}, ${num(b.y1 - b.y0)}, ${H}]);`);
  for (let j = 1; j < ny; j++) out.push(`translate([${num(b.x0)}, ${num(iy0 + ((iy1 - iy0) * j) / ny - w / 2)}, 0]) cube([${num(b.x1 - b.x0)}, ${num(w)}, ${H}]);`);
  return out;
}

/** Jar with an external thread at the top and a screw lid with an internal thread and grip. */
function screwContainer(
  f: ContainerFeature,
  sk: SketchFeature,
  ctx: Parameters<FeatureKind<ContainerFeature>['build']>[2],
  circle: { c: Vec; r: number } | undefined,
  { H, w, fl, c }: { H: number; w: number; fl: number; c: number },
) {
  if (!circle) return { error: t('err.screwNeedsCircle') };
  const r = new FieldReader(ctx);
  const Lt = r.positive(t('field.threadLen'), f.threadLength).v;
  const P = r.positive(t('field.pitch'), f.pitch).v;
  if (r.error) return { error: r.error };
  const R = circle.r;
  const h = threadDepth(P);
  const Ri = R - w; // inner radius
  const Rn = Math.min(Ri, R - h - MIN_NECK_WALL); // inner radius in the neck (the wall inside the thread)
  const zCone = H - Lt - (Ri - Rn); // 45° transition up to the neck – printable without supports
  if (Rn < 1) return { error: t('err.wallTooThin') };
  if (Lt >= H - fl || zCone < fl) return { error: t('err.containerTooLow') };
  const fn = fnFor(2 * R);
  const m = ctx.module;
  const cavity = [[0, fl], [Ri, fl], [Ri, zCone], [Rn, H - Lt], [Rn, H + 1], [0, H + 1]].map(([x, y]) => `[${num(x)}, ${num(y)}]`).join(', ');
  const Ro = R + c + w; // the lid's outer radius
  const Hl = fl + Lt;
  const ribs = Math.max(8, Math.round((2 * Math.PI * Ro) / 5));
  const at = `translate([${num(circle.c.x)}, ${num(circle.c.y)}, 0])`;
  const lidAt = `translate([${num(circle.c.x + R + Ro + 10)}, ${num(circle.c.y)}, 0])`;
  const place = ctx.place(sk);
  const code = [
    `module ${m}() {\n  ${place}${at} difference() {\n    union() {\n      cylinder(r = ${num(R)}, h = ${num(H - Lt)}, $fn = ${fn});\n` +
      `      ${threadScad({ R, P, L: Lt, z0: H - Lt, chamfer: true }, '      ')}\n    }\n` +
      `    rotate_extrude($fn = ${fn}) polygon([${cavity}]);\n  }\n}`,
    `module ${m}_lid() {\n  ${place}${lidAt} difference() {\n    union() {\n      cylinder(r = ${num(Ro)}, h = ${num(Hl)}, $fn = ${fnFor(2 * Ro)});\n` +
      `      for (i = [0 : ${ribs - 1}]) rotate(i * 360 / ${ribs}) translate([${num(Ro)}, 0, 0]) cylinder(r = 0.8, h = ${num(Hl)}, $fn = 12); // grip\n    }\n` +
      `    translate([0, 0, ${num(Hl)}]) rotate([180, 0, 0]) ${threadScad({ R: R + c, P, L: Lt + 0.01, z0: -0.01, entry: true }, '    ')}\n  }\n}`,
  ].join('\n');
  return { code, tools: [{ op: 'add' as const, call: `${m}();` }, { op: 'add' as const, call: `${m}_lid();` }] };
}
