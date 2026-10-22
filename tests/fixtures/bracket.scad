// Test model: L-shaped shelf bracket with slotted mounting holes, a gusset, lightening holes and
// a raised part number. Only axis-aligned prisms, so it converts without code blocks.

t = 4;            // plate thickness
a = 60;           // vertical leg
b = 80;           // horizontal leg
w = 30;           // width
slot = [10, 5];

module slot2d(len, d) {
  hull() for (x = [0, len]) translate([x, 0]) circle(d = d, $fn = 32);
}

module holes(n, pitch) {
  for (i = [0 : n - 1]) translate([i * pitch, 0]) children();
}

// horizontal leg with two slots and three lightening holes
difference() {
  linear_extrude(t) offset(r = 3, $fn = 24) offset(delta = -3) square([b, w]);
  translate([18, w / 2, -1]) linear_extrude(t + 2) slot2d(slot.x, slot.y);
  translate([52, w / 2, -1]) linear_extrude(t + 2) slot2d(slot.x, slot.y);
  for (i = [0 : 2]) translate([12 + i * 24, 6, -1]) cylinder(d = 4, h = t + 2, $fn = 24);
}

// vertical leg with a row of holes
difference() {
  translate([0, 0, 0]) cube([t, w, a]);
  for (z = [15, 30, 45]) translate([-1, w / 2, z]) rotate([0, 90, 0]) cylinder(d = 5, h = t + 2, $fn = 24);
}

// two gussets (triangles extruded across the width)
for (y = [3, w - 3 - t]) translate([0, y + t, 0]) rotate([90, 0, 0])
  linear_extrude(t) polygon([[t, t], [t + 30, t], [t, t + 30]]);

// raised part number on the top face
translate([b - 22, w - 8, t]) linear_extrude(0.8) text("BR-80", size = 4, font = "Liberation Sans");

// corner pads
holes(2, b - 16) translate([4, 2, 0]) cube([8, 4, t + 1]);
