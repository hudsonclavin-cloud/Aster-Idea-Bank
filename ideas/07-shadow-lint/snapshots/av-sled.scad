// PART: Avionics sled, 6 in av-bay, SLS PA12 nylon
// KIND: mechanical
// MAKE: SLS PA12 (EOS PA2200 class), plate flat in XY, bosses up; or CF-nylon FDM with the plate on the bed; ream the rod holes 6.60 after printing; heat-set M3 inserts in the 12 bosses; inspect rod-hole spacing with calipers
// NOTE: Two 1/4-20 all-thread rods on 63.50 mm (2.500 in) centres, clearance holes 6.60 (1/4 in + 0.25); the sled slides on the rods and is clamped by the bulkhead nuts
// NOTE: Plate 90 × 220 × 4 fits a 146.3 mm coupler ID with room for batteries beside it; 12 bosses Ø8 × 5 with Ø4.00 × 5 deep blind holes for M3 heat-set inserts (the plate under the boss stays solid) on a 20 × 45 mm grid (flight computer, GPS, switch board); two 25 × 4 battery-strap slots
// NOTE: SLS tolerance ±0.3 mm: nothing on this part is a precision fit; the rod holes are reamed after printing and declared ±0.15
// NOTE: Non-structural: recovery loads go through the rods and bulkheads, never through the sled; keep it light (lightening holes are fine)
// SPEC-BEGIN
// {"name":"avionics sled","size_mm":[220,90,9],
//  "parts":[{"name":"plate","role":"sled plate with rod holes and strap slots","size_mm":[220,90,4]},{"name":"bosses","role":"12 heat-set insert bosses","size_mm":[143,53,6]}],
//  "joints":[{"a":"bosses","b":"plate","overlap_mm":1}],
//  "layout":[{"a":"bosses","rel":"above","b":"plate","tol_mm":2}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"PA12-SLS","process":"sls","tolerance_class":"ISO 2768-c","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"plate length","module":"plate","axis":"x","nominal_mm":220.00,"tol_mm":0.30,"tol_src":"source","tol_ref":"EOS PA 2200 datasheet: typical accuracy +/-0.3 mm"},
//              {"name":"plate width","module":"plate","axis":"y","nominal_mm":90.00,"tol_mm":0.30,"tol_src":"source","tol_ref":"EOS PA 2200 datasheet: typical accuracy +/-0.3 mm"},
//              {"name":"plate thickness","module":"plate","axis":"z","nominal_mm":4.00,"tol_mm":0.30,"tol_src":"source","tol_ref":"EOS PA 2200 datasheet: typical accuracy +/-0.3 mm"},
//              {"name":"overall height","module":"main","axis":"z","nominal_mm":9.00,"tol_mm":0.30,"tol_src":"source","tol_ref":"EOS PA 2200 datasheet: typical accuracy +/-0.3 mm"}],
//  "holes":[{"name":"all-thread rods 1/4 in","d_mm":6.60,"tol_mm":0.15,"pos_tol_mm":0.15,"pattern":"list","at_mm":[[10,13.25],[10,76.75],[210,13.25],[210,76.75]],"axis":"z","from_mm":0,"to_mm":4,"tol_src":"default"},
//           {"name":"M3 heat-set boss holes","d_mm":4.00,"tol_mm":0.15,"pattern":"list","at_mm":[[42.5,18.5],[87.5,18.5],[132.5,18.5],[177.5,18.5],[42.5,45],[87.5,45],[132.5,45],[177.5,45],[42.5,71.5],[87.5,71.5],[132.5,71.5],[177.5,71.5]],"axis":"z","from_mm":9,"to_mm":4.2,"tol_src":"default"}],
//  "gauges":[{"name":"strap slots GO","module":"gauge_slots_go","expect":"clear","why":"two 25 × 4 slots exist at least 24.7 × 3.7"}],
//  "mfg":{"stock":"SLS PA12 powder bed; or 1.75 mm CF-nylon filament","finish":"bead blast; ream the four rod holes 6.60","heat_treat":"none","deburr":"none needed",
//         "inspect":["rod hole centres 63.50 ± 0.15 with calipers","rod holes with a 6.35 mm rod: must slide","boss holes with a 3.9 mm pin before inserts"],
//         "notes":["Print with the plate flat; bosses up","Heat-set inserts at 240 °C for PA12; keep the iron perpendicular","Battery straps: 25 mm hook-and-loop through the slots"]}}
// FLIGHT-END
tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
plate_l = 220.0; // plate length along x
plate_w = 90.0; // plate width along y
plate_t = 4.0; // plate thickness
rod_d = 6.60; // 1/4 in all-thread clearance (reamed)
rod_pitch = 63.50; // rod centres, 2.500 in
rod_inset = 10.0; // rod holes from each end
boss_d = 8.0; // heat-set boss OD
boss_h = 5.0; // boss height above the plate
insert_d = 4.00; // M3 heat-set insert hole
boss_cols = 4; // bosses along x
boss_rows = 3; // bosses along y
boss_pitch_x = 45.0; // boss grid pitch along x
boss_pitch_y = 26.5; // boss grid pitch along y
slot_l = 25.0; // battery strap slot length (y)
slot_w = 4.0; // battery strap slot width (x)
slot_x = 195.0; // strap slot centre x (both slots)
cut_ext = 1; // cutter overshoot
// --- end parameters ---
function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));
boss_x0 = (plate_l - (boss_cols-1)*boss_pitch_x)/2;
boss_y0 = (plate_w - (boss_rows-1)*boss_pitch_y)/2;
rod_y0 = (plate_w - rod_pitch)/2;
module plate(){
  difference(){
    cube([plate_l, plate_w, plate_t]);
    for(x=[rod_inset, plate_l - rod_inset]) for(y=[rod_y0, rod_y0 + rod_pitch]) translate([x, y, -cut_ext]) cylinder(d=rod_d, h=plate_t + 2*cut_ext, $fn=fn_tol(rod_d));
    for(y=[plate_w*0.25, plate_w*0.75]) translate([slot_x - slot_w/2, y - slot_l/2, -cut_ext]) cube([slot_w, slot_l, plate_t + 2*cut_ext]);
  }
}
module bosses(){
  difference(){
    for(i=[0:boss_cols-1]) for(j=[0:boss_rows-1]) translate([boss_x0 + i*boss_pitch_x, boss_y0 + j*boss_pitch_y, plate_t - 1]) cylinder(d=boss_d, h=boss_h + 1, $fn=fn_tol(boss_d));
    for(i=[0:boss_cols-1]) for(j=[0:boss_rows-1]) translate([boss_x0 + i*boss_pitch_x, boss_y0 + j*boss_pitch_y, 1]) cylinder(d=insert_d, h=plate_t + boss_h + cut_ext, $fn=fn_tol(insert_d));
  }
}
// GO gauge for the two slots: blocks 0.3 mm under size, must not touch the part
module gauge_slots_go(){ for(y=[plate_w*0.25, plate_w*0.75]) translate([slot_x - slot_w/2 + 0.15, y - slot_l/2 + 0.15, 0.2]) cube([slot_w - 0.3, slot_l - 0.3, plate_t - 0.4]); }
module main(){ union(){ plate(); bosses(); } }
main();
