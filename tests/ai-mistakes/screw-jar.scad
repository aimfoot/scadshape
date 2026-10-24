// expect: starts in mid-air at z = 35 mm
// An AI chat's answer to the app's prompt (2026-10): the cavity cut takes away the top the neck stands on.
// Tiny screw-top container — export/print the body and lid side by side.
// Units: mm

// Main dimensions
body_radius = 25;                 // outer body radius
body_height = 35;                 // body height
body_wall = 2;                    // body side-wall thickness
floor_thickness = 2;              // body floor thickness
neck_radius = 12;                 // neck radius at thread roots
neck_wall = 2;                    // neck wall thickness
neck_height = 12;                 // neck height above body

// Thread dimensions
thread_depth = 0.8;               // thread radial height
thread_pitch = 2.4;               // thread pitch
thread_width_ratio = 0.42;        // thread width as a fraction of pitch
fit_clearance = 0.25;             // thread clearance; increase if too tight
thread_bottom_clearance = 1.5;    // space below the threads
thread_top_clearance = 1.5;       // space above the threads
thread_slice_factor = 24;         // helical mesh slices per pitch
minimum_thread_slices = 24;       // minimum helical mesh slices

// Lid dimensions
lid_height = 14;                  // lid height
lid_wall = 2;                     // lid side-wall thickness
lid_top = 2;                      // lid top thickness

// Print layout
layout_gap = 8;                   // gap between body and lid
sides = 64;                       // circle resolution; maximum allowed: 96

// Small offsets and angles
epsilon = 0.02;                   // small overlap to avoid coincident surfaces
zero = 0;                         // zero coordinate
flip_angle = 180;                 // lid print-orientation rotation
full_turn = 360;                  // degrees in a full turn

// Derived dimensions
body_inner_radius = body_radius - body_wall;
neck_inner_radius = neck_radius - neck_wall;
thread_width = thread_pitch * thread_width_ratio;
thread_start = body_height + thread_bottom_clearance;
thread_height = neck_height - thread_bottom_clearance - thread_top_clearance;
lid_bottom_on_body = body_height + neck_height - lid_height;
lid_outer_radius = neck_radius + thread_depth + fit_clearance + lid_wall;
lid_layout_x = body_radius + lid_outer_radius + layout_gap;

$fn = sides;

// Helical thread ridge for the body, or matching groove cutter for the lid.
module helical_thread(root_radius, depth, pitch, start_z, height, female=false) {
    twist_angle = full_turn * height / pitch;
    slice_count = max(
        minimum_thread_slices,
        ceil(height / pitch * thread_slice_factor)
    );

    translate([zero, zero, start_z])
        linear_extrude(
            height = height,
            twist = twist_angle,
            slices = slice_count,
            convexity = 10
        )
            translate([root_radius, zero])
                polygon(points =
                    female
                    ? [
                        [depth, -thread_width / 2],
                        [zero, zero],
                        [depth, thread_width / 2]
                      ]
                    : [
                        [zero, -thread_width / 2],
                        [depth, zero],
                        [zero, thread_width / 2]
                      ]
                );
}

module body() {
    union() {
        // Hollow body with a narrower neck opening.
        difference() {
            union() {
                cylinder(r=body_radius, h=body_height);
                translate([zero, zero, body_height])
                    cylinder(r=neck_radius, h=neck_height);
            }

            translate([zero, zero, floor_thickness])
                cylinder(
                    r=body_inner_radius,
                    h=body_height - floor_thickness + epsilon
                );

            translate([zero, zero, body_height])
                cylinder(
                    r=neck_inner_radius,
                    h=neck_height + epsilon
                );
        }

        // External screw thread.
        helical_thread(
            neck_radius,
            thread_depth,
            thread_pitch,
            thread_start,
            thread_height
        );
    }
}

// Lid is modeled with its opening at z=0, ready to be inverted for printing.
module lid_local() {
    difference() {
        cylinder(r=lid_outer_radius, h=lid_height);

        // Hollow interior, leaving the lid top closed.
        translate([zero, zero, -epsilon])
            cylinder(
                r=neck_radius + thread_depth + fit_clearance,
                h=lid_height - lid_top + epsilon
            );

        // Matching internal thread groove.
        helical_thread(
            neck_radius + fit_clearance,
            thread_depth + fit_clearance,
            thread_pitch,
            thread_start - lid_bottom_on_body,
            thread_height,
            female=true
        );
    }
}

// Both parts are separate and rest on the bed.
// The lid is placed top-face-down so its opening faces upward for printing.
body();

translate([lid_layout_x, zero, lid_height])
    rotate([flip_angle, zero, zero])
        lid_local();
