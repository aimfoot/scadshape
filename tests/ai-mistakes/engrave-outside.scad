// expect: text("love") doesn't touch the shape it is cut from
// An AI's ring with "love" engraved on the outside: the text starts at the outer surface and is
// extruded outward, so it cuts nothing.
outer_diameter = 22;
inner_diameter = 18;
ring_height = 6;
text_size = 3;
text_depth = 0.6;
difference() {
    cylinder(d=outer_diameter, h=ring_height, $fn=64);
    translate([0, 0, -0.1])
    cylinder(d=inner_diameter, h=ring_height+0.2, $fn=64);
    translate([outer_diameter/2, 0, ring_height/2])
    rotate([0, 90, 0])
    linear_extrude(height=text_depth+0.1)
    text("love", size=text_size, halign="center", valign="center", font="Liberation Sans");
}
