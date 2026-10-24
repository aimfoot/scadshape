// expect: is the part upside down
// An AI's last "fix" of a box with a screw cap: nothing in mid-air any more, but the cavity is cut
// through the floor, so the box is open below, closed on top, with a 90 mm flat ceiling.
include <BOSL2/std.scad>
box_width = 100; box_height = 80; wall_thick = 5; base_thick = 10;
thread_dia = 50; thread_depth = 1.5; thread_len = 12; thread_count = 8;
cap_dia = 54; cap_height = 22; spacing = 6;
translate([0, 0, box_height/2]) {
    difference() {
        cube([box_width, box_width, box_height], center=true);
        translate([0, 0, -base_thick/2 + 1])
            cube([box_width - 2*wall_thick, box_width - 2*wall_thick, box_height - base_thick + 2], center=true);
        translate([0, 0, box_height/2 - 1])
            cylinder(h=3, d=thread_dia + 2, center=true, $fn=96);
        translate([0, 0, box_height/2 - thread_len/2]) {
            for (i = [0:thread_count-1]) {
                angle = i * 360 / thread_count;
                rotate([0, 0, angle])
                    translate([thread_dia/2 + 1.5, 0, 0])
                        cube([3, 2, thread_len], center=true);
            }
        }
    }
}
cap_x = box_width/2 + spacing + cap_dia/2;
translate([cap_x, 0, cap_height/2]) {
    difference() {
        cylinder(h=cap_height, d=cap_dia, center=true, $fn=96);
        translate([0, 0, 1])
            cylinder(h=cap_height - 2, d=thread_dia - 2, center=true, $fn=96);
        for (angle = [0:60:300]) {
            rotate([0, 0, angle])
                translate([cap_dia/2 - 2, 0, cap_height/2 - 2])
                    cube([2, 3, 2], center=true);
        }
        translate([0, 0, -cap_height/2 + thread_len/2 + 2]) {
            for (i = [0:thread_count-1]) {
                angle = i * 360 / thread_count;
                rotate([0, 0, angle])
                    translate([thread_dia/2 + 1.5, 0, 0])
                        cube([3, 2.5, thread_len], center=true);
            }
        }
    }
}
