// expect: threaded_nut() takes: nutwidth, id, h, pitch
// An AI's M8 nut (trial #17): an outer diameter instead of nutwidth, so a check deep in BOSL2 fails.
include <BOSL2/std.scad>
include <BOSL2/threading.scad>
threaded_nut(id = 8.2, h = 6.5, pitch = 1.25,
             od = 13, $fn = 32);
