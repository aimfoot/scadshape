// Reads OpenSCAD's CSG export (.csg): a tree of calls with only literals as arguments, e.g.
// multmatrix([[1, 0, 0, 3], …]) { cylinder(h = 8.4, r1 = 3, r2 = 3, center = false); }. Modules,
// loops and variables have already been evaluated by OpenSCAD.

export type CsgValue = number | string | boolean | null | CsgValue[];

export interface CsgNode {
  name: string;
  /** Positional arguments (e.g. multmatrix(M)). */
  pos: CsgValue[];
  /** Named arguments (h = 8.4). */
  args: Record<string, CsgValue>;
  children: CsgNode[];
}

class Reader {
  i = 0;
  constructor(private s: string) {}

  ws() {
    for (;;) {
      const c = this.s[this.i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.i++;
      else if (c === '/' && this.s[this.i + 1] === '/') while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++;
      else if (c === '/' && this.s[this.i + 1] === '*') {
        const end = this.s.indexOf('*/', this.i + 2);
        this.i = end < 0 ? this.s.length : end + 2;
      } else return;
    }
  }

  peek() {
    this.ws();
    return this.s[this.i];
  }

  expect(c: string) {
    if (this.peek() !== c) throw new Error(`CSG: expected '${c}' at ${this.i}, got '${this.s.slice(this.i, this.i + 20)}'`);
    this.i++;
  }

  ident(): string {
    this.ws();
    const m = /^[$A-Za-z_][\w$]*/.exec(this.s.slice(this.i, this.i + 64));
    if (!m) throw new Error(`CSG: expected a name at ${this.i}: '${this.s.slice(this.i, this.i + 20)}'`);
    this.i += m[0].length;
    return m[0];
  }

  value(): CsgValue {
    const c = this.peek();
    if (c === '[') {
      this.i++;
      const out: CsgValue[] = [];
      if (this.peek() === ']') {
        this.i++;
        return out;
      }
      for (;;) {
        out.push(this.value());
        const d = this.peek();
        this.i++;
        if (d === ']') return out;
        if (d !== ',') throw new Error(`CSG: expected ',' or ']' at ${this.i - 1}`);
      }
    }
    if (c === '"') {
      let s = '';
      this.i++;
      while (this.i < this.s.length && this.s[this.i] !== '"') {
        if (this.s[this.i] === '\\') {
          const n = this.s[this.i + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          this.i += 2;
        } else s += this.s[this.i++];
      }
      this.i++;
      return s;
    }
    const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|-?inf|nan|true|false|undef)/i.exec(this.s.slice(this.i, this.i + 40));
    if (!m) throw new Error(`CSG: unknown value at ${this.i}: '${this.s.slice(this.i, this.i + 20)}'`);
    this.i += m[0].length;
    const w = m[0].toLowerCase();
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'undef' || w === 'nan') return null;
    if (w === 'inf') return Infinity;
    if (w === '-inf') return -Infinity;
    return Number(m[0]);
  }

  node(): CsgNode {
    const name = this.ident();
    this.expect('(');
    const pos: CsgValue[] = [];
    const args: Record<string, CsgValue> = {};
    if (this.peek() !== ')') {
      for (;;) {
        const save = this.i;
        const m = /^\s*([$A-Za-z_][\w$]*)\s*=(?!=)/.exec(this.s.slice(this.i, this.i + 80));
        if (m) {
          this.i += m[0].length;
          args[m[1]] = this.value();
        } else {
          this.i = save;
          pos.push(this.value());
        }
        const d = this.peek();
        this.i++;
        if (d === ')') break;
        if (d !== ',') throw new Error(`CSG: expected ',' or ')' at ${this.i - 1}`);
      }
    } else this.i++;
    const children: CsgNode[] = [];
    const d = this.peek();
    if (d === ';') this.i++;
    else if (d === '{') {
      this.i++;
      while (this.peek() !== '}') children.push(this.node());
      this.i++;
    } else children.push(this.node()); // single child without braces
    return { name, pos, args, children };
  }
}

/** Read a .csg file (all top-level nodes). */
export function parseCsg(text: string): CsgNode[] {
  const r = new Reader(text);
  const out: CsgNode[] = [];
  while (r.peek() !== undefined) out.push(r.node());
  return out;
}

/** Write a node back as OpenSCAD code (for parts that do not become sketches). */
export function csgToScad(n: CsgNode, indent = ''): string {
  const val = (v: CsgValue): string =>
    Array.isArray(v) ? `[${v.map(val).join(', ')}]` : typeof v === 'string' ? JSON.stringify(v) : v === null ? 'undef' : v === Infinity ? '1e200' : v === -Infinity ? '-1e200' : String(v);
  const a = [...n.pos.map(val), ...Object.entries(n.args).map(([k, v]) => `${k} = ${val(v)}`)].join(', ');
  if (!n.children.length) return `${indent}${n.name}(${a});`;
  return `${indent}${n.name}(${a}) {\n${n.children.map(c => csgToScad(c, indent + '  ')).join('\n')}\n${indent}}`;
}
