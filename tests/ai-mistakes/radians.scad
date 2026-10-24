// expect: has no radians()
// fix: cos(angle)
angle = 30;
cube([10, 10, 10 * cos(radians(angle))]);
