// Test model: wall hook with a back plate, a hull-shaped arm and a mirrored pair of fins.
module plate() { linear_extrude(3) offset(r = 2, $fn = 24) square([20, 40], center = true); }
module arm2d() { hull() { square([6, 4], center = true); translate([0, 30]) circle(d = 6, $fn = 32); } }
module fin() { polygon([[0, 0], [10, 0], [0, 14]]); }

plate();
translate([0, -10, 3]) rotate([-90, 0, 0]) rotate([0, 0, 0]) linear_extrude(4, center = true) arm2d();
for (s = [-1, 1]) translate([s * 3, -12, 3]) rotate([90, 0, 90]) linear_extrude(1.5, center = true) mirror([s < 0 ? 1 : 0, 0]) fin();
translate([-4, 14, 3]) cube([8, 6, 4]);
