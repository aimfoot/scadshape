// Shared by all features: types for code generation and the panel's fields, and helper functions.

import type { Doc } from '../doc';
import type { V3 } from '../frame';
import { exprToScad, parseExpr, type Vars } from '../expr';
export type { Vars };
import { t, type Key } from '../i18n';
import { segmentsFor, type Vec } from '../sketch/geom';
import type { Plane, SketchData } from '../sketch/model';
import type { Loop, Region } from '../sketch/regions';
import type { Repeat } from './pattern';

export type Op = 'add' | 'remove' | 'intersect';

/** The base of all features in the tree (solid features can also be repeated, see pattern.ts). */
export interface FeatureBase extends Repeat {
  id: string;
  name: string;
  suppressed?: boolean;
}

export interface SketchFeature extends FeatureBase, SketchData {
  type: 'sketch';
  plane: Plane;
  /** The plane's offset along the normal (mm, expression). */
  offset?: string;
  /**
   * Sketched on a face in 3D: which way the face points out of the body, along the plane's normal
   * or against it (an underside). New features build outwards and cut/drill inwards.
   */
  outward?: 'normal' | 'reverse';
  /**
   * Sketched on a slanted face: the plane's origin and axes in the world (unit vectors, u ⟂ v; the
   * normal u × v points out of the body). Takes precedence over plane; plane is then just the
   * nearest base plane.
   */
  face?: { o: V3; u: V3; v: V3 };
  /**
   * The face comes from an extrude: the side that a line in its profile sweeps out, or an end face
   * (lo/hi along its sketch normal). The plane is recomputed from it on every build (follows the
   * dimensions); face is the last known position, used if the reference can no longer be resolved.
   * sign: the face's normal out of the body compared with the computed one.
   */
  faceRef?: FaceRef;
  /**
   * Sketched on a round face: how far (mm) the surface falls away below the drawing (the plane only
   * touches along a line). What is added outwards is extended that far in so it reaches the
   * surface.
   */
  seat?: number;
}

export interface FaceRef {
  feature: string;
  entity?: string;
  cap?: 'lo' | 'hi';
  sign: 1 | -1;
}

/** Direction out of the body for a sketch on a face (otherwise along the normal). */
export const outwardOf = (sk: SketchFeature | undefined): 'normal' | 'reverse' => sk?.outward ?? 'normal';
/** Direction into the body (opposite of outwards). */
export const inwardOf = (sk: SketchFeature | undefined): 'normal' | 'reverse' => (outwardOf(sk) === 'normal' ? 'reverse' : 'normal');

/** One step in the model build: module calls that are added, subtracted or intersected. */
export interface Tool {
  op: Op;
  call: string;
}

export interface SketchRegions {
  loops: Loop[];
  regions: Region[];
}

export interface BuildCtx {
  vars: Vars;
  /** Variable name → valid OpenSCAD name. */
  names: ReadonlyMap<string, string>;
  /** The module name for the feature. */
  module: string;
  regions(sk: SketchFeature): SketchRegions;
  /** The sketch plane's placement in 3D (incl. offset) as an OpenSCAD prefix. */
  place(sk: SketchFeature): string;
  /** The whole document (for features that follow other features, e.g. an extruded face). */
  doc?: Doc;
}

export type Built = { error: string } | { code: string; tools: Tool[]; /** include/use lines at the top of the file. */ preamble?: string[] };

/** Reads expression fields and collects the first error. */
export class FieldReader {
  error: string | null = null;
  constructor(private ctx: Pick<BuildCtx, 'vars' | 'names'>) {}

  /** Value and code (variables are kept in the code). */
  read(label: string, src: string, check: (v: number) => boolean = () => true, why = ''): { v: number; code: string } {
    const r = parseExpr(src, this.ctx.vars);
    if (r.value === null) this.error ??= `${label}: ${r.error}`;
    else if (!check(r.value)) this.error ??= `${label} ${why}`;
    const v = r.value ?? 0;
    return { v, code: r.uses.length ? `(${exprToScad(src, this.ctx.names)})` : num(v) };
  }

  positive(label: string, src: string) {
    return this.read(label, src, v => v > 0, t('err.mustBePositive'));
  }
}

export const num = (n: number) => {
  const s = (Math.round(n * 1e6) / 1e6).toString();
  return s === '-0' ? '0' : s;
};

export const fnFor = (diameter: number) => segmentsFor(Math.max(diameter, 0.1) / 2, Math.PI * 2, 0.01);

/** Place the sketch's 2D (u, v) on the plane; z along the plane's normal. */
export const PLANE_ROTATE: Record<Plane, string> = {
  XY: '',
  XZ: 'rotate([90, 0, 0]) ', // u → X, v → Z, normal −Y (towards the viewer in the front view)
  YZ: 'rotate([90, 0, 90]) ', // u → Y, v → Z, normal +X
};

// ---- The panel's fields (data – drawn by ui/panel.ts) ---------------------------------

export type PickSpec =
  | { kind: 'regions'; axis?: boolean } // regions (and for revolve an axis)
  | { kind: 'points' } // points (holes, text)
  | { kind: 'circles' } // circles/arcs (threads)
  | { kind: 'none' };

/** A field in the feature panel. `key` is the feature property the field changes. */
export type Field<F> =
  | { kind: 'expr'; key: keyof F & string; label: Key; unit?: string; show?: (f: F) => boolean }
  | { kind: 'text'; key: keyof F & string; label: Key; show?: (f: F) => boolean } // free text (not an expression)
  | { kind: 'code'; key: keyof F & string; label: Key; show?: (f: F) => boolean } // several lines of code
  | { kind: 'choice'; key: keyof F & string; options: { value: string; label: Key }[]; show?: (f: F) => boolean }
  | { kind: 'check'; key: keyof F & string; label: Key; show?: (f: F) => boolean }
  | { kind: 'select'; key: keyof F & string; label: Key; options: (f: F, ctx?: FieldCtx) => { value: string; label: string }[]; show?: (f: F) => boolean }
  | { kind: 'heading'; label: Key; show?: (f: F) => boolean }
  /** Computed text (e.g. strain); warn = shown as a warning. */
  | { kind: 'note'; text: (f: F, vars: Vars) => { text: string; warn?: boolean } | null; show?: (f: F) => boolean }
  | { kind: 'pair'; fields: [Field<F>, Field<F>]; show?: (f: F) => boolean };

/** Context for fields that list other things in the document: features before index before are visible. */
export interface FieldCtx {
  doc: Doc;
  before: number;
}

export interface PickTarget {
  /** Candidates to choose from (for points/circles: ids in the sketch). */
  candidates?: string[];
}

export interface FeatureKind<F extends FeatureBase & { type: string; sketch?: string }> {
  type: F['type'];
  /** Key for the type's name ("Extrude") – also the base for the default name. */
  label: Key;
  icon: string;
  pick: PickSpec;
  fields: Field<F>[];
  /** New feature with default values for the sketch. */
  create(id: string, name: string, sketch: SketchFeature): F;
  /** Short description in the tree. */
  detail(f: F): string;
  /** Code generation. */
  build(f: F, sk: SketchFeature, ctx: BuildCtx): Built;
  /** Can the sketch be used for the feature (does it have what is needed)? */
  usable(sk: SketchFeature): boolean;
  /** Called when a field has changed in the panel (e.g. preset → custom sizes). */
  changed?(f: F, key: string, sk: SketchFeature | undefined): void;
}

export const OP_LABEL: Record<Op, Key> = { add: 'op.add', remove: 'op.remove', intersect: 'op.intersect' };

export type { Vec };
