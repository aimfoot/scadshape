// expect: assembly of 3 colored parts
color("gray") cube([40, 40, 3]);
color("red") translate([0, 0, 3]) cylinder(d = 10, h = 20);
color("blue") translate([0, 0, 23]) cube([40, 40, 3]);
