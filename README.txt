scadshape – a parametric CAD app for Android, built on OpenSCAD
=====================================================================

Goal: draw sketches (line, rectangle, circle, 3-point arc …) with a finger,
extrude/revolve in a feature tree, all offline on the phone. The model is the
feature tree (JSON); OpenSCAD code is generated from it and rendered by
OpenSCAD-WASM with the Manifold backend. Web page first, APK wrapper later.

Status: phases 0–3 done 2026-10-16 (spike, sketch tools, constraints/dimensions, features).
2026-10-17: restructuring (modules, feature registry), Swedish/English, threads,
offset sketch planes; then containers (compartments, push-fit/screw lids), export 3MF/STL/.scad
(phase 4), repeat (linear/grid/around axis/mirror) and edges (corner radius, round/chamfer)
(phase 5), PWA (offline, installable) + a public server ready for the Cloudflare tunnel,
models (several projects, file in/out), text (8 fonts), undo in part mode, the sketch tools
polygon and slot, round/chamfer sketch corners (sketch/fillet.ts), a 3D measure tool (measure.ts),
STL/SVG import (Import), dark theme (☰ → Theme), snap fits (snap hook/catch, snap lid).
2026-10-23: English is the base language of the code, comments and docs; Swedish is a UI translation.
Left: the public address, the Android app before Play (android/README.txt), more features (see Ideas).

Architecture (2026-10-17)
  src/features/        one file per feature type: data, defaults, the panel's fields,
                       the description in the tree and the OpenSCAD code (build). index.ts = registry.
                       New type: write features/<type>.ts, add it to KINDS and SolidFeature,
                       add a toolbar button (startFeature) and texts in i18n.
  src/model3d.ts       assembles the model from the features (union/difference/intersection).
  src/ui/              render, tree, panel (fields built from features/*.fields), pickers
                       (picking in 3D: regions, axis, points, circles), params, sketchmode,
                       bench, dom, state (shared state + events), toast.
  src/i18n.ts + i18n-en.ts/i18n-sv.ts  t('key'), data-i18n in the HTML; English is the base and
                       Swedish is type-checked against it (a missing translation = a compile error).
                       Language picker in ☰. Default names ("Sketch 1"/"Skiss 1") follow the language.
                       Example ids and saved source ids are English (plate, cup, heavy, cube, custom);
                       the Swedish ids saved before 2026-10-23 are mapped in ui/state.ts.

Container (features/container.ts)
  Closed profile → box: height, wall, bottom, corner radius, compartments in X/Y (dividers, lower than
  the lid rim). Lid beside it (for printing): push-fit (plate + rim inside the wall, clearance per
  side) or screw (circle only: external thread on the neck with a 45° transition inside, a lid with
  an internal thread and grip). Without a sketch the button creates an 80 × 60 template sketch with dimensions.
  Tested: the lid screws on (overlap 0 at the right angle, > 50 mm³ at a wrong one).

Repeat and edges (features/pattern.ts, extrude.ts)
  Every feature has "Repeat": linear (axis, count, spacing), grid, around axis (count,
  angle; 360 = evenly), mirror (plane through the origin). Wrapped around the feature's tool in model3d.
  Threads are not mirrored (that would make a left-hand thread) – an error with an explanation.
  Extrude: corner radius (rounds inward and outward corners with offset), edge round/chamfer at
  the outer end/the sketch/both (layers of offset profiles).

Models (projects.ts, ui/projects.ts, kv.ts)
  Several models in IndexedDB (database "scadshape", store "kv", since 2026-10-22; before that
  localStorage): scadshape.projects (index), scadshape.doc.<id>, scadshape.current. kv.ts reads everything
  into memory when the module loads (top-level await) and writes every change through, so projects.ts is
  synchronous as before. If there are model keys in localStorage they are moved (they replace IndexedDB, are
  read back and compared, then removed from localStorage). Without IndexedDB: localStorage, otherwise memory.
  A failed write → a red notice (storageHooks). UI settings, language, theme and Custom code stay in
  localStorage. Test: tools/browser/storage.mjs.
  Startup: main.ts sets the theme, waits for openStorage(), then initState() and the rest. <body> has
  the class loading (hidden) until everything is wired up; tests wait for body:not(.loading) before they read
  window.__scadshape (where storage is a test hook to read/write/clear the storage). The old single
  document (scadshape.doc) becomes "My model" at the first start. ☰ → the name → list: open, rename,
  duplicate, delete, new, open file, save as file (.scadshape.json). Open file also takes .scad: it opens
  as Custom code and renders (the file chooser has no accept filter – otherwise Android greys out .scad).
  Undo/redo in part mode (ui/history.ts): a snapshot per change, reset when switching models.

Text (features/text.ts, fonts.ts)
  Raised/engraved text at the picked points (otherwise the sketch origin), start (mm from the plane).
  Fonts in public/fonts/ (OFL, LICENSE.txt): Liberation Sans (+ bold), Allerta Stencil, Bebas
  Neue, Pacifico, Orbitron (Medium = "Orbitron", Bold, Black; 2026-10-23). The engine gets the whole family
  when the code mentions it (fontsFor: "Orbitron:style=Medium" or just "Orbitron" is enough); the worker
  fetches and caches them and sets FONTCONFIG_FILE in preRun. Variable fonts (e.g. Google's
  Orbitron[wght]) crash the WASM build – use static .ttf files. Orbitron has a reserved name (OFL
  RFN): own instances made from the variable file (fontTools) must not be called Orbitron, hence the
  project's own unmodified static files (v1.000, github.com/theleagueof/orbitron) – the original drawing,
  slightly different from Google's 2.001. Test: model.test "Orbitron, Bold and Black are chosen …".

Libraries (libs.ts, vendor/libraries/)
  Copied 2026-10-17 (only *.scad + LICENSE, see VERSION):
    BOSL2 2.0.766 (BSD-2)              include <BOSL2/std.scad>              1.06 MB gz
    Round-Anything (MIT)               use <Round-Anything/polyround.scad>   12 kB gz
    dotSCAD 3.3 (LGPL-3)               use <dotSCAD/src/line2d.scad>         94 kB gz
    gridfinity-rebuilt-openscad (MIT)  use <gridfinity-rebuilt-openscad/…>, or the whole
                                       gridfinity-rebuilt-bins.scad pasted in       47 kB gz
  build.mjs packs every library into dist/libs/<name>.json. The engine only sends along the
  libraries the code uses (include/use <name/…>, or detect in libs.ts); the worker fetches the JSON
  once, writes the files to /libraries and sets OPENSCADPATH (plus paths per library:
  dotSCAD/src and gridfinity's root directory, for their relative includes). Part of the offline cache.
  Times (WASM): BOSL2 cuboid ~0.5 s, screw("M6") ~0.8 s, gridfinity bin ~0.65 s.
  More libraries: copy to vendor/libraries/<name> and add to LIBRARIES. Test: libs.mjs.
  The view refits in Custom code/examples when the model changes size/position a lot (not in own models).

Convert to sketches (convert/csg.ts, convert/scad2doc.ts, ui/convert.ts, features/code.ts)
  The button in the code panel (Custom code/examples): OpenSCAD runs the code and exports the CSG tree (.csg:
  modules, loops, variables already evaluated). Bodies that are prisms along a world axis (cube,
  cylinder, linear_extrude, hull of such) → a sketch on XY/XZ/YZ (+ offset) + Extrude;
  cones and spheres → profile + Revolve; the rest (BOSL2 polyhedra, minkowski, hull in 3D, rotated bodies,
  text with a missing font) → code blocks (feature "OpenSCAD code", no sketch, include/use lifted out).
  2D: square/circle/polygon directly (rectangles and circles with dimensions); offset/text/overlaps are drawn
  by OpenSCAD (SVG, fine resolution) and arcs are found in the points (the center adjusted so that the
  end points lie exactly on the radius). hull of equal circles → a rounded shape with tangents, equal radii,
  a radius dimension and (rectangle) outer width/height – only the position free. $fn < 16 is kept as a polygon
  (an intentional hexagon), circles without $fn become real circles.
  The boolean tree is flattened in the tree's order; a subtraction that reaches a body added earlier
  (boxes) turns that whole difference into code. In a union, difference/intersection are taken first.
  Consecutive prisms with the same plane/height/operation are merged into one sketch. Afterwards the volume
  is compared with the original (rendered with $fa=1, $fs=0.2) and the result is shown.
  Tests (tests/convert.test.ts): the test models in tests/fixtures/ (snap_box 8 sketches/1 code,
  bracket 8 sketches/0 code, bosl2_knob partly code, cable_clip, wall_hook; all ≤ 0.04 % volume) and, if
  it exists, tests/private/ (own files that are not published).
  Limitation: the sketches are independent – if the box's width changes the holes do not follow (no
  link like the original code's variables).

Export (ui/export.ts)
  3MF (zip, unit mm), STL (binary), OpenSCAD code. The file is produced when the dialog opens so that
  the button press can download/share at once. Chrome on Android does not share .3mf/.stl via Web Share
  – hence a download (in the app: Downloads and the share sheet). File name = the model's name.
  The files need a slicer (Bambu Studio, OrcaSlicer, PrusaSlicer …). Bambu Handy does not slice:
  it only starts finished print files (MakerWorld/Bambu Studio) – tested 2026-10-23 on a
  Xiaomi 11T Pro, the 3MF could not be opened. Slicing on the phone (e.g. Kiri:Moto) and sending to
  a Bambu printer would need the network and Bambu's .gcode.3mf format – not done.

Threads (features/threads.ts, thread.ts, hole.ts)
  ISO metric profile (60°, crest P/8, root P/4), a cross-section r(θ) extruded with −360°/
  pitch (right-hand thread). M2–M30 with the standard pitch, clearance for 3D printing (0.2 mm).
  Hole → Threaded: internal thread + core hole. Thread feature: pick circles in 3D; External cuts
  away the cylinder and replaces it with a threaded rod (chamfered), Internal subtracts a thread tap.
  The size is suggested from the circle (outer or inner diameter). M8×15 mm ≈ 0.05 s, 85k tri.
  Offset sketch planes: "Offset" in the plane picker (e.g. the plate's height/a variable).
  Downward direction is flipped with rotate([180,0,0]), not mirror – a mirror gives a left-hand thread
  (tests: "threads are right-handed in every direction" measures the helix in the mesh).

Sketch tools (sketch/editor.ts)
  Polygon (G): center + corner, 3/4/5/6/8 sides; corners on a construction circle + equal sides
  → a dimension on the circle (e.g. across flats) and rotation. Slot (O): two ends + width;
  arcs and lines tangent. The tools' constraints are "quiet" (the symbols show when the shape is
  selected). Tangency at a shared end point is solved as in FreeCAD (the radius ⟂ the line,
  perpendicular_pppp) – the distance form gave the wrong number of degrees of freedom (slot 9 instead of 5).

Sketch on a face (faceref.ts, 2026-10-17)
  Sketch → "Pick a face on the model" → tap a flat face in 3D. Faces parallel to
  Top/Front/Right: the plane and the offset are worked out (XZ: offset = −y).
  Slanted faces: the sketch gets face = { o, u, v } (frame.ts; the normal u × v out of the body), placed
  with multmatrix. If the face comes from an extrude (findFaceRef: the side that a line in the profile
  sweeps up, or an end face lo/hi), faceRef { feature, entity | cap, sign } is saved and the plane is
  recomputed from it on every build (the line's solved points, depth, direction, the parent sketch's
  frame – recursively), so the sketch follows the dimensions. Otherwise (or if the source is deleted/suppressed)
  face = the last known position applies. Normal and position from all triangles
  in the plane (area-weighted); u horizontal along the face, v uphill, the origin at the bottom left corner seen from outside.
  Everything that places a sketch (OpenSCAD, the 3D view, picking in 3D, outline) goes through sketchFrame(). The offset
  preferably becomes an expression from the extrude that created the face (e.g. "t", "2 + t", "-(t / 2)"),
  so the sketch follows when the dimension changes; otherwise the number. The sketch gets outward ('normal'/'reverse')
  = which way the face points out: new extrudes/text build outward, "remove" turns inward,
  holes drill inward. In sketch mode the model's edges in the plane are shown (grey, from the latest mesh;
  applies to every sketch whose plane coincides with a face) and you snap to corners, circle centers
  and edges (a new point, no constraint). The view fits the face only for sketches from a face.
  Tests: model.test "sketch on a face …", tools/browser/faces.mjs.

Extrude a face (faceoutline.ts, features/surface.ts)
  A flat face → a new sketch "… · face" with the face's outline as locked geometry, used by the extrude.
  The outline is made to match the face exactly, so the new body joins it without a step: values come
  back from the float32 mesh as the shortest decimal within float32 precision (exactValue – the code
  writes at most six decimals, and float32 keeps about seven digits), and a regular polygon starting
  at angle 0 becomes a circle with that $fn (CircleE.fn), corner for corner. Anything else stays a
  polygon. A curved face becomes the feature "Extruded face": for the side of an extruded circle a
  ring of circle()s with the circle's own $fn and no margin (its wall is the sketch circle itself),
  for an arc a rotate_extrude sector with 0.02 mm overlap, otherwise a fixed copy of the surface.
  Test: model.test "a face sketch lines up exactly …".

Licence and "About scadshape" (2026-10-22)
  scadshape: GPL-3.0 or later (LICENSE). Required in practice: the OpenSCAD WASM contains CGAL
  (GPL-3); OpenSCAD itself is GPL-2 with an exception for CGAL. ☰ → About scadshape (src/ui/about.ts) shows
  the version (android/build.sh sets SCADSHAPE_VERSION), the licence and everything bundled, grouped
  (src/licenses.ts). The licence texts: vendor/licenses/ (tools/licenses.sh fetches them from the versions
  that the openscad-wasm build pins + SPDX texts; SOURCES.txt) and the dependencies' LICENSE files, copied by
  build.mjs to dist/licenses/. When the OpenSCAD WASM or a library changes: run tools/licenses.sh
  and update src/licenses.ts. Test: tools/browser/about.mjs (every text opens).
  Back/Esc in a licence text goes back to the list (Android's back: buttons with data-back).

Images in README.md (2026-10-23, docs/media/)
  tools/browser/readme-media.mjs remakes them against staging (see the script's header): two GIFs
  (sketch-to-part, variables) and five screenshots, English, 390 × 844. The GIFs are frame series with
  a fixed display time per frame (gifenc + pngjs, dev dependencies in tools/browser); DUMP=<dir>
  also saves the frames as PNG for review. Run again when the interface changes noticeably.
  Two follow-up changes in the app: the feature panel in portrait (at the bottom) moves the model up above it
  (viewer.setBottomInset, like setRightInset in landscape) – before, the model was hidden under the panel; and
  the sketch view leaves at least 90 px margin at the sides (editor.fit), so that dimension labels with variable
  names are not clipped on narrow phones.

Start card and examples (2026-10-22, ui/welcome.ts, examples/models.ts)
  When the model is empty a card shows in the 3D area: four steps (Sketch → draw/Dimension → Done + Extrude …
  → Export) and four examples. It does not block the tools and hides when the model gets content,
  a feature panel opens or you enter a sketch; × hides it for the session, ☰ → Get started
  shows it again. The examples are built when they are opened (new models in the current format) with dimensions
  that depend on variables (the names follow the language): Box with lid (container), Mounting plate (extrude +
  countersunk M4 holes on the top, outward 'normal' so they drill downward), Sign (text), Cup
  (revolve). A jar with a screw lid was in at first but took ~3 s and 357k triangles (the threads) – too
  heavy as a first impression. Tests: tests/examples.test.ts (fully defined sketches, renders,
  variable ×1.5 → a larger model, the holes go through), tools/browser/welcome.mjs.
  The toolbar fades at the edge where it continues (ui/scrollhint.ts). Benchmark only exists on the
  development server (isDevHost).
  Weak phone: tools/browser/lowend.mjs (360 × 640, CPU throttled 1/4/6×): start 0.18/0.46/0.69 s,
  the examples 0.1–0.4 s. Note: the CDP throttling does not apply to the worker, so the engine times are the machine's own.

Android app (android/, started 2026-10-22)
  WebView wrapper, fully offline: android/build.sh → android/dist/scadshape.apk. Saving/sharing files,
  opening files from other apps and the back button go through the bridge in src/android.ts + src/ui/android.ts
  (only present in the app). Details and what is left before Play: android/README.txt.

Ideas (not done)
  Gridfinity bins, hinges, a face sketch on revolve/code blocks that follows the dimensions.

Phases
  0 spike         WASM engine in a Web Worker, 3D view with touch gestures, benchmark   ✔
  1 sketch tools  line, rectangle, circle, polygon, slot, arcs, snapping                ✔
  2 constraints   planegcs (FreeCAD's solver, WASM), dimensions with number entry       ✔
  3 features      extrude (+/−), revolve, hole, thread, container, text, tree           ✔
  4 printing      export 3MF/STL/.scad (download/share; on to a slicer)                 ✔
  5 extras        offset planes, repeat/mirror, corner radius, round/chamfer edges      ✔
Limitation: OpenSCAD is CSG/mesh without B-rep – no "tap a 3D edge and round it";
the edges are therefore rounded/chamfered per extrude (layers of ~0.2 mm, one per print layer).

Addresses
  Development: http://<SCADSHAPE_HOST>:8790/ (scadshape-web, receives logs). serve.py listens on
    127.0.0.1 unless told otherwise; to reach it from the phone, SCADSHAPE_HOST is set to e.g.
    the Tailscale IP in a systemd drop-in (~/.config/systemd/user/scadshape-web.service.d/host.conf:
    [Service] + Environment=SCADSHAPE_HOST=<ip>), which is not in the repository.
  Public (for the Cloudflare tunnel): 127.0.0.1:8791 (scadshape-public, SCADSHAPE_PUBLIC=1:
    strict CSP, no POST, no access log). The same dist/ – a rebuild reaches both at once.
    The app sends logs/benchmarks only from the development address (remote.ts isDevHost: localhost
    or a Tailscale address 100.64.0.0/10).

Public address
  A reverse proxy or tunnel (e.g. Cloudflare Tunnel) to 127.0.0.1:8791 (scadshape-public).
  Over https sw.js is registered: the app is cached for offline use (a cache per content hash, a new version
  is fetched in the background and used at the next start) and can be installed ("Add to
  home screen"). manifest.webmanifest + icons/ (drawn by tools/browser/make-icons.mjs).
  The CSP needs 'unsafe-eval': planegcs (embind) creates functions with new Function – without it
  the redundant-dimension check failed silently.

The sketch tool (phase 1)
  "+ Sketch" → pick a plane (Top XY, Front XZ, Right YZ) → draw → "Done".
  The point goes where the finger is; a magnifier while the finger is down; drag
  from the first to the second point in one swipe, or tap point by point.
  Two fingers pan/zoom. Snapping: existing points/the origin (become shared
  points = coincident), grid (step by zoom), horizontal/vertical (line).
  Once a shape has its first point the size snaps instead of the position (sizeSnap, 2026-10-23):
  diameters, lengths and sides in whole mm (finer only when zoomed in past a 1 mm grid); points,
  curves and the model still win. Off with the grid button. Test: tools/browser/steps.mjs.
  A line chain ends on an existing point, with "Finish" or by tapping the last
  point again. Select: tap, drag points/lines/a circle edge, drop a point on
  another to merge them. Construction = dashed, does not count as a profile.
  Regions as in a CAD program (regions.ts): the curves are split where they cross
  each other, loose ends are trimmed, every bounded face in the planar graph becomes a
  region (filled blue). Standalone components inside a face become holes, islands in holes
  material again. Open ends are shown with a red ring. The document is saved in localStorage.
  tests/phone-sketches.json: hand-drawn sketches with uneven coordinates (test cases).

Constraints and dimensions (phase 2)
  Solver: planegcs (@salusoft89/planegcs, FreeCAD's solver as WASM, dist/planegcs.wasm).
  Every change is solved; if it conflicts (or is redundant, for new constraints/dimensions)
  it is rolled back with a red notice and the constraints involved blink red.
  Dragging geometry: temporary constraints pull toward the finger as far as the constraints allow.
  Select → the context bar shows the fitting constraints: Horizontal/Vertical (lines or
  two points), Parallel, Perpendicular, Equal, Tangent, Concentric, On line/curve,
  Midpoint, Merge, Fix/Unfix, Dimension. Dimension: line → length (along/horizontal/
  vertical), circle → diameter, arc → radius (toggle), two lines → angle (parallel
  → distance), point+line, two points. The dimension field takes expressions (40/2+5).
  Tap a dimension to change/delete it. Automatic constraints while drawing:
  horizontal/vertical, coincident (shared point), on curve (snap to a curve ▢),
  midpoint (snap ▲). Blue = can move, black = fully defined (freedom analysis:
  every point is dragged at random with temporary constraints – what moves is free).
  The status bar shows the degrees of freedom or "Fully defined".
  planegcs diagnoses in the starting state, so every solve runs twice
  (the second time from the solved geometry) – otherwise redundant constraints are missed.

Features (phase 3)
  Document v2 (doc.ts): features in order (sketch, extrude, revolve), variables,
  a rollback marker. v1 (phases 1–2) is migrated: every sketch with regions gets an extrude
  with the old preview height. model3d.ts builds OpenSCAD: one module per
  feature; add = union, remove = difference, intersect = intersection, in the tree's
  order. Errors per feature (e.g. "The profile crosses the axis", "Unknown variable") are shown with
  ⚠ in the tree and the feature is skipped.
  Extrude: sketch, regions, height (expression), up/down/symmetric, operation.
  Revolve: axis = the sketch's X/Y axis or a line in the sketch (often a construction line),
  angle, symmetric, operation. The profile must lie on one side of the axis.
  Region picking: the panel shows the sketch's regions as faces in 3D; tap to select/deselect.
  The choice is saved as a point inside every region ("seed"), so it survives sketch changes.
  Default (nothing picked) = what is material with an even depth (a ring around a hole etc.).
  Axis picking: "Pick axis"/"Line" shows the candidates dashed; tap one.
  The tree (☰): tap = edit; ⋯ = edit, suppress, roll back to here, delete
  (a sketch takes the features built on it along). New features are inserted at the marker.
  Variables (fx): name = expression, may use the variables above. Used in height/angle
  and in sketch dimensions (the dimension saves the expression; when the variable changes the sketch is recomputed and
  solved). Names with non-ASCII letters are transliterated in the code (höjd → hojd) because OpenSCAD only takes a–z.
  Preview while the panel is open (the latest request wins, 350 ms after a key press).
  Landscape: the 3D view is shifted so the model ends up beside the panel.

Fillet/chamfer sketch corners (src/sketch/fillet.ts)
  Select corner points (two lines meet, not parallel) or lines → Fillet / Chamfer in
  the context bar; the dimension dialog opens (radius or leg). Several corners: one dimension, the rest Equal.
  Fillet: the lines are trimmed to the tangent points, an arc + tangent constraints + a radius dimension.
  Chamfer: a straight line, construction legs from the corner (Equal) + a dimension on the first leg.
  Virtual corner: if the corner point has dimensions/constraints (or is the origin) – and always when chamfering –
  it is kept on the lines' extension (point on line + dashed legs), so the dimensions still hold.
  A line with Equal/Midpoint becomes construction at full length + a trimmed copy (the polygon's sides).
  The degrees of freedom do not change. Tests: solver.test "fillet: …"/"chamfer: …", tools/browser/fillet.mjs.
  Only line–line corners (not line–arc).

The measure tool (src/measure.ts, src/ui/measure.ts)
  "Measure" in the part toolbar. A tap snaps to a visible corner (18 px; not the points along a
  tessellated circle), otherwise a visible edge (14 px), otherwise the face. Edge → the whole straight edge
  (length) or circle/arc (Ø/R, center; the chain of mesh edges is followed as long as the points
  lie on the same circle with even segments). One pick: size/coordinates. Two picks: distance +
  ΔX/ΔY/ΔZ (a circle counts from its center); parallel faces/edges → perpendicular distance, otherwise
  an angle; point → face/edge perpendicular. The third tap starts over; a new render clears the picks.
  Tests: tests/measure.test.ts, tools/browser/measure.mjs.

Import (src/ui/importer.ts, Import in the part toolbar)
  STL (binary/ASCII, at most 64 MB) → feature "Imported body" (features/mesh.ts): centered on the plate
  (bottom at Z = 0), scale %, rotate, move, add/remove/intersect. The file is kept in IndexedDB
  by content hash (src/blobs.ts; the document only saves the hash). The engine (scad.ts) sees
  import("/imports/<hash>.stl") in the code and writes the file to the worker's file system. "Save as file"
  embeds the files (base64, "files") and "Open file" saves them; the .scad export points to the
  original file's name. If the file is missing in the browser, that is an error in the tree. Files are not deleted
  when the model is deleted (IndexedDB "scadshape-files").
  SVG (src/svg.ts, own XML reader): path (all commands), rect (rx/ry), circle, ellipse, line,
  polyline, polygon, g/transform, viewBox/units → mm, y up. Text, images and use are skipped
  (listed in the dialog). Circular arcs become sketch arcs if the transform is uniform, Béziers are flattened
  (0.02 mm). Dialog: width (scales uniformly), the corner/center at the origin, lock → then the plane picker
  (also a face on the model); the geometry ends up in a new sketch with the file's name. The solver cannot handle
  many free points (1000 free = planegcs runs out of memory; fixed ones are cheap): over 150
  points are locked by default, over 600 always, over 6000 refused.
  Tests: tests/svg.test.ts, tools/browser/import.mjs (pwa.mjs runs with ?sw in the address).

Theme (src/theme.ts, ☰ → Settings → Theme: Same as the phone / Light / Dark)
  The choice is saved (scadshape.theme); the resolved theme becomes data-theme on <html>. All colors in
  style.css are variables with dark values (+ a media query before the script has run, color-scheme for
  forms). The sketch canvas has two palettes (editor.ts LIGHT/DARK; fully defined = light in
  dark), the 3D view changes its grid and sketch lines (viewer.setTheme). Test: tools/browser/theme.mjs.

Settings (src/ui/settings.ts, src/bed.ts, ☰ → Settings, 2026-10-23)
  Language, theme, the printer's build volume and About scadshape in one dialog (the drawer keeps the
  room for the features). Build volume: presets (Bambu Lab A1 mini 180³ by default, A1/P1S/X1 256³,
  Prusa MK4, Prusa MINI, Ender-3) or a custom size, saved as scadshape.bed. The 3D view draws the plate's
  outline at Z = 0, centered under the model as a slicer places it (viewer.setBed); the status bar warns
  (class warn) when the model does not fit, also turned 90° on the plate (fitsBed). Changing it
  redoes the warning without a new render (applyBed). Test: tools/browser/settings.mjs.
  Everything renders by itself: the model on every change, Custom code 0.8 s after the typing pauses.
  The Render button is only Cancel, shown once a render has run for 0.4 s.

Faces picked in the 3D view (src/ui/faceselect.ts, 2026-10-23)
  In part mode with no panel open, a tap on the model selects a face (tinted, viewer.setHighlight with
  faceTriangles: the connected flat face, or the smooth curved one), a tap beside clears it. With a face
  selected, Extrude in the toolbar extrudes it (as "Pick a face" does) and Sketch sketches on it. A long
  press (500 ms still, or a right click) selects the face and opens a menu: Extrude, Cut into the model
  (extrude with op remove, inward), Sketch on this face. The click the browser sends when the finger is
  lifted is swallowed so it does not hit the menu. A new mesh, a panel, the measure tool or sketch
  mode clears the selection. Test: tools/browser/faceselect.mjs.

Snap fits
  Snap hook (features/snap.ts) at points in a sketch (none picked = standalone points, otherwise
  the origin; without a sketch a template sketch in XY): Hook = a bending beam along the plane's normal, centered on the point,
  a barb toward Direction (degrees in the plane), 30° lead-in, back face locking 90° or releasable 45°,
  a 45° chamfer at the root. The panel shows the strain at the root ε = 1.5·t·y/L² and warns above 2.5 % (PLA),
  plus a tip about the print orientation (an upright hook bends across the layers). Catch = a pocket (t + y + 2·clearance)
  × (b + 2·clearance) × depth cut into the body. The field type 'note' (common.ts) shows computed text.
  Snap lid (container, lid "Snap"): a push-fit lid whose rim bulges out snapDepth (0.6) with
  45° flanks near the tip, and a groove at the same height in the wall (+0.15 mm). Interference = bead −
  clearance. The bead and groove are built as layers on the 0.2 mm print layers (layers that share a print layer give steps
  that the slicer cannot print); the rim wall keeps its thickness. scadcheck: no remarks.
  Tests: model.test "container with snap lid …", "snap hook and catch …" (assembled lid: 0 mm³ overlap with the groove,
  ~84 mm³ interference without), tools/browser/snap.mjs.

Points and holes
  The Point tool (P) in the sketch draws standalone points (SPoint.standalone) – they snap
  to midpoints/curves, can get dimensions and constraints like other points.
  The Hole feature drills at the picked points (default: all standalone points; without any,
  circle/arc centers). Select/deselect by tapping the points in the 3D view. Type: simple,
  counterbore, countersink. Size M2–M8 fills in the clearance hole (ISO 273
  medium), a counterbore for a socket head screw and 90° for a countersunk screw; changed dimensions → "Custom".
  Depth or through all. Drill up/down along the plane's normal, with a start (mm from
  the sketch plane) – e.g. start = the plate's thickness and downward for a counterbore on the top.
  Holes are always subtracted and need a body before them in the tree.

Files
  src/main.ts          UI: part mode (3D, source, code, features) and sketch mode
  src/doc.ts           document v2 (features, variables, rollback), migration, localStorage
  src/model3d.ts       features → OpenSCAD (extrude, revolve, operations, errors per feature)
  src/params.ts, src/paramsync.ts  variables; recompute sketch dimensions when they change
  src/sketch/model.ts  sketch data: points + entities (line/circle/arc) + constraints
  src/sketch/geom.ts   2D geometry, tessellation (chord error ≤ 0.01 mm)
  src/sketch/regions.ts  closed profiles and nesting
  src/sketch/codegen.ts  profiles → OpenSCAD 2D (polygon/circle, difference for holes)
  src/sketch/editor.ts   the canvas editor (tools, snapping, magnifier, constraints, undo)
  src/sketch/solver.ts   sketch ↔ planegcs: solving, dragging, freedom analysis
  src/sketch/annotate.ts dimensions and constraint symbols (measuring, drawing, hit areas)
  src/expr.ts          expressions in dimension fields
  src/sketch3d.ts      sketch curves as lines in the 3D view
  tests/               unit tests: node tests/run.mjs (sketch, solver, projects, models with a real
                       OpenSCAD render – volumes, dimensions, thread direction, lid fit)
  tools/browser/{container,export,pattern,projects,text,history,sketchtools,pwa}.mjs
                       browser tests for the current features (pwa.mjs against http://127.0.0.1:8791/?sw)
  tools/browser/sketch.mjs  draws a sketch with real touch events (CDP) and checks everything
  tools/browser/constraints.mjs  constraints/dimensions: rectangle → fully defined, conflict, tangent, drag, delete/undo
  tools/browser/threads.mjs  threads (external/internal, circle picking in 3D) and language switch en↔sv
  tools/browser/holes.mjs  the point tool, holes: point picking in 3D, counterbore, M sizes, editing
  tools/browser/features.mjs  migration, variables, extrude/remove, region and axis picking in 3D, revolve,
                       rollback/suppress, variable change, reload, portrait mode
  node build.mjs --out dist-next  build without publishing (test with python3 -m http.server)
  src/scad.ts          client for the worker: render(src) → STL + log, cancel()
  src/scad.worker.ts   runs OpenSCAD; the wasm is compiled once, a new instance per render
  src/viewer.ts        three.js, Z up, OrbitControls (1 finger rotates, 2 zoom/pan)
  src/stl.ts           binary STL → positions/normals (the file's normal for needle triangles)
  src/edges.ts         the model's edges (angle > 25°); needles and slivers that Manifold leaves where
                       faces join in one plane are left out of the angle test – with three.js's
                       EdgesGeometry they showed as lines across flat faces (test: model.test "needle …")
  src/examples/*.scad  examples (packaged as text)
  public/              index.html, style.css (copied to dist/)
  vendor/openscad/     OpenSCAD-WASM (web build), see VERSION
  build.mjs            esbuild → dist/ (+ .gz). `node build.mjs --watch` during development
  serve.py             server for dist/ + POST /api/bench → data/bench.jsonl
  scadshape-web.service  user service (systemctl --user restart scadshape-web)
  tools/bench-node.mjs   benchmark a .scad in Node: node tools/bench-node.mjs file.scad [manifold|cgal]
  tools/browser/smoke.mjs  smoke test in headless Chromium (Playwright):
                           cd tools/browser && node smoke.mjs [url] [outdir] [--bench]

Building
  npx tsc --noEmit -p . && node build.mjs
  A rebuild is published at once (dist/ is emptied but not removed – the service bind-mounts it).

Updating OpenSCAD-WASM
  Download OpenSCAD-<date>-WebAssembly-web.zip + .sha256 from
  https://files.openscad.org/snapshots/ into an empty directory, `sha256sum -c`,
  unpack (python3 -I -m zipfile -e zip out/), replace vendor/openscad/openscad.{js,wasm},
  update VERSION, run bench-node + smoke.mjs, build.

Measurements on the development machine (i5-10500, WASM, Manifold), 2026-10-16
  plate with 28 holes + sphere   13 416 tri    ~250 ms   (CGAL: ~70 s)
  cup                            17 552 tri    ~120 ms
  heavy, 144 spheres            114 880 tri    ~1.8 s
  new instance per render        ~35 ms
  The phone's values: data/bench.jsonl (from the "Benchmark" button), progress/errors in data/client.jsonl.

The phone (Chrome 155), 2026-10-16
  The 3D view: 60 fps while the heavy model (115k tri) spins.
  OpenSCAD plate: 0.27 s with JIT – as fast as the development machine; worker = main thread.
  IMPORTANT: Chrome's "JavaScript optimizer" (V8 optimizer) was turned off for the site
  → all JS/WASM was interpreted and became ~18–30× slower (plate 4.7 s, heavy 33 s).
  If it feels sluggish: run diag.html (the JS loop should take ~20 ms, not ~1300 ms) and
  allow the JavaScript optimizer for the site in Chrome. The APK's WebView is under our own control.
