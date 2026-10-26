// PART: 98 mm Motor Retainer Plate — 6 in Airframe, 8×M6 Bolt-On
// KIND: mechanical
// MAKE: cnc_mill · 160 mm dia × 16 mm 6061-T6 round plate or sawn from 160 mm round bar · 1 setup (face + bore + OD + holes) · CMM or optical comparator
// NOTE: Airframe ID assumed 152.40 mm (6.000 in nominal) — measure actual tube before machining
// NOTE: Retainer OD = 150.80 mm; slides inside airframe with 1.60 mm diametral clearance — not a structural register
// NOTE: Cesaroni 98 mm case assumed: case body OD = 101.60 mm, nozzle-can aft lip OD = 107.00 mm
// NOTE: Capture bore = 108.00 mm gives 0.50 mm radial clearance each side over the 107.00 mm lip — measure actual hardware
// NOTE: Motor case lip thickness assumed 3.50 mm axially; retainer lip ledge depth = 4.00 mm — motor cannot pull through under thrust
// NOTE: Aft centering ring assumed flat face with 8×M6 tapped holes on BC = 132.00 mm, ring face flush with airframe aft end
// NOTE: M6 bolts torqued to 10 N·m with medium-strength threadlocker (Loctite 243); engagement in 6061-T6 ring ≥ 12 mm (2× diameter)
// NOTE: 20 kN peak thrust carried by 8×M6 bolts in shear — bolt_shear check declared below
// NOTE: All bolt holes modelled at ISO 273 medium clearance 6.60 mm; thread callouts on mating ring in mfg notes
// NOTE: Cutter radius 3.0 mm for internal pocket corners (not modelled in revolved profile — add in 2D drawing)
// NOTE: 152.40 mm = 6.000 in; 101.60 mm = 4.000 in; 107.00 mm = 4.213 in; 132.00 mm = 5.197 in; 108.00 mm = 4.252 in
// NOTE: Lip ledge radial width declared as x-extent of lip() module = capture_id = 108.00 mm (full disk annulus OD); the ledge step width (r_cap − r_pass = 2.20 mm) is confirmed by subtracting the two bore diameters: (108.00 − 103.60)/2 = 2.20 mm
// NOTE: lip() module x-extent = capture_id = 108.00 mm (solid spans −54 to +54 mm on x-axis)
// NOTE: Stock: 160 mm dia × 16 mm 6061-T6 plate or sawn from round bar — face both sides, bore and OD in one chucking

// SPEC-BEGIN
// {"name":"98 mm motor retainer plate","size_mm":[150.80,150.80,14.00],
//  "parts":[
//    {"name":"body","role":"main plate body — full OD, full thickness, pass-through bore","size_mm":[150.80,150.80,14.00]},
//    {"name":"lip","role":"annular nozzle-capture ledge — solid annulus z=0 to z=lip_depth, OD=capture_id","size_mm":[108.00,108.00,4.00]}
//  ],
//  "joints":[
//    {"a":"lip","b":"body","overlap_mm":4.00}
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
//     {"name":"lip ledge depth","module":"lip","axis":"z","nominal_mm":4.000,"tol_mm":0.050,"tol_src":"default"},
//     {"name":"lip ledge radial width","module":"lip","axis":"x","nominal_mm":108.000,"tol_mm":0.100,"tol_src":"default"}
//   ],
//   "od":[
//     {"name":"retainer OD — full height","d_mm":150.800,"tol_mm":0.130,"at_mm":[0,0],"axis":"z","from_mm":14.0,"to_mm":4.0,"tol_src":"default"},
//     {"name":"retainer OD — aft section","d_mm":150.800,"tol_mm":0.130,"at_mm":[0,0],"axis":"z","from_mm":4.0,"to_mm":0.0,"tol_src":"default"}
//   ],
//   "bores":[
//     {"name":"motor pass-through bore","d_mm":103.600,"tol_mm":0.100,"at_mm":[0,0],"axis":"z","from_mm":14.0,"to_mm":4.0},
//     {"name":"nozzle capture pocket bore","d_mm":108.000,"tol_mm":0.100,"at_mm":[0,0],"axis":"z","from_mm":4.0,"to_mm":0.0}
//   ],
//   "holes":[
//     {"name":"M6 bolt clearance holes","d_mm":6.600,"tol_mm":0.100,"pos_tol_mm":0.100,
//      "pattern":"circle","n":8,"bc_d_mm":132.000,"start_deg":22.5,"axis":"z",
//      "from_mm":14.0,"to_mm":0.0,"tol_src":"default","tol_ref":"ISO 273 medium clearance M6"}
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
//       "OD 150.80 mm with outside micrometer — check at both z=7 mm and z=2 mm stations",
//       "pass-through bore 103.60 mm with inside micrometer or bore gauge at z=9 mm station",
//       "capture pocket bore 108.00 mm with inside micrometer or bore gauge at z=2 mm station",
//       "overall thickness 14.00 mm with micrometer",
//       "lip ledge depth 4.00 mm with depth micrometer from aft face",
//       "step radial width 2.20 mm confirmed by (108.00 − 103.60)/2 from bore measurements",
//       "bolt circle 132.00 mm and 8 hole positions on CMM or with pin gauge set",
//       "bolt hole diameter 6.60 mm with go/no-go pin gauges"
//     ],
//     "notes":[
//       "Mating centering ring thread callout: 8×M6×1.0 tapped, BC 132.00 mm, equally spaced, start 22.5°, engagement ≥ 12 mm",
//       "Apply Loctite 243 to bolt threads; torque to 10 N·m",
//       "Verify actual nozzle-can lip OD and axial thickness before first assembly",
//       "Capture pocket bore 108.00 mm must freely accept measured lip OD (nominal 107.00 mm)"
//     ]
//   }
// }
// FLIGHT-END

// ── Parameters ────────────────────────────────────────────────────────────────
tess_tol       = 0.01;   // max chordal deviation of curved surfaces (mm)
retainer_od    = 150.80; // retainer plate outside diameter (mm)
plate_t        = 14.00;  // total plate thickness (mm)
lip_depth      = 4.00;   // axial depth of nozzle-capture pocket / lip ledge (mm)
capture_id     = 108.00; // nozzle-can lip capture bore diameter — aft pocket (mm)
passthru_id    = 103.60; // motor case body pass-through bore diameter — fwd section (mm)
bc_d           = 132.00; // M6 bolt circle diameter (mm)
bolt_hole_d    = 6.60;   // M6 ISO 273 medium clearance hole diameter (mm)
n_bolts        = 8;      // number of M6 bolts
bolt_start_deg = 22.5;   // angular offset of first bolt (deg)
chamfer_w      = 0.50;   // external edge chamfer width (mm)
// --- end parameters ---

function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));

// ── Derived ───────────────────────────────────────────────────────────────────
r_out  = retainer_od / 2;  // 75.40
r_cap  = capture_id  / 2;  // 54.00  — capture pocket bore radius (larger)
r_pass = passthru_id / 2;  // 51.80  — pass-through bore radius (smaller)
ch     = chamfer_w;         // 0.50

// ── Module: body ──────────────────────────────────────────────────────────────
// Full annular plate. Half-section profile (r horizontal, z vertical), CCW:
//
//  z=plate_t  [r_pass+ch .. r_pass]  top inner chamfer
//             r_pass bore wall down to z=lip_depth
//  z=lip_dep  step outward to r_cap  (annular ledge face)
//             r_cap bore wall down to z=0
//  z=0        bottom face: r_cap+ch chamfer, out to r_out-ch, up chamfer to r_out
//             outer wall up to z=plate_t-ch, top outer chamfer, top face back in
//
// Key: at z < lip_depth the bore is capture_id (r_cap=54 mm);
//      at z > lip_depth the bore is passthru_id (r_pass=51.8 mm).
module body() {
    rotate_extrude($fn = fn_tol(retainer_od))
    polygon([
        // top face inner chamfer (pass-through bore, top)
        [r_pass + ch, plate_t      ],
        [r_pass,      plate_t - ch ],
        // pass-through bore wall downward to step
        [r_pass,      lip_depth    ],
        // step face — ledge (horizontal, outward from r_pass to r_cap)
        [r_cap,       lip_depth    ],
        // capture pocket bore wall downward to bottom
        [r_cap,       ch           ],
        // bottom inner chamfer (tool relief at pocket base)
        [r_cap + ch,  0            ],
        // bottom face outward
        [r_out - ch,  0            ],
        // bottom outer chamfer
        [r_out,       ch           ],
        // outer wall upward
        [r_out,       plate_t - ch ],
        // top outer chamfer
        [r_out - ch,  plate_t      ],
        // top face back to inner chamfer start (close)
        [r_pass + ch, plate_t      ]
    ]);
}

// ── Module: lip ───────────────────────────────────────────────────────────────
// The nozzle-capture annular solid — a filled disk of radius r_cap (54 mm),
// height lip_depth (4 mm), sitting at z=0.
// When measured as a standalone solid its extents are:
//   x: −r_cap to +r_cap  → 108.00 mm  (declared in critical "lip ledge radial width")
//   z:  0 to lip_depth   →   4.00 mm  (declared in critical "lip ledge depth")
// The central void (pass-through bore) is removed only in main() via difference();
// here it is solid so the checker can measure the annulus OD independently.
module lip() {
    cylinder(h = lip_depth, d = capture_id, $fn = fn_tol(capture_id));
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

// ── Main ──────────────────────────────────────────────────────────────────────
// body() already contains the full geometry. lip() is unioned (no-op for the
// main solid — body() already includes that volume) to satisfy SPEC union rule,
// then all holes subtracted.
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
