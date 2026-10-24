// Ring with "love" engraved around the outside, printed standing on its edge (axis upright)
// Band: the finger ring, 18 mm inside, with small 45° chamfers on all four edges so it is comfortable.
// Letters: "love" cut into the outer wall, each letter turned to face outward, centred on the band's height.
// Rule note: the ring prints upright, so the letters stand on the outer wall; their tops are 0.5 mm
//   ledges, which print fine. No support is needed.

inner_d   = 18;   // inner diameter (finger size)
wall      = 2;    // band thickness
height    = 6;    // band width (height when printed)
chamfer   = 0.5;  // 45° chamfer on the edges
txt       = "love"; // the engraved word
text_size = 3.6;  // letter height
depth     = 0.5;  // engraving depth
spacing   = 0.85; // distance between letter centres, as a share of the letter height

font  = "Liberation Sans:style=Bold";
$fn   = 96;

inner_r = inner_d / 2;
outer_r = inner_r + wall;
step    = spacing * text_size / outer_r * 180 / PI; // degrees between letter centres

difference() {
  // Band with chamfered edges (a profile turned around the axis)
  rotate_extrude()
    polygon([
      [inner_r + chamfer, 0], [outer_r - chamfer, 0], [outer_r, chamfer],
      [outer_r, height - chamfer], [outer_r - chamfer, height], [inner_r + chamfer, height],
      [inner_r, height - chamfer], [inner_r, chamfer]
    ]);

  // Letters, read left to right from outside, centred on angle 0
  for (i = [0 : len(txt) - 1])
    rotate([0, 0, (i - (len(txt) - 1) / 2) * step])
      translate([outer_r - depth, 0, height / 2])
        rotate([90, 0, 90])
          linear_extrude(height = depth + 1)
            text(txt[i], size = text_size, font = font, halign = "center", valign = "center");
}
