// Extrudera en yta: den tryckta plana ytans kontur (bara den sammanhängande ytan, inte allt i planet)
// som slutna slingor i skissplanet, och som låst geometri i en skiss.

import type { Frame, V3 } from './frame';
import { toPlane } from './frame';
import type { Vec } from './sketch/geom';
import { newId, type SketchData } from './sketch/model';

export type FaceLoop = { kind: 'circle'; c: Vec; r: number } | { kind: 'poly'; pts: Vec[] };

/** Ta bort brus från float32 (STL:en). */
const tidy = (v: number) => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Konturen av den plana ytan i planet som innehåller punkten `at` (i världen): ytterkant och hål,
 * raka bitar ihopslagna och runda hål/tappar som cirklar. Tom om ingen yta i planet träffas.
 */
export function faceLoops(positions: Float32Array, frame: Frame, at: V3): FaceLoop[] {
  const tol = 1e-3 + Math.hypot(...frame.o) * 1e-5;
  const nTri = positions.length / 9;
  const uvOf = (t: number, k: number) => toPlane(frame, [positions[t * 9 + k * 3], positions[t * 9 + k * 3 + 1], positions[t * 9 + k * 3 + 2]]);
  const key = (p: Vec) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;
  // Trianglarna i planet, i skissens (u, v).
  const tris = new Map<number, Vec[]>();
  for (let t = 0; t < nTri; t++) {
    const q = [0, 1, 2].map(k => uvOf(t, k));
    if (q.some(p => Math.abs(p.w) > tol)) continue;
    const area = (q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[2].x - q[0].x) * (q[1].y - q[0].y);
    if (Math.abs(area) < 1e-12) continue;
    tris.set(t, q.map(p => ({ x: p.x, y: p.y })));
  }
  if (!tris.size) return [];
  // Startfacetten: den som innehåller den tryckta punkten (annars närmaste).
  const hit = toPlane(frame, at);
  let seed = -1, best = Infinity;
  for (const [t, q] of tris) {
    const d = [0, 1, 2].map(i => {
      const a = q[i], b = q[(i + 1) % 3];
      return (b.x - a.x) * (hit.y - a.y) - (b.y - a.y) * (hit.x - a.x);
    });
    if (d.every(v => v >= -1e-9) || d.every(v => v <= 1e-9)) {
      seed = t;
      break;
    }
    const cx = (q[0].x + q[1].x + q[2].x) / 3, cy = (q[0].y + q[1].y + q[2].y) / 3;
    const dd = Math.hypot(cx - hit.x, cy - hit.y);
    if (dd < best) [best, seed] = [dd, t];
  }
  // Sammanhängande yta: grannar över gemensamma kanter.
  const edgeId = (a: Vec, b: Vec) => (key(a) < key(b) ? `${key(a)}|${key(b)}` : `${key(b)}|${key(a)}`);
  const byEdge = new Map<string, number[]>();
  for (const [t, q] of tris)
    for (let i = 0; i < 3; i++) {
      const id = edgeId(q[i], q[(i + 1) % 3]);
      const l = byEdge.get(id);
      if (l) l.push(t);
      else byEdge.set(id, [t]);
    }
  const face = new Set([seed]);
  const queue = [seed];
  while (queue.length) {
    const q = tris.get(queue.pop()!)!;
    for (let i = 0; i < 3; i++)
      for (const u of byEdge.get(edgeId(q[i], q[(i + 1) % 3])) ?? [])
        if (!face.has(u)) {
          face.add(u);
          queue.push(u);
        }
  }
  // Kantlinjer (bara en triangel i ytan), riktade som trianglarna → slingor.
  const next = new Map<string, Vec[]>();
  for (const t of face) {
    const q = tris.get(t)!;
    for (let i = 0; i < 3; i++) {
      const a = q[i], b = q[(i + 1) % 3];
      if ((byEdge.get(edgeId(a, b)) ?? []).filter(u => face.has(u)).length !== 1) continue;
      const l = next.get(key(a));
      if (l) l.push(b);
      else next.set(key(a), [b]);
    }
  }
  const loops: FaceLoop[] = [];
  const pointAt = new Map<string, Vec>();
  for (const t of face) for (const p of tris.get(t)!) pointAt.set(key(p), p);
  for (const startKey of [...next.keys()]) {
    while (next.get(startKey)?.length) {
      const pts: Vec[] = [pointAt.get(startKey)!];
      let cur = startKey;
      for (let guard = 0; guard < 100000; guard++) {
        const outs = next.get(cur);
        if (!outs?.length) break;
        const b = outs.shift()!;
        cur = key(b);
        if (cur === startKey) break;
        pts.push(b);
      }
      if (pts.length >= 3) loops.push(simplify(pts));
    }
  }
  return loops;
}

/** Slå ihop raka bitar; en slinga med många punkter på samma avstånd från mitten blir en cirkel. */
function simplify(pts: Vec[]): FaceLoop {
  const n = pts.length;
  if (n >= 12) {
    const c = { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
    const rs = pts.map(p => Math.hypot(p.x - c.x, p.y - c.y));
    const r = rs.reduce((s, v) => s + v, 0) / n;
    if (r > 0 && rs.every(v => Math.abs(v - r) < r * 0.01 + 1e-3)) return { kind: 'circle', c: { x: tidy(c.x), y: tidy(c.y) }, r: tidy(r) };
  }
  const keep = pts.filter((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
    const len = Math.hypot(p.x - a.x, p.y - a.y) * Math.hypot(b.x - p.x, b.y - p.y);
    return len < 1e-18 || Math.abs(cross) / len > 1e-4;
  });
  return { kind: 'poly', pts: keep.map(p => ({ x: tidy(p.x), y: tidy(p.y) })) };
}

/** Lägg in slingorna i skissen som låst geometri (fixerade punkter, cirklar med mått). */
export function addFaceLoops(sk: SketchData, loops: FaceLoop[]) {
  const fixed = (p: Vec) => {
    const id = newId(sk, 'p');
    sk.points[id] = { x: p.x, y: p.y };
    sk.constraints.push({ id: newId(sk, 'c'), type: 'fix', p: id, quiet: true });
    return id;
  };
  for (const l of loops) {
    if (l.kind === 'circle') {
      const e = newId(sk, 'e');
      sk.entities[e] = { type: 'circle', c: fixed(l.c), r: l.r };
      sk.constraints.push({ id: newId(sk, 'c'), type: 'diameter', e, value: 2 * l.r });
      continue;
    }
    const ids = l.pts.map(fixed);
    ids.forEach((a, i) => {
      sk.entities[newId(sk, 'e')] = { type: 'line', p1: a, p2: ids[(i + 1) % ids.length] };
    });
  }
}

/**
 * Den runda (mjuka) ytan kring den tryckta punkten: facetter som hänger ihop över kanter med
 * mindre än 30° vinkel. Trianglarna i världen (9 tal per triangel), eller null om ytan är plan.
 */
export function smoothFace(positions: Float32Array, at: V3, normal: V3): number[] | null {
  const nTri = positions.length / 9;
  const P = (t: number, k: number): V3 => [positions[t * 9 + k * 3], positions[t * 9 + k * 3 + 1], positions[t * 9 + k * 3 + 2]];
  const nrm = (t: number): V3 => {
    const [a, b, c] = [P(t, 0), P(t, 1), P(t, 2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(...n) || 1;
    return [n[0] / L, n[1] / L, n[2] / L];
  };
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const L = Math.hypot(...normal) || 1;
  const n0: V3 = [normal[0] / L, normal[1] / L, normal[2] / L];
  // Startfacetten: samma normal, närmast punkten.
  let seed = -1, best = Infinity;
  const normals: V3[] = [];
  for (let t = 0; t < nTri; t++) {
    normals.push(nrm(t));
    if (dot(normals[t], n0) < 0.999) continue;
    const c = [0, 1, 2].map(i => (P(t, 0)[i] + P(t, 1)[i] + P(t, 2)[i]) / 3);
    const d = Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]);
    if (d < best) [best, seed] = [d, t];
  }
  if (seed < 0) return null;
  const vk = (p: V3) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const ek = (t: number, k: number) => {
    const a = vk(P(t, k)), b = vk(P(t, (k + 1) % 3));
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const byEdge = new Map<string, number[]>();
  for (let t = 0; t < nTri; t++)
    for (let k = 0; k < 3; k++) {
      const id = ek(t, k);
      const l = byEdge.get(id);
      if (l) l.push(t);
      else byEdge.set(id, [t]);
    }
  const smooth = Math.cos((30 * Math.PI) / 180);
  const face = new Set([seed]);
  const queue = [seed];
  let curved = false;
  while (queue.length) {
    const t = queue.pop()!;
    for (let k = 0; k < 3; k++)
      for (const u of byEdge.get(ek(t, k)) ?? []) {
        if (face.has(u) || dot(normals[t], normals[u]) < smooth) continue;
        face.add(u);
        queue.push(u);
        if (dot(normals[u], n0) < 0.9999) curved = true;
      }
  }
  if (!curved) return null;
  const out: number[] = [];
  for (const t of face) for (let k = 0; k < 3; k++) out.push(...P(t, k).map(v => Math.round(v * 1e4) / 1e4));
  return out;
}
