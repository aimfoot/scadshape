// expect: assign() was removed
// fix: let(x = i * 10)
for (i = [0:2]) assign(x = i * 10) translate([x, 0, 0]) cube(5);
