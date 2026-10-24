// 3D view: three.js with Z up (like OpenSCAD), touch gestures via OrbitControls, only redraws when
// something changes (saves battery on the phone).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Bed } from './bed';
import type { Mesh } from './stl';
import { featureEdges } from './edges';
import type { Vec } from './sketch/geom';
import type { Plane } from './sketch/model';
import { planeFrame, toPlane, toWorld, type Frame, type V3 } from './frame';
import { cornerVertices, type Pick } from './measure';
import { currentTheme, type Theme } from './theme';

/** Grid and sketch lines per theme (the body and the edges show well against both backgrounds). */
const PALETTE: Record<Theme, { minor: number; minorA: number; major: number; majorA: number; sketch: number }> = {
  light: { minor: 0x7f8c99, minorA: 0.25, major: 0x5d6b78, majorA: 0.45, sketch: 0x1a6fc4 },
  dark: { minor: 0x8696a5, minorA: 0.16, major: 0x9aa9b7, majorA: 0.3, sketch: 0x5ea4ec },
};

const V = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
/** The sketch's (x, y) and distance w along the normal → the world. */
const to3d = (f: Frame, p: Vec, w = 0) => V(toWorld(f, p, w));
/** Base plane (for tests that pass 'XY' etc.) or frame. */
const asFrame = (f: Plane | Frame, offset = 0) => (typeof f === 'string' ? planeFrame(f, offset) : f);

export interface Overlay {
  /** The sketch plane's placement. */
  frame: Frame;
  regions: { outer: Vec[]; holes: Vec[][]; selected: boolean }[];
  axes: { a: Vec; b: Vec; selected: boolean }[];
  points?: { p: Vec; selected: boolean }[];
  /** The points' distance from the plane along the normal (e.g. the hole's start point). */
  pointsOffset?: number;
  /** Where the points are in the world, if not on the plane (e.g. text around a round side). */
  pointsAt?: (p: Vec) => V3;
}

export type ViewName = 'iso' | 'top' | 'front' | 'right';

const VIEW_DIRS: Record<ViewName, THREE.Vector3> = {
  iso: new THREE.Vector3(1, -1, 0.8).normalize(),
  top: new THREE.Vector3(0, -1e-4, 1).normalize(), // slightly from -Y so X points to the right
  front: new THREE.Vector3(0, -1, 0),
  right: new THREE.Vector3(1, 0, 0),
};

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private part = new THREE.Group();
  private sketches = new THREE.Group();
  private overlay = new THREE.Group();
  private marks = new THREE.Group();
  private highlight = new THREE.Group();
  private bedLines = new THREE.Group();
  private bed: Bed | null = null;
  private overlayAxes: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private overlayPoints: THREE.Vector3[] = [];
  /** Tap (without the view having rotated) – screen coordinates in the canvas. */
  onTap?: (p: { x: number; y: number }) => void;
  /** Temporary tap handler (e.g. pick a face for a new sketch) that takes precedence over onTap. */
  tapOverride: ((p: { x: number; y: number }) => void) | null = null;
  /** Long press (or right click) without the view having rotated. Not while tapOverride is set. */
  onLongPress?: (p: { x: number; y: number }) => void;
  /**
   * One-finger drag of something in the view (e.g. text along a face): start says whether the
   * point grabs it; if so the view does not rotate, move follows the finger and end comes on release.
   */
  drag: { start(p: { x: number; y: number }): boolean; move(p: { x: number; y: number }): void; end(): void } | null = null;
  /** The shown model's triangles (9 numbers per triangle), or null. */
  meshPositions: Float32Array | null = null;
  /** Their normals (one per corner, the same for a triangle's three), or null. */
  meshNormals: Float32Array | null = null;
  /** The model's CAD edges (6 numbers per segment), for the measure tool. */
  edgePositions: Float32Array | null = null;
  private cornerPositions: Float32Array | null = null;
  /** A new mesh is shown: listeners drop what pointed into the old one (measure picks, a selected face). */
  readonly meshChanged: (() => void)[] = [];
  private grid = new THREE.Group();
  private running = false;
  private dirty = true;
  /** The bounding sphere of the model (and the sketch lines). */
  readonly bounds = new THREE.Sphere(new THREE.Vector3(), 50);
  private insetRight = 0; // px covered by a panel on the right
  private insetBottom = 0; // px covered by a panel at the bottom
  private gridHalf = 100;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.camera);

    // Light: soft sky/ground light + a directional light that follows the camera.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-0.5, 1, 2);
    this.camera.add(key);

    this.scene.add(this.grid, this.bedLines, this.part, this.highlight, this.sketches, this.overlay, this.marks);
    this.buildGrid(100);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.9;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.requestRender());

    // Tap = short touch without movement with one finger; held still for 500 ms = long press.
    let down: { x: number; y: number; t: number; id: number } | null = null;
    let fingers = 0;
    let pressTimer = 0;
    let mouse = false;
    const el = this.renderer.domElement;
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const longPress = (p: { x: number; y: number }) => {
      if (!this.tapOverride) this.onLongPress?.(p);
    };
    // A drag grabs the pointer before OrbitControls sees it (capture listeners on the target run
    // first). A grab without movement is still a tap.
    let dragging: { id: number; x: number; y: number; moved: boolean; t: number } | null = null;
    el.addEventListener('pointerdown', e => {
      if (dragging || fingers > 0 || e.button > 0 || this.tapOverride || !this.drag?.start(local(e))) return;
      e.stopImmediatePropagation();
      el.setPointerCapture(e.pointerId);
      dragging = { id: e.pointerId, ...local(e), moved: false, t: performance.now() };
    }, { capture: true });
    el.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.stopImmediatePropagation();
      const p = local(e);
      if (!dragging.moved && Math.hypot(p.x - dragging.x, p.y - dragging.y) <= 8) return;
      dragging.moved = true;
      this.drag?.move(p);
    }, { capture: true });
    const dragUp = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.stopImmediatePropagation();
      const d = dragging;
      dragging = null;
      this.drag?.end();
      if (!d.moved && e.type === 'pointerup' && performance.now() - d.t < 600) this.onTap?.(local(e));
    };
    el.addEventListener('pointerup', dragUp, { capture: true });
    el.addEventListener('pointercancel', dragUp, { capture: true });
    el.addEventListener('pointerdown', e => {
      fingers++;
      mouse = e.pointerType === 'mouse';
      down = fingers === 1 ? { ...local(e), t: performance.now(), id: e.pointerId } : null;
      clearTimeout(pressTimer);
      if (down && !mouse) {
        const at = { x: down.x, y: down.y };
        pressTimer = window.setTimeout(() => {
          down = null; // no tap when the finger is lifted
          longPress(at);
        }, 500);
      }
    });
    el.addEventListener('pointermove', e => {
      if (down && e.pointerId === down.id) {
        const p = local(e);
        if (Math.hypot(p.x - down.x, p.y - down.y) > 8) {
          down = null;
          clearTimeout(pressTimer);
        }
      }
    });
    const up = (e: PointerEvent) => {
      fingers = Math.max(0, fingers - 1);
      clearTimeout(pressTimer);
      if (down && e.pointerId === down.id && e.type === 'pointerup' && performance.now() - down.t < 600) (this.tapOverride ?? this.onTap)?.(local(e));
      down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    // The browser's own long-press menu has no use here; a right click is the mouse's long press.
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (mouse) longPress(local(e));
    });

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.setView('iso');
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyInset();
    this.requestRender();
  }

  requestRender() {
    this.dirty = true;
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.tick);
  }

  private tick = () => {
    const moving = this.controls.update();
    if (this.dirty || moving) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    if (moving) requestAnimationFrame(this.tick);
    else this.running = false;
  };

  /** Change theme: the grid and the sketch lines get new colors. */
  setTheme(th: Theme = currentTheme()) {
    this.buildGrid(this.gridHalf);
    for (const o of this.sketches.children) ((o as THREE.LineSegments).material as THREE.LineBasicMaterial).color.setHex(PALETTE[th].sketch);
    this.drawBed();
    this.requestRender();
  }

  /** The printer's plate (w × d): an outline at Z = 0, centered under the model as a slicer places it. */
  setBed(bed: Bed | null) {
    this.bed = bed;
    this.drawBed();
  }

  private drawBed() {
    Viewer.disposeGroup(this.bedLines);
    if (this.bed) {
      const box = new THREE.Box3().setFromObject(this.part);
      const cx = box.isEmpty() ? 0 : (box.min.x + box.max.x) / 2, cy = box.isEmpty() ? 0 : (box.min.y + box.max.y) / 2;
      const x0 = cx - this.bed.w / 2, x1 = cx + this.bed.w / 2, y0 = cy - this.bed.d / 2, y1 = cy + this.bed.d / 2;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x1, y0, 0, x1, y1, 0, x1, y1, 0, x0, y1, 0, x0, y1, 0, x0, y0, 0], 3));
      const pal = PALETTE[currentTheme()];
      this.bedLines.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: pal.major, transparent: true, opacity: Math.min(1, pal.majorA * 2.2), depthWrite: false })));
    }
    this.requestRender();
  }

  private buildGrid(half: number) {
    this.gridHalf = half;
    const pal = PALETTE[currentTheme()];
    Viewer.disposeGroup(this.grid);
    const step = 10;
    half = Math.ceil(half / step) * step;
    const minor: number[] = [], major: number[] = [];
    for (let v = -half; v <= half; v += step) {
      const arr = v % 50 === 0 ? major : minor;
      arr.push(-half, v, 0, half, v, 0, v, -half, 0, v, half, 0);
    }
    const lines = (pts: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    };
    this.grid.add(lines(minor, pal.minor, pal.minorA), lines(major, pal.major, pal.majorA));
    const axis = (x: number, y: number, z: number, color: number) => lines([0, 0, 0, x, y, z], color, 0.9);
    const a = Math.max(10, half / 5);
    this.grid.add(axis(a, 0, 0, 0xd0453b), axis(0, a, 0, 0x3a9a4b), axis(0, 0, a, 0x3b6fd0));
  }

  private static disposeGroup(g: THREE.Group) {
    for (const o of g.children) {
      const m = o as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    g.clear();
  }

  /** Compute the extent (for views and the grid) of the model + sketch lines. */
  private updateBounds() {
    const box = new THREE.Box3()
      .setFromObject(this.part)
      .union(new THREE.Box3().setFromObject(this.sketches))
      .union(new THREE.Box3().setFromObject(this.overlay));
    if (box.isEmpty()) this.bounds.set(new THREE.Vector3(), 50);
    else box.getBoundingSphere(this.bounds);
    const ext = box.isEmpty() ? 0 : Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.y), Math.abs(box.max.y));
    this.buildGrid(Math.max(100, ext) + 10);
    this.drawBed();
    this.requestRender();
  }

  /** Regions/axes to choose from (the feature panel); null removes them. Always drawn on top. */
  setOverlay(o: Overlay | null) {
    Viewer.disposeGroup(this.overlay);
    this.overlayAxes = [];
    this.overlayPoints = [];
    if (o) {
      const to3 = (p: Vec, w = 0) => to3d(o.frame, p, w);
      for (const r of o.regions) {
        const shape = new THREE.Shape(r.outer.map(p => new THREE.Vector2(p.x, p.y)));
        for (const h of r.holes) shape.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p.x, p.y))));
        const g = new THREE.ShapeGeometry(shape);
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const v = to3({ x: pos.getX(i), y: pos.getY(i) });
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        g.computeBoundingSphere();
        const m = new THREE.Mesh(
          g,
          new THREE.MeshBasicMaterial({
            color: r.selected ? 0x1a6fc4 : 0x8a99a8, transparent: true, opacity: r.selected ? 0.5 : 0.18,
            side: THREE.DoubleSide, depthTest: false, depthWrite: false,
          }),
        );
        m.renderOrder = 10;
        this.overlay.add(m);
        const outline = [r.outer, ...r.holes].flatMap(poly => poly.flatMap((p, i) => [to3(p), to3(poly[(i + 1) % poly.length])]));
        const lg = new THREE.BufferGeometry().setFromPoints(outline);
        const l = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: r.selected ? 0x1a6fc4 : 0x5c6b7a, depthTest: false, transparent: true }));
        l.renderOrder = 11;
        this.overlay.add(l);
      }
      for (const ax of o.axes) {
        const a = to3(ax.a), b = to3(ax.b);
        this.overlayAxes.push({ a, b });
        const g = new THREE.BufferGeometry().setFromPoints([a, b]);
        const l = new THREE.LineSegments(
          g,
          ax.selected
            ? new THREE.LineBasicMaterial({ color: 0xe8790c, depthTest: false, transparent: true })
            : new THREE.LineDashedMaterial({ color: 0x5c6b7a, dashSize: 2, gapSize: 1.5, depthTest: false, transparent: true }),
        );
        l.computeLineDistances();
        l.renderOrder = 12;
        this.overlay.add(l);
      }
      const at = (p: Vec) => (o.pointsAt ? V(o.pointsAt(p)) : to3(p, o.pointsOffset ?? 0));
      for (const sel of [false, true]) {
        const pts = (o.points ?? []).filter(p => p.selected === sel).map(p => at(p.p));
        if (!pts.length) continue;
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.Points(
          g,
          new THREE.PointsMaterial({ color: sel ? 0xe8790c : 0x5c6b7a, size: sel ? 16 : 12, sizeAttenuation: false, depthTest: false, transparent: true }),
        );
        m.renderOrder = 13;
        this.overlay.add(m);
      }
      this.overlayPoints = (o.points ?? []).map(p => at(p.p));
    }
    this.updateBounds();
  }

  /** Point on the sketch plane (in the sketch's u, v) under a screen point, or null. */
  pickOnPlane(p: { x: number; y: number }, frame: Frame): Vec | null {
    const el = this.renderer.domElement;
    const ndc = new THREE.Vector2((p.x / el.clientWidth) * 2 - 1, -(p.y / el.clientHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(V(frame.n), V(frame.o));
    const hit = ray.ray.intersectPlane(pl, new THREE.Vector3());
    return hit ? toPlane(frame, [hit.x, hit.y, hit.z]) : null;
  }

  /** The ray from the eye through a screen point: origin and unit direction in the world. */
  rayAt(p: { x: number; y: number }): { o: V3; d: V3 } {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((p.x / el.clientWidth) * 2 - 1, -(p.y / el.clientHeight) * 2 + 1), this.camera);
    const { origin: o, direction: d } = ray.ray;
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }

  /** The model surface under a screen point: hit point and the surface's normal (in the world), or null. */
  pickFace(p: { x: number; y: number }): { point: [number, number, number]; normal: [number, number, number] } | null {
    const body = this.part.children[0] as THREE.Mesh | undefined;
    if (!body) return null;
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((p.x / el.clientWidth) * 2 - 1, -(p.y / el.clientHeight) * 2 + 1), this.camera);
    const hit = ray.intersectObject(body, false)[0];
    if (!hit?.face) return null;
    const n = hit.face.normal;
    return { point: [hit.point.x, hit.point.y, hit.point.z], normal: [n.x, n.y, n.z] };
  }

  /**
   * The measure tool: what the tap hits – a visible corner (within 18 px; not the points along a
   * circle), otherwise a visible edge (within 14 px), otherwise the face. Corners and edges behind
   * the model do not count.
   */
  pickMeasure(p: { x: number; y: number }): Pick | null {
    const body = this.part.children[0] as THREE.Mesh | undefined;
    if (!body) return null;
    const el = this.renderer.domElement;
    const W = el.clientWidth, H = el.clientHeight;
    const ray = new THREE.Raycaster();
    const rayAt = (s: { x: number; y: number }) => {
      ray.setFromCamera(new THREE.Vector2((s.x / W) * 2 - 1, -(s.y / H) * 2 + 1), this.camera);
      return ray;
    };
    const screen = (v: THREE.Vector3) => {
      const q = v.clone().project(this.camera);
      return { x: ((q.x + 1) / 2) * W, y: ((1 - q.y) / 2) * H, z: q.z };
    };
    const tol = Math.max(1e-3, this.bounds.radius * 2e-3);
    const visible = (v: THREE.Vector3) => {
      const s = screen(v);
      const hit = rayAt(s).intersectObject(body, false)[0];
      return !hit || this.camera.position.distanceTo(v) <= hit.distance + tol;
    };
    const e = this.edgePositions;
    if (e) {
      const cands: { d: number; v: THREE.Vector3 }[] = [];
      const cv = this.cornerPositions ?? new Float32Array();
      for (let i = 0; i < cv.length; i += 3) {
        const v = new THREE.Vector3(cv[i], cv[i + 1], cv[i + 2]);
        const s = screen(v);
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < 18 && s.z < 1) cands.push({ d, v });
      }
      cands.sort((a, b) => a.d - b.d);
      for (const c of cands.slice(0, 8)) if (visible(c.v)) return { kind: 'vertex', point: [c.v.x, c.v.y, c.v.z] };
      const r = rayAt(p).ray;
      const segs: { d: number; i: number; v: THREE.Vector3 }[] = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), onSeg = new THREE.Vector3();
      for (let i = 0; i < e.length / 6; i++) {
        a.fromArray(e, i * 6);
        b.fromArray(e, i * 6 + 3);
        r.distanceSqToSegment(a, b, undefined, onSeg);
        const s = screen(onSeg);
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < 14 && s.z < 1) segs.push({ d, i, v: onSeg.clone() });
      }
      segs.sort((x, y) => x.d - y.d);
      for (const c of segs.slice(0, 8)) if (visible(c.v)) return { kind: 'edge', point: [c.v.x, c.v.y, c.v.z], seg: c.i };
    }
    const f = this.pickFace(p);
    return f ? { kind: 'face', point: f.point, normal: f.normal } : null;
  }

  /** The measure tool's marks: points, bold edges (polylines) and guide lines. Drawn on top. */
  setMarks(m: { points: V3[]; polylines: V3[][]; lines: [V3, V3][] } | null) {
    Viewer.disposeGroup(this.marks);
    if (m) {
      const color = 0xe8790c;
      const segs = m.polylines.flatMap(pl => pl.slice(1).flatMap((q, i) => [V(pl[i]), V(q)]));
      if (segs.length) {
        const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
        l.renderOrder = 20;
        this.marks.add(l);
      }
      if (m.lines.length) {
        const l = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(m.lines.flatMap(([a, b]) => [V(a), V(b)])),
          new THREE.LineDashedMaterial({ color: 0x1a6fc4, dashSize: Math.max(0.5, this.bounds.radius * 0.03), gapSize: Math.max(0.3, this.bounds.radius * 0.02), depthTest: false, transparent: true }),
        );
        l.computeLineDistances();
        l.renderOrder = 21;
        this.marks.add(l);
      }
      if (m.points.length) {
        const pts = new THREE.Points(
          new THREE.BufferGeometry().setFromPoints(m.points.map(V)),
          new THREE.PointsMaterial({ color, size: 12, sizeAttenuation: false, depthTest: false, transparent: true }),
        );
        pts.renderOrder = 22;
        this.marks.add(pts);
      }
    }
    this.requestRender();
  }

  /** A picked face (triangles in the world, 9 numbers each), tinted over the model; null removes it. */
  setHighlight(tris: number[] | null) {
    Viewer.disposeGroup(this.highlight);
    if (tris?.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color: 0x1a6fc4, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }),
      );
      m.renderOrder = 5;
      this.highlight.add(m);
    }
    this.requestRender();
  }

  /** Is a face highlighted? – for tests. */
  get highlighted() {
    return this.highlight.children.length > 0;
  }

  /** Screen position for a world point – for tests. */
  screenOfWorld(x: number, y: number, z: number): { x: number; y: number } {
    const el = this.renderer.domElement;
    const q = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((q.x + 1) / 2) * el.clientWidth, y: ((1 - q.y) / 2) * el.clientHeight };
  }

  /** A panel covers `px` on the right: shift the image so the model lands in the middle of what is visible. */
  setRightInset(px: number) {
    this.insetRight = Math.max(0, px);
    this.applyInset();
    this.requestRender();
  }

  /** A panel covers `px` at the bottom (portrait): move the model up to the middle of what is visible. */
  setBottomInset(px: number) {
    this.insetBottom = Math.max(0, px);
    this.applyInset();
    this.requestRender();
  }

  private applyInset() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const p = Math.min(this.insetRight, w * 0.6), b = Math.min(this.insetBottom, h * 0.6);
    // A larger imagined image where the visible part is the lower right: the center lands in the
    // middle of the free area.
    if (p > 0 || b > 0) this.camera.setViewOffset(w + p, h + b, p, b, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Screen position (in the canvas) for a point in a sketch plane – for tests. */
  screenOf(plane: Plane | Frame, uv: Vec, offset = 0): { x: number; y: number } {
    const el = this.renderer.domElement;
    const q = to3d(asFrame(plane, offset), uv).project(this.camera);
    return { x: ((q.x + 1) / 2) * el.clientWidth, y: ((1 - q.y) / 2) * el.clientHeight };
  }

  /** Index of the nearest overlaid point within `tol` px, or −1. */
  nearestPoint(p: { x: number; y: number }, tol = 28): number {
    const el = this.renderer.domElement;
    let best = -1, bestD = tol;
    this.overlayPoints.forEach((v, i) => {
      const q = v.clone().project(this.camera);
      const d = Math.hypot(((q.x + 1) / 2) * el.clientWidth - p.x, ((1 - q.y) / 2) * el.clientHeight - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** Index of the nearest overlaid axis within `tol` px, or −1. */
  nearestAxis(p: { x: number; y: number }, tol = 26): number {
    const el = this.renderer.domElement;
    const toScreen = (v: THREE.Vector3) => {
      const q = v.clone().project(this.camera);
      return { x: ((q.x + 1) / 2) * el.clientWidth, y: ((1 - q.y) / 2) * el.clientHeight };
    };
    let best = -1, bestD = tol;
    this.overlayAxes.forEach((ax, i) => {
      const a = toScreen(ax.a), b = toScreen(ax.b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** Sketch curves in 3D (polylines with [x, y, z] points). */
  setSketchLines(polylines: [number, number, number][][]) {
    Viewer.disposeGroup(this.sketches);
    const pts: number[] = [];
    for (const pl of polylines)
      for (let i = 1; i < pl.length; i++) pts.push(...pl[i - 1], ...pl[i]);
    if (pts.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.sketches.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: PALETTE[currentTheme()].sketch })));
    }
    this.updateBounds();
  }

  setMesh(mesh: Mesh | null) {
    Viewer.disposeGroup(this.part);
    this.meshPositions = mesh && mesh.triangles ? mesh.positions : null;
    this.meshNormals = mesh && mesh.triangles ? mesh.normals : null;
    this.edgePositions = this.cornerPositions = null;
    this.setHighlight(null);
    for (const f of this.meshChanged) f();
    if (!mesh || mesh.triangles === 0) return this.updateBounds();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const body = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0xb4c2cf,
        roughness: 0.55,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    // Edges like in a CAD program. If the model has very many (e.g. threads) they are faded,
    // otherwise such faces turn black with lines.
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(featureEdges(mesh.positions, mesh.normals, 25), 3));
    this.edgePositions = edgeGeo.getAttribute('position').array as Float32Array;
    this.cornerPositions = cornerVertices(this.edgePositions);
    const segments = edgeGeo.getAttribute('position').count / 2;
    const opacity = Math.min(1, Math.max(0.12, 6000 / Math.max(segments, 1)));
    const edges = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: 0x22303d, transparent: opacity < 1, opacity }),
    );
    this.part.add(body, edges);
    this.updateBounds();
  }

  /** Place the camera along a standard direction so the whole model is visible. */
  setView(name: ViewName) {
    const dir = VIEW_DIRS[name];
    const r = Math.max(this.bounds.radius, 5);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (r / Math.sin(Math.min(fov, fov * this.camera.aspect) / 2)) * 1.1;
    this.controls.target.copy(this.bounds.center);
    this.camera.position.copy(this.bounds.center).addScaledVector(dir, dist);
    this.controls.update();
    this.requestRender();
  }

  fit() {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const r = Math.max(this.bounds.radius, 5);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (r / Math.sin(Math.min(fov, fov * this.camera.aspect) / 2)) * 1.1;
    this.controls.target.copy(this.bounds.center);
    this.camera.position.copy(this.bounds.center).addScaledVector(dir, dist);
    this.controls.update();
    this.requestRender();
  }

  /** Spin the model one turn and count frames (for the benchmark). */
  measureFps(ms = 3000): Promise<{ fps: number; worstMs: number }> {
    return new Promise(resolve => {
      const c = this.bounds.center;
      const start = this.camera.position.clone().sub(c);
      const t0 = performance.now();
      let frames = 0, last = t0, worst = 0;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const p = start.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), t * Math.PI * 2);
        this.camera.position.copy(c).add(p);
        this.camera.lookAt(c);
        this.renderer.render(this.scene, this.camera);
        frames++;
        worst = Math.max(worst, now - last);
        last = now;
        if (t < 1) requestAnimationFrame(step);
        else {
          this.controls.update();
          resolve({ fps: (frames * 1000) / (now - t0), worstMs: worst });
        }
      };
      requestAnimationFrame(step);
    });
  }
}
