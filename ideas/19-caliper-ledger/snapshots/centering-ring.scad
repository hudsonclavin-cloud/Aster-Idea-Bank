// PART: Thrust-transfer centering ring, 98 mm motor mount in 6 in airframe
// KIND: mechanical
// MAKE: CNC mill from 6.35 mm 6061-T6 plate; stack up to 4 blanks on a fixture plate located through two M4 holes; OD, bore, 8 holes and top chamfer in setup 1, flip for bottom chamfer; inspect OD/bore/pins
// NOTE: Airframe ID 149.60 mm (5.890 in) assumed for a 6.000 in (152.40 mm) OD tube; measure your tube and set ring_od = ID - 0.10
// NOTE: Motor mount tube OD 101.60 mm (4.000 in) assumed for a 98 mm MMT; bore_d = OD + 0.10 epoxy clearance
// NOTE: Ring OD 149.50 = 5.886 in; bore 101.70 = 4.004 in; thickness 6.35 = 0.250 in plate; bolt circle 126.00 = 4.961 in
// NOTE: 4 x M4 clearance holes 4.50 (ISO 273 medium) at 45,135,225,315 deg for all-thread or retainer bolts; 4 x 18.00 lightening holes at 0,90,180,270 deg
// NOTE: Thrust 12 kN (a large 98 mm M/N motor; declare yours) is carried by the 4 M4 bolts in single shear: use class 12.9 bolts with the plain shank (not thread) in the plate; 8.8 bolts give SF about 1.7
// NOTE: Ligaments between lightening holes and bore/OD are 3.15/2.75 mm; go to 16 mm lightening holes if the shop objects
// SPEC-BEGIN
// {"name":"98 mm centering ring for 6 in airframe","size_mm":[149.5,149.5,6.35],
//  "parts":[{"name":"ring","role":"thrust-transfer centering ring, chamfered OD, 8 holes","size_mm":[149.5,149.5,6.35]}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_mill","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"ring OD","module":"ring","axis":"x","nominal_mm":149.50,"tol_mm":0.05,"round":true,"tol_src":"default"},
//              {"name":"ring OD (y)","module":"ring","axis":"y","nominal_mm":149.50,"tol_mm":0.05,"round":true,"tol_src":"default"},
//              {"name":"plate thickness","module":"ring","axis":"z","nominal_mm":6.35,"tol_mm":0.25,"tol_src":"default"}],
//  "bores":[{"name":"MMT bore","d_mm":101.70,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":6.35,"tol_src":"default"}],
//  "holes":[{"name":"lightening holes","d_mm":18.00,"tol_mm":0.10,"pattern":"circle","n":4,"bc_d_mm":126.00,"start_deg":0,"axis":"z","from_mm":0,"to_mm":6.35,"tol_src":"default"},
//           {"name":"M4 retention bolts","d_mm":4.50,"tol_mm":0.10,"pattern":"circle","n":4,"bc_d_mm":126.00,"start_deg":45,"axis":"z","from_mm":0,"to_mm":6.35,"tol_src":"default"}],
//  "loads":[{"check":"bolt_shear","name":"thrust bolts","size":"M4","grade":"12.9","shear_plane":"shank","n":4,"force_N":12000,"plate_t_mm":6.35,"sf_min":2.0,"inputs_src":"default"}],
//  "mfg":{"stock":"6.35 mm (0.250 in) 6061-T6 plate, 160 x 160 mm blank per ring",
//         "finish":"bare; abrade OD and bore with 80 grit before epoxy bonding",
//         "heat_treat":"none",
//         "deburr":"0.5 x 45 chamfer OD both faces and 0.3 x 45 bore both faces (in the profile); break hole edges 0.2 max",
//         "inspect":["OD with micrometer at 2 places 90 deg apart","bore with 101.65 GO / 101.75 NO-GO plug or bore gauge","M4 holes with 4.40 GO / 4.60 NO-GO pins","thickness with micrometer at 4 places"],
//         "notes":["Stack-machine: clamp up to 4 blanks to a sacrificial fixture plate through two of the M4 holes (drill those first), then mill OD and bore in one setup so the bore-to-OD concentricity comes from the spindle, not the fixture",
//                  "Waterjet alternative: cut OD and bore 1.0 mm undersize/oversize, then finish the bore and OD on the mill; the bore +/-0.05 is not achievable by waterjet alone",
//                  "Faces are as-rolled plate (+/-0.25); face only if the stack needs parallel faces",
//                  "Thrust path is MMT -> epoxy fillet -> ring -> airframe; the M4 bolts tie the ring to the forward ring or retainer"]}}
// FLIGHT-END
tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
ring_od = 149.50; // ring OD: airframe ID 149.60 minus 0.10 diametral epoxy clearance (5.886 in)
bore_d = 101.70; // motor mount bore: 98 mm MMT OD 101.60 plus 0.10 diametral clearance (4.004 in)
plate_t = 6.35; // ring thickness, 0.250 in 6061-T6 plate as rolled
od_chamfer = 0.5; // 0.5 x 45 deg chamfer on the OD, both faces (deburr, eases insertion)
bore_chamfer = 0.3; // 0.3 x 45 deg chamfer on the bore, both faces (deburr)
bc_d = 126.00; // bolt circle for all 8 holes, centred between bore and OD (4.961 in)
light_n = 4; // number of lightening holes
light_d = 18.00; // lightening hole diameter, interpolated with an end mill
light_start_deg = 0; // angle of the first lightening hole from +X
bolt_n = 4; // number of M4 retention / all-thread holes
bolt_d = 4.50; // M4 clearance, ISO 273 medium
bolt_start_deg = 45; // angle of the first M4 hole from +X (midway between lightening holes)
cut_ext = 1; // hole cutters overshoot each face by this much so the boolean is clean
// --- end parameters ---
function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));
// One closed profile in [r, z]: bore wall with its chamfers, top face, OD wall with its chamfers, bottom face.
function ring_profile() = [
  [bore_d/2 + bore_chamfer, 0],
  [ring_od/2 - od_chamfer, 0],
  [ring_od/2, od_chamfer],
  [ring_od/2, plate_t - od_chamfer],
  [ring_od/2 - od_chamfer, plate_t],
  [bore_d/2 + bore_chamfer, plate_t],
  [bore_d/2, plate_t - bore_chamfer],
  [bore_d/2, bore_chamfer]
];
module ring(){ // the whole part: one revolve, one difference for the off-axis holes
  difference(){
    rotate_extrude($fn=fn_tol(ring_od)) polygon(ring_profile());
    for(i=[0:light_n-1]) rotate(light_start_deg + i*360/light_n)
      translate([bc_d/2, 0, -cut_ext]) cylinder(d=light_d, h=plate_t + 2*cut_ext, $fn=fn_tol(light_d));
    for(i=[0:bolt_n-1]) rotate(bolt_start_deg + i*360/bolt_n)
      translate([bc_d/2, 0, -cut_ext]) cylinder(d=bolt_d, h=plate_t + 2*cut_ext, $fn=fn_tol(bolt_d));
  }
}
module main(){ ring(); }
main();
