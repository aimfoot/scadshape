// expect: has no radians()
angle = 30;
cube([10, 10, 10 * cos(radians(angle))]);
