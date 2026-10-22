$fn = 128;
difference() {
  union() {
    cylinder(h = 90, r1 = 36, r2 = 42);
    // Handtag: en halv torus på sidan
    translate([38, 0, 45]) rotate([90, 0, 0])
      rotate_extrude(angle = 360) translate([24, 0]) circle(r = 5);
  }
  translate([0, 0, 4]) cylinder(h = 100, r1 = 33, r2 = 39);
}
