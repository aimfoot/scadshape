// Test model: knurled-ish knob built entirely with BOSL2 (stays OpenSCAD code when converted).
include <BOSL2/std.scad>

$fn = 64;
diff() cyl(d = 30, h = 14, rounding2 = 3, anchor = BOTTOM) {
  attach(TOP, overlap = 1) tag("remove") cyl(d = 6.2, h = 10, anchor = TOP);
  tag("remove") zrot_copies(n = 12, r = 15.5) cyl(d = 3, h = 20);
}
