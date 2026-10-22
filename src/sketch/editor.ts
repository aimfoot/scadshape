// Skisseditor på en 2D-canvas: rita med fingret (eller musen), med villkor och mått.
//
// Inmatning: punkten hamnar där fingret är (med snäpp). Medan fingret är nere
// visas ett förstoringsglas ovanför fingret; dra för att finjustera, släpp för
// att placera. Man kan också dra från första till andra punkten i ett svep.
// Två fingrar panorerar/zoomar alltid. Mus: hjul zoomar, höger/mitten-knapp panorerar.
//
// Varje ändring löses av planegcs (solver.ts). Krockar ändringen med villkoren
// rullas den tillbaka och onMessage får en förklaring.

import {
  angleOf, arcPoints, arcThrough, ccwSweep, dist, distToArc, distToSegment, fmtNum, polar, TAU, type Vec,
} from './geom';
import {
  arcGeom, cloneSketch, entityPointIds, fixArcs, mergePoints, newId, ORIGIN, pruneConstraints, removeEntities, removePoints,
  constraintRefs, isDimension, type Constraint, type NewConstraint, type SketchData,
} from './model';
import { endpointDegrees, findLoops, type Loop } from './regions';
import { cornersFor, cutCorners, defaultCornerSize, type CornerKind } from './fillet';
import { curveGap, curveLineGap, drawDimension, drawGlyphs, measure, pointCurveDistance, pointLineDistance, radiusOf, signedAngle, visibleAngle, xAngle, type Hotspot } from './annotate';
import type { SketchSolver, SolveResult } from './solver';
import { t, type Key } from '../i18n';
import { currentTheme } from '../theme';

export type ToolName = 'select' | 'point' | 'line' | 'rect' | 'rectc' | 'circle' | 'polygon' | 'slot' | 'arc3' | 'arcc';

interface Snap extends Vec {
  pointId?: string; // befintlig punkt (eller ORIGIN)
  entity?: string; // kurva (kind 'curve') eller linje (kind 'mid')
  kind: 'point' | 'grid' | 'free' | 'h' | 'v' | 'curve' | 'mid' | 'ref' | 'refEdge';
}

interface View {
  cx: number; // världskoordinat i mitten av canvas (mm)
  cy: number;
  scale: number; // px per mm
}

type Hit = { type: 'point'; id: string } | { type: 'entity'; id: string } | { type: 'constraint'; id: string; dim: boolean };

type Gesture =
  | { kind: 'none' }
  | { kind: 'ignore' } // vänta tills alla fingrar släppt
  | { kind: 'pinch'; d0: number; s0: number; world0: Vec }
  | { kind: 'pan'; last: Vec }
  | { kind: 'press'; down: Vec; downSnap: Snap; moved: boolean; touch: boolean; startedDrag: boolean }
  | { kind: 'select-press'; down: Vec; moved: boolean; touch: boolean; hit: Hit | null; dragging: boolean; last: Vec };

interface DragState {
  hit: Hit;
  before: string; // skissen före draget (för ångra/återställning)
  startPts: Map<string, Vec>;
  startWorld: Vec;
}

export interface Action {
  label: string;
  symbol: string;
  run: () => void;
}

export interface DimensionInfo {
  title: string;
  value: number;
  expr?: string;
  unit: string;
  dir?: 'aligned' | 'h' | 'v';
  rd?: 'radius' | 'diameter';
}

const LIGHT = {
  bg: '#fbfcfd',
  gridMinor: 'rgba(110,125,140,.13)',
  gridMajor: 'rgba(110,125,140,.28)',
  axisX: 'rgba(208,69,59,.55)',
  axisY: 'rgba(58,154,75,.55)',
  free: '#1a6fc4', // underbestämd (blå)
  defined: '#141d26', // fullt bestämd (svart)
  construction: '#7d8b99',
  selected: '#e8790c',
  conflict: '#d0453b',
  region: 'rgba(26,111,196,.12)',
  preview: '#5c8fc9',
  snap: '#e8790c',
  open: '#d0453b',
  dim: '#3b4a59',
  reference: 'rgba(92,107,122,.75)', // modellens kanter i skissplanet
  label: 'rgba(255,255,255,.92)', // bakom mått, villkorssymboler och mätetiketten
  labelLine: 'rgba(31,58,87,.25)',
  loupeRing: 'rgba(31,58,87,.45)',
};
/** Mörkt tema: samma betydelser; fullt bestämt blir ljust i stället för svart. */
const DARK: typeof LIGHT = {
  bg: '#141a20',
  gridMinor: 'rgba(150,165,180,.10)',
  gridMajor: 'rgba(150,165,180,.22)',
  axisX: 'rgba(240,110,100,.6)',
  axisY: 'rgba(100,200,120,.55)',
  free: '#5ea4ec',
  defined: '#e8eef4',
  construction: '#7f8e9c',
  selected: '#f39a3d',
  conflict: '#f0675c',
  region: 'rgba(94,164,236,.16)',
  preview: '#7fb2e6',
  snap: '#f39a3d',
  open: '#f0675c',
  dim: '#b9c6d2',
  reference: 'rgba(160,175,190,.7)',
  label: 'rgba(27,34,41,.92)',
  labelLine: 'rgba(160,180,200,.3)',
  loupeRing: 'rgba(160,180,200,.55)',
};
const PALETTES = { light: LIGHT, dark: DARK };

/** Modellens kontur i skissplanet (skissa på en yta): bara att se och snäppa till. */
export interface SketchReference {
  segments: [Vec, Vec][];
  snaps: Vec[];
}

/** Avlångt hål: radien är avståndet från punkten till mittlinjen A–B (minst en hundradel). */
function slotRadius(a: Vec, b: Vec, p: Vec) {
  const L = dist(a, b);
  if (L < 1e-9) return 0;
  return Math.abs(((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / L);
}

const HINTS: Record<ToolName, Key[]> = {
  select: ['hint.select'],
  line: ['hint.line1', 'hint.line2'],
  rect: ['hint.rect1', 'hint.rect2'],
  rectc: ['hint.rectc1', 'hint.rectc2'],
  circle: ['hint.circle1', 'hint.circle2'],
  polygon: ['hint.poly1', 'hint.poly2'],
  slot: ['hint.slot1', 'hint.slot2', 'hint.slot3'],
  arc3: ['hint.arc31', 'hint.arc32', 'hint.arc33'],
  arcc: ['hint.arcc1', 'hint.arcc2', 'hint.arcc3'],
  point: ['hint.point'],
};

const CONSTRAINT_NAMES: Record<Constraint['type'], Key> = {
  horizontal: 'con.horizontal', vertical: 'con.vertical', hpoints: 'con.horizontal', vpoints: 'con.vertical', parallel: 'con.parallel',
  perpendicular: 'con.perpendicular', equal: 'con.equal', tangent: 'con.tangent', concentric: 'con.concentric', onCurve: 'con.onCurve',
  midpoint: 'con.midpoint', fix: 'con.fix', distance: 'con.dimension', pldistance: 'con.dimension', pcdistance: 'con.dimension', ccdistance: 'con.dimension', cldistance: 'con.dimension', xangle: 'con.angle', radius: 'con.radius', diameter: 'con.diameter',
  angle: 'con.angle',
};

export class SketchEditor {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  view: View = { cx: 0, cy: 0, scale: 5 };

  sketch: SketchData;
  tool: ToolName = 'line';
  /** Färger för aktuellt tema (theme.ts). */
  private get C() {
    return PALETTES[currentTheme()];
  }
  snapToGrid = true;
  showConstraints = true;
  selection = new Set<string>(); // 'p:<id>', 'e:<id>' eller 'c:<id>'
  /** Modellens kanter i planet. */
  reference: SketchReference | null = null;
  /** Ta med referensen när vyn anpassas (skiss skapad på en yta). */
  fitReference = false;

  private solver: SketchSolver | null = null;
  private lastSolve: SolveResult | null = null;
  private free: { points: Set<string>; radii: Set<string> } | null = null;
  private flash = new Set<string>(); // villkor som just krockade (visas rött en stund)
  private flashTimer = 0;

  private placed: Snap[] = []; // punkter placerade i pågående verktygsoperation
  private cursor: Snap | null = null; // aktuell (snäppt) position för förhandsvisning
  private fingerScreen: Vec | null = null; // för förstoringsglaset
  private arcAccum = 0; // mittpunktsbåge: hur långt användaren svept (radianer, moturs +)
  private arcLastAngle = 0;
  private pointers = new Map<number, Vec>();
  private gesture: Gesture = { kind: 'none' };
  private drag: DragState | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private loops: Loop[] = [];
  private degrees = new Map<string, number>();
  private hotspots: Hotspot[] = [];
  private dirty = false; // en omritning är redan schemalagd

  /** Efter varje bestående ändring av skissen (för att spara). */
  onChange?: () => void;
  /** När hjälptext, ångra-läge, markering eller lösarstatus ändras. */
  onState?: () => void;
  /** Meddelande till användaren (t.ex. krockande villkor). */
  onMessage?: (text: string, kind: 'info' | 'error') => void;
  /** Användaren vill ändra ett mått (tryckt på etiketten: viaTap, eller nyss skapat). */
  onEditDimension?: (id: string, viaTap?: boolean) => void;

  constructor(host: HTMLElement, sketch: SketchData) {
    this.sketch = sketch;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sketch-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.bindInput();
    this.recompute();
    this.resize();
  }

  // ---- Publikt API --------------------------------------------------------------

  setSolver(s: SketchSolver) {
    this.solver = s;
    this.solveQuietly();
  }

  setSketch(sk: SketchData) {
    this.sketch = sk;
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    this.resetTool();
    this.solveQuietly();
    this.fit();
  }

  setTool(t: ToolName) {
    this.tool = t;
    this.resetTool();
    if (t !== 'select') this.selection.clear();
    this.changedState();
  }

  get hint() {
    const steps = HINTS[this.tool];
    return t(steps[Math.min(this.placed.length, steps.length - 1)]);
  }
  /** Ett ritverktyg har en pågående operation som kan avslutas. */
  get chainActive() {
    return this.tool !== 'select' && this.placed.length > 0;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get selectedCount() {
    return this.selection.size;
  }
  get loopCount() {
    return this.loops.filter(l => l.depth % 2 === 0).length;
  }
  get openInfo() {
    let open = 0;
    for (const d of this.degrees.values()) if (d === 1) open++;
    return { open };
  }
  /** Frihetsgrader (null om lösaren inte är laddad). */
  get dof(): number | null {
    return this.solver && this.lastSolve?.ok ? this.lastSolve.dof : null;
  }
  get solverReady() {
    return this.solver !== null;
  }

  finishOperation() {
    this.resetTool();
    this.changedState();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(JSON.stringify(this.sketch));
    this.restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(JSON.stringify(this.sketch));
    this.restore(s);
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const sel = [...this.selection];
    this.transact(() => {
      const cons = new Set(sel.filter(s => s.startsWith('c:')).map(s => s.slice(2)));
      this.sketch.constraints = this.sketch.constraints.filter(c => !cons.has(c.id));
      removeEntities(this.sketch, sel.filter(s => s.startsWith('e:')).map(s => s.slice(2)));
      removePoints(this.sketch, sel.filter(s => s.startsWith('p:')).map(s => s.slice(2)).filter(p => p !== ORIGIN));
    });
    this.selection.clear();
    this.changedState();
  }

  toggleConstruction() {
    const ents = [...this.selection].filter(s => s.startsWith('e:')).map(s => this.sketch.entities[s.slice(2)]).filter(Boolean);
    if (!ents.length) return;
    const on = !ents.every(e => e.construction);
    this.transact(() => {
      for (const e of ents) e.construction = on || undefined;
    });
  }

  /** Zooma så att hela skissen syns (eller ett standardområde om den är tom). */
  fit() {
    const pts: Vec[] = Object.values(this.sketch.points);
    if (this.fitReference) for (const [a, b] of this.reference?.segments ?? []) pts.push(a, b);
    for (const e of Object.values(this.sketch.entities))
      if (e.type === 'circle') {
        const c = this.sketch.points[e.c];
        pts.push({ x: c.x - e.r, y: c.y - e.r }, { x: c.x + e.r, y: c.y + e.r });
      } else if (e.type === 'arc') {
        const g = arcGeom(this.sketch, e);
        pts.push(...arcPoints(g.c, g.r, g.a0, g.sweep, Math.max(g.r, 1e-6) * 0.01));
      }
    if (!pts.length) pts.push({ x: -40, y: -40 }, { x: 40, y: 40 });
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const wMm = Math.max(x1 - x0, 10), hMm = Math.max(y1 - y0, 10);
    this.view = {
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      scale: Math.min(Math.max(this.w, 100) / (wMm * 1.5), Math.max(this.h, 100) / (hMm * 1.6)),
    };
    this.requestDraw();
  }

  /** Klientkoordinater (CSS px) för en punkt i skissen (mm) – för tester. */
  clientPoint(p: Vec): Vec {
    const r = this.canvas.getBoundingClientRect();
    const s = this.toScreen(p);
    return { x: r.left + s.x, y: r.top + s.y };
  }

  // ---- Villkor och mått ----------------------------------------------------------

  /** Villkor/åtgärder som passar det som är markerat. */
  actions(): Action[] {
    const sk = this.sketch;
    const sel = [...this.selection];
    const pts = sel.filter(k => k.startsWith('p:')).map(k => k.slice(2));
    const ents = sel.filter(k => k.startsWith('e:')).map(k => k.slice(2)).filter(e => sk.entities[e]);
    const cons = sel.filter(k => k.startsWith('c:')).map(k => k.slice(2));
    const lines = ents.filter(e => sk.entities[e].type === 'line');
    const curves = ents.filter(e => sk.entities[e].type !== 'line');
    const n = pts.length + ents.length;
    const A: Action[] = [];
    const add = (label: string, symbol: string, make: () => NewConstraint[] | null) =>
      A.push({ label, symbol, run: () => this.addConstraints(make() ?? []) });

    if (cons.length && !n) {
      A.push({ label: t(cons.length > 1 ? 'act.deleteConstraints' : 'act.deleteConstraint'), symbol: '✕', run: () => this.deleteSelection() });
      const dims = cons.filter(id => {
        const c = sk.constraints.find(x => x.id === id);
        return c !== undefined && isDimension(c);
      });
      if (dims.length === 1) A.unshift({ label: t('act.editDimension'), symbol: '✎', run: () => this.onEditDimension?.(dims[0]) });
      return A;
    }
    const corners = (pts.length === n || lines.length === n) && n ? cornersFor(sk, pts, lines) : [];
    if (corners.length) {
      A.push({ label: t('act.fillet'), symbol: '◜', run: () => this.cutCorners('fillet', corners.map(c => c.p)) });
      A.push({ label: t('act.chamfer'), symbol: '◸', run: () => this.cutCorners('chamfer', corners.map(c => c.p)) });
    }
    if (lines.length && lines.length === n) {
      add(t('act.horizontal'), 'H', () => lines.map(e => ({ type: 'horizontal', e }) as const));
      add(t('act.vertical'), 'V', () => lines.map(e => ({ type: 'vertical', e }) as const));
    }
    if (lines.length === 1 && n === 1) A.push({ label: t('act.dimension'), symbol: '↔', run: () => this.addDimension() });
    if (lines.length === 2 && n === 2) {
      const [e1, e2] = lines;
      add(t('act.parallel'), '∥', () => [{ type: 'parallel', e1, e2 }]);
      add(t('act.perpendicular'), '⊥', () => [{ type: 'perpendicular', e1, e2 }]);
    }
    if (ents.length >= 2 && ents.length === n && (lines.length === n || curves.length === n)) {
      const [first, ...rest] = ents;
      add(t('act.equal'), '=', () => rest.map(e2 => ({ type: 'equal', e1: first, e2 }) as const));
    }
    if (lines.length === 2 && n === 2) A.push({ label: t('act.dimension'), symbol: '∠', run: () => this.addDimension() });
    if (ents.length === 2 && n === 2 && curves.length >= 1) {
      const [e1, e2] = ents;
      add(t('act.tangent'), 'T', () => [{ type: 'tangent', e1, e2 }]);
      if (lines.length === 1) A.push({ label: t('act.dimension'), symbol: '↔', run: () => this.addDimension() });
    }
    if (curves.length === 2 && n === 2) {
      const [e1, e2] = curves;
      add(t('act.concentric'), '◎', () => [{ type: 'concentric', e1, e2 }]);
      A.push({ label: t('act.dimension'), symbol: '↔', run: () => this.addDimension() });
    }
    if (curves.length === 1 && n === 1) A.push({ label: t('act.dimension'), symbol: 'Ø', run: () => this.addDimension() });
    if (pts.length === 1 && ents.length === 1) {
      const [p] = pts, [e] = ents;
      if (!entityPointIds(sk.entities[e]).includes(p)) {
        add(t(lines.length ? 'act.onLine' : 'act.onCurve'), '•', () => [{ type: 'onCurve', p, e }]);
        if (lines.length) add(t('act.midpoint'), 'M', () => [{ type: 'midpoint', p, e }]);
        A.push({ label: t('act.dimension'), symbol: '↔', run: () => this.addDimension() });
      }
    }
    if (pts.length === 2 && n === 2) {
      const [p1, p2] = pts;
      A.push({ label: t('act.merge'), symbol: '⊙', run: () => this.mergeSelected(p1, p2) });
      add(t('act.horizontal'), 'H', () => [{ type: 'hpoints', p1, p2 }]);
      add(t('act.vertical'), 'V', () => [{ type: 'vpoints', p1, p2 }]);
      A.push({ label: t('act.dimension'), symbol: '↔', run: () => this.addDimension() });
    }
    // Punkter på en cirkel: vinkel (mot X-axeln eller en linje) och jämn fördelning.
    const onCircle = pts.length ? this.curveOfPoint(pts[0]) : null;
    if (pts.length === 1 && onCircle && (n === 1 || (n === 2 && lines.length === 1))) {
      const [p] = pts, ref = lines[0] ?? null;
      A.push({ label: t(ref ? 'act.angleLine' : 'act.angleX'), symbol: '∠', run: () => this.anglePoint(p, onCircle, ref) });
    }
    const circle = curves.length === 1 && sk.entities[curves[0]].type === 'circle' ? curves[0] : pts.length && onCircle && sk.entities[onCircle].type === 'circle' && !curves.length ? onCircle : null;
    if (circle && lines.length === 0 && curves.length <= 1 && pts.every(p => this.curveOfPoint(p, circle))) {
      const on = pts.length ? pts : sk.constraints.filter(c => c.type === 'onCurve' && c.e === circle).map(c => (c as { p: string }).p);
      if (on.length >= 2) A.push({ label: t('act.distribute'), symbol: '✣', run: () => this.distribute(circle, on) });
    }
    if (pts.length === 1 && n === 1 && pts[0] !== ORIGIN) {
      const p = pts[0];
      const fixed = sk.constraints.find(c => c.type === 'fix' && c.p === p);
      if (fixed) A.push({ label: t('act.unfix'), symbol: '⚓', run: () => this.transact(() => { sk.constraints = sk.constraints.filter(c => c !== fixed); }) });
      else add(t('act.fix'), '⚓', () => [{ type: 'fix', p }]);
    }
    return A;
  }

  private addConstraints(list: NewConstraint[]) {
    if (!list.length) return;
    const sk = this.sketch;
    const same = (a: NewConstraint, b: Constraint) => {
      const { id: _id, ...rest } = b;
      return JSON.stringify(Object.entries(rest).sort()) === JSON.stringify(Object.entries(a).sort());
    };
    const fresh = list.filter(c => !sk.constraints.some(b => same(c, b)));
    if (!fresh.length) return this.onMessage?.(t('msg.constraintExists'), 'info');
    const ok = this.transact(
      () => {
        for (const c of fresh) sk.constraints.push({ ...c, id: newId(sk, 'c') } as Constraint);
      },
      { strict: true },
    );
    if (ok) {
      this.selection.clear();
      this.changedState();
    }
  }

  /** Avrunda/fasa hörnen och öppna måttet (radie resp. ben) för redigering. */
  private cutCorners(kind: CornerKind, points: string[]) {
    const sk = this.sketch;
    const trial = cloneSketch(sk);
    const dim = cutCorners(trial, points, kind, defaultCornerSize(sk, cornersFor(sk, points, []), kind));
    if (!dim) return this.onMessage?.(t('msg.cornerFails'), 'info');
    if (!this.transact(() => Object.assign(sk, trial), { strict: true })) return;
    this.selection.clear();
    this.changedState();
    this.onEditDimension?.(dim);
  }

  /** Cirkeln/bågen som punkten sitter på (villkoret "på kurvan"); med only: bara just den. */
  private curveOfPoint(p: string, only?: string): string | null {
    const sk = this.sketch;
    const c = sk.constraints.find(c => c.type === 'onCurve' && c.p === p && (!only || c.e === only) && sk.entities[c.e] && sk.entities[c.e].type !== 'line');
    return c ? (c as { e: string }).e : null;
  }

  /** Radielinjen centrum → punkt (konstruktion): befintlig eller ny. Inne i en transaktion. */
  private radiusLine(p: string, e: string): string {
    const sk = this.sketch;
    const c = (sk.entities[e] as { c: string }).c;
    const found = Object.entries(sk.entities).find(([, x]) => x.type === 'line' && x.construction && x.p1 === c && x.p2 === p);
    if (found) return found[0];
    const id = this.addLine(c, p);
    (sk.entities[id] as { construction?: boolean }).construction = true;
    return id;
  }

  /** Vinkel för en punkt på en cirkel: radien mot en linje, eller mot X-axeln. Öppnar måttet. */
  private anglePoint(p: string, e: string, ref: string | null) {
    const sk = this.sketch;
    const L = (x: string) => {
      const l = sk.entities[x] as { p1: string; p2: string };
      return { a: sk.points[l.p1], b: sk.points[l.p2] };
    };
    const id = newId(sk, 'c');
    const ok = this.transact(
      () => {
        const r = this.radiusLine(p, e);
        if (ref) sk.constraints.push({ id, type: 'angle', e1: ref, e2: r, value: signedAngle(L(ref), L(r)) });
        else sk.constraints.push({ id, type: 'xangle', e: r, value: xAngle(L(r)) });
      },
      { strict: true },
    );
    if (!ok) return;
    this.selection.clear();
    this.changedState();
    this.onEditDimension?.(id);
  }

  /**
   * Fördela punkter jämnt runt en cirkel (den första stannar kvar) och håll dem så med en
   * konstruktionspolygon med lika sidor. Ett mått på ett avstånd eller en vinkel styr då alla.
   */
  private distribute(e: string, pts: string[]) {
    const sk = this.sketch;
    const circ = sk.entities[e] as { c: string; r: number };
    const c = sk.points[circ.c];
    const a0 = angleOf(c, sk.points[pts[0]]);
    const key = (p: string) => (p === pts[0] ? 0 : ccwSweep(a0, angleOf(c, sk.points[p])));
    const order = [...pts].sort((p, q) => key(p) - key(q));
    const n = order.length;
    const set = new Set(order);
    const ok = this.transact(
      () => {
        // En tidigare fördelning av samma punkter ersätts.
        for (const [id, x] of Object.entries(sk.entities)) if (x.type === 'line' && x.construction && set.has(x.p1) && set.has(x.p2)) delete sk.entities[id];
        order.forEach((p, i) => Object.assign(sk.points[p], polar(c, circ.r, a0 + (TAU * i) / n)));
        const construction = (l: string) => ((sk.entities[l] as { construction?: boolean }).construction = true) && l;
        if (n === 2) {
          const l = construction(this.addLine(order[0], order[1]));
          sk.constraints.push({ id: newId(sk, 'c'), type: 'midpoint', p: circ.c, e: l, quiet: true });
        } else {
          const lines = order.map((p, i) => construction(this.addLine(p, order[(i + 1) % n])));
          for (let i = 1; i < n; i++) sk.constraints.push({ id: newId(sk, 'c'), type: 'equal', e1: lines[0], e2: lines[i], quiet: true });
        }
      },
      { strict: true },
    );
    if (!ok) return;
    this.selection.clear();
    this.changedState();
  }

  private mergeSelected(p1: string, p2: string) {
    const [from, into] = p1 === ORIGIN ? [p2, p1] : [p1, p2];
    if (this.transact(() => mergePoints(this.sketch, from, into))) {
      this.selection.clear();
      this.changedState();
    }
  }

  /** Skapa ett mått för markeringen med nuvarande värde och öppna det för redigering. */
  addDimension() {
    const sk = this.sketch;
    const sel = [...this.selection];
    const pts = sel.filter(k => k.startsWith('p:')).map(k => k.slice(2));
    const ents = sel.filter(k => k.startsWith('e:')).map(k => k.slice(2));
    let c: NewConstraint | null = null;
    const line = (e: string) => sk.entities[e]?.type === 'line' ? (sk.entities[e] as { p1: string; p2: string }) : null;
    if (ents.length === 1 && !pts.length) {
      const e = sk.entities[ents[0]];
      if (e.type === 'line') c = { type: 'distance', p1: e.p1, p2: e.p2, dir: 'aligned', value: dist(sk.points[e.p1], sk.points[e.p2]) };
      else if (e.type === 'circle') c = { type: 'diameter', e: ents[0], value: 2 * e.r };
      else c = { type: 'radius', e: ents[0], value: arcGeom(sk, e).r };
    } else if (ents.length === 2 && !pts.length && line(ents[0]) && line(ents[1])) {
      const L = (e: string) => ({ a: sk.points[line(e)!.p1], b: sk.points[line(e)!.p2] });
      const ang = signedAngle(L(ents[0]), L(ents[1]));
      if (Math.abs(Math.sin((ang * Math.PI) / 180)) > 1e-6) c = { type: 'angle', e1: ents[0], e2: ents[1], value: ang };
      else {
        const p = line(ents[1])!.p1;
        c = { type: 'pldistance', p, e: ents[0], value: pointLineDistance(sk.points[p], L(ents[0])) };
      }
    } else if (pts.length === 1 && ents.length === 1 && line(ents[0])) {
      const l = line(ents[0])!;
      c = { type: 'pldistance', p: pts[0], e: ents[0], value: pointLineDistance(sk.points[pts[0]], { a: sk.points[l.p1], b: sk.points[l.p2] }) };
    } else if (pts.length === 1 && ents.length === 1 && !entityPointIds(sk.entities[ents[0]]).includes(pts[0])) {
      const e = sk.entities[ents[0]];
      const cv = e.type === 'circle' ? { c: sk.points[e.c], r: e.r } : e.type === 'arc' ? arcGeom(sk, e) : null;
      if (cv) c = { type: 'pcdistance', p: pts[0], e: ents[0], value: pointCurveDistance(sk.points[pts[0]], cv) };
    } else if (ents.length === 2 && !pts.length && ents.every(e => sk.entities[e] && sk.entities[e].type !== 'line')) {
      const cv = (e: string) => {
        const x = sk.entities[e];
        return x.type === 'circle' ? { c: sk.points[x.c], r: x.r } : arcGeom(sk, x as Extract<typeof x, { type: 'arc' }>);
      };
      c = { type: 'ccdistance', e1: ents[0], e2: ents[1], value: curveGap(cv(ents[0]), cv(ents[1])).gap };
    } else if (ents.length === 2 && !pts.length && ents.filter(e => line(e)).length === 1) {
      const l = ents.find(e => line(e))!, e = ents.find(x => x !== l)!;
      const x = sk.entities[e];
      const cv = x.type === 'circle' ? { c: sk.points[x.c], r: x.r } : arcGeom(sk, x as Extract<typeof x, { type: 'arc' }>);
      const L = line(l)!;
      const g = curveLineGap(cv, { a: sk.points[L.p1], b: sk.points[L.p2] });
      if (g.gap < 1e-9) return this.onMessage?.(t('msg.lineCrossesCircle'), 'info');
      c = { type: 'cldistance', e, l, value: g.gap };
    } else if (pts.length === 2 && !ents.length) {
      c = { type: 'distance', p1: pts[0], p2: pts[1], dir: 'aligned', value: dist(sk.points[pts[0]], sk.points[pts[1]]) };
    }
    if (!c) return this.onMessage?.(t('msg.dimensionWhat'), 'info');
    if ((c as { value: number }).value < 1e-9 && c.type !== 'angle') return this.onMessage?.(t('msg.dimensionZero'), 'info');
    const id = newId(sk, 'c');
    if (this.transact(() => sk.constraints.push({ ...c, id } as Constraint), { strict: true })) {
      this.selection.clear();
      this.changedState();
      this.onEditDimension?.(id);
    }
  }

  dimensionInfo(id: string): DimensionInfo | null {
    const c = this.sketch.constraints.find(x => x.id === id);
    if (!c || !isDimension(c)) return null;
    const v = measure(this.sketch, c) ?? 0;
    switch (c.type) {
      case 'distance':
        return { title: t(c.dir === 'h' ? 'dim.hDistance' : c.dir === 'v' ? 'dim.vDistance' : 'dim.distance'), value: c.value, unit: 'mm', dir: c.dir, expr: c.expr };
      case 'pldistance':
        return { title: t('dim.pointLine'), value: c.value, unit: 'mm', expr: c.expr };
      case 'pcdistance':
        return { title: t('dim.pointCurve'), value: c.value, unit: 'mm', expr: c.expr };
      case 'ccdistance':
        return { title: t('dim.curveCurve'), value: c.value, unit: 'mm', expr: c.expr };
      case 'cldistance':
        return { title: t('dim.curveLine'), value: c.value, unit: 'mm', expr: c.expr };
      case 'radius':
      case 'diameter':
        return { title: t(c.type === 'radius' ? 'dim.radius' : 'dim.diameter'), value: c.value, unit: 'mm', rd: c.type, expr: c.expr };
      case 'angle':
        return { title: t('dim.angle'), value: v, unit: '°', expr: c.expr };
      case 'xangle':
        return { title: t('dim.xAngle'), value: v, unit: '°', expr: c.expr };
      default:
        return null;
    }
  }

  /** Vad blir värdet om måttet byter riktning/typ (för dialogen)? */
  previewDimension(id: string, opts: { dir?: 'aligned' | 'h' | 'v'; rd?: 'radius' | 'diameter' }): number | null {
    const c = this.sketch.constraints.find(x => x.id === id);
    if (!c) return null;
    if (c.type === 'distance' && opts.dir) return measure(this.sketch, { ...c, dir: opts.dir });
    if ((c.type === 'radius' || c.type === 'diameter') && opts.rd) {
      const r = radiusOf(this.sketch, c.e);
      return r === null ? null : opts.rd === 'radius' ? r : 2 * r;
    }
    return measure(this.sketch, c);
  }

  /** Sätt ett mått (och ev. riktning/typ). Returnerar false om det inte gick (krock). */
  setDimension(id: string, value: number, opts: { dir?: 'aligned' | 'h' | 'v'; rd?: 'radius' | 'diameter'; expr?: string } = {}): boolean {
    const sk = this.sketch;
    const idx = sk.constraints.findIndex(x => x.id === id);
    const c = sk.constraints[idx];
    if (!c || !isDimension(c)) return false;
    if (!(value > 0) && !((c.type === 'angle' || c.type === 'xangle') && value >= 0)) {
      this.onMessage?.(t('msg.valuePositive'), 'error');
      return false;
    }
    const expr = opts.expr || undefined;
    return this.transact(
      () => {
        if (c.type === 'distance') {
          const dir = opts.dir ?? c.dir;
          let sign: 1 | -1 | undefined;
          if (dir !== 'aligned') {
            const a = sk.points[c.p1], b = sk.points[c.p2];
            const d = dir === 'h' ? b.x - a.x : b.y - a.y;
            sign = d < 0 ? -1 : 1;
          }
          sk.constraints[idx] = { ...c, dir, value, sign, expr };
        } else if (c.type === 'radius' || c.type === 'diameter') {
          sk.constraints[idx] = { ...c, type: opts.rd ?? c.type, value, expr };
        } else if (c.type === 'angle') {
          const L = (e: string) => {
            const l = sk.entities[e] as { p1: string; p2: string };
            return { a: sk.points[l.p1], b: sk.points[l.p2] };
          };
          const vis = visibleAngle(L(c.e1), L(c.e2));
          const abs = vis.s1 === vis.s2 ? value : 180 - value;
          const sign = Math.sign(c.value) || Math.sign(signedAngle(L(c.e1), L(c.e2))) || 1;
          sk.constraints[idx] = { ...c, value: sign * abs, expr };
        } else if (c.type === 'xangle') {
          // Samma sida om X-axeln som nu (vinkeln skrivs utan tecken).
          const l = sk.entities[c.e] as { p1: string; p2: string };
          const sign = Math.sign(xAngle({ a: sk.points[l.p1], b: sk.points[l.p2] })) || 1;
          sk.constraints[idx] = { ...c, value: sign * value, expr };
        } else sk.constraints[idx] = { ...c, value, expr } as Constraint;
      },
      { strict: true },
    );
  }

  // ---- Lösning och transaktioner ----------------------------------------------------

  /** Lös utan att röra ångra-historiken (vid inladdning). */
  private solveQuietly() {
    pruneConstraints(this.sketch);
    if (this.solver) {
      this.lastSolve = this.solver.solve(this.sketch);
      this.free = this.solver.freedom(this.sketch);
    } else fixArcs(this.sketch);
    this.recompute();
    this.onState?.();
  }

  /**
   * Gör en ändring, lös och behåll den bara om villkoren håller.
   * strict: även överflödiga (redundanta) villkor avvisas – för nya villkor/mått.
   */
  private transact(fn: () => void, opts: { strict?: boolean; before?: string } = {}): boolean {
    const before = opts.before ?? JSON.stringify(this.sketch);
    fn();
    pruneConstraints(this.sketch);
    let res: SolveResult | null = null;
    if (this.solver) res = this.solver.solve(this.sketch);
    else fixArcs(this.sketch);
    const bad = res && (!res.ok || (opts.strict && res.redundant.length > 0));
    if (bad && res) {
      Object.assign(this.sketch, JSON.parse(before));
      const culprits = res.ok ? res.redundant : res.conflicting;
      this.flashConstraints(culprits);
      const names = [...new Set(culprits.map(id => this.sketch.constraints.find(c => c.id === id)).filter(Boolean).map(c => t(CONSTRAINT_NAMES[c!.type])))];
      this.onMessage?.(
        res.ok
          ? t('msg.redundant') + (names.length ? ` (${names.join(', ')})` : '')
          : t('msg.conflict') + (names.length ? ` (${names.join(', ')})` : ''),
        'error',
      );
      if (this.solver) {
        this.lastSolve = this.solver.solve(this.sketch);
        this.free = this.solver.freedom(this.sketch);
      }
      this.recompute();
      this.changedState();
      return false;
    }
    this.lastSolve = res;
    if (this.solver) this.free = this.solver.freedom(this.sketch);
    if (before !== JSON.stringify(this.sketch)) {
      this.undoStack.push(before);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.recompute();
    this.onChange?.();
    this.changedState();
    return true;
  }

  private flashConstraints(ids: string[]) {
    this.flash = new Set(ids.map(id => `c:${id}`));
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flash.clear();
      this.requestDraw();
    }, 2500);
  }

  private resetTool() {
    this.placed = [];
    this.cursor = null;
    this.arcAccum = 0;
    this.requestDraw();
  }

  private restore(json: string) {
    // Behåll objektet (det är featuren i dokumentet) men byt innehåll.
    Object.assign(this.sketch, JSON.parse(json) as SketchData);
    this.selection.clear();
    this.resetTool();
    if (this.solver) {
      this.lastSolve = this.solver.solve(this.sketch);
      this.free = this.solver.freedom(this.sketch);
    }
    this.recompute();
    this.onChange?.();
    this.changedState();
  }

  private changedState() {
    this.requestDraw();
    this.onState?.();
  }

  private recompute() {
    // Släpp markeringar av sådant som inte längre finns (borttaget, sammanfogat, ångrat).
    const sk = this.sketch;
    for (const k of [...this.selection]) {
      const id = k.slice(2);
      const exists = k[0] === 'p' ? id in sk.points : k[0] === 'e' ? id in sk.entities : sk.constraints.some(c => c.id === id);
      if (!exists) this.selection.delete(k);
    }
    this.loops = findLoops(this.sketch).loops;
    this.degrees = endpointDegrees(this.sketch);
    this.requestDraw();
  }

  // ---- Koordinater ---------------------------------------------------------------

  private toScreen(p: Vec, v = this.view): Vec {
    return { x: (p.x - v.cx) * v.scale + this.w / 2, y: this.h / 2 - (p.y - v.cy) * v.scale };
  }
  private toWorld(s: Vec, v = this.view): Vec {
    return { x: (s.x - this.w / 2) / v.scale + v.cx, y: (this.h / 2 - s.y) / v.scale + v.cy };
  }

  /** Rutnätssteg (mm) så att rutorna blir minst ~14 px. */
  private gridStep() {
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
    return steps.find(s => s * this.view.scale >= 14) ?? 1000;
  }

  // ---- Snäpp --------------------------------------------------------------------

  private snapAt(screen: Vec, touch: boolean, exclude?: string): Snap {
    const tol = touch ? 22 : 10;
    const sk = this.sketch;
    const w = this.toWorld(screen);
    // 1. Befintliga punkter och origo.
    let best: Snap | null = null;
    let bestD = tol;
    const consider = (id: string, p: Vec) => {
      if (id === exclude) return;
      const d = dist(this.toScreen(p), screen);
      if (d < bestD) {
        bestD = d;
        best = { x: p.x, y: p.y, pointId: id, kind: 'point' };
      }
    };
    consider(ORIGIN, { x: 0, y: 0 });
    for (const [id, p] of Object.entries(sk.points)) consider(id, p);
    if (best) return best;
    // Modellens hörn och hålcentrum (ny punkt på samma ställe, inget villkor).
    for (const p of this.reference?.snaps ?? []) {
      const d = dist(this.toScreen(p), screen);
      if (d < bestD) {
        bestD = d;
        best = { x: p.x, y: p.y, kind: 'ref' };
      }
    }
    if (best) return best;

    // 2. Mittpunkter på linjer (lite mindre radie så att ändpunkterna vinner).
    bestD = tol * 0.8;
    for (const [id, e] of Object.entries(sk.entities)) {
      if (e.type !== 'line' || e.p1 === exclude || e.p2 === exclude) continue;
      const m = { x: (sk.points[e.p1].x + sk.points[e.p2].x) / 2, y: (sk.points[e.p1].y + sk.points[e.p2].y) / 2 };
      const d = dist(this.toScreen(m), screen);
      if (d < bestD) {
        bestD = d;
        best = { ...m, entity: id, kind: 'mid' };
      }
    }
    if (best) return best;

    // 3. Kurvor: projicera på närmaste.
    const tolMm = (tol * 0.7) / this.view.scale;
    let bestC = tolMm;
    for (const [id, e] of Object.entries(sk.entities)) {
      if (entityPointIds(e).includes(exclude ?? '')) continue;
      let p: Vec | null = null;
      if (e.type === 'line') {
        const a = sk.points[e.p1], b = sk.points[e.p2];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = ((w.x - a.x) * dx + (w.y - a.y) * dy) / (dx * dx + dy * dy || 1);
        if (t > 0 && t < 1) p = { x: a.x + dx * t, y: a.y + dy * t };
      } else {
        const c = sk.points[e.c];
        const r = e.type === 'circle' ? e.r : dist(c, sk.points[e.p1]);
        const ang = angleOf(c, w);
        if (e.type === 'arc') {
          const g = arcGeom(sk, e);
          if (ccwSweep(g.a0, ang) > g.sweep) continue;
        }
        p = polar(c, r, ang);
      }
      if (!p) continue;
      const d = dist(p, w);
      if (d < bestC) {
        bestC = d;
        best = { ...p, entity: id, kind: 'curve' };
      }
    }
    if (best) return best;

    // Modellens kanter.
    for (const [a, b] of this.reference?.segments ?? []) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const p = { x: a.x + dx * t, y: a.y + dy * t };
      const d = dist(p, w);
      if (d < bestC) {
        bestC = d;
        best = { ...p, kind: 'refEdge' };
      }
    }
    if (best) return best;

    // 4. Rutnät.
    let x = w.x, y = w.y;
    let kind: Snap['kind'] = 'free';
    if (this.snapToGrid) {
      const g = this.gridStep();
      x = Math.round(x / g) * g;
      y = Math.round(y / g) * g;
      kind = 'grid';
    }
    // 5. Vågrätt/lodrätt från föregående punkt (linje).
    const from = this.tool === 'line' ? this.placed[this.placed.length - 1] : undefined;
    if (from) {
      const hTol = (touch ? 14 : 8) / this.view.scale;
      if (Math.abs(w.y - from.y) < hTol && Math.abs(w.x - from.x) > hTol) {
        y = from.y;
        kind = 'h';
      } else if (Math.abs(w.x - from.x) < hTol && Math.abs(w.y - from.y) > hTol) {
        x = from.x;
        kind = 'v';
      }
    }
    return { x, y, kind };
  }

  // ---- Skapa geometri -------------------------------------------------------------

  /** Punkt för ett snäpp: befintlig punkt, eller ny (med villkor om den fäst på en kurva/mittpunkt). */
  private pointFor(s: Snap): string {
    const sk = this.sketch;
    if (s.pointId) {
      if (s.pointId === ORIGIN && !sk.points[ORIGIN]) sk.points[ORIGIN] = { x: 0, y: 0 };
      if (sk.points[s.pointId]) return s.pointId;
    }
    const id = newId(sk, 'p');
    sk.points[id] = { x: s.x, y: s.y };
    if (s.entity && sk.entities[s.entity]) {
      if (s.kind === 'curve') sk.constraints.push({ id: newId(sk, 'c'), type: 'onCurve', p: id, e: s.entity });
      if (s.kind === 'mid') sk.constraints.push({ id: newId(sk, 'c'), type: 'midpoint', p: id, e: s.entity });
    }
    return id;
  }

  private addLine(a: string, b: string, c?: 'horizontal' | 'vertical') {
    const sk = this.sketch;
    const id = newId(sk, 'e');
    sk.entities[id] = { type: 'line', p1: a, p2: b };
    if (c) sk.constraints.push({ id: newId(sk, 'c'), type: c, e: id });
    return id;
  }

  /** Antal sidor för polygonverktyget. */
  polygonSides = 6;

  /**
   * Regelbunden polygon: hörn på en konstruktionscirkel och lika långa sidor – då går den att
   * måttsätta med cirkelns diameter (eller en sida) och vrida som en helhet.
   */
  private addPolygon(center: Snap, corner: Snap) {
    const sk = this.sketch;
    const n = Math.max(3, Math.min(32, Math.round(this.polygonSides)));
    const r = dist(center, corner);
    const a0 = angleOf(center, corner);
    const c = this.pointFor(center);
    const circ = newId(sk, 'e');
    sk.entities[circ] = { type: 'circle', c, r, construction: true };
    const pts = [this.pointFor(corner)];
    for (let i = 1; i < n; i++) pts.push(this.pointFor({ ...polar(center, r, a0 + (TAU * i) / n), kind: 'free' }));
    const lines = pts.map((p, i) => this.addLine(p, pts[(i + 1) % n]));
    for (const p of pts) sk.constraints.push({ id: newId(sk, 'c'), type: 'onCurve', p, e: circ, quiet: true });
    for (let i = 1; i < n; i++) sk.constraints.push({ id: newId(sk, 'c'), type: 'equal', e1: lines[0], e2: lines[i], quiet: true });
  }

  /**
   * Mittpunktsrektangel: vågräta/lodräta sidor och en diagonal (konstruktion) med centrum som
   * mittpunkt – då förblir den centrerad när sidorna måttsätts.
   */
  private addCenterRect(center: Snap, corner: Snap) {
    const sk = this.sketch;
    const o = { x: 2 * center.x - corner.x, y: 2 * center.y - corner.y };
    const c = this.pointFor(center);
    const p1 = this.pointFor({ ...o, kind: 'free' });
    const p2 = this.pointFor({ x: corner.x, y: o.y, kind: 'free' });
    const p3 = this.pointFor(corner);
    const p4 = this.pointFor({ x: o.x, y: corner.y, kind: 'free' });
    this.addLine(p1, p2, 'horizontal');
    this.addLine(p2, p3, 'vertical');
    this.addLine(p3, p4, 'horizontal');
    this.addLine(p4, p1, 'vertical');
    const diag = this.addLine(p1, p3);
    (sk.entities[diag] as { construction?: boolean }).construction = true;
    sk.constraints.push({ id: newId(sk, 'c'), type: 'midpoint', p: c, e: diag, quiet: true });
  }

  /** Avlångt hål: två halvcirkelbågar och två linjer, tangenta, lika radier, med en mittlinje (konstruktion). */
  private addSlot(a: Snap, b: Snap, r: number) {
    const sk = this.sketch;
    const L = dist(a, b);
    const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const n = { x: -d.y, y: d.x };
    const at = (p: Vec, k: number): Snap => ({ x: p.x + n.x * r * k, y: p.y + n.y * r * k, kind: 'free' });
    const ca = this.pointFor(a), cb = this.pointFor(b);
    const aL = this.pointFor(at(a, 1)), aR = this.pointFor(at(a, -1)), bL = this.pointFor(at(b, 1)), bR = this.pointFor(at(b, -1));
    // Bågarna går moturs: vid A från vänster till höger (bort från B), vid B tvärtom.
    const arcA = newId(sk, 'e');
    sk.entities[arcA] = { type: 'arc', c: ca, p1: aL, p2: aR };
    const arcB = newId(sk, 'e');
    sk.entities[arcB] = { type: 'arc', c: cb, p1: bR, p2: bL };
    const l1 = this.addLine(aR, bR), l2 = this.addLine(bL, aL);
    const axis = this.addLine(ca, cb);
    (sk.entities[axis] as { construction?: boolean }).construction = true;
    for (const [l, arc] of [[l1, arcA], [l1, arcB], [l2, arcA], [l2, arcB]]) sk.constraints.push({ id: newId(sk, 'c'), type: 'tangent', e1: l, e2: arc, quiet: true });
    sk.constraints.push({ id: newId(sk, 'c'), type: 'equal', e1: arcA, e2: arcB, quiet: true });
  }

  /** Placera en punkt i aktuellt verktyg. */
  private place(s: Snap) {
    const P = this.placed;
    const sk = this.sketch;
    const same = (a: Vec, b: Vec) => dist(a, b) < 1e-9;
    switch (this.tool) {
      case 'point': {
        if (s.pointId) {
          this.onMessage?.(t('msg.pointExists'), 'info');
          break;
        }
        this.transact(() => {
          const id = this.pointFor(s);
          sk.points[id].standalone = true;
        });
        break;
      }
      case 'line': {
        if (!P.length) {
          P.push(s);
          break;
        }
        const prev = P[P.length - 1];
        if (same(prev, s)) {
          if (P.length > 1) this.placed = []; // tryck på sista punkten igen → avsluta kedjan
          break;
        }
        let a = '', b = '';
        const ok = this.transact(() => {
          a = this.pointFor(prev);
          b = this.pointFor(s);
          this.addLine(a, b, s.kind === 'h' ? 'horizontal' : s.kind === 'v' ? 'vertical' : undefined);
        });
        if (!ok) break;
        P[P.length - 1] = { ...prev, ...sk.points[a], pointId: a, kind: 'point' };
        if (s.pointId) this.placed = []; // fäste i befintlig punkt → kedjan klar
        else P.push({ ...s, ...sk.points[b], pointId: b, kind: 'point' });
        break;
      }
      case 'rect': {
        if (!P.length) {
          P.push(s);
          break;
        }
        const a = P[0];
        if (Math.abs(a.x - s.x) < 1e-9 || Math.abs(a.y - s.y) < 1e-9) break;
        this.transact(() => {
          const p1 = this.pointFor(a);
          const p2 = this.pointFor({ x: s.x, y: a.y, kind: 'free' });
          const p3 = this.pointFor(s);
          const p4 = this.pointFor({ x: a.x, y: s.y, kind: 'free' });
          this.addLine(p1, p2, 'horizontal');
          this.addLine(p2, p3, 'vertical');
          this.addLine(p3, p4, 'horizontal');
          this.addLine(p4, p1, 'vertical');
        });
        this.placed = [];
        break;
      }
      case 'rectc': {
        if (!P.length) {
          P.push(s);
          break;
        }
        const c = P[0];
        if (Math.abs(c.x - s.x) < 1e-9 || Math.abs(c.y - s.y) < 1e-9) break;
        this.transact(() => this.addCenterRect(c, s));
        this.placed = [];
        break;
      }
      case 'circle': {
        if (!P.length) {
          P.push(s);
          break;
        }
        const r = dist(P[0], s);
        if (r < 1e-6) break;
        this.transact(() => {
          const c = this.pointFor(P[0]);
          sk.entities[newId(sk, 'e')] = { type: 'circle', c, r };
        });
        this.placed = [];
        break;
      }
      case 'polygon': {
        if (!P.length) {
          P.push(s);
          break;
        }
        if (dist(P[0], s) < 1e-6) break;
        this.transact(() => this.addPolygon(P[0], s));
        this.placed = [];
        break;
      }
      case 'slot': {
        if (P.length < 2) {
          if (P.length === 1 && same(P[0], s)) break;
          P.push(s);
          break;
        }
        const r = slotRadius(P[0], P[1], s);
        if (r < 1e-6) break;
        this.transact(() => this.addSlot(P[0], P[1], r));
        this.placed = [];
        break;
      }
      case 'arc3': {
        if (P.length < 2) {
          if (P.length === 1 && same(P[0], s)) break;
          P.push(s);
          break;
        }
        const arc = arcThrough(P[0], P[1], s);
        if (!arc) break;
        this.transact(() => {
          const a = this.pointFor(P[0]);
          const b = this.pointFor(P[1]);
          const c = this.pointFor({ ...arc.c, kind: 'free' });
          sk.entities[newId(sk, 'e')] = { type: 'arc', c, p1: arc.ccw ? a : b, p2: arc.ccw ? b : a };
        });
        this.placed = [];
        break;
      }
      case 'arcc': {
        if (P.length === 0) {
          P.push(s);
          break;
        }
        if (P.length === 1) {
          if (dist(P[0], s) < 1e-6) break;
          P.push(s);
          this.arcAccum = 0;
          this.arcLastAngle = angleOf(P[0], s);
          break;
        }
        this.trackArcSweep(s);
        const [cS, sS] = P;
        const r = dist(cS, sS);
        const endPos = polar(cS, r, angleOf(cS, s));
        if (dist(endPos, sS) < 1e-6) break;
        const ccw = this.arcAccum >= 0;
        this.transact(() => {
          const c = this.pointFor(cS);
          const a = this.pointFor(sS);
          const endSnap: Snap = s.pointId && Math.abs(dist(cS, s) - r) < 1e-6 ? s : { ...endPos, kind: 'free' };
          const b = this.pointFor(endSnap);
          sk.entities[newId(sk, 'e')] = { type: 'arc', c, p1: ccw ? a : b, p2: ccw ? b : a };
        });
        this.placed = [];
        break;
      }
    }
    this.changedState();
  }

  /** Mittpunktsbåge: följ hur användaren sveper runt centrum för att välja riktning. */
  private trackArcSweep(s: Vec) {
    if (this.tool !== 'arcc' || this.placed.length !== 2) return;
    const a = angleOf(this.placed[0], s);
    let d = a - this.arcLastAngle;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    this.arcAccum = Math.max(-TAU, Math.min(TAU, this.arcAccum + d));
    this.arcLastAngle = a;
  }

  // ---- Träffar (markering) ------------------------------------------------------------

  private hitTest(screen: Vec, touch: boolean): Hit | null {
    // En punkt rakt under fingret går före etiketter och symboler som råkar ligga ovanpå.
    const close = touch ? 10 : 5;
    for (const [id, p] of Object.entries(this.sketch.points))
      if (dist(this.toScreen(p), screen) < close) return { type: 'point', id };
    // Måttetiketter får lite marginal; villkorssymboler bara själva rutan (så att ett tryck på linjen väljer linjen).
    for (const h of [...this.hotspots].reverse()) {
      const pad = h.dim && touch ? 4 : 0;
      if (screen.x >= h.x - pad && screen.x <= h.x + h.w + pad && screen.y >= h.y - pad && screen.y <= h.y + h.h + pad)
        return { type: 'constraint', id: h.key.slice(2), dim: h.dim };
    }
    // Det närmaste vinner; punkter får 6 px försprång så att ändpunkter är lätta att ta.
    const tol = touch ? 22 : 10;
    let bestP: Hit | null = null;
    let dP = tol;
    for (const [id, p] of Object.entries(this.sketch.points)) {
      const d = dist(this.toScreen(p), screen);
      if (d < dP) {
        dP = d;
        bestP = { type: 'point', id };
      }
    }
    const w = this.toWorld(screen);
    let best: Hit | null = null;
    let bestE = tol / this.view.scale;
    for (const [id, e] of Object.entries(this.sketch.entities)) {
      let d: number;
      if (e.type === 'line') d = distToSegment(w, this.sketch.points[e.p1], this.sketch.points[e.p2]);
      else if (e.type === 'circle') d = Math.abs(dist(w, this.sketch.points[e.c]) - e.r);
      else {
        const g = arcGeom(this.sketch, e);
        d = distToArc(w, g.c, g.r, g.a0, g.sweep);
      }
      if (d < bestE) {
        bestE = d;
        best = { type: 'entity', id };
      }
    }
    if (bestP && (!best || dP <= bestE * this.view.scale + 6)) return bestP;
    return best;
  }

  // ---- Pekare --------------------------------------------------------------------------

  private bindInput() {
    const c = this.canvas;
    const pos = (e: PointerEvent): Vec => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const p = pos(e);
      this.pointers.set(e.pointerId, p);
      const touch = e.pointerType !== 'mouse';

      if (this.pointers.size === 2) {
        // Två fingrar: avbryt pågående tryck/drag och börja nypa.
        this.cancelDrag();
        const [a, b] = [...this.pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.gesture = { kind: 'pinch', d0: Math.max(dist(a, b), 1), s0: this.view.scale, world0: this.toWorld(mid) };
        this.cursor = null;
        this.fingerScreen = null;
        this.requestDraw();
        return;
      }
      if (this.pointers.size > 2) return;

      if (e.pointerType === 'mouse' && e.button !== 0) {
        this.gesture = { kind: 'pan', last: p };
        return;
      }
      if (this.tool === 'select') {
        this.gesture = { kind: 'select-press', down: p, moved: false, touch, hit: this.hitTest(p, touch), dragging: false, last: p };
      } else {
        const s = this.snapAt(p, touch);
        this.gesture = { kind: 'press', down: p, downSnap: s, moved: false, touch, startedDrag: false };
        this.cursor = s;
        this.trackArcSweep(s);
        if (touch) this.fingerScreen = p;
      }
      this.requestDraw();
    });

    c.addEventListener('pointermove', e => {
      const p = pos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      const g = this.gesture;
      const touch = e.pointerType !== 'mouse';

      if (g.kind === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.view.scale = clamp((g.s0 * dist(a, b)) / g.d0, 0.05, 2000);
        // Håll världspunkten under fingrarnas mittpunkt.
        const w = this.toWorld(mid);
        this.view.cx += g.world0.x - w.x;
        this.view.cy += g.world0.y - w.y;
        this.requestDraw();
        return;
      }
      if (g.kind === 'pan') {
        this.view.cx -= (p.x - g.last.x) / this.view.scale;
        this.view.cy += (p.y - g.last.y) / this.view.scale;
        g.last = p;
        this.requestDraw();
        return;
      }
      if (g.kind === 'press') {
        if (!g.moved && dist(p, g.down) > (g.touch ? 10 : 4)) g.moved = true;
        // Dra från första punkten: placera den direkt när draget börjar.
        if (g.moved && !g.startedDrag && this.placed.length === 0) {
          g.startedDrag = true;
          this.place(g.downSnap);
        }
        this.cursor = this.snapAt(p, g.touch);
        this.trackArcSweep(this.cursor);
        if (g.touch) this.fingerScreen = p;
        this.requestDraw();
        return;
      }
      if (g.kind === 'select-press') {
        if (!g.moved && dist(p, g.down) > (g.touch ? 10 : 4)) {
          g.moved = true;
          if (g.hit && g.hit.type !== 'constraint' && !(g.hit.type === 'point' && g.hit.id === ORIGIN)) {
            g.dragging = true;
            this.startDrag(g.hit, g.down);
          }
        }
        if (!g.moved) return;
        if (g.dragging) this.dragTo(p, g.touch);
        else {
          this.view.cx -= (p.x - g.last.x) / this.view.scale;
          this.view.cy += (p.y - g.last.y) / this.view.scale;
        }
        g.last = p;
        if (g.touch && g.dragging) this.fingerScreen = p;
        this.requestDraw();
        return;
      }
      // Mus utan knapp: förhandsvisa.
      if (!touch && g.kind === 'none' && this.tool !== 'select') {
        this.cursor = this.snapAt(p, false);
        this.trackArcSweep(this.cursor);
        this.requestDraw();
      }
    });

    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId) ?? pos(e);
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      const cancelled = e.type === 'pointercancel';
      if (g.kind === 'pinch' || g.kind === 'ignore') {
        this.gesture = this.pointers.size ? { kind: 'ignore' } : { kind: 'none' };
        return;
      }
      this.gesture = { kind: 'none' };
      this.fingerScreen = null;
      if (g.kind === 'press' && !cancelled) {
        const s = this.snapAt(p, g.touch);
        this.trackArcSweep(s);
        this.place(s);
        this.cursor = g.touch ? null : s;
      } else if (g.kind === 'select-press') {
        if (g.dragging) {
          if (cancelled) this.cancelDrag();
          else this.finishDrag(p, g.touch);
        } else if (!g.moved && !cancelled) this.tapSelect(g.hit ?? this.useReferenceEdge(g.down, g.touch));
      }
      this.requestDraw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && this.gesture.kind === 'none') {
        this.cursor = null;
        this.requestDraw();
      }
    });

    c.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const p = { x: e.clientX - r.left, y: e.clientY - r.top };
        const before = this.toWorld(p);
        this.view.scale = clamp(this.view.scale * Math.exp(-e.deltaY * 0.0015), 0.05, 2000);
        const after = this.toWorld(p);
        this.view.cx += before.x - after.x;
        this.view.cy += before.y - after.y;
        this.requestDraw();
      },
      { passive: false },
    );
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  /**
   * Tryck på modellens kant (skissa på en yta): lägg in kanten som låst konstruktionslinje så att
   * den går att måttsätta mot. Hörnen delas med redan inlagda kanter.
   */
  private useReferenceEdge(screen: Vec, touch: boolean): Hit | null {
    const segs = this.reference?.segments;
    if (!segs?.length) return null;
    const w = this.toWorld(screen);
    let best: [Vec, Vec] | null = null;
    let bestD = (touch ? 14 : 8) / this.view.scale; // snävt: ett tryck bredvid ska fortfarande avmarkera
    for (const s of segs) {
      const d = distToSegment(w, s[0], s[1]);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return null;
    const sk = this.sketch;
    const fixedAt = (q: Vec) => {
      for (const [id, p] of Object.entries(sk.points))
        if (dist(p, q) < 1e-6 && sk.constraints.some(c => c.type === 'fix' && c.p === id)) return id;
      const id = newId(sk, 'p');
      sk.points[id] = { x: q.x, y: q.y };
      sk.constraints.push({ id: newId(sk, 'c'), type: 'fix', p: id, quiet: true });
      return id;
    };
    let e = '';
    const [a, b] = best;
    const ok = this.transact(() => {
      const p1 = fixedAt(a), p2 = fixedAt(b);
      e = this.addLine(p1, p2);
      (sk.entities[e] as { construction?: boolean }).construction = true;
    });
    if (!ok) return null;
    this.onMessage?.(t('msg.referenceEdge'), 'info');
    return { type: 'entity', id: e };
  }

  private tapSelect(hit: Hit | null) {
    if (!hit) this.selection.clear();
    else {
      const key = `${hit.type === 'point' ? 'p' : hit.type === 'entity' ? 'e' : 'c'}:${hit.id}`;
      // Ett mått öppnas direkt för redigering.
      if (hit.type === 'constraint' && hit.dim) {
        this.selection.clear();
        this.changedState();
        this.onEditDimension?.(hit.id, true);
        return;
      }
      if (this.selection.has(key)) this.selection.delete(key);
      else this.selection.add(key);
    }
    this.changedState();
  }

  // ---- Dra geometri ----------------------------------------------------------------------

  private startDrag(hit: Hit, downScreen: Vec) {
    const sk = this.sketch;
    const ids = hit.type === 'point' ? [hit.id] : hit.type === 'entity' ? entityPointIds(sk.entities[hit.id]) : [];
    const startPts = new Map(ids.filter(id => sk.points[id]).map(id => [id, { ...sk.points[id] }]));
    this.drag = { hit, before: JSON.stringify(sk), startPts, startWorld: this.toWorld(downScreen) };
  }

  private dragTo(now: Vec, touch: boolean) {
    const d = this.drag;
    if (!d) return;
    const sk = this.sketch;
    const w = this.toWorld(now);
    const delta = { x: w.x - d.startWorld.x, y: w.y - d.startWorld.y };
    let target: { points?: { id: string; x: number; y: number }[]; radius?: { e: string; r: number } };
    if (d.hit.type === 'point') {
      const s = this.snapAt(now, touch, d.hit.id);
      this.cursor = s;
      target = { points: [{ id: d.hit.id, x: s.x, y: s.y }] };
    } else {
      const e = sk.entities[d.hit.id];
      if (e?.type === 'circle') target = { radius: { e: d.hit.id, r: Math.max(1e-3, dist(sk.points[e.c], w)) } };
      else target = { points: [...d.startPts].filter(([id]) => id !== ORIGIN).map(([id, p]) => ({ id, x: p.x + delta.x, y: p.y + delta.y })) };
    }
    if (this.solver) {
      this.solver.solve(sk, target); // misslyckas det står geometrin kvar
    } else {
      for (const t of target.points ?? []) Object.assign(sk.points[t.id], { x: t.x, y: t.y });
      if (target.radius) {
        const e = sk.entities[target.radius.e];
        if (e.type === 'circle') e.r = target.radius.r;
      }
      fixArcs(sk);
    }
    this.recompute();
  }

  private finishDrag(p: Vec, touch: boolean) {
    const d = this.drag;
    this.drag = null;
    this.cursor = null;
    if (!d) return;
    const sk = this.sketch;
    // Släppt på en punkt: slå ihop. Släppt på en kurva: lägg punkten på kurvan.
    this.transact(
      () => {
        if (d.hit.type !== 'point') return;
        const s = this.snapAt(p, touch, d.hit.id);
        if (s.pointId) {
          if (s.pointId === ORIGIN && !sk.points[ORIGIN]) sk.points[ORIGIN] = { x: 0, y: 0 };
          mergePoints(sk, d.hit.id, s.pointId);
          this.selection.delete(`p:${d.hit.id}`);
        } else if (s.kind === 'curve' && s.entity) sk.constraints.push({ id: newId(sk, 'c'), type: 'onCurve', p: d.hit.id, e: s.entity });
        else if (s.kind === 'mid' && s.entity) sk.constraints.push({ id: newId(sk, 'c'), type: 'midpoint', p: d.hit.id, e: s.entity });
      },
      { before: d.before },
    );
  }

  private cancelDrag() {
    if (!this.drag) return;
    Object.assign(this.sketch, JSON.parse(this.drag.before));
    this.drag = null;
    this.cursor = null;
    this.recompute();
  }

  // ---- Rita ----------------------------------------------------------------------------

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const first = this.w === 0;
    this.w = r.width;
    this.h = r.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (first) this.fit();
    this.requestDraw();
  }

  requestDraw() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => {
      this.dirty = false;
      this.draw();
    });
  }

  private draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.C.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    this.hotspots = this.drawScene(ctx, this.view, true);
    this.drawOverlay(ctx);
    if (this.fingerScreen && (this.cursor || this.gesture.kind === 'select-press')) this.drawLoupe(ctx);
  }

  private isFree(kind: 'p' | 'e', id: string): boolean {
    if (!this.free) return true; // utan lösare vet vi inte
    if (kind === 'p') return this.free.points.has(id);
    const e = this.sketch.entities[id];
    if (!e) return false;
    if (e.type === 'circle' && this.free.radii.has(id)) return true;
    return entityPointIds(e).some(p => this.free!.points.has(p));
  }

  /** Rita rutnät, regioner, kurvor, villkor och förhandsvisning med vyn `v`. */
  private drawScene(ctx: CanvasRenderingContext2D, v: View, annotations: boolean): Hotspot[] {
    const S = (p: Vec) => this.toScreen(p, v);
    const sk = this.sketch;

    // Rutnät (samma steg som snäppet, även i förstoringsglaset)
    const g = this.gridStep();
    const tl = this.toWorld({ x: 0, y: 0 }, v), br = this.toWorld({ x: this.w, y: this.h }, v);
    const lines = (step: number, color: string) => {
      ctx.beginPath();
      for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
        const sx = Math.round(S({ x, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, this.h);
      }
      for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
        const sy = Math.round(S({ x: 0, y }).y) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(this.w, sy);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    lines(g, this.C.gridMinor);
    lines(g * 5, this.C.gridMajor);
    const o = S({ x: 0, y: 0 });
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.C.axisX;
    ctx.beginPath();
    ctx.moveTo(0, o.y);
    ctx.lineTo(this.w, o.y);
    ctx.stroke();
    ctx.strokeStyle = this.C.axisY;
    ctx.beginPath();
    ctx.moveTo(o.x, 0);
    ctx.lineTo(o.x, this.h);
    ctx.stroke();

    // Modellens kanter i planet (skissa på en yta).
    if (this.reference?.segments.length) {
      ctx.beginPath();
      for (const [a, b] of this.reference.segments) {
        const p = S(a), q = S(b);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.strokeStyle = this.C.reference;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.stroke();
    }

    // Regioner (material) fylls; hål lämnas tomma.
    ctx.fillStyle = this.C.region;
    this.loops.forEach((l, i) => {
      if (l.depth % 2) return;
      const path = new Path2D();
      for (const loop of [l, ...this.loops.filter(h => h.parent === i)]) {
        loop.pts.forEach((p, k) => {
          const s = S(p);
          if (k) path.lineTo(s.x, s.y);
          else path.moveTo(s.x, s.y);
        });
        path.closePath();
      }
      ctx.fill(path, 'evenodd');
    });

    // Kurvor: blå = kan röra sig, svart = fullt bestämd.
    for (const [id, e] of Object.entries(sk.entities)) {
      const sel = this.selection.has(`e:${id}`);
      ctx.strokeStyle = sel ? this.C.selected : e.construction ? this.C.construction : this.isFree('e', id) ? this.C.free : this.C.defined;
      ctx.lineWidth = sel ? 3 : 2;
      ctx.setLineDash(e.construction ? [6, 4] : []);
      ctx.beginPath();
      if (e.type === 'line') {
        const a = S(sk.points[e.p1]), b = S(sk.points[e.p2]);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else if (e.type === 'circle') {
        const c = S(sk.points[e.c]);
        ctx.arc(c.x, c.y, e.r * v.scale, 0, TAU);
      } else {
        const ag = arcGeom(sk, e);
        const c = S(ag.c);
        // Skärmens y är nedåt: moturs i världen = medurs på skärmen.
        ctx.arc(c.x, c.y, ag.r * v.scale, -ag.a0, -(ag.a0 + ag.sweep), true);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Punkter
    for (const [id, p] of Object.entries(sk.points)) {
      const s = S(p);
      const sel = this.selection.has(`p:${id}`);
      ctx.fillStyle = sel ? this.C.selected : id === ORIGIN || !this.isFree('p', id) ? this.C.defined : this.C.free;
      ctx.beginPath();
      ctx.arc(s.x, s.y, sel ? 5 : 3, 0, TAU);
      ctx.fill();
      if (p.standalone) {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6.5, 0, TAU);
        ctx.stroke();
      }
      // Öppen ände (rött): kurvan hänger inte ihop med något i den änden.
      if (this.degrees.get(id) === 1) {
        ctx.strokeStyle = this.C.open;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, TAU);
        ctx.stroke();
      }
    }
    // Origo
    ctx.strokeStyle = this.C.defined;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 5, 0, TAU);
    ctx.stroke();

    // Mått och villkorssymboler
    const spots: Hotspot[] = [];
    if (annotations) {
      const colorFor = (key: string) => (this.flash.has(key) ? this.C.conflict : this.selection.has(key) ? this.C.selected : this.C.dim);
      for (const c of sk.constraints) {
        if (!isDimension(c)) continue;
        const key = `c:${c.id}`;
        const h = drawDimension(ctx, sk, c, S, colorFor(key), this.C.label);
        if (h) spots.push(h);
      }
      // Verktygens egna villkor (polygon, slits) visas bara när något av formen är markerat.
      const visible = (c: Constraint) => {
        if (!c.quiet || this.selection.has(`c:${c.id}`)) return true;
        const r = constraintRefs(c);
        return r.entities.some(e => this.selection.has(`e:${e}`)) || r.points.some(p => this.selection.has(`p:${p}`));
      };
      if (this.showConstraints) spots.push(...drawGlyphs(ctx, sk, S, colorFor, this.C.label, visible));
    }

    this.drawPreview(ctx, v);
    return spots;
  }

  private drawPreview(ctx: CanvasRenderingContext2D, v: View) {
    const S = (p: Vec) => this.toScreen(p, v);
    const P = this.placed;
    const cur = this.cursor;
    ctx.strokeStyle = this.C.preview;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (cur && P.length) {
      const a = P[0];
      switch (this.tool) {
        case 'line': {
          const last = S(P[P.length - 1]), b = S(cur);
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(b.x, b.y);
          break;
        }
        case 'rect': {
          const p = S(a), q = S(cur);
          ctx.rect(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y));
          break;
        }
        case 'rectc': {
          const p = S({ x: 2 * a.x - cur.x, y: 2 * a.y - cur.y }), q = S(cur), m = S(a);
          ctx.rect(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y));
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.moveTo(m.x + 4, m.y);
          ctx.arc(m.x, m.y, 4, 0, TAU);
          break;
        }
        case 'circle': {
          const c = S(a);
          ctx.arc(c.x, c.y, dist(a, cur) * v.scale, 0, TAU);
          break;
        }
        case 'polygon': {
          const r = dist(a, cur), a0 = angleOf(a, cur), n = Math.max(3, Math.round(this.polygonSides));
          for (let i = 0; i <= n; i++) {
            const q = S(polar(a, r, a0 + (TAU * i) / n));
            if (i) ctx.lineTo(q.x, q.y);
            else ctx.moveTo(q.x, q.y);
          }
          break;
        }
        case 'slot': {
          if (P.length === 1) {
            const p = S(a), q = S(cur);
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
          } else {
            const b = P[1];
            const r = slotRadius(a, b, cur) * v.scale;
            const p = S(a), q = S(b);
            const ang = Math.atan2(-(q.y - p.y), q.x - p.x); // skärmens y är nedåt
            // Moturs i skissen = medurs på skärmen: halvcirkel runt A bort från B och runt B bort från A.
            ctx.arc(p.x, p.y, r, -ang - Math.PI / 2, -ang + Math.PI / 2, true);
            ctx.arc(q.x, q.y, r, -ang + Math.PI / 2, -ang - Math.PI / 2, true);
            ctx.closePath();
          }
          break;
        }
        case 'arc3': {
          if (P.length === 1) {
            const p = S(a), q = S(cur);
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
          } else {
            const arc = arcThrough(P[0], P[1], cur);
            if (arc) {
              const c = S(arc.c);
              const from = arc.ccw ? P[0] : P[1], to = arc.ccw ? P[1] : P[0];
              const a0 = angleOf(arc.c, from);
              ctx.arc(c.x, c.y, arc.r * v.scale, -a0, -(a0 + ccwSweep(a0, angleOf(arc.c, to))), true);
            } else {
              const p = S(P[0]), q = S(P[1]);
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
            }
          }
          break;
        }
        case 'arcc': {
          const c = S(a);
          if (P.length === 1) {
            ctx.moveTo(c.x, c.y);
            const q = S(cur);
            ctx.lineTo(q.x, q.y);
          } else {
            const r = dist(a, P[1]);
            const a0 = angleOf(a, P[1]);
            const a1 = angleOf(a, cur);
            const ccw = this.arcAccum >= 0;
            const from = ccw ? a0 : a1;
            const sweep = ccwSweep(from, ccw ? a1 : a0);
            ctx.arc(c.x, c.y, r * v.scale, -from, -(from + sweep), true);
          }
          break;
        }
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Placerade punkter i pågående operation
    for (const p of P) {
      const s = S(p);
      ctx.fillStyle = this.C.preview;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, TAU);
      ctx.fill();
    }
    // Snäppmarkör
    if (cur) {
      const s = S(cur);
      ctx.strokeStyle = this.C.snap;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (cur.kind === 'point') ctx.arc(s.x, s.y, 8, 0, TAU);
      else if (cur.kind === 'mid') {
        ctx.moveTo(s.x, s.y - 8);
        ctx.lineTo(s.x + 8, s.y + 6);
        ctx.lineTo(s.x - 8, s.y + 6);
        ctx.closePath();
      } else if (cur.kind === 'curve') ctx.rect(s.x - 6, s.y - 6, 12, 12);
      else {
        ctx.moveTo(s.x - 7, s.y);
        ctx.lineTo(s.x + 7, s.y);
        ctx.moveTo(s.x, s.y - 7);
        ctx.lineTo(s.x, s.y + 7);
      }
      ctx.stroke();
    }
  }

  /** Mått och snäpptyp vid markören. */
  private drawOverlay(ctx: CanvasRenderingContext2D) {
    const cur = this.cursor;
    if (!cur) return;
    const P = this.placed;
    let text = '';
    if (P.length && this.tool !== 'select') {
      const a = P[0], last = P[P.length - 1];
      if (this.tool === 'line') {
        const ang = (Math.atan2(cur.y - last.y, cur.x - last.x) * 180) / Math.PI;
        text = `L ${fmtNum(dist(last, cur))} · ${fmtNum(ang, 1)}°`;
      } else if (this.tool === 'rect') text = `${fmtNum(Math.abs(cur.x - a.x))} × ${fmtNum(Math.abs(cur.y - a.y))}`;
      else if (this.tool === 'rectc') text = `${fmtNum(2 * Math.abs(cur.x - a.x))} × ${fmtNum(2 * Math.abs(cur.y - a.y))}`;
      else if (this.tool === 'circle') text = `R ${fmtNum(dist(a, cur))} · Ø ${fmtNum(2 * dist(a, cur))}`;
      else if (this.tool === 'arc3' && P.length === 2) {
        const arc = arcThrough(P[0], P[1], cur);
        text = arc ? `R ${fmtNum(arc.r)}` : '';
      } else if (this.tool === 'arcc') text = `R ${fmtNum(dist(a, P[1] ?? cur))}`;
      else text = `L ${fmtNum(dist(last, cur))}`;
    } else text = `${fmtNum(cur.x)}, ${fmtNum(cur.y)}`;
    if (cur.kind === 'h') text += ` · ${t('snap.horizontal')}`;
    if (cur.kind === 'v') text += ` · ${t('snap.vertical')}`;
    if (cur.kind === 'mid') text += ` · ${t('snap.midpoint')}`;
    if (cur.kind === 'curve') text += ` · ${t('snap.onCurve')}`;
    if (cur.kind === 'ref' || cur.kind === 'refEdge') text += ` · ${t('snap.model')}`;
    const s = this.toScreen(cur);
    // Med finger: lägg texten under förstoringsglaset (fingret skymmer annars).
    let x = s.x + 14, y = s.y + 26;
    if (this.fingerScreen) {
      x = this.fingerScreen.x - 60;
      y = this.loupeCenter().y + 78;
    }
    ctx.font = '600 13px system-ui, sans-serif';
    const wText = ctx.measureText(text).width;
    x = clamp(x, 6, this.w - wText - 14);
    y = clamp(y, 18, this.h - 8);
    ctx.fillStyle = this.C.label;
    ctx.strokeStyle = this.C.labelLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 6, y - 15, wText + 12, 21, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.C.defined;
    ctx.fillText(text, x, y);
  }

  private loupeCenter(): Vec {
    const f = this.fingerScreen!;
    const R = 62;
    // Ovanför fingret; om det inte får plats, till vänster/höger.
    let x = f.x, y = f.y - 115;
    if (y - R < 4) {
      y = clamp(f.y, R + 4, this.h - R - 4);
      x = f.x > this.w / 2 ? f.x - 120 : f.x + 120;
    }
    return { x: clamp(x, R + 4, this.w - R - 4), y };
  }

  private drawLoupe(ctx: CanvasRenderingContext2D) {
    const R = 62, Z = 3;
    const c = this.loupeCenter();
    const target = this.cursor ?? this.toWorld(this.fingerScreen!);
    // Vy där målpunkten hamnar mitt i glaset.
    const v: View = { scale: this.view.scale * Z, cx: 0, cy: 0 };
    v.cx = target.x - (c.x - this.w / 2) / v.scale;
    v.cy = target.y + (c.y - this.h / 2) / v.scale;
    ctx.save();
    ctx.shadowColor = 'rgba(20,30,40,.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = this.C.bg;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = this.C.bg;
    ctx.fillRect(c.x - R, c.y - R, 2 * R, 2 * R);
    this.drawScene(ctx, v, false);
    ctx.restore();
    ctx.strokeStyle = this.C.loupeRing;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, TAU);
    ctx.stroke();
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
