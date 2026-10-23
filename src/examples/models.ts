// Example models (the start card, src/ui/welcome.ts): built when they are opened, in the document's
// current format, with dimensions tied to variables – change a variable and the model follows. The
// variable names follow the language (bredd/width …).

import { emptyDoc, insertFeature, newFeature, newSketch, type Doc } from '../doc';
import { applyHoleSize } from '../features/hole';
import type { SketchFeature } from '../features/common';
import { getLang, type Key } from '../i18n';
import { ORIGIN, newId, type NewConstraint } from '../sketch/model';

export type ExampleId = 'box' | 'plate' | 'sign' | 'cup';

export const EXAMPLES: { id: ExampleId; name: Key; desc: Key }[] = [
  { id: 'box', name: 'start.box', desc: 'start.boxDesc' },
  { id: 'plate', name: 'start.plate', desc: 'start.plateDesc' },
  { id: 'sign', name: 'start.sign', desc: 'start.signDesc' },
  { id: 'cup', name: 'start.cup', desc: 'start.cupDesc' },
];

const VAR_NAMES = {
  sv: { width: 'bredd', depth: 'djup', height: 'höjd', length: 'längd', thickness: 'tjocklek', diameter: 'diameter' },
  en: { width: 'width', depth: 'depth', height: 'height', length: 'length', thickness: 'thickness', diameter: 'diameter' },
};
const SIGN_TEXT = { sv: 'Hej!', en: 'Hello!' };

/** Sketch builder with constraints: points, lines and dimensions tied to variables. */
class Sketch {
  constructor(readonly sk: SketchFeature) {
    sk.points[ORIGIN] ??= { x: 0, y: 0 };
  }
  pt(x: number, y: number, standalone = false) {
    const id = newId(this.sk, 'p');
    this.sk.points[id] = standalone ? { x, y, standalone: true } : { x, y };
    return id;
  }
  line(p1: string, p2: string, construction = false) {
    const id = newId(this.sk, 'e');
    this.sk.entities[id] = construction ? { type: 'line', p1, p2, construction: true } : { type: 'line', p1, p2 };
    return id;
  }
  c(o: NewConstraint) {
    this.sk.constraints.push({ id: newId(this.sk, 'c'), ...o } as SketchFeature['constraints'][number]);
  }
  /** Rectangle centered on the origin (construction diagonal + midpoint), dimensions width × height. */
  centeredRect(w: number, h: number, wExpr: string, hExpr: string) {
    const p = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => this.pt(x, y));
    const lines = p.map((a, i) => this.line(a, p[(i + 1) % 4]));
    lines.forEach((e, i) => this.c({ type: i % 2 ? 'vertical' : 'horizontal', e }));
    this.c({ type: 'midpoint', p: ORIGIN, e: this.line(p[0], p[2], true) });
    this.c({ type: 'distance', p1: p[0], p2: p[1], dir: 'h', value: w, expr: wExpr });
    this.c({ type: 'distance', p1: p[1], p2: p[2], dir: 'v', value: h, expr: hExpr });
  }
  /** Standalone point (e.g. a hole center) on the X axis, |x| mm from the origin. */
  pointOnX(x: number, absExpr: string) {
    const p = this.pt(x, 0, true);
    this.c({ type: 'hpoints', p1: ORIGIN, p2: p });
    this.c({ type: 'distance', p1: ORIGIN, p2: p, dir: 'h', value: Math.abs(x), expr: absExpr, ...(x < 0 ? { sign: -1 as const } : {}) });
    return p;
  }
}

/** Sketch on XY; with offset a sketch on a top face (like tapping the face): holes drill down, text builds up. */
function sketch(doc: Doc, offset?: string) {
  const sk = newSketch(doc, 'XY');
  if (offset) Object.assign(sk, { offset, outward: 'normal' });
  insertFeature(doc, sk);
  return { sk, s: new Sketch(sk) };
}

export function buildExample(id: ExampleId): Doc {
  const lang = getLang();
  const v = VAR_NAMES[lang];
  const doc = emptyDoc();
  switch (id) {
    case 'box': {
      doc.params = [{ name: v.width, expr: '80' }, { name: v.depth, expr: '50' }, { name: v.height, expr: '35' }];
      const { sk, s } = sketch(doc);
      s.centeredRect(80, 50, v.width, v.depth);
      insertFeature(doc, Object.assign(newFeature(doc, 'container', sk), { height: v.height, lid: 'lip' as const, radius: '4' }));
      break;
    }
    case 'plate': {
      doc.params = [{ name: v.length, expr: '70' }, { name: v.width, expr: '30' }, { name: v.thickness, expr: '4' }];
      const { sk, s } = sketch(doc);
      s.centeredRect(70, 30, v.length, v.width);
      insertFeature(doc, Object.assign(newFeature(doc, 'extrude', sk), { depth: v.thickness, radius: '5' }));
      // The holes are drawn on the plate's top face and drilled down through it.
      const top = sketch(doc, v.thickness);
      top.s.pointOnX(-25, `${v.length} / 2 - 10`);
      top.s.pointOnX(25, `${v.length} / 2 - 10`);
      const holes = Object.assign(newFeature(doc, 'hole', top.sk), { kind: 'countersink' as const, through: true });
      applyHoleSize(holes, 'M4'); // diameter and countersink from the preset
      insertFeature(doc, holes);
      break;
    }
    case 'sign': {
      doc.params = [{ name: v.width, expr: '90' }, { name: v.height, expr: '30' }, { name: v.thickness, expr: '3' }];
      const { sk, s } = sketch(doc);
      s.centeredRect(90, 30, v.width, v.height);
      insertFeature(doc, Object.assign(newFeature(doc, 'extrude', sk), { depth: v.thickness, radius: '4' }));
      const top = sketch(doc, v.thickness);
      insertFeature(doc, Object.assign(newFeature(doc, 'text', top.sk), { text: SIGN_TEXT[lang], size: '12', depth: '1' }));
      break;
    }
    case 'cup': {
      // Half the cross-section (L shape) in the Front plane, revolved around the sketch's Y axis (=
      // Z in the world).
      doc.params = [{ name: v.diameter, expr: '70' }, { name: v.height, expr: '80' }];
      const sk = newSketch(doc, 'XZ');
      insertFeature(doc, sk);
      const s = new Sketch(sk);
      const [r, h, wall, floor] = [35, 80, 2.5, 3];
      const p = [ORIGIN, s.pt(r, 0), s.pt(r, h), s.pt(r - wall, h), s.pt(r - wall, floor), s.pt(0, floor)];
      p.forEach((a, i) => s.c({ type: i % 2 ? 'vertical' : 'horizontal', e: s.line(a, p[(i + 1) % p.length]) }));
      s.c({ type: 'distance', p1: p[0], p2: p[1], dir: 'h', value: r, expr: `${v.diameter} / 2` });
      s.c({ type: 'distance', p1: p[1], p2: p[2], dir: 'v', value: h, expr: v.height });
      s.c({ type: 'distance', p1: p[3], p2: p[2], dir: 'h', value: wall });
      s.c({ type: 'distance', p1: p[0], p2: p[5], dir: 'v', value: floor });
      insertFeature(doc, newFeature(doc, 'revolve', sk));
      break;
    }
  }
  return doc;
}
