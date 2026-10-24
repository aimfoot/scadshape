// expect: 8 places start in mid-air at z = 68 mm
// An AI's "fix" for a box with a screw cap: ridges instead of a thread, hanging into a cavity open at the bottom.
include <BOSL2/std.scad>
box_width = 100; box_height = 80; wall_thick = 5; base_thick = 10;
thread_dia = 50; thread_depth = 1.5; thread_len = 12; thread_count = 8;
cap_dia = 54; cap_height = 22; cap_wall = 3; spacing = 6;
translate([0, 0, box_height/2]) {
    difference() {
        cube([box_width, box_width, box_height], center=true);
        translate([0, 0, -base_thick/2 + 1])
            cube([box_width - 2*wall_thick, box_width - 2*wall_thick, box_height - base_thick + 2], center=true);
        translate([0, 0, box_height/2 - 1])
            cylinder(h=3, d=thread_dia + 2, center=true, $fn=96);
    }
    translate([0, 0, box_height/2 - thread_len/2]) {
        for (i = [0:thread_count-1]) {
            angle = i * 360 / thread_count;
            rotate([0, 0, angle])
                translate([thread_dia/2 - thread_depth/2, 0, 0])
                    cube([thread_depth, 1.5, thread_len], center=true);
        }
    }
}
cap_x = box_width/2 + spacing + cap_dia/2;
translate([cap_x, 0, cap_height/2]) {
    difference() {
        cylinder(h=cap_height, d=cap_dia, center=true, $fn=96);
        translate([0, 0, 1])
            cylinder(h=cap_height - 2, d=thread_dia - 0.5, center=true, $fn=96);
        for (angle = [0:60:300]) {
            rotate([0, 0, angle])
                translate([cap_dia/2 - 2, 0, cap_height/2 - 2])
                    cube([2, 3, 2], center=true);
        }
        translate([0, 0, -cap_height/2 + thread_len/2 + 2]) {
            for (i = [0:thread_count-1]) {
                angle = i * 360 / thread_count;
                rotate([0, 0, angle])
                    translate([thread_dia/2 - thread_depth/2, 0, 0])
                        cube([thread_depth, 2, thread_len], center=true);
            }
        }
    }
}
