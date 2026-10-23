// Binary STL → positions and normals (one normal per triangle, flat shading).

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  triangles: number;
}

export function parseBinaryStl(buf: ArrayBuffer): Mesh {
  if (buf.byteLength < 84) return { positions: new Float32Array(0), normals: new Float32Array(0), triangles: 0 };
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 > buf.byteLength) throw new Error(`Broken STL: ${n} triangles but ${buf.byteLength} bytes`);
  const pos = new Float32Array(n * 9);
  const nrm = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    const p = t * 9;
    for (let k = 0; k < 9; k++) pos[p + k] = dv.getFloat32(o + k * 4, true);
    // The normal is computed from the corners (tolerates files with zeroed normals).
    const ax = pos[p + 3] - pos[p], ay = pos[p + 4] - pos[p + 1], az = pos[p + 5] - pos[p + 2];
    const bx = pos[p + 6] - pos[p], by = pos[p + 7] - pos[p + 1], bz = pos[p + 8] - pos[p + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 9; k += 3) {
      nrm[p + k] = nx;
      nrm[p + k + 1] = ny;
      nrm[p + k + 2] = nz;
    }
  }
  return { positions: pos, normals: nrm, triangles: n };
}

export interface StlInfo {
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
}

/** Binary or ASCII STL: number of triangles and extent, or null if the file is not an STL. */
export function stlInfo(bytes: Uint8Array): StlInfo | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => {
    if (![x, y, z].every(Number.isFinite)) return;
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  };
  const done = (n: number) => (n > 0 && Number.isFinite(min[0]) ? { triangles: n, min, max } : null);
  // Binary: the size matches the number of triangles (ASCII files can also start with "solid").
  if (bytes.length >= 84) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.length) {
      for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
        const o = 84 + t * 50 + 12 + k * 12;
        add(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true));
      }
      return done(n);
    }
  }
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  if (!/^\s*solid\b/i.test(text)) return null;
  const all = new TextDecoder().decode(bytes);
  let n = 0;
  for (const m of all.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) {
    add(Number(m[1]), Number(m[2]), Number(m[3]));
    n++;
  }
  return done(Math.floor(n / 3));
}
