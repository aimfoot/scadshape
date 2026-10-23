// expect: doesn't add up in OpenSCAD
heights = [5, 10, 15];
total = 0;
for (h = heights) {
    total = total + h;
}
cube([10, 10, max(total, 1)]);
