// Heavy test: 144 overlapping spheres minus a grid of slabs
$fn = 32;
difference() {
  union()
    for (i = [0:11], j = [0:11])
      translate([i * 5, j * 5, 2 * sin(i * 30) * cos(j * 30)]) sphere(r = 3.4);
  for (i = [0:5]) translate([i * 10 + 2.5, -5, -10]) cube([2, 70, 30]);
}
