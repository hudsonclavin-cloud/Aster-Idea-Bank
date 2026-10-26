// PART: Machined av-bay coupler tube, 6 in airframe, shear-pin and rail-button holes
// KIND: mechanical
// MAKE: CNC lathe from 152.4 mm 6061-T6 bar or 6 in × 0.25 wall tube — op1 turn OD 149.30 over the full length, bore 142.90, chamfer; op2 flip, face to 300.00 and chamfer; mill 6 radial shear-pin holes and the rail-button tap drill in a rotary fixture; inspect OD with micrometer at 3 places, wall with a tube micrometer, holes with pins
// NOTE: Airframe ID 149.60 mm (5.890 in) assumed; coupler OD 149.30 = ID − 0.30 diametral (0.15 mm per side, a hand slide fit that the shear pins locate); measure your tube and set coupler_od
// NOTE: Length 300.00 = 2 calibers (1 caliber = 149.6 mm per side of the joint); wall 3.20 (bore 142.90 = 5.626 in)
// NOTE: Shear pins: 3 × 2-56 nylon screws per end at 120°, 25.0 mm from each end; the coupler carries the clearance hole 2.20 (2-56 major 2.18 + clearance), the airframe is tapped; 2-56 nylon shears at about 150 N each [Likely], declared as a bolt_shear check with the ejection load the three pins must survive during drag separation
// NOTE: Rail button: one #8-32 tapped hole at mid-length (tap drill #29 = 3.45 mm, modelled at tap drill) for a 1515 button; the second button goes on the airframe
// NOTE: In a lathe the OD and bore come from one setup so concentricity is spindle-limited; do not re-chuck between OD and bore
// SPEC-BEGIN
// {"name":"6 in machined coupler tube","size_mm":[149.3,149.3,300],
//  "parts":[{"name":"tube","role":"coupler tube with chamfers and radial holes","size_mm":[149.3,149.3,300]}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_lathe","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"length","module":"main","axis":"z","nominal_mm":300.00,"tol_mm":0.10,"tol_src":"default"}],
//  "od":[{"name":"coupler OD","d_mm":149.30,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":2,"to_mm":298,"tol_src":"default"}],
//  "bores":[{"name":"bore","d_mm":142.90,"tol_mm":0.10,"at_mm":[0,0],"axis":"z","from_mm":300,"to_mm":0,"tol_src":"default"}],
//  "holes":[{"name":"shear pin, aft, 0°","d_mm":2.20,"tol_mm":0.10,"pattern":"single","at_mm":[0,25],"axis":"x","from_mm":74.65,"to_mm":71.45,"tol_src":"default"},
//           {"name":"shear pin, fwd, 0°","d_mm":2.20,"tol_mm":0.10,"pattern":"single","at_mm":[0,275],"axis":"x","from_mm":74.65,"to_mm":71.45,"tol_src":"default"},
//           {"name":"rail button tap drill #8-32","d_mm":3.45,"tol_mm":0.10,"pattern":"single","at_mm":[0,150],"axis":"y","from_mm":-74.65,"to_mm":-71.45,"tol_src":"default"}],
//  "gauges":[{"name":"shear pins at 120° and 240°, both ends","module":"gauge_pins_go","expect":"clear","why":"the four off-axis radial pin holes exist at 2.09 minimum"}],
//  "loads":[{"check":"bolt_shear","name":"3 nylon shear pins at separation","size":"#2-56","n":3,"force_N":150,"bolt_sigma_y_MPa":60,"plate_t_mm":3.2,"sf_min":1.0,"inputs_src":"default"}],
//  "mfg":{"stock":"152.4 mm 6061-T6 round bar, 310 mm, or 6 in × 0.25 in wall 6061-T6 tube","finish":"bare or type II anodize; the OD is a sliding fit, no paint on it","heat_treat":"none",
//         "deburr":"0.5 × 45° chamfer on OD and bore at both ends (in the profile); deburr the radial holes inside and out",
//         "inspect":["OD with micrometer at both ends and mid-length","bore with a bore gauge","length with a height gauge","pin holes with 2.10 GO / 2.30 NO-GO pins","tap drill with a 3.40 pin before tapping"],
//         "notes":["Drag-separation load on the pins: (mass aft of the joint) × deceleration at burnout; 150 N (50 N per pin) is a placeholder — compute yours","Nylon 2-56 yield ≈ 60 MPa is a placeholder for the pin material [Speculative]; test three pins to failure"]}}
// FLIGHT-END
tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
coupler_od = 149.30; // coupler OD: airframe ID 149.60 − 0.30 (5.878 in)
wall = 3.20; // wall thickness
length = 300.00; // coupler length, 2 calibers
pin_d = 2.20; // 2-56 nylon shear pin clearance
pin_inset = 25.0; // pin holes from each end
pin_n = 3; // pins per end, equally spaced
rail_d = 3.45; // #8-32 tap drill (#29)
rail_z = 150.0; // rail button hole height
chamfer = 0.5; // 0.5 × 45° deburr chamfer
cut_ext = 2; // cutter overshoot beyond the OD
// --- end parameters ---
function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));
bore_d = coupler_od - 2*wall;
function profile() = [
  [bore_d/2 + chamfer, 0], [coupler_od/2 - chamfer, 0], [coupler_od/2, chamfer],
  [coupler_od/2, length - chamfer], [coupler_od/2 - chamfer, length],
  [bore_d/2 + chamfer, length], [bore_d/2, length - chamfer], [bore_d/2, chamfer]
];
module radial_hole(d, z, a){ rotate(a) translate([bore_d/2 - 1, 0, z]) rotate([0,90,0]) cylinder(d=d, h=wall + 1 + cut_ext, $fn=fn_tol(d)); }
module tube(){
  difference(){
    rotate_extrude($fn=fn_tol(coupler_od)) polygon(profile());
    for(z=[pin_inset, length - pin_inset]) for(i=[0:pin_n-1]) radial_hole(pin_d, z, i*360/pin_n);
    radial_hole(rail_d, rail_z, -90);   // rail button hole along −y
  }
}
// GO gauge: pins of (2.20 − 0.10 − 0.02) at the four holes the CMM cannot reach along an axis
module gauge_pins_go(){ for(z=[pin_inset, length - pin_inset]) for(i=[1:pin_n-1]) rotate(i*360/pin_n) translate([bore_d/2 + 0.2, 0, z]) rotate([0,90,0]) cylinder(d=pin_d - 0.12, h=wall - 0.4, $fn=fn_tol(pin_d)); }
module main(){ tube(); }
main();
