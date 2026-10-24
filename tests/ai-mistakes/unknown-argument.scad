// expect: has no parameter "height"
module post(d, h) cylinder(d = d, h = h);
post(d = 8, height = 20);
