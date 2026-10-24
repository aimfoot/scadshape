// expect: For screw threads use BOSL2
// An AI answer for a box with a screw cap: screw_thread() is from a thread library the app doesn't have.
include <BOSL2/std.scad>
thread_dia = 50;   // thread diameter
thread_pitch = 4;  // thread pitch
thread_len = 12;   // thread length
cylinder(d = thread_dia - 3, h = 20);
translate([0, 0, 20]) screw_thread(d = thread_dia, pitch = thread_pitch, l = thread_len, internal = false);
