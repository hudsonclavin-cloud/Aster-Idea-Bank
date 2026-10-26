// PART: Av-bay ejection bulkhead with face-seal O-ring, 6 in coupler
// KIND: mechanical
// MAKE: CNC lathe + 3-axis mill from a 45 mm slice of 152.4 mm 6061-T6 round bar; lathe op1 (bar in chuck): face the seal side, cut the O-ring groove, turn OD 146.20 with the seal-side chamfer, part off; mill op2 (seal face down in soft jaws on the OD): face to 37.70 overall, mill down to the 12.70 plate face around the two bosses, chamfer the top OD edge, bore the two pockets, drill/ream the 10 holes, tap #8-32; inspect OD with micrometer, thickness, groove with gauge rings, holes with GO/NO-GO pins
// NOTE: Coupler ID 146.30 mm (5.760 in) assumed for a 6 in fibreglass coupler; bulkhead OD 146.20 = ID - 0.10 (5.756 in); measure your coupler and set plate_od = ID - 0.10
// NOTE: Plate 12.70 = 0.500 in; overall height 37.70 = 1.484 in; bosses 22.00 dia x 25 above the plate at x = +/-40; pockets 16.50 dia x 20 deep (4.3 cm3, about 4 g FFFg black powder each, tape cap) for a printed or PVC charge cup; for 1/2-14 NPT charge caps set pocket_d = 17.86 (45/64 in tap drill) and tap
// NOTE: O-ring AS568-250, ID 4.984 in = 126.59 mm, W 0.103 in = 2.62 mm, nitrile 70 A (FKM 75 A if the seal sees hot gas). Face seal on the INBOARD (bottom, z=0) face against a stop ring bonded in the coupler: ejection pressure and the rod nuts both push the seal shut. Pressure comes from the OD side (external), so the groove ID equals the O-ring ID per Parker ORD 5700 section 4
// NOTE: Groove 126.60 ID x 3.10 wide x 1.96 deep, Parker ORD 5700 Design Chart 4-3 face seal for W .103: depth .074-.080 in, width .120-.125 in for vacuum/gases (.140-.146 for liquids), squeeze about 25 %; break groove corners R 0.13-0.38 (.005-.015 in); seal land 0.8 um Ra max, no radial scratches
// NOTE: Stop ring in the coupler must cover the groove: land ID <= 125 mm, land OD = coupler ID; the 4 rods pass inside it on the 110 bolt circle
// NOTE: 4 x 6.60 holes = 1/4 in all-thread clearance (6.35 + 0.25) on a 110.00 bolt circle (4.331 in) at 45/135/225/315 deg; 2 x 7.00 holes for a 1/4-20 U-bolt on 44.45 (1.750 in) centres along y; every through hole is INSIDE the seal, so put bonded sealing washers under the rod nuts and the U-bolt nuts or gas bypasses the O-ring
// NOTE: 2 x 3.20 e-match lead feed-throughs at (+/-6, -40), potted with epoxy after wiring; 2 x #8-32 tapped holes (tap drill #29 = 3.45 mm, 10 deep, modelled at tap drill) on 25.4 centres at y = -50 for a 2-position barrier strip; change tb_pitch/tb_drill for your block
// NOTE: Recovery shock 5 kN on the U-bolt is tension in the two 1/4-20 legs (122 MPa on the 20.5 mm2 stress area) and tension in the 4 all-thread rods. Declared as bolt_shear per the contract, which checks 0.577*sy and is therefore conservative for a tension load. SPECIFY A STAINLESS A2-70 U-BOLT: a zinc-plated grade-2 steel one (sy 393 MPa) makes only SF 1.86 against that conservative basis, and this file used to pass only because an undeclared grade silently defaulted to 8.8
// SPEC-BEGIN
// {"name":"6 in av-bay ejection bulkhead","size_mm":[146.2,146.2,37.7],
//  "parts":[{"name":"plate","role":"bulkhead disc with face-seal groove, OD chamfers and all through holes","size_mm":[146.2,146.2,12.7]},
//           {"name":"charge_well_a","role":"charge well boss at +x with the ejection charge pocket","size_mm":[22,22,27]},
//           {"name":"charge_well_b","role":"charge well boss at -x with the ejection charge pocket","size_mm":[22,22,27]}],
//  "joints":[{"a":"charge_well_a","b":"plate","overlap_mm":2},{"a":"charge_well_b","b":"plate","overlap_mm":2}],
//  "proportions":[{"a":"charge_well_a","b":"plate","axis":"z","min":2.0,"max":2.3,"why":"boss stands about 2x the plate thickness so the pocket keeps a 5 mm floor above the plate"}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_lathe","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"bulkhead OD","module":"plate","axis":"x","nominal_mm":146.20,"tol_mm":0.05,"round":true,"tol_src":"default"},
//              {"name":"bulkhead OD (y)","module":"plate","axis":"y","nominal_mm":146.20,"tol_mm":0.05,"round":true,"tol_src":"default"},
//              {"name":"plate thickness","module":"plate","axis":"z","nominal_mm":12.70,"tol_mm":0.05,"tol_src":"user"},
//              {"name":"overall height","module":"main","axis":"z","nominal_mm":37.70,"tol_mm":0.10,"tol_src":"default"},
//              {"name":"boss OD","module":"charge_well_a","axis":"x","nominal_mm":22.00,"tol_mm":0.10,"round":true,"tol_src":"default"}],
//  "bores":[{"name":"charge pocket A","d_mm":16.50,"tol_mm":0.10,"at_mm":[40,0],"axis":"z","from_mm":17.7,"to_mm":37.7,"tol_src":"default"},
//           {"name":"charge pocket B","d_mm":16.50,"tol_mm":0.10,"at_mm":[-40,0],"axis":"z","from_mm":17.7,"to_mm":37.7,"tol_src":"default"}],
//  "holes":[{"name":"all-thread rods 1/4 in","d_mm":6.60,"tol_mm":0.10,"pattern":"circle","n":4,"bc_d_mm":110.00,"start_deg":45,"axis":"z","from_mm":0,"to_mm":12.7,"tol_src":"default"},
//           {"name":"U-bolt 1/4-20","d_mm":7.00,"tol_mm":0.10,"pattern":"list","at_mm":[[0,22.225],[0,-22.225]],"axis":"z","from_mm":0,"to_mm":12.7,"tol_src":"default"},
//           {"name":"e-match feed-through","d_mm":3.20,"tol_mm":0.10,"pattern":"list","at_mm":[[6,-40],[-6,-40]],"axis":"z","from_mm":0,"to_mm":12.7,"tol_src":"default"},
//           {"name":"terminal block #8-32 tap drill","d_mm":3.45,"tol_mm":0.10,"pattern":"list","at_mm":[[12.7,-50],[-12.7,-50]],"axis":"z","from_mm":2.7,"to_mm":12.7,"tol_src":"default"}],
//  "gauges":[{"name":"groove GO ring","module":"gauge_groove_go","expect":"clear","why":"groove at least 126.68 ID to 132.72 OD and 1.94 deep everywhere"},
//            {"name":"groove ID wall NO-GO","module":"gauge_groove_nogo_id","expect":"blocked","why":"groove ID wall not below 126.52 (O-ring seats on this wall)"},
//            {"name":"groove OD wall NO-GO","module":"gauge_groove_nogo_od","expect":"blocked","why":"groove OD wall not above 132.88"},
//            {"name":"groove depth NO-GO","module":"gauge_groove_nogo_depth","expect":"blocked","why":"groove floor not deeper than 2.00 (squeeze stays above 22 %)"}],
//  "loads":[{"check":"bolt_shear","name":"U-bolt recovery shock","size":"1/4-20","grade":"A2-70","n":2,"force_N":5000,"plate_t_mm":12.7,"sf_min":2.0,"inputs_src":"default"},
//           {"check":"thread","name":"terminal block screws","size":"#8-32","engagement_mm":10,"internal_material":"6061-T6","sf_min":2.0,"inputs_src":"default"}],
//  "mfg":{"stock":"152.4 mm (6.000 in) 6061-T6 round bar, 45 mm slice per bulkhead",
//         "finish":"bare or type II clear anodize; seal land and groove 0.8 um Ra (32 uin) max with a circular lay",
//         "heat_treat":"none",
//         "deburr":"0.5 x 45 chamfer OD both faces, boss top edge and pocket mouth (in the profiles); break hole edges 0.2 max; groove corners R 0.13-0.38 per Parker",
//         "inspect":["OD with micrometer at 2 places 90 deg apart","plate thickness with micrometer at 4 places between holes","groove width and depth with the GO/NO-GO gauge rings or a depth micrometer and pin","rod holes 6.50 GO / 6.70 NO-GO pins, U-bolt holes 6.90 / 7.10, feed-throughs 3.10 / 3.30, pockets 16.40 / 16.60 plug","#8-32 with a 2B thread plug gauge after tapping"],
//         "notes":["Lathe first: OD, seal face and groove in one chucking so the groove is concentric with the OD; the mill then locates on that OD in soft jaws",
//                  "Groove is a finish plunge with a 3.0 mm grooving insert then a sizing pass; do not sand the seal land",
//                  "Tapped holes are drilled 10 deep and tapped 8 deep; the 118 deg drill point adds 1.0 mm beyond the modelled flat bottom",
//                  "Sealing washers (bonded, Dowty type) under every nut on the charge side; pot the feed-throughs with epoxy after wiring",
//                  "Mass about 590 g (217.9 cm3) machined from a 2.2 kg slice; the two 25 mm bosses cost most of the milling time, split-line them as separate turned inserts if the shop prefers"]}}
// FLIGHT-END
tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
plate_od = 146.20; // bulkhead OD: coupler ID 146.30 minus 0.10 diametral clearance (5.756 in)
plate_t = 12.70; // plate thickness, 0.500 in
od_chamfer = 0.5; // 0.5 x 45 deg chamfer on the OD, both faces (deburr, leads into the coupler)
oring_w = 2.62; // O-ring cross section, AS568 W .103 in
oring_id = 126.59; // O-ring ID, AS568-250 = 4.984 in
groove_id = 126.60; // groove ID = O-ring ID (external pressure seats the ring on the ID wall), Parker ORD 5700 sec 4
groove_w = 3.10; // groove width, Parker Design Chart 4-3 face seal W .103, vacuum and gases .120-.125 in
groove_depth = 1.96; // groove depth, Parker Design Chart 4-3 face seal W .103, .074-.080 in (25 % squeeze on 2.62)
groove_tol = 0.04; // groove wall and floor position tolerance per side, Parker +/-.003 in on width and depth, halved per wall
groove_od = groove_id + 2*groove_w; // groove OD, derived
well_x = 40; // charge well boss centres at +/- this x
boss_d = 22.00; // charge well boss OD
boss_h = 25; // boss height above the plate top face
boss_joint = 2; // boss profile extends this far into the plate so the union is one solid
pocket_d = 16.50; // charge pocket bore, plain, for a printed or PVC charge cup
pocket_depth = 20; // charge pocket depth from the boss top
boss_chamfer = 0.5; // 0.5 x 45 deg chamfer on the boss top edge and the pocket mouth (deburr)
rod_hole_d = 6.60; // 1/4 in all-thread clearance: 6.35 plus 0.25
rod_bc_d = 110.00; // all-thread bolt circle, 4.331 in
rod_n = 4; // number of all-thread rods
rod_start_deg = 45; // angle of the first rod hole from +X, keeps them clear of the charge wells
ubolt_hole_d = 7.00; // 1/4-20 U-bolt leg clearance: 6.35 plus 0.65 (hole for a bent leg pair)
ubolt_pitch = 44.45; // U-bolt leg centres, 1.750 in, along y
feed_d = 3.20; // e-match lead feed-through, epoxy potted after wiring
feed_x = 6; // feed-through holes at +/- this x
feed_y = -40; // feed-through holes at this y, between the U-bolt and the terminal block
tb_drill = 3.45; // #8-32 tap drill, #29 = 0.1360 in
tb_pitch = 25.4; // terminal block mounting hole centres, 1.000 in
tb_y = -50; // terminal block screw holes at this y
tb_depth = 10; // tapped hole depth from the top face (blind: the plate stays sealed)
cut_ext = 1; // hole cutters overshoot each face by this much so the boolean is clean
// --- end parameters ---
function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));
// Plate profile in [r, z], one closed loop: axis, seal face (z=0) with the groove, OD with both chamfers, top face.
function plate_profile() = [
  [0, 0],
  [groove_id/2, 0],
  [groove_id/2, groove_depth],
  [groove_od/2, groove_depth],
  [groove_od/2, 0],
  [plate_od/2 - od_chamfer, 0],
  [plate_od/2, od_chamfer],
  [plate_od/2, plate_t - od_chamfer],
  [plate_od/2 - od_chamfer, plate_t],
  [0, plate_t]
];
// Boss profile in [r, z] about its own axis: starts boss_joint inside the plate, pocket and both chamfers in the profile.
function boss_profile() = let(z0 = plate_t - boss_joint, top = plate_t + boss_h, floor = top - pocket_depth) [
  [0, z0],
  [boss_d/2, z0],
  [boss_d/2, top - boss_chamfer],
  [boss_d/2 - boss_chamfer, top],
  [pocket_d/2 + boss_chamfer, top],
  [pocket_d/2, top - boss_chamfer],
  [pocket_d/2, floor],
  [0, floor]
];
module plate(){ // one revolve, one difference for the ten off-axis holes
  difference(){
    rotate_extrude($fn=fn_tol(plate_od)) polygon(plate_profile());
    union(){
      for(i=[0:rod_n-1]) rotate(rod_start_deg + i*360/rod_n)
        translate([rod_bc_d/2, 0, -cut_ext]) cylinder(d=rod_hole_d, h=plate_t + 2*cut_ext, $fn=fn_tol(rod_hole_d));
      for(sy=[-1, 1]) translate([0, sy*ubolt_pitch/2, -cut_ext]) cylinder(d=ubolt_hole_d, h=plate_t + 2*cut_ext, $fn=fn_tol(ubolt_hole_d));
      for(sx=[-1, 1]) translate([sx*feed_x, feed_y, -cut_ext]) cylinder(d=feed_d, h=plate_t + 2*cut_ext, $fn=fn_tol(feed_d));
      for(sx=[-1, 1]) translate([sx*tb_pitch/2, tb_y, plate_t - tb_depth]) cylinder(d=tb_drill, h=tb_depth + cut_ext, $fn=fn_tol(tb_drill));
    }
  }
}
module charge_well(sx){ translate([sx*well_x, 0, 0]) rotate_extrude($fn=fn_tol(boss_d)) polygon(boss_profile()); }
module charge_well_a(){ charge_well(1); }
module charge_well_b(){ charge_well(-1); }
// Gauge rings for the O-ring groove (intersected with main() by the app; never part of the part).
module gauge_ring(r_in, r_out, z0, z1){ rotate_extrude($fn=fn_tol(2*r_out)) translate([r_in, z0]) square([r_out - r_in, z1 - z0]); }
module gauge_groove_go(){ gauge_ring(groove_id/2 + groove_tol + tess_tol, groove_od/2 - groove_tol - tess_tol, 0.01, groove_depth - groove_tol - tess_tol); }
module gauge_groove_nogo_id(){ gauge_ring(groove_id/2 - groove_tol - 0.001, groove_id/2 + groove_w/4, 0.01, groove_depth/2); }
module gauge_groove_nogo_od(){ gauge_ring(groove_od/2 - groove_w/4, groove_od/2 + groove_tol + 0.001, 0.01, groove_depth/2); }
module gauge_groove_nogo_depth(){ gauge_ring(groove_id/2 + groove_w/4, groove_od/2 - groove_w/4, 0.01, groove_depth + groove_tol + 0.001); }
module main(){ union(){ plate(); charge_well_a(); charge_well_b(); } }
main();
