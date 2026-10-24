// expect: has no degrees()
// fix: tilt = atan2(5, 20);
tilt = degrees(atan2(5, 20));
rotate([tilt, 0, 0]) cube([20, 2, 30]);
