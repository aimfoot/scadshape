// expect: takes degrees in OpenSCAD, but this uses PI
r = 20;
for (i = [0:5]) translate([r * cos(i * PI / 3), r * sin(i * PI / 3), 0]) cylinder(d = 4, h = 2);
