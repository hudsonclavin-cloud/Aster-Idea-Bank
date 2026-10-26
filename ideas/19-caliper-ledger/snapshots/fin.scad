// PART: Clipped-delta fin with through-the-wall tab, 300 root / 100 tip / 140 span, 1/4 in 6061-T6 plate
// KIND: mechanical
// MAKE: CNC mill from 6.35 mm 6061-T6 plate (waterjet the outline first if available); mill the 45 deg LE and tip bevels both faces on a vacuum plate, 2 setups (flip on the two tab holes); ream/drill tab holes 4.50 in setup 1; calipers on chords/span/tab, 45 deg angle gauge and 1.0 feeler on the bevel flat, pins in the holes
// NOTE: Fin laid flat, thickness along Z, root edge on Y=0, leading edge from the origin; tab hangs in -Y so main() spans Y -15..140
// NOTE: Root chord 300.00 mm = 11.811 in; tip chord 100.00 = 3.937 in; semi-span 140.00 = 5.512 in; LE sweep 160.00 = 6.299 in; thickness 6.35 = 1/4 in plate
// NOTE: Airframe 6.000 in OD = 152.40 mm with 2.0 mm wall (ID 148.4) and a 98 mm motor mount tube OD 101.60 = 4.000 in are ASSUMED; tab_h 15 is the brief's value and only reaches part-way to the MMT: for the tab to bottom on the MMT set tab_h = wall + (ID - MMT_OD)/2 = 2.0 + 23.4 = 25.4
// NOTE: Bevels: leading edge and tip chamfered 45 deg on BOTH faces leaving a 1.00 mm flat (1.88 mm per face); trailing edge and root stay square. A knife edge on G10 chips, keep the flat
// NOTE: Tab holes: 2 x 4.50 mm (M4 clearance, ISO 273 medium; 4.5 mm is a standard drill) at X 80 / 220, Y -7.5: injected fillet epoxy keys through them and they take 4 mm dowels in a fin-can alignment jig. Optional: set tab_hole_pitch or delete the loop
// NOTE: FLUTTER as drawn FAILS the declared 700 m/s at 3000 m: NACA TN 4197 (Martin) with G = 4.1 GPa gives Vf about 290 m/s (centroid epsilon) to 334 m/s (Martin epsilon 0.25), SF 0.41-0.48 vs sf_min 1.5. This 4.76 plate is a Mach 0.6 fin. For 700 m/s at SF 1.5 use fin_t = 12.70 (1/2 in G10, Vf about 1260 m/s, SF 1.8) or a tip-to-tip carbon layup (outside the formula)
// NOTE: G10-FR4 shear modulus 4.1 GPa is Bennett's (2025) working value (600 ksi); direct measurements report about 5.3 GPa (775 ksi). E about 18 GPa lengthwise, density 1.85 g/cm3. 6061-T6 plate (G 26 GPa) is the machined alternative: Vf about 730 m/s at 4.76 (SF 1.04), about 1120 m/s at 6.35 (SF 1.6)
// NOTE: Waterjet holds +/-0.1 on 4.76 mm G10 at quality 4-5, so the +/-0.20 on chords, span and tab is the process capability, not ISO 2768-m general (+/-0.5 over 120-400)
// SPEC-BEGIN
// {"name":"Clipped-delta G10 fin with TTW tab","size_mm":[300,155,6.35],
//  "parts":[{"name":"fin","role":"clipped-delta plate, LE and tip bevelled 45 deg both faces","size_mm":[300,140,6.35]},
//           {"name":"tab","role":"through-the-wall root tab with 2 epoxy-key holes, overlaps the fin root by 2","size_mm":[220,17,6.35]}],
//  "joints":[{"a":"tab","b":"fin","overlap_mm":2}],
//  "layout":[{"a":"tab","rel":"front","b":"fin"}],
//  "profile":[{"part":"fin","along":"y","measure":"x","from_mm":300,"to_mm":100,"why":"clipped delta: chord tapers from the root to the tip"}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_mill","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"root chord","module":"fin","axis":"x","nominal_mm":300.00,"tol_mm":0.20,"tol_src":"default"},
//              {"name":"semi-span","module":"fin","axis":"y","nominal_mm":140.00,"tol_mm":0.20,"tol_src":"default"},
//              {"name":"plate thickness","module":"fin","axis":"z","nominal_mm":6.35,"tol_mm":0.05,"round":false,"tol_src":"default"},
//              {"name":"tip chord at the tip flat","module":"tip_chord_gauge","axis":"x","nominal_mm":100.00,"tol_mm":0.20,"tol_src":"default"},
//              {"name":"tab length","module":"tab","axis":"x","nominal_mm":220.00,"tol_mm":0.20,"tol_src":"default"},
//              {"name":"tab height below the root","module":"tab_gauge","axis":"y","nominal_mm":15.00,"tol_mm":0.20,"tol_src":"default"},
//              {"name":"overall height, tab to tip","module":"main","axis":"y","nominal_mm":155.00,"tol_mm":0.30,"tol_src":"default"}],
//  "bores":[],
//  "holes":[{"name":"tab epoxy-key holes","d_mm":4.50,"tol_mm":0.10,"pattern":"list","at_mm":[[80,-7.5],[220,-7.5]],"axis":"z","from_mm":0,"to_mm":6.35,"tol_src":"default"}],
//  "gauges":[{"name":"LE bevel GO","module":"gauge_le_bevel","expect":"clear","why":"45 deg bevel fully cut on both faces along the whole leading edge"},
//            {"name":"LE flat present","module":"gauge_le_flat","expect":"interfere","why":"the 1.0 mm leading-edge flat exists, not a knife edge"}],
//  "loads":[{"check":"flutter","name":"fin at max Q","root_mm":300,"tip_mm":100,"span_mm":140,"thick_mm":6.35,"v_max_m_s":700,"alt_m":3000,"sf_min":1.5,"inputs_src":"default"}],
//  "mfg":{"stock":"6.35 mm (1/4 in) 6061-T6 plate, 320 x 175 mm blank per fin",
//         "finish":"as cut; scuff the whole tab and a 12 mm band each side of the root with 80 grit before epoxy",
//         "heat_treat":"none",
//         "deburr":"break all waterjet edges 0.3-0.5 mm with 220 grit (no machined chamfer on root, TE or tab edges); the bevels keep their 1.0 mm flat, do not sand to a knife edge",
//         "inspect":["root chord, tip chord, span and tab length with calipers","thickness with a micrometer at 4 places (sheet as supplied)","bevel angle with a 45 deg angle gauge; flat width 1.0 with a feeler against a straightedge","tab holes with 4.38 GO / 4.60 NO-GO pins"],
//         "notes":["Waterjet: 0.8 mm garnet kerf, quality 4-5 edge, taper under 0.05 on 4.76 mm; pierce outside the profile; cut with the LE 1.88 mm oversize only if the bevel is to be milled to a witness line",
//                  "Bevels: 45 deg chamfer mill or tilted head, both faces, on a vacuum plate or toe clamps in the tab holes; the bevel runs out at the root corner and mitres into the tip bevel",
//                  "Bond: tab through the airframe slot to the motor mount, 4 internal fillets, epoxy injected through the tab holes forms keys; external fillets 10 mm radius",
//                  "Flutter SF at 700 m/s is under 1 as drawn (see NOTE): change fin_t or v_max before a Mach 2 flight; the app recomputes the loads row from fin_t",
//                  "6061-T6 alternative: same file, material 6061-T6, process cnc_mill, chamfer all edges 0.5 x 45 with a chamfer mill and add 0.5 x 45 to the deburr line"]}}
// FLIGHT-END
tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
root_c = 300.00; // root chord, along X on Y=0 (11.811 in)
tip_c = 100.00; // tip chord, along X at Y=span (3.937 in)
span = 140.00; // semi-span, root edge to tip edge along Y (5.512 in)
le_sweep = 160.00; // leading-edge sweep: X offset of the tip LE corner from the root LE corner (6.299 in)
fin_t = 6.35; // plate thickness, 1/4 in 6061-T6 plate, critical (flutter SF 1.6 at 700 m/s; G10 at 4.76 fails, see NOTE)
le_flat = 1.00; // flat left on the leading edge and tip after bevelling (G10 knife edges chip)
bevel_ang = 45; // bevel angle from the plate face, degrees (OpenSCAD trig is in degrees)
tab_len = 220.00; // TTW tab length along X, centred on the root chord (8.661 in)
tab_h = 15.00; // tab height below the root, through the airframe wall toward the MMT (see NOTE: 25.4 bottoms on a 98 mm MMT in a 6 in tube)
tab_overlap = 2.00; // tab extends this far into the fin body so the SPEC joint has real shared volume
tab_hole_d = 4.50; // tab epoxy-key / jig-pin holes, M4 clearance ISO 273 medium, 4.5 mm standard drill
tab_hole_pitch = 140.00; // spacing of the two tab holes, symmetric about the tab centre (X 80 and 220)
cut_ext = 1; // hole cutters overshoot each face by this much so the boolean is clean
gauge_gap = 0.10; // clearance between the bevel GO gauge and the nominal bevel plane
gauge_slab = 0.01; // thickness of the slab that samples the tip chord at the tip flat
// --- end parameters ---
function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));
// Derived geometry. atan2/sin/tan take and return DEGREES in OpenSCAD, so no radian conversion anywhere.
le_ang = atan2(span, le_sweep); // leading-edge angle from the root chord, degrees (41.19 for 140/160)
le_len = sqrt(le_sweep*le_sweep + span*span); // leading-edge length (212.60)
bevel_in = (fin_t - le_flat)/2 / tan(bevel_ang); // in-plane inset of each bevel at the plate face (1.88 at 45 deg)
z_flat_lo = (fin_t - le_flat)/2; // bottom of the LE/tip flat (1.88)
z_flat_hi = z_flat_lo + le_flat; // top of the LE/tip flat (2.88)
// Planform with the LE and tip edges moved inward by d; root and TE stay put. d=0 is the outer outline.
// A line shifted d perpendicular to itself moves d/sin(le_ang) along the root, which is what the LE corner needs.
function planform(d) = [
  [d / sin(le_ang), 0],
  [root_c, 0],
  [root_c + (le_sweep + tip_c - root_c) * (span - d) / span, span - d],
  [(span - d) * le_sweep / span + d / sin(le_ang), span - d]
];
module fin(){ // one convex hull: the 1.0 flat at mid-thickness plus the full-thickness inset core = 45 deg bevels on LE and tip, square root and TE
  hull(){
    translate([0, 0, z_flat_lo]) linear_extrude(le_flat) polygon(planform(0));
    linear_extrude(fin_t) polygon(planform(bevel_in));
  }
}
module tab(){ // root tab in -Y, overlapping the fin root by tab_overlap; the two holes are the only boolean in the file
  difference(){
    translate([root_c/2 - tab_len/2, -tab_h, 0]) cube([tab_len, tab_h + tab_overlap, fin_t]);
    for(x = [root_c/2 - tab_hole_pitch/2, root_c/2 + tab_hole_pitch/2])
      translate([x, -tab_h/2, -cut_ext]) cylinder(d=tab_hole_d, h=fin_t + 2*cut_ext, $fn=fn_tol(tab_hole_d));
  }
}
module main(){ union(){ fin(); tab(); } }
// --- inspection modules (referenced by FLIGHT critical/gauges; not SPEC parts) ---
module tip_chord_gauge(){ // sliver of the fin at the tip flat: its X extent is the tip chord
  intersection(){ fin(); translate([-1, span - gauge_slab, -1]) cube([root_c + 2, gauge_slab + 1, fin_t + 2]); }
}
module tab_gauge(){ // everything below the root line: its Y extent is the tab height
  intersection(){ main(); translate([-1, -tab_h - 1, -1]) cube([root_c + 2, tab_h + 1, fin_t + 2]); }
}
module gauge_le_bevel(){ // two 45 deg wedges riding gauge_gap above the upper and below the lower LE bevel, full LE length: expect clear
  intersection(){
    main();
    rotate([0, 0, le_ang]) rotate([90, 0, 90]) linear_extrude(le_len) union(){
      polygon([[0, z_flat_hi + gauge_gap], [-(bevel_in - gauge_gap), fin_t], [0, fin_t]]);
      polygon([[0, z_flat_lo - gauge_gap], [-(bevel_in - gauge_gap), 0], [0, 0]]);
    }
  }
}
module gauge_le_flat(){ // thin block on the LE at the bottom 0.1-0.2 of the flat, middle 80% of the LE: expect contact (empty if ground to a knife edge)
  intersection(){
    main();
    rotate([0, 0, le_ang]) translate([0.1*le_len, -0.05, z_flat_lo + 0.1]) cube([0.8*le_len, 0.05, 0.1]);
  }
}
main();
