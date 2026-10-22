// Gemensamt för alla features: typer för kodgenerering och panelens fält, och hjälpfunktioner.

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

/** Grunden för alla features i trädet (solida features kan också upprepas, se pattern.ts). */
export interface FeatureBase extends Repeat {
  id: string;
  name: string;
  suppressed?: boolean;
}

export interface SketchFeature extends FeatureBase, SketchData {
  type: 'sketch';
  plane: Plane;
  /** Planets förskjutning längs normalen (mm, uttryck). */
  offset?: string;
  /**
   * Skissad på en yta i 3D: åt vilket håll ytan pekar ut ur kroppen, längs planets normal
   * eller mot den (en undersida). Nya features bygger utåt och skär/borrar inåt.
   */
  outward?: 'normal' | 'reverse';
  /**
   * Skissad på en sned yta: planets origo och axlar i världen (enhetsvektorer, u ⟂ v; normalen
   * u × v pekar ut ur kroppen). Går före plane; plane är då bara närmaste grundplan.
   */
  face?: { o: V3; u: V3; v: V3 };
  /**
   * Ytan kommer från en extrudering: sidan som en linje i dess profil sveper upp, eller en
   * ändyta (lo/hi längs dess skissnormal). Planet räknas om ur den vid varje bygge (följer
   * måtten); face är senast kända läge, som används om referensen inte längre går att lösa.
   * sign: ytans normal ut ur kroppen jämfört med den uträknade.
   */
  faceRef?: FaceRef;
  /**
   * Skissad på en rund yta: hur långt (mm) ytan faller bort under det ritade (planet tangerar
   * bara längs en linje). Det som läggs till utåt förlängs så långt in så att det når ytan.
   */
  seat?: number;
}

export interface FaceRef {
  feature: string;
  entity?: string;
  cap?: 'lo' | 'hi';
  sign: 1 | -1;
}

/** Riktning ut ur kroppen för en skiss på en yta (annars längs normalen). */
export const outwardOf = (sk: SketchFeature | undefined): 'normal' | 'reverse' => sk?.outward ?? 'normal';
/** Riktning in i kroppen (motsatt utåt). */
export const inwardOf = (sk: SketchFeature | undefined): 'normal' | 'reverse' => (outwardOf(sk) === 'normal' ? 'reverse' : 'normal');

/** Ett steg i modellbygget: modulanrop som läggs till, dras bort eller snittas. */
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
  /** Variabelnamn → giltigt OpenSCAD-namn. */
  names: ReadonlyMap<string, string>;
  /** Modulnamnet för featuren. */
  module: string;
  regions(sk: SketchFeature): SketchRegions;
  /** Skissplanets placering i 3D (inkl. förskjutning) som OpenSCAD-prefix. */
  place(sk: SketchFeature): string;
  /** Hela dokumentet (för features som följer andra features, t.ex. en extruderad yta). */
  doc?: Doc;
}

export type Built = { error: string } | { code: string; tools: Tool[]; /** include/use-rader överst i filen. */ preamble?: string[] };

/** Läser uttrycksfält och samlar första felet. */
export class FieldReader {
  error: string | null = null;
  constructor(private ctx: Pick<BuildCtx, 'vars' | 'names'>) {}

  /** Värde och kod (variabler behålls i koden). */
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

/** Placera skissens 2D (u, v) på planet; z längs planets normal. */
export const PLANE_ROTATE: Record<Plane, string> = {
  XY: '',
  XZ: 'rotate([90, 0, 0]) ', // u → X, v → Z, normal −Y (mot betraktaren i framvyn)
  YZ: 'rotate([90, 0, 90]) ', // u → Y, v → Z, normal +X
};

// ---- Panelens fält (data – ritas av ui/panel.ts) --------------------------------------

export type PickSpec =
  | { kind: 'regions'; axis?: boolean } // regioner (och för revolve en axel)
  | { kind: 'points' } // punkter (hål, text)
  | { kind: 'circles' } // cirklar/bågar (gängor)
  | { kind: 'none' };

/** Ett fält i featurepanelen. `key` är egenskapen i featuren som fältet ändrar. */
export type Field<F> =
  | { kind: 'expr'; key: keyof F & string; label: Key; unit?: string; show?: (f: F) => boolean }
  | { kind: 'text'; key: keyof F & string; label: Key; show?: (f: F) => boolean } // fri text (inte ett uttryck)
  | { kind: 'code'; key: keyof F & string; label: Key; show?: (f: F) => boolean } // flera rader kod
  | { kind: 'choice'; key: keyof F & string; options: { value: string; label: Key }[]; show?: (f: F) => boolean }
  | { kind: 'check'; key: keyof F & string; label: Key; show?: (f: F) => boolean }
  | { kind: 'select'; key: keyof F & string; label: Key; options: (f: F, ctx?: FieldCtx) => { value: string; label: string }[]; show?: (f: F) => boolean }
  | { kind: 'heading'; label: Key; show?: (f: F) => boolean }
  /** Uträknad text (t.ex. töjning); warn = visas som varning. */
  | { kind: 'note'; text: (f: F, vars: Vars) => { text: string; warn?: boolean } | null; show?: (f: F) => boolean }
  | { kind: 'pair'; fields: [Field<F>, Field<F>]; show?: (f: F) => boolean };

/** Sammanhang för fält som listar annat i dokumentet: features före index before syns. */
export interface FieldCtx {
  doc: Doc;
  before: number;
}

export interface PickTarget {
  /** Kandidater att välja bland (för punkter/cirklar: id i skissen). */
  candidates?: string[];
}

export interface FeatureKind<F extends FeatureBase & { type: string; sketch?: string }> {
  type: F['type'];
  /** Nyckel för typens namn ("Extrudera") – också grund för standardnamnet. */
  label: Key;
  icon: string;
  pick: PickSpec;
  fields: Field<F>[];
  /** Ny feature med standardvärden för skissen. */
  create(id: string, name: string, sketch: SketchFeature): F;
  /** Kort beskrivning i trädet. */
  detail(f: F): string;
  /** Kodgenerering. */
  build(f: F, sk: SketchFeature, ctx: BuildCtx): Built;
  /** Kan skissen användas för featuren (har den det som behövs)? */
  usable(sk: SketchFeature): boolean;
  /** Anropas när ett fält ändrats i panelen (t.ex. förval → egna mått). */
  changed?(f: F, key: string, sk: SketchFeature | undefined): void;
}

export const OP_LABEL: Record<Op, Key> = { add: 'op.add', remove: 'op.remove', intersect: 'op.intersect' };

export type { Vec };
