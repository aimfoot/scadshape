// expect: text("love") doesn't touch the shape it is cut from
// The same AI's first try: "love" embossed into the top of the ring – centred, so it lands in the
// ring's hole and cuts nothing.
outer_diameter = 22;
inner_diameter = 18;
ring_height = 6;
text_size = 3;
text_depth = 0.6;
difference() {
    cylinder(d=outer_diameter, h=ring_height, $fn=64);
    translate([0, 0, -0.1])
    cylinder(d=inner_diameter, h=ring_height+0.2, $fn=64);
    translate([0, 0, ring_height - text_depth])
    linear_extrude(height=text_depth+0.1)
    text("love", size=text_size, halign="center", valign="center", font="Liberation Sans");
}
