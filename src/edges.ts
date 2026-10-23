// The model's edges as in a CAD program: where the faces meet at an angle, and open edges. Like
// three.js's EdgesGeometry, but robust to the needles and slivers Manifold leaves where faces join
// in one plane: their direction cannot be trusted after rounding to float32 (zero, or even flipped),
// so they do not take part in the angle test – otherwise they show as lines across flat faces.

/** Edge segments (6 numbers each) where the normals differ by more than `angleDeg`, plus open edges. */
export function featureEdges(positions: Float32Array, normals: Float32Array, angleDeg = 25): Float32Array {
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const key = (i: number) => `${Math.round(positions[i] * 1e4)},${Math.round(positions[i + 1] * 1e4)},${Math.round(positions[i + 2] * 1e4)}`;
  const edges = new Map<string, { a: number; b: number; n: number[] }>();
  for (let t = 0; t < positions.length; t += 9) {
    const keys = [key(t), key(t + 3), key(t + 6)];
    for (let k = 0; k < 3; k++) {
      const ka = keys[k], kb = keys[(k + 1) % 3];
      if (ka === kb) continue; // a corner collapsed into another
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(id);
      if (e) e.n.push(t);
      else edges.set(id, { a: t + k * 3, b: t + ((k + 1) % 3) * 3, n: [t] });
    }
  }
  const out: number[] = [];
  const dot = (s: number, t: number) => normals[s] * normals[t] + normals[s + 1] * normals[t + 1] + normals[s + 2] * normals[t + 2];
  for (const e of edges.values()) {
    if (e.n.length > 1) {
      const sure = e.n.filter(t => reliable(positions, t));
      if (sure.length < 2 || sure.every(t => dot(sure[0], t) >= cos)) continue;
    }
    out.push(positions[e.a], positions[e.a + 1], positions[e.a + 2], positions[e.b], positions[e.b + 1], positions[e.b + 2]);
  }
  return new Float32Array(out);
}

/** Is the triangle at `t` big and wide enough for its normal to mean something (> 0.0001 mm², not a needle)? */
function reliable(p: Float32Array, t: number): boolean {
  const ax = p[t + 3] - p[t], ay = p[t + 4] - p[t + 1], az = p[t + 5] - p[t + 2];
  const bx = p[t + 6] - p[t], by = p[t + 7] - p[t + 1], bz = p[t + 8] - p[t + 2];
  const cx = p[t + 6] - p[t + 3], cy = p[t + 7] - p[t + 4], cz = p[t + 8] - p[t + 5];
  const area = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
  const longest = Math.max(ax * ax + ay * ay + az * az, bx * bx + by * by + bz * bz, cx * cx + cy * cy + cz * cz);
  return area > 1e-4 && area > 1e-4 * longest;
}
