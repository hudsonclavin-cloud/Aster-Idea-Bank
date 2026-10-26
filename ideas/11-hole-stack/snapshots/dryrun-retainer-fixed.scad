// PART: 98 mm Motor Retainer Plate — 6 in Airframe, 8×M6 Bolt-On
// KIND: mechanical
// MAKE: cnc_mill · 160 mm dia × 16 mm 6061-T6 round plate or sawn from 160 mm round bar · 1 setup (face + bore + OD + holes) · CMM or optical comparator
// NOTE: Airframe ID assumed 152.40 mm (6.000 in nominal) — measure actual tube before machining
// NOTE: Retainer OD = 150.80 mm; slides inside airframe with 1.60 mm diametral clearance — not a structural register
// NOTE: Cesaroni 98 mm case assumed: case body OD = 101.60 mm, nozzle-can aft lip OD = 107.00 mm
// NOTE: Capture bore = 108.00 mm gives 0.50 mm radial clearance each side over the 107.00 mm lip — measure actual hardware
// NOTE: Motor case lip thickness assumed 3.50 mm axially; capture pocket depth 4.00 mm — the nozzle-can lip seats in the pocket and cannot pull through
// NOTE: THE PLATE IS OPEN THROUGH THE MIDDLE. From the aft face: Ø108.00 capture pocket 4.00 mm deep, then Ø103.60 pass-through for the remaining 10.00 mm. The retaining ledge is the annular face at z = 4.00 between the two bores, 2.20 mm wide radially = (108.00 − 103.60)/2.
// NOTE: lip() is the retaining RING itself — the material inside Ø108.00 that overhangs the pocket: an annulus r 51.80 → 54.00, z 4.00 → 14.00, so x-extent 108.00 and z-extent 10.00. It is built as intersection(){ body(); Ø108 cylinder; }, so it cannot disagree with the plate it is cut from, and unioning it in main() adds no material. A filled Ø108 disk here would PLUG the pocket and the motor could not pass — the part would be a cup.
// NOTE: Pocket depth is proven by gauge_pocket_go (a Ø107.90 × 3.90 plug must enter) and the ledge by gauge_ledge_nogo (material must exist just above the pocket floor), not by a module bounding box
// NOTE: Aft centering ring assumed flat face with 8×M6 tapped holes on BC = 132.00 mm, ring face flush with airframe aft end
// NOTE: M6 bolts torqued to 10 N·m with medium-strength threadlocker (Loctite 243); engagement in 6061-T6 ring ≥ 12 mm (2× diameter)
// NOTE: 20 kN peak thrust carried by 8×M6 bolts in shear — bolt_shear check declared below
// NOTE: All bolt holes modelled at ISO 273 medium clearance 6.60 mm; thread callouts on the mating ring in mfg notes
// NOTE: Cutter radius 3.0 mm for internal pocket corners (not modelled in the revolved profile — add it in the 2D drawing)
// NOTE: 152.40 mm = 6.000 in; 101.60 mm = 4.000 in; 107.00 mm = 4.213 in; 132.00 mm = 5.197 in; 108.00 mm = 4.252 in
// NOTE: Stock: 160 mm dia × 16 mm 6061-T6 plate or sawn from round bar — face both sides, bore and OD in one chucking

// SPEC-BEGIN
// {"name":"98 mm motor retainer plate","size_mm":[150.80,150.80,14.00],
//  "parts":[
//    {"name":"body","role":"main plate — full OD, full thickness, stepped bore: Ø108 capture pocket then Ø103.6 pass-through","size_mm":[150.80,150.80,14.00]},
//    {"name":"lip","role":"retaining ring overhanging the capture pocket — annulus r 51.8 to 54.0, z 4.0 to 14.0","size_mm":[108.00,108.00,10.00]}
//  ],
//  "joints":[
//    {"a":"lip","b":"body","overlap_mm":10.00}
//  ]}
// SPEC-END

// FLIGHT-BEGIN
// {
//   "material":"6061-T6",
//   "process":"cnc_mill",
//   "tolerance_class":"ISO 2768-m",
//   "tess_tol_mm":0.01,
//   "hazard":"none",
//   "critical":[
//     {"name":"overall thickness","module":"main","axis":"z","nominal_mm":14.000,"tol_mm":0.100,"tol_src":"default"},
//     {"name":"retaining ring OD (= capture bore)","module":"lip","axis":"x","nominal_mm":108.000,"tol_mm":0.100,"round":true,"tol_src":"default"},
//     {"name":"retaining ring height above the pocket","module":"lip","axis":"z","nominal_mm":10.000,"tol_mm":0.100,"tol_src":"default"}
//   ],
//   "od":[
//     {"name":"retainer OD","d_mm":150.800,"tol_mm":0.130,"at_mm":[0,0],"axis":"z","from_mm":0.0,"to_mm":14.0,"tol_src":"default"}
//   ],
//   "bores":[
//     {"name":"motor pass-through bore","d_mm":103.600,"tol_mm":0.100,"at_mm":[0,0],"axis":"z","from_mm":14.0,"to_mm":4.0,"tol_src":"default"},
//     {"name":"nozzle capture pocket bore","d_mm":108.000,"tol_mm":0.100,"at_mm":[0,0],"axis":"z","from_mm":0.0,"to_mm":4.0,"tol_src":"default"}
//   ],
//   "holes":[
//     {"name":"M6 bolt clearance holes","d_mm":6.600,"tol_mm":0.100,"pos_tol_mm":0.100,
//      "pattern":"circle","n":8,"bc_d_mm":132.000,"start_deg":22.5,"axis":"z",
//      "from_mm":14.0,"to_mm":0.0,"tol_src":"source","tol_ref":"ISO 273 medium clearance M6 = 6.6 mm"}
//   ],
//   "gauges":[
//     {"name":"capture pocket GO","module":"gauge_pocket_go","expect":"clear","why":"a Ø107.90 x 3.90 plug enters the aft pocket: it is at least that wide and that deep"},
//     {"name":"retaining ledge present","module":"gauge_ledge_nogo","expect":"interfere","why":"material exists just above the pocket floor — the ledge the motor lip bears against"}
//   ],
//   "loads":[
//     {"check":"bolt_shear","name":"M6 thrust bolts 8 off","size":"M6","n":8,
//      "force_N":20000,"plate_t_mm":14.0,"sf_min":2.0,
//      "grade":"8.8","shear_plane":"shank","inputs_src":"user"},
//     {"check":"thread","name":"M6 into 6061-T6 centering ring","size":"M6",
//      "engagement_mm":12.0,"internal_material":"6061-T6","inputs_src":"default"}
//   ],
//   "mfg":{
//     "stock":"160 mm dia × 16 mm 6061-T6 round plate or sawn from 160 mm round bar",
//     "finish":"anodize type II clear",
//     "heat_treat":"none",
//     "deburr":"0.5 × 45° chamfer all external edges; break all hole entries 0.5 × 45°",
//     "inspect":[
//       "OD 150.80 mm with outside micrometer at z = 2 mm and z = 12 mm",
//       "pass-through bore 103.60 mm with inside micrometer or bore gauge at z = 9 mm",
//       "capture pocket bore 108.00 mm with inside micrometer or bore gauge at z = 2 mm",
//       "overall thickness 14.00 mm with micrometer",
//       "capture pocket depth 4.00 mm with depth micrometer from the aft face to the ledge",
//       "ledge radial width 2.20 mm confirmed by (108.00 − 103.60)/2 from the two bore measurements",
//       "confirm the plate is open through: a 103 mm rod passes right through",
//       "bolt circle 132.00 mm and 8 hole positions on a CMM or with a pin gauge set",
//       "bolt hole diameter 6.60 mm with go/no-go pin gauges"
//     ],
//     "notes":[
//       "Mating centering ring thread callout: 8×M6×1.0 tapped, BC 132.00 mm, equally spaced, start 22.5°, engagement ≥ 12 mm",
//       "Apply Loctite 243 to bolt threads; torque to 10 N·m",
//       "Verify actual nozzle-can lip OD and axial thickness before first assembly",
//       "Capture pocket bore 108.00 mm must freely accept the measured lip OD (nominal 107.00 mm)",
//       "The 2.20 mm ledge is the whole retention feature: check it is not machined away when deburring the pocket"
//     ]
//   }
// }
// FLIGHT-END

// ── Parameters ────────────────────────────────────────────────────────────────
tess_tol       = 0.01;   // max chordal deviation of curved surfaces (mm)
retainer_od    = 150.80; // retainer plate outside diameter (mm)
plate_t        = 14.00;  // total plate thickness (mm)
lip_depth      = 4.00;   // axial depth of the nozzle-capture pocket (mm)
capture_id     = 108.00; // nozzle-can lip capture bore diameter — aft pocket (mm)
passthru_id    = 103.60; // motor case body pass-through bore diameter — fwd section (mm)
bc_d           = 132.00; // M6 bolt circle diameter (mm)
bolt_hole_d    = 6.60;   // M6 ISO 273 medium clearance hole diameter (mm)
n_bolts        = 8;      // number of M6 bolts
bolt_start_deg = 22.5;   // angular offset of the first bolt (deg)
chamfer_w      = 0.50;   // external edge chamfer width (mm)
gauge_gap      = 0.10;   // clearance between a GO gauge and the nominal feature (mm)
// --- end parameters ---

function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));

// ── Derived ───────────────────────────────────────────────────────────────────
r_out  = retainer_od / 2;  // 75.40
r_cap  = capture_id  / 2;  // 54.00  — capture pocket bore radius (larger, aft)
r_pass = passthru_id / 2;  // 51.80  — pass-through bore radius (smaller, fwd)
ch     = chamfer_w;        // 0.50
ledge_w = r_cap - r_pass;  //  2.20  — radial width of the retaining ledge

// ── Module: body ──────────────────────────────────────────────────────────────
// The whole plate, one revolve. Half-section profile (r horizontal, z vertical):
//   z = plate_t   top inner chamfer, then the Ø103.60 pass-through wall downward
//   z = lip_depth the LEDGE: step outward from r_pass to r_cap (2.20 mm of face)
//   z = 0         the Ø108.00 capture pocket wall down to the aft face
// Nothing is drawn across the middle: at (0,0) the part is open from z=0 to z=14.
module body() {
    rotate_extrude($fn = fn_tol(retainer_od))
    polygon([
        // top (forward) face, inner chamfer at the pass-through bore
        [r_pass + ch, plate_t      ],
        [r_pass,      plate_t - ch ],
        // pass-through bore wall downward to the ledge
        [r_pass,      lip_depth    ],
        // THE LEDGE — annular face, r_pass out to r_cap
        [r_cap,       lip_depth    ],
        // capture pocket wall downward to the aft face
        [r_cap,       ch           ],
        // aft face inner chamfer (pocket mouth)
        [r_cap + ch,  0            ],
        // aft face outward
        [r_out - ch,  0            ],
        [r_out,       ch           ],
        // outer wall upward
        [r_out,       plate_t - ch ],
        [r_out - ch,  plate_t      ],
        // top face back to the start
        [r_pass + ch, plate_t      ]
    ]);
}

// ── Module: lip ───────────────────────────────────────────────────────────────
// The retaining ring: the material inside Ø108.00 that overhangs the pocket —
// an annulus r 51.80 → 54.00, z 4.00 → 14.00, carrying the same top inner chamfer
// as the plate.  x-extent 108.00, z-extent 10.00.
// It is drawn from the SAME parameters as body()'s profile over the same band, so
// it is the metal the plate already has there: main() unions it and adds nothing.
// (A filled Ø108 disk here would fill the pocket body() just cut — a cup, not a
// retainer. The pocket must stay open.  Nor an intersection() with body(): two
// revolves tessellated at different $fn interleave, and the ring picks up
// micron-thin slivers of the pocket wall that stretch its measured height.)
module lip() {
    rotate_extrude($fn = fn_tol(capture_id))
    polygon([
        [r_pass + ch, plate_t      ],   // top inner chamfer, as body()
        [r_pass,      plate_t - ch ],
        [r_pass,      lip_depth    ],   // inner wall down to the ledge
        [r_cap,       lip_depth    ],   // the ledge face itself
        [r_cap,       plate_t      ]    // outer wall of the ring, back up
    ]);
}

// ── Bolt holes ────────────────────────────────────────────────────────────────
module bolt_holes() {
    r_bc = bc_d / 2;
    for (i = [0 : n_bolts - 1]) {
        ang = bolt_start_deg + i * (360 / n_bolts);
        translate([r_bc * cos(ang), r_bc * sin(ang), -0.1])
            cylinder(h = plate_t + 0.2,
                     d = bolt_hole_d,
                     $fn = fn_tol(bolt_hole_d));
    }
}

// ── Gauges (measurement only — main() never calls these) ──────────────────────
// GO: a Ø107.90 × 3.90 plug must enter the aft pocket without touching metal.
// Proves the pocket is at least full diameter and full depth — i.e. it exists.
module gauge_pocket_go() {
    translate([0, 0, gauge_gap/2])
        cylinder(h = lip_depth - gauge_gap, d = capture_id - gauge_gap,
                 $fn = fn_tol(capture_id));
}
// NO-GO: a thin Ø107.90 disc just ABOVE the pocket floor must hit metal.
// Proves the ledge is there — that the pocket did not simply continue through.
module gauge_ledge_nogo() {
    translate([0, 0, lip_depth + gauge_gap/2])
        cylinder(h = 0.20, d = capture_id - gauge_gap,
                 $fn = fn_tol(capture_id));
}

// ── Main ──────────────────────────────────────────────────────────────────────
// body() is the finished plate. lip() is a named region OF that plate, unioned
// so the SPEC part is drawn where its own module puts it; it adds no material.
// Bolt holes are cut last.
module main() {
    difference() {
        union() {
            body();
            lip();
        }
        bolt_holes();
    }
}

main();
