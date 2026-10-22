$fn = 96;
difference() {
  linear_extrude(20) offset(r = 4) offset(delta = -4) square([80, 50]);
  for (x = [10:10:70], y = [10:10:40]) translate([x, y, -1]) cylinder(d = 6, h = 30);
  translate([40, 25, 10]) sphere(r = 18);
}
