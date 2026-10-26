// PART: Bolt-on motor retainer / thrust plate, 98 mm case in 6 in airframe
// KIND: mechanical
// MAKE: CNC lathe from 152.4 mm 6061-T6 bar — op1 face, turn OD 149.50, bore 98.60 and the 104.0 counterbore, chamfers; op2 (soft jaws on the OD) face to 10.00 and chamfer; mill 8 × 6.40 on the 132 bolt circle; inspect OD with micrometer, bore with plug gauge, bolt circle with pins
// NOTE: Airframe ID 149.60 mm (5.890 in) assumed; plate OD 149.50 = ID − 0.10 (5.886 in); measure your tube and set plate_od
// NOTE: 98 mm motor case OD 98.00 assumed (Cesaroni/AeroTech 98 mm hardware); bore 98.60 = case + 0.60 diametral for a hand slide fit under thrust; counterbore Ø104.0 × 4.0 deep from the aft face seats the case's thrust ring lip
// NOTE: 8 × M6 class 8.8 bolts, clearance 6.40 (ISO 273 fine), on a 132.00 bolt circle (5.197 in), threading into the forward ring or a tapped retainer ring ≥ 9 mm of 6061 engagement (thread check declared)
// NOTE: Thrust path: case thrust ring → counterbore shoulder → plate → 8 bolts in single shear → forward ring / airframe. 20 kN is an upper bound for a 98 mm N motor; declare your motor's peak thrust
// SPEC-BEGIN
// {"name":"98 mm bolt-on motor retainer","size_mm":[149.5,149.5,10],
//  "parts":[{"name":"plate","role":"retainer plate with bore, counterbore, chamfers and bolt holes","size_mm":[149.5,149.5,10]}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_lathe","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"plate thickness","module":"plate","axis":"z","nominal_mm":10.00,"tol_mm":0.05,"tol_src":"default"}],
//  "od":[{"name":"plate OD","d_mm":149.50,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":10,"tol_src":"default"}],
//  "bores":[{"name":"case bore","d_mm":98.60,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":10,"to_mm":4,"tol_src":"default"},
//           {"name":"thrust-ring counterbore","d_mm":104.00,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":4,"tol_src":"default"}],
//  "holes":[{"name":"M6 retention bolts","d_mm":6.40,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":8,"bc_d_mm":132.00,"start_deg":0,"axis":"z","from_mm":10,"to_mm":0,"tol_src":"default"}],
//  "loads":[{"check":"bolt_shear","name":"thrust bolts","size":"M6","grade":"8.8","n":8,"force_N":20000,"plate_t_mm":10,"sf_min":2.0,"inputs_src":"default"},
//           {"check":"thread","name":"retainer screws into 6061","size":"M6","engagement_mm":12,"internal_material":"6061-T6","inputs_src":"default"}],
//  "mfg":{"stock":"152.4 mm (6.000 in) 6061-T6 round bar, 14 mm slice","finish":"type II clear anodize after machining","heat_treat":"none",
//         "deburr":"0.5 × 45° chamfer on the OD and the bore, both faces (in the profile); break hole edges",
//         "inspect":["OD with micrometer at 2 places","bore with 98.55 GO / 98.65 NO-GO plug","counterbore depth with a depth micrometer","bolt circle with 6.30 GO pins in a fixture or on a CMM"],
//         "notes":["Torque M6 8.8 to 9 N·m with medium thread locker","Bolt shear SF is on the threads; use bolts with the plain shank in the plate for a higher margin"]}}
// FLIGHT-END
tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
plate_od = 149.50; // plate OD: airframe ID 149.60 − 0.10 (5.886 in)
plate_t = 10.00; // plate thickness (0.394 in)
bore_d = 98.60; // motor case bore: 98.00 case + 0.60 clearance
cbore_d = 104.00; // counterbore for the case thrust ring
cbore_depth = 4.00; // counterbore depth from the aft (z=0) face
bolt_n = 8; // number of retention bolts
bolt_d = 6.40; // M6 clearance, ISO 273 fine
bc_d = 132.00; // bolt circle (5.197 in)
chamfer = 0.5; // 0.5 × 45° deburr chamfer on OD and bore edges
cut_ext = 1; // cutter overshoot
// --- end parameters ---
function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));
// Half-section in [r, z], counter-clockwise: bore wall, counterbore step, aft face, OD wall, forward face.
function profile() = [
  [cbore_d/2 + chamfer, 0], [plate_od/2 - chamfer, 0], [plate_od/2, chamfer],
  [plate_od/2, plate_t - chamfer], [plate_od/2 - chamfer, plate_t],
  [bore_d/2 + chamfer, plate_t], [bore_d/2, plate_t - chamfer],
  [bore_d/2, cbore_depth], [cbore_d/2, cbore_depth], [cbore_d/2, chamfer]
];
module plate(){
  difference(){
    rotate_extrude($fn=fn_tol(plate_od)) polygon(profile());
    for(i=[0:bolt_n-1]) rotate(i*360/bolt_n) translate([bc_d/2, 0, -cut_ext]) cylinder(d=bolt_d, h=plate_t + 2*cut_ext, $fn=fn_tol(bolt_d));
  }
}
module main(){ plate(); }
main();
