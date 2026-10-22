// Test model: mirrored cable clip with rounded profile, made from polygons and offsets in loops.
w = 10;
module half() {
  polygon([[0, 0], [12, 0], [12, 3], [5, 3], [5, 12], [9, 16], [7, 18], [2, 13], [2, 3], [0, 3]]);
}
linear_extrude(w) {
  offset(r = 0.6, $fn = 16) offset(delta = -0.6) half();
  mirror([1, 0]) offset(r = 0.6, $fn = 16) offset(delta = -0.6) half();
}
// screw tab
translate([-20, 0, 0]) linear_extrude(3) difference() {
  square([40, w]);
  for (x = [5, 35]) translate([x, w / 2]) circle(d = 3.4, $fn = 24);
}
