// expect: Use children() instead
// fix: translate([0, 0, h]) children(0);
module on_top(h) translate([0, 0, h]) child();
cube(10);
on_top(10) sphere(3);
