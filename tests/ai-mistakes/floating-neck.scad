// expect: starts in mid-air at z = 35 mm
// The cavity is cut up through the top (h + epsilon), so the neck has nothing under it.
body_r = 25;
body_h = 35;
wall = 2;
neck_r = 12;
neck_h = 12;
epsilon = 0.02;
$fn = 64;
difference() {
    union() {
        cylinder(r = body_r, h = body_h);
        translate([0, 0, body_h]) cylinder(r = neck_r, h = neck_h);
    }
    translate([0, 0, wall]) cylinder(r = body_r - wall, h = body_h - wall + epsilon);
    translate([0, 0, body_h]) cylinder(r = neck_r - wall, h = neck_h + epsilon);
}
