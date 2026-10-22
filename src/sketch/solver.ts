// Villkorslösare: skissen → planegcs (FreeCADs lösare, WASM) → tillbaka till skissen.
//
// Id i lösaren: punkter "p_<id>", entiteter "e_<id>", villkor "c_<id>", hjälpobjekt "x_…".

import { DebugMode, GcsWrapper, SolveStatus, make_gcs_wrapper } from '@salusoft89/planegcs';
import type { SketchPrimitive } from '@salusoft89/planegcs/dist/sketch/sketch_primitive';
import { angleOf, ccwSweep, dist, TAU } from './geom';
import { ORIGIN, type Constraint, type Entity, type SketchData } from './model';

export interface SolveResult {
  ok: boolean;
  dof: number;
  /** Villkor (våra id) som krockar, om lösningen misslyckades. */
  conflicting: string[];
  redundant: string[];
}

/** Dra punkter mot mål (mm) och/eller en cirkel/båge mot en radie. */
export interface Drag {
  points?: { id: string; x: number; y: number }[];
  radius?: { e: string; r: number };
}

const P = (id: string) => `p_${id}`;
const E = (id: string) => `e_${id}`;
const C = (id: string) => `c_${id}`;
const unC = (ids: string[]) => ids.filter(i => i.startsWith('c_')).map(i => i.slice(2));
const OK = (st: number) => st === SolveStatus.Success || st === SolveStatus.Converged;

export class SketchSolver {
  constructor(private g: GcsWrapper) {
    g.debug_mode = DebugMode.NoDebug;
  }

  /** Geometri + villkor som planegcs-primitiver (punkter först: referenser måste peka bakåt). */
  private primitives(sk: SketchData): SketchPrimitive[] {
    const fixed = new Set([ORIGIN, ...sk.constraints.filter(c => c.type === 'fix').map(c => (c as { p: string }).p)]);
    const out: SketchPrimitive[] = [];
    for (const [id, p] of Object.entries(sk.points)) out.push({ id: P(id), type: 'point', x: p.x, y: p.y, fixed: fixed.has(id) });
    for (const [id, e] of Object.entries(sk.entities)) {
      if (e.type === 'line') out.push({ id: E(id), type: 'line', p1_id: P(e.p1), p2_id: P(e.p2) });
      else if (e.type === 'circle') out.push({ id: E(id), type: 'circle', c_id: P(e.c), radius: e.r });
      else {
        const c = sk.points[e.c], p1 = sk.points[e.p1], p2 = sk.points[e.p2];
        const a0 = angleOf(c, p1);
        out.push({
          id: E(id), type: 'arc', c_id: P(e.c), radius: dist(c, p1),
          start_angle: a0, end_angle: a0 + ccwSweep(a0, angleOf(c, p2)), start_id: P(e.p1), end_id: P(e.p2),
        });
        out.push({ id: `x_rules_${id}`, type: 'arc_rules', a_id: E(id) });
      }
    }
    for (const c of sk.constraints) out.push(...this.constraint(sk, c));
    return out;
  }

  private constraint(sk: SketchData, c: Constraint): SketchPrimitive[] {
    const id = C(c.id);
    const ent = (eid: string): Entity | undefined => sk.entities[eid];
    const kind = (eid: string) => ent(eid)?.type;
    switch (c.type) {
      case 'horizontal':
      case 'vertical':
        return kind(c.e) === 'line' ? [{ id, type: c.type === 'horizontal' ? 'horizontal_l' : 'vertical_l', l_id: E(c.e) }] : [];
      case 'hpoints':
      case 'vpoints':
        return [{ id, type: c.type === 'hpoints' ? 'horizontal_pp' : 'vertical_pp', p1_id: P(c.p1), p2_id: P(c.p2) }];
      case 'parallel':
        return [{ id, type: 'parallel', l1_id: E(c.e1), l2_id: E(c.e2) }];
      case 'perpendicular':
        return [{ id, type: 'perpendicular_ll', l1_id: E(c.e1), l2_id: E(c.e2) }];
      case 'equal': {
        const [k1, k2] = [kind(c.e1), kind(c.e2)];
        if (k1 === 'line' && k2 === 'line') return [{ id, type: 'equal_length', l1_id: E(c.e1), l2_id: E(c.e2) }];
        if (k1 === 'circle' && k2 === 'circle') return [{ id, type: 'equal_radius_cc', c1_id: E(c.e1), c2_id: E(c.e2) }];
        if (k1 === 'arc' && k2 === 'arc') return [{ id, type: 'equal_radius_aa', a1_id: E(c.e1), a2_id: E(c.e2) }];
        if (k1 === 'circle' && k2 === 'arc') return [{ id, type: 'equal_radius_ca', c1_id: E(c.e1), a2_id: E(c.e2) }];
        if (k1 === 'arc' && k2 === 'circle') return [{ id, type: 'equal_radius_ca', c1_id: E(c.e2), a2_id: E(c.e1) }];
        return [];
      }
      case 'tangent': {
        let [a, b] = [c.e1, c.e2];
        const order = { line: 0, circle: 1, arc: 2 } as const;
        if (order[kind(a)!] > order[kind(b)!]) [a, b] = [b, a];
        const pair = `${kind(a)}-${kind(b)}`;
        // Tangens i en gemensam ändpunkt (som i FreeCAD): radien till punkten vinkelrät mot linjen,
        // resp. punkten på linjen genom båda centrumen. Avståndsformen (tangent_la) har en dubbelrot
        // just där, och då räknar planegcs fel antal frihetsgrader.
        const ea = ent(a), eb = ent(b);
        if (c.type === 'tangent' && ea && eb) {
          const ends = (e: Entity) => (e.type === 'circle' ? [] : [e.p1, e.p2]);
          const shared = ends(ea).find(q => ends(eb).includes(q));
          if (shared && ea.type === 'line' && eb.type === 'arc') {
            const other = ea.p1 === shared ? ea.p2 : ea.p1;
            return [{ id, type: 'perpendicular_pppp', l1p1_id: P(eb.c), l1p2_id: P(shared), l2p1_id: P(shared), l2p2_id: P(other) }];
          }
          if (shared && ea.type === 'arc' && eb.type === 'arc' && ea.c !== eb.c)
            return [{ id, type: 'point_on_line_ppp', p_id: P(shared), lp1_id: P(ea.c), lp2_id: P(eb.c) }];
        }
        if (pair === 'line-circle') return [{ id, type: 'tangent_lc', l_id: E(a), c_id: E(b) }];
        if (pair === 'line-arc') return [{ id, type: 'tangent_la', l_id: E(a), a_id: E(b) }];
        if (pair === 'circle-circle') return [{ id, type: 'tangent_cc', c1_id: E(a), c2_id: E(b) }];
        if (pair === 'circle-arc') return [{ id, type: 'tangent_ca', c_id: E(a), a_id: E(b) }];
        if (pair === 'arc-arc') return [{ id, type: 'tangent_aa', a1_id: E(a), a2_id: E(b) }];
        return [];
      }
      case 'concentric': {
        const a = ent(c.e1), b = ent(c.e2);
        if (!a || !b || a.type === 'line' || b.type === 'line') return [];
        return [{ id, type: 'p2p_coincident', p1_id: P(a.c), p2_id: P(b.c) }];
      }
      case 'onCurve': {
        const k = kind(c.e);
        if (k === 'line') return [{ id, type: 'point_on_line_pl', p_id: P(c.p), l_id: E(c.e) }];
        if (k === 'circle') return [{ id, type: 'point_on_circle', p_id: P(c.p), c_id: E(c.e) }];
        if (k === 'arc') return [{ id, type: 'point_on_arc', p_id: P(c.p), a_id: E(c.e) }];
        return [];
      }
      case 'midpoint': {
        const l = ent(c.e);
        return l?.type === 'line' ? [{ id, type: 'p2p_symmetric_ppp', p1_id: P(l.p1), p2_id: P(l.p2), p_id: P(c.p) }] : [];
      }
      case 'fix':
        return []; // punkten markeras som fixerad i primitives()
      case 'distance':
        if (c.dir === 'aligned') return [{ id, type: 'p2p_distance', p1_id: P(c.p1), p2_id: P(c.p2), distance: c.value }];
        // planegcs: difference = param2 − param1, alltså p2 − p1 = sign·value.
        return [{
          id, type: 'difference',
          param1: { o_id: P(c.p1), prop: c.dir === 'h' ? 'x' : 'y' },
          param2: { o_id: P(c.p2), prop: c.dir === 'h' ? 'x' : 'y' },
          difference: (c.sign ?? 1) * c.value,
        }];
      case 'pldistance':
        return [{ id, type: 'p2l_distance', p_id: P(c.p), l_id: E(c.e), distance: c.value }];
      case 'ccdistance':
        return kind(c.e1) !== 'line' && kind(c.e2) !== 'line' ? [{ id, type: 'c2cdistance', c1_id: E(c.e1), c2_id: E(c.e2), dist: c.value }] : [];
      case 'cldistance':
        return kind(c.e) !== 'line' && kind(c.l) === 'line' ? [{ id, type: 'c2ldistance', c_id: E(c.e), l_id: E(c.l), dist: c.value }] : [];
      case 'pcdistance':
        return kind(c.e) === 'circle' || kind(c.e) === 'arc' ? [{ id, type: 'p2cdistance', p_id: P(c.p), c_id: E(c.e), distance: c.value }] : [];
      case 'radius':
      case 'diameter': {
        const k = kind(c.e);
        const v = c.value;
        if (k === 'circle') return [c.type === 'radius' ? { id, type: 'circle_radius', c_id: E(c.e), radius: v } : { id, type: 'circle_diameter', c_id: E(c.e), diameter: v }];
        if (k === 'arc') return [c.type === 'radius' ? { id, type: 'arc_radius', a_id: E(c.e), radius: v } : { id, type: 'arc_diameter', a_id: E(c.e), diameter: v }];
        return [];
      }
      case 'xangle': {
        const l = ent(c.e);
        return l?.type === 'line' ? [{ id, type: 'p2p_angle', p1_id: P(l.p1), p2_id: P(l.p2), angle: (c.value * Math.PI) / 180 }] : [];
      }
      case 'angle':
        return [{ id, type: 'l2l_angle_ll', l1_id: E(c.e1), l2_id: E(c.e2), angle: (c.value * Math.PI) / 180 }];
    }
  }

  private dragPrims(sk: SketchData, drag: Drag): SketchPrimitive[] {
    const out: SketchPrimitive[] = [];
    for (const d of drag.points ?? []) {
      out.push({ id: `x_t_${d.id}`, type: 'point', x: d.x, y: d.y, fixed: true });
      out.push({ id: `x_d_${d.id}`, type: 'p2p_coincident', p1_id: P(d.id), p2_id: `x_t_${d.id}`, temporary: true });
    }
    if (drag.radius) {
      const k = sk.entities[drag.radius.e]?.type;
      if (k === 'circle') out.push({ id: 'x_r', type: 'circle_radius', c_id: E(drag.radius.e), radius: drag.radius.r, temporary: true });
      if (k === 'arc') out.push({ id: 'x_r', type: 'arc_radius', a_id: E(drag.radius.e), radius: drag.radius.r, temporary: true });
    }
    return out;
  }

  private run(prims: SketchPrimitive[]) {
    this.g.clear_data();
    this.g.push_primitives_and_params(prims);
    const st = this.g.solve();
    this.g.apply_solution();
    return st;
  }

  /** Läs tillbaka punkter och radier från lösaren till skissen. */
  private writeBack(sk: SketchData) {
    for (const p of this.g.sketch_index.get_primitives()) {
      if (p.type === 'point' && p.id.startsWith('p_')) {
        const pt = sk.points[p.id.slice(2)];
        if (pt) {
          pt.x = p.x;
          pt.y = p.y;
        }
      } else if (p.type === 'circle' && p.id.startsWith('e_')) {
        const e = sk.entities[p.id.slice(2)];
        if (e?.type === 'circle') e.r = p.radius;
      }
    }
  }

  /**
   * Lös skissen. Vid lyckad lösning uppdateras `sk`; annars lämnas den orörd.
   * Med `drag` dras geometrin mot målen så långt villkoren tillåter.
   */
  solve(sk: SketchData, drag?: Drag): SolveResult {
    // 1. Lös (vid drag: med temporära villkor mot målen, SQP).
    const st1 = this.run([...this.primitives(sk), ...(drag ? this.dragPrims(sk, drag) : [])]);
    if (!drag && !OK(st1)) return this.result(st1);
    const trial: SketchData = JSON.parse(JSON.stringify(sk));
    this.writeBack(trial);
    // 2. Lös igen från den lösta geometrin: planegcs diagnostiserar (frihetsgrader,
    //    överflödiga villkor) i startläget, och det är bara pålitligt när det redan stämmer.
    const res = this.result(this.run(this.primitives(trial)));
    if (res.ok) this.writeBack(sk);
    return res;
  }

  private result(st: number): SolveResult {
    const conflicting = unC(this.g.get_gcs_conflicting_constraints());
    const ok = OK(st) && conflicting.length === 0;
    return { ok, dof: this.g.gcs.dof(), conflicting, redundant: unC(this.g.get_gcs_redundant_constraints()) };
  }

  /**
   * Vilka punkter och radier kan fortfarande röra sig? Alla dras samtidigt åt
   * slumpvisa håll med temporära villkor; det som flyttar sig är underbestämt.
   * Skissen ändras inte.
   */
  freedom(sk: SketchData): { points: Set<string>; radii: Set<string> } {
    const free = { points: new Set<string>(), radii: new Set<string>() };
    const xs = Object.values(sk.points).map(p => p.x), ys = Object.values(sk.points).map(p => p.y);
    if (!xs.length) return free;
    const size = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const step = size * 0.05;
    const tol = step * 1e-3;
    const fixedIds = new Set([ORIGIN, ...sk.constraints.filter(c => c.type === 'fix').map(c => (c as { p: string }).p)]);
    const drag: SketchPrimitive[] = [];
    // Deterministisk "slump" (gyllene vinkeln) så att resultatet är stabilt.
    let k = 0;
    for (const [id, p] of Object.entries(sk.points)) {
      if (fixedIds.has(id)) continue;
      const a = (k++ * 2.39996323) % TAU;
      drag.push({ id: `x_t_${id}`, type: 'point', x: p.x + step * Math.cos(a), y: p.y + step * Math.sin(a), fixed: true });
      drag.push({ id: `x_d_${id}`, type: 'p2p_coincident', p1_id: P(id), p2_id: `x_t_${id}`, temporary: true });
    }
    for (const [id, e] of Object.entries(sk.entities))
      if (e.type === 'circle') drag.push({ id: `x_r_${id}`, type: 'circle_radius', c_id: E(id), radius: e.r + step, temporary: true });
    this.run([...this.primitives(sk), ...drag]);
    for (const p of this.g.sketch_index.get_primitives()) {
      if (p.type === 'point' && p.id.startsWith('p_')) {
        const o = sk.points[p.id.slice(2)];
        if (o && Math.hypot(p.x - o.x, p.y - o.y) > tol) free.points.add(p.id.slice(2));
      } else if (p.type === 'circle' && p.id.startsWith('e_')) {
        const e = sk.entities[p.id.slice(2)];
        if (e?.type === 'circle' && Math.abs(p.radius - e.r) > tol) free.radii.add(p.id.slice(2));
      }
    }
    return free;
  }
}

let loading: Promise<SketchSolver> | null = null;

/** Ladda lösaren (wasm-filen ligger bredvid sidan, eller ges som sökväg i Node). */
export function loadSolver(wasmPath?: string): Promise<SketchSolver> {
  loading ??= make_gcs_wrapper(wasmPath ?? new URL('planegcs.wasm', document.baseURI).href).then(g => new SketchSolver(g));
  return loading;
}
