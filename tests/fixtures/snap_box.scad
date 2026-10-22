// Test model: small two-part box with a snap lip, a lanyard hole, a countersunk magnet seat,
// a domed button and engraved text. Mixes 2D hulls, prisms, cones, a sphere and a rotated body.

part = "both"; // [both, body, lid]

inner = [60, 34, 12];
wall = 2;
r = 4;            // corner radius
lip_h = 3;
gap = 0.2;
$fn = 48;

module rounded(size, rad) {
  hull() for (x = [rad, size.x - rad], y = [rad, size.y - rad]) translate([x, y]) circle(r = rad);
}

module body() {
  difference() {
    linear_extrude(inner.z + wall) rounded([inner.x + 2 * wall, inner.y + 2 * wall], r);
    translate([wall, wall, wall]) linear_extrude(inner.z + 1) rounded([inner.x, inner.y], r - wall);
    // lanyard hole through one end
    translate([-1, inner.y / 2 + wall, inner.z / 2 + wall]) rotate([0, 90, 0]) cylinder(d = 4, h = wall + 2);
    // countersunk magnet seat in the floor
    translate([inner.x / 2 + wall, inner.y / 2 + wall, -0.01]) cylinder(r1 = 5, r2 = 3, h = 1.5);
    // engraved label on the long side
    translate([inner.x / 2 + wall, 0.6, inner.z / 2 + wall]) rotate([90, 0, 0])
      linear_extrude(1) text("BOX", size = 5, halign = "center", valign = "center", font = "Liberation Sans");
  }
}

module lid() {
  translate([0, inner.y + 2 * wall + 8, 0]) {
    linear_extrude(wall) rounded([inner.x + 2 * wall, inner.y + 2 * wall], r);
    translate([wall + gap, wall + gap, wall]) linear_extrude(lip_h) difference() {
      rounded([inner.x - 2 * gap, inner.y - 2 * gap], r - wall);
      offset(delta = -1.2) rounded([inner.x - 2 * gap, inner.y - 2 * gap], r - wall);
    }
    // domed push button
    translate([inner.x / 2 + wall, inner.y / 2 + wall, wall]) sphere(r = 3);
    // tilted grip ridge (not axis aligned)
    translate([8, 6, wall]) rotate([0, 0, 30]) rotate([20, 0, 0]) cube([14, 2, 2]);
  }
}

if (part != "lid") body();
if (part != "body") lid();
