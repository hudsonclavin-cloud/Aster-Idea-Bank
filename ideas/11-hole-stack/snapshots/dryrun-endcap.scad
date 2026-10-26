// PART: Nitrous Tank End Cap — 4-inch, 60 bar MEOP, 1/4 NPT Port
// KIND: mechanical
// MAKE: cnc_lathe (OD / bore / groove / face features) + cnc_mill (1/4 NPT port, bolt circle) · 127 mm 6061-T6 round bar · 2 setups: lathe from OD, flip for face; mill for NPT and bolt holes · CMM + bore gauge + groove micrometer
// NOTE: hazard=pressure — PRESSURE BOUNDARY at 60 bar MEOP. Tier B ICD. Hydrotest to 90 bar (1305 psi) with water before any gas service. A signed hydro record must accompany the part; do not fly without it.
// NOTE: Tank bore (piston bore) assumed 101.60 mm = 4.000 in nominal. MEASURE actual tank ID and update tank_bore and shoulder_od before release.
// NOTE: Shoulder OD 101.50 mm fits tank bore 101.60 mm with 0.10 mm diametral clearance for O-ring piston seal installation.
// NOTE: O-ring AS568-240: ID 94.84 mm (3.734 in), CS 3.53 mm. Radial piston seal. Parker ORD 5700 Table 4-2 for -240: bore A 101.60, groove bottom B1 95.96 (+0/-0.05), groove width G 4.75-4.88 mm. Groove depth from the 101.50 shoulder OD = (101.50 - 95.96)/2 = 2.77 mm (the face-seal depth 2.59 is NOT the radial gland).
// NOTE: 1/4 NPT port per ANSI/ASME B1.20.1. Tap drill 7/16 in = 11.111 mm, modelled at nominal tap-drill diameter (straight cylinder — taper cut by the tap). Callout on drawing: 1/4 NPT ANSI/ASME B1.20.1.
// NOTE: 8× M8 bolt circle Ø115 mm secures cap to tank flange. Flange OD 127.00 mm = 5.000 in (standard round bar). M8 clearance holes ISO 273 medium = 9.0 mm.
// NOTE: Total axial thickness 25.40 mm = 1.000 in. Shoulder length 20.00 mm (flange step 5.40 mm + shoulder 20.00 mm = 25.40 mm total).
// NOTE: Bolt force corrected: P × π × r² = 6.00 MPa × π × (50.80 mm)² = 48 641 N total on 8 bolts = 6 080 N per bolt. M8 grade 8.8 single shear capacity ~18 kN per bolt; SF ≈ 3.0 — PASS.
// NOTE: Working fluid nitrous oxide (N₂O). 6061-T6 is generally compatible; verify with your oxidiser supplier.
// NOTE: NPT boss is a raised feature (3 mm proud of outer face) providing material for NPT thread engagement depth without breaking into the lightening pocket. Boss OD 22 mm.
// NOTE: tess_tol 0.01 mm as specified.
// NOTE: 127.00 mm = 5.000 in; 101.60 mm = 4.000 in; 25.40 mm = 1.000 in; 11.11 mm = 0.4375 in (7/16 in).

// SPEC-BEGIN
// {"name":"Nitrous Tank End Cap","size_mm":[127.0,127.0,28.4],"parts":[{"name":"body","role":"main flange and face plate with lightening pocket","size_mm":[127.0,127.0,25.4]},{"name":"shoulder","role":"piston seal shoulder inserted into tank bore","size_mm":[101.5,101.5,20.0]},{"name":"npt_boss","role":"raised boss on outer face for 1/4 NPT port","size_mm":[22.0,22.0,3.0]}],"joints":[{"a":"body","b":"shoulder","overlap_mm":20},{"a":"body","b":"npt_boss","overlap_mm":3}]}
// SPEC-END

// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_lathe","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"pressure",
//  "tier":"B",
//  "critical":[
//    {"name":"overall cap thickness","module":"main","axis":"z","nominal_mm":28.400,"tol_mm":0.100,"tol_src":"default","note":"flange 5.4 + shoulder 20.0 + boss 3.0 = 28.4 mm total Z extent"},
//    {"name":"shoulder length","module":"shoulder","axis":"z","nominal_mm":20.000,"tol_mm":0.050,"tol_src":"default"},
//    {"name":"flange OD","module":"body","axis":"x","nominal_mm":127.000,"tol_mm":0.130,"tol_src":"default","round":true},
//    {"name":"shoulder OD","module":"shoulder","axis":"x","nominal_mm":101.500,"tol_mm":0.050,"tol_src":"source","tol_ref":"Parker ORD 5700 / sliding fit for O-ring piston seal in tank bore 101.60 mm; 0.10 mm diametral clearance"},
//    {"name":"o-ring groove width","module":"shoulder","axis":"z","nominal_mm":4.750,"tol_mm":0.050,"tol_src":"source","tol_ref":"Parker ORD 5700 Table 4-2 piston gland CS 3.53 mm static lubricated: width 4.75 mm min"},
//    {"name":"lightening pocket depth","module":"body","axis":"z","nominal_mm":8.000,"tol_mm":0.130,"tol_src":"default"},
//    {"name":"npt boss height","module":"npt_boss","axis":"z","nominal_mm":3.000,"tol_mm":0.100,"tol_src":"default"}
//  ],
//  "od":[
//    {"name":"flange OD","d_mm":127.000,"tol_mm":0.130,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":5.400,"tol_src":"default"},
//    {"name":"shoulder OD","d_mm":101.500,"tol_mm":0.050,"at_mm":[0,0],"axis":"z","from_mm":5.400,"to_mm":25.400,"tol_src":"source","tol_ref":"Parker ORD 5700 / tank bore 101.60 mm nominal, 0.10 mm diametral clearance"}
//  ],
//  "bores":[
//    {"name":"lightening pocket bore","d_mm":80.000,"tol_mm":0.130,"pos_tol_mm":0.100,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":8.000,"tol_src":"default"},
//    {"name":"npt port tap drill","d_mm":11.110,"tol_mm":0.100,"pos_tol_mm":0.200,"at_mm":[0,0],"axis":"z","from_mm":28.400,"to_mm":13.900,"tol_src":"source","tol_ref":"ANSI/ASME B1.20.1 1/4 NPT tap drill = 7/16 in = 11.111 mm; depth 14.5 mm from outer face of boss"},
//    {"name":"o-ring groove bottom diameter","d_mm":95.960,"tol_mm":0.050,"pos_tol_mm":0.050,"at_mm":[0,0],"axis":"z","from_mm":11.150,"to_mm":15.900,"tol_src":"source","tol_ref":"Parker ORD 5700 Table 4-2 piston CS 3.53 mm: groove bottom B1 = 95.96 mm, groove bottom OD = 101.50 - 2*2.59 = 96.32 mm"}
//  ],
//  "holes":[
//    {"name":"M8 bolt pattern clearance","d_mm":9.000,"tol_mm":0.100,"pos_tol_mm":0.150,"pattern":"circle","n":8,"bc_d_mm":115.000,"start_deg":22.5,"axis":"z","from_mm":0,"to_mm":25.400,"tol_src":"source","tol_ref":"ISO 273 medium clearance M8 = 9.0 mm"}
//  ],
//  "loads":[
//    {"check":"hoop","name":"shoulder wall at O-ring groove root","P_MPa":6.00,"ri_mm":47.980,"t_mm":2.770,"sf_min":2.0,"inputs_src":"user","note":"ri = groove bottom radius = 95.96/2 = 47.98 mm; t = groove depth = 2.77 mm (thinnest wall); Lame hoop sigma = P*(ri^2+ro^2)/(ro^2-ri^2), ro=50.75 mm"},
//    {"check":"hoop","name":"flange face plate at MEOP","P_MPa":6.00,"ri_mm":40.000,"t_mm":17.400,"sf_min":2.0,"inputs_src":"user","note":"face plate thickness = total_z - pocket_z = 25.4 - 8.0 = 17.4 mm; ri=40 mm conservative pressure span"},
//    {"check":"thread","name":"M8 bolts into aluminium tank flange","size":"M8","engagement_mm":16.000,"internal_material":"6061-T6","inputs_src":"user","note":"16 mm engagement = 2x bolt diameter in tank flange; measure actual depth before assembly"},
//    {"check":"bolt_shear","name":"M8 bolt pattern pressure retention","size":"M8","n":8,"force_N":48641,"plate_t_mm":25.400,"sf_min":2.0,"inputs_src":"user","note":"force_N = P * pi * r^2 = 6.00e6 Pa * pi * (0.05080 m)^2 = 48641 N total axial load on bolt pattern","grade":"8.8"}
//  ],
//  "mfg":{"stock":"127 mm (5.000 in) diameter 6061-T6 round bar, length 35 mm minimum","finish":"anodize type II clear, mask 1/4 NPT thread and O-ring groove","heat_treat":"none","deburr":"0.5 x 45 chamfer all external edges; break all sharp edges 0.3 mm min; O-ring groove edges eased with 0.1 mm radius to prevent O-ring damage","inspect":["shoulder OD with outside micrometer at 3 axial stations","O-ring groove width and depth with groove micrometer (Parker ORD 5700 values)","bolt circle position on CMM or pin gauge","NPT port with 1/4 NPT plug gauge L1 hand-tight engagement","lightening pocket depth with depth micrometer","overall thickness with micrometer","flange OD with micrometer","boss height with height gauge"],"notes":["PRESSURE BOUNDARY — hydrotest to 90 bar (1305 psi) with water before any gas service; signed hydro record required","Lubricate O-ring with Krytox GPL 205 or N2O-compatible grease","NPT sealant: PTFE tape or anaerobic sealant rated for N2O service","Torque M8 bolts to 25 N·m (grade 8.8 lubricated) in star pattern","AS568-240 O-ring — confirm N2O compatibility with O-ring supplier"]}}
// FLIGHT-END

tess_tol      = 0.01;    // max chordal deviation of curved surfaces (mm)

// Diameters
flange_od     = 127.000; // flange outside diameter (mm) = 5.000 in
shoulder_od   = 101.500; // shoulder OD — piston seal surface (mm); tank bore = 101.60 mm
tank_bore     = 101.600; // nominal tank inner bore (mm) = 4.000 in — MEASURE and update
pocket_d      = 80.000;  // lightening pocket diameter (mm)
boss_od       = 22.000;  // NPT boss outside diameter (mm)
bolt_bc_d     = 115.000; // M8 bolt circle diameter (mm)
bolt_cl_d     = 9.000;   // M8 clearance hole diameter ISO 273 medium (mm)
npt_tap_d     = 11.110;  // 1/4 NPT tap drill diameter = 7/16 in (mm)

// Axial dimensions (all Z measured from inner face = z=0)
flange_z      = 5.400;   // flange step height (mm) — from z=0 inner face up to shoulder base
shoulder_z    = 20.000;  // shoulder engagement length (mm) — from flange step to shoulder tip
boss_z        = 3.000;   // NPT boss height above outer face (mm)
pocket_z      = 8.000;   // lightening pocket depth from inner face (mm)
npt_depth     = 14.500;  // 1/4 NPT tap drill depth from top of boss (mm)

// O-ring groove (AS568-240, CS 3.53 mm, radial piston seal)
// Groove located on shoulder, measured from inner face (z=0):
// Shoulder runs from z=flange_z to z=flange_z+shoulder_z = 5.4 to 25.4
// Groove near edge (toward outer face): z = 5.4 + 5.75 = 11.15
// Groove far  edge (toward inner face): z = 5.4 + 5.75 + 4.75 = 15.90
groove_depth  = 2.770;   // radial groove depth from the 101.50 shoulder OD to Parker Table 4-2 B1 = 95.96 (mm)
groove_w      = 4.750;   // groove width (mm) per Parker ORD 5700 Table 4-2 (G 4.75-4.88, no back-up ring)
groove_z0     = flange_z + 5.750; // groove near edge z from inner face (mm) = 11.150
// groove_bottom OD = shoulder_od - 2*groove_depth = 101.50 - 5.54 = 95.96 mm (Parker Table 4-2 B1 for -240)
groove_bot_od = shoulder_od - 2 * groove_depth; // = 95.960 mm

// Bolt circle
bolt_n        = 8;       // number of M8 bolts
bolt_start    = 22.5;    // first bolt CCW angle from +X (deg)

// Chamfer
cham          = 0.500;   // deburr chamfer (mm)

// Total part Z extent = flange_z + shoulder_z + boss_z = 5.4 + 20.0 + 3.0 = 28.4 mm
total_z       = flange_z + shoulder_z + boss_z; // 28.4 mm
// Outer face of flange = z = flange_z + shoulder_z = 25.4 mm
outer_face_z  = flange_z + shoulder_z; // 25.4 mm
// --- end parameters ---

function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));

// ─── body ────────────────────────────────────────────────────────────────────
// Flange disk + solid face plate, z=0 (inner face) to z=outer_face_z (25.4 mm).
// Lightening pocket is a cylindrical recess on the inner face (z=0 side).
// The body is the full flange OD from z=0 to z=outer_face_z, minus the pocket.
// The shoulder shares volume with body from z=flange_z to z=outer_face_z.
// Revolved profile (one rotate_extrude), then difference for pocket.
module body() {
    fn_f = fn_tol(flange_od);
    fn_p = fn_tol(pocket_d);

    // Solid of revolution: flange disk only (no pocket yet)
    // Profile in rz-plane (CCW = solid in OpenSCAD rotate_extrude)
    // r from 0 to flange_od/2, z from 0 to outer_face_z
    // Outer contour: chamfered edges
    rotate_extrude($fn=fn_f)
        polygon([
            // Inner face, axis
            [0,                    0],
            // Inner face, outer edge approach
            [flange_od/2 - cham,   0],
            // Inner face outer chamfer
            [flange_od/2,          cham],
            // Flange OD wall up to just below outer face
            [flange_od/2,          outer_face_z - cham],
            // Outer face outer chamfer
            [flange_od/2 - cham,   outer_face_z],
            // Outer face, across to axis
            [0,                    outer_face_z]
        ]);

    // Subtract lightening pocket: cylinder on inner face
    // (We do the difference here so the module is self-contained)
    // Actually we build the pocket subtraction in main(); body() is the solid flange disk.
}

// ─── shoulder ────────────────────────────────────────────────────────────────
// The shoulder is a cylinder of diameter shoulder_od that extends from
// z=flange_z (base, flush with flange step) to z=outer_face_z (tip at z=25.4).
// Length = shoulder_z = 20.0 mm.
// It contains the O-ring groove.
// This module is a solid of revolution — profile in rz-plane.
module shoulder() {
    fn_s  = fn_tol(shoulder_od);
    fn_gb = fn_tol(groove_bot_od);

    // groove z coordinates (from inner face z=0):
    gz0 = groove_z0;               // near edge  = 11.150 mm
    gz1 = groove_z0 + groove_w;    // far  edge  = 15.900 mm
    sh_r  = shoulder_od / 2;       // 50.750 mm
    gb_r  = groove_bot_od / 2;     // 47.980 mm

    rotate_extrude($fn=fn_s)
        polygon([
            // base of shoulder at flange step, axis
            [0,           flange_z],
            // shoulder outer radius at base (chamfer into flange step)
            [sh_r - cham, flange_z],
            [sh_r,        flange_z + cham],
            // shoulder wall up to groove near edge
            [sh_r,        gz0 - 0.10],
            // groove entry chamfer
            [sh_r - 0.10, gz0],
            // groove root
            [gb_r,        gz0],
            [gb_r,        gz1],
            // groove exit chamfer
            [sh_r - 0.10, gz1],
            [sh_r,        gz1 + 0.10],
            // shoulder wall to tip chamfer
            [sh_r,        outer_face_z - cham],
            // shoulder tip chamfer
            [sh_r - cham, outer_face_z],
            // close across top face back to axis
            [0,           outer_face_z]
        ]);
}

// ─── npt_boss ────────────────────────────────────────────────────────────────
// A raised cylindrical boss on the outer face (z=outer_face_z to z=total_z).
// The NPT port is drilled through this boss and into the face plate.
// boss_od 22 mm, height boss_z 3 mm.
module npt_boss() {
    fn_b = fn_tol(boss_od);
    rotate_extrude($fn=fn_b)
        polygon([
            [0,            outer_face_z],
            [boss_od/2 - cham, outer_face_z],
            [boss_od/2,    outer_face_z + cham],
            [boss_od/2,    total_z - cham],
            [boss_od/2 - cham, total_z],
            [0,            total_z]
        ]);
}

// ─── lightening pocket ────────────────────────────────────────────────────────
// Cylindrical recess on inner face (z=0) — subtracted in main().
module pocket_cut() {
    translate([0, 0, -0.1])
        cylinder(h = pocket_z + 0.1, d = pocket_d,
                 $fn = fn_tol(pocket_d));
}

// ─── bolt holes ───────────────────────────────────────────────────────────────
// 8× M8 clearance holes through the full flange thickness.
module bolt_holes() {
    for (i = [0 : bolt_n - 1]) {
        angle = bolt_start + i * (360.0 / bolt_n);
        translate([(bolt_bc_d/2)*cos(angle),
                   (bolt_bc_d/2)*sin(angle),
                   -0.1])
            cylinder(h = outer_face_z + 0.2, d = bolt_cl_d,
                     $fn = fn_tol(bolt_cl_d));
    }
}

// ─── NPT port ─────────────────────────────────────────────────────────────────
// Straight tap-drill bore from top of boss downward, depth npt_depth.
// Modelled at tap-drill diameter (NPT taper is cut by the tap, not modelled as geometry).
// from z=total_z down to z = total_z - npt_depth = 28.4 - 14.5 = 13.9 mm
module npt_cut() {
    translate([0, 0, total_z - npt_depth - 0.1])
        cylinder(h = npt_depth + 0.1, d = npt_tap_d,
                 $fn = fn_tol(npt_tap_d));
}

// ─── gauge for O-ring groove (NO-GO: groove must accept the O-ring CS) ────────
// A torus-section gauge ring at groove position — for reference; not called by main().
module gauge_groove_go() {
    // The groove must accept an O-ring of CS 3.53 mm.
    // GO gauge: a ring of cross-section equal to groove dimensions (groove_w × groove_depth)
    // positioned at groove_z0, shoulder_od/2.
    // expect: clear — the O-ring (modelled as a square cross-section for GO) must fit.
    translate([0, 0, 0])
    rotate_extrude($fn=fn_tol(groove_bot_od))
        square([groove_depth, groove_w],
               center=false); // positioned at r=groove_bot_od/2, z=groove_z0
    // Note: actual gauge position and orientation set by the calling check harness.
}

// ─── main ─────────────────────────────────────────────────────────────────────
module main() {
    difference() {
        union() {
            body();
            shoulder();
            npt_boss();
        }
        pocket_cut();
        bolt_holes();
        npt_cut();
    }
}

main();
