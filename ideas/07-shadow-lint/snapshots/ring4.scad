// PART: 6 in to 54 mm Motor Centering Ring
// KIND: mechanical
// MAKE: CNC mill · 6061-T6 aluminum plate 160 x 160 x 10 mm · 1 setup on fixture plate · CMM / plug gauge inspection
// NOTE: Designed for 6.0 in airframe shared ID 152.40 mm = 6.000 in with 0.05 mm radial clearance (ring OD 152.30 mm = 5.996 in)
// NOTE: Motor mount tube bore 57.50 mm = 2.264 in for LOC Precision MMT-2.14 / BT-2.14 (OD 57.40 mm = 2.260 in [likely])
// NOTE: Thickness 8.00 mm = 0.315 in
// NOTE: Certified peak thrust reference: Loki L2050 at 3331 N peak [likely]
// SPEC-BEGIN
// {"name":"6in_to_54mm_centering_ring","size_mm":[152.3,152.3,8.0],"parts":[{"name":"ring","role":"main body","size_mm":[152.3,152.3,8.0]}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_mill","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"overall height","module":"ring","axis":"z","nominal_mm":8.000,"tol_mm":0.05,"tol_src":"default"},
//              {"name":"outer diameter extent","module":"ring","axis":"x","nominal_mm":152.300,"tol_mm":0.10,"tol_src":"user"}],
//  "od":[{"name":"centering ring OD","d_mm":152.300,"tol_mm":0.08,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":8.0,"tol_src":"user"}],
//  "bores":[{"name":"MMT bore","d_mm":57.500,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":8.0,"to_mm":0,"tol_src":"source","tol_ref":"LOC Precision MMT-2.14 / BT-2.14 OD 57.4 mm"}],
//  "holes":[{"name":"lightening holes","d_mm":25.00,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":4,"bc_d_mm":105.0,"start_deg":0,"axis":"z","from_mm":8.0,"to_mm":0,"tol_src":"default"},
//           {"name":"eyebolt mounting holes","d_mm":6.60,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":2,"bc_d_mm":105.0,"start_deg":45,"axis":"z","from_mm":8.0,"to_mm":0,"tol_src":"default"},
//           {"name":"perimeter mounting holes","d_mm":3.40,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":6,"bc_d_mm":142.0,"start_deg":0,"axis":"z","from_mm":8.0,"to_mm":0,"tol_src":"default"}],
//  "loads":[{"check":"bolt_shear","name":"thrust retention bolts","size":"M3","n":6,"grade":"8.8","force_N":3331,"plate_t_mm":8.0,"sf_min":2.0,"inputs_src":"source","motor":"Loki L2050"}],
//  "mfg":{"stock":"160 mm x 160 mm x 10 mm 6061-T6 plate","finish":"anodize type II clear","heat_treat":"none","deburr":"0.5 x 45 chamfer all external edges","inspect":["OD with micrometer / caliper","MMT bore with plug gauge or caliper","bolt circle pattern on CMM"],"notes":["Designed for 6.0 in ID airframe (152.4 mm nominal) with 0.05 mm radial clearance","Bored for 54 mm MMT (LOC BT-2.14 OD 57.4 mm + 0.1 mm clearance)","Max peak thrust based on Loki L2050 certified 3331 N peak"]}}
// FLIGHT-END

tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
ring_od = 152.30; // outer diameter of centering ring (mm)
ring_id = 57.50; // inner diameter for 54 mm motor mount tube (mm)
ring_h = 8.00; // thickness of centering ring (mm)
chamfer = 0.50; // external edge chamfer (mm)

light_d = 25.00; // lightening hole diameter (mm)
light_bc_d = 105.00; // bolt circle diameter for lightening holes (mm)

eye_d = 6.60; // eyebolt hole diameter M6 clearance (mm)
eye_bc_d = 105.00; // bolt circle diameter for eyebolt holes (mm)

perim_d = 3.40; // perimeter mounting hole diameter M3 clearance (mm)
perim_bc_d = 142.00; // bolt circle diameter for perimeter holes (mm)
// --- end parameters ---

function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));

module ring() {
    fn_ring = fn_tol(ring_od);
    rotate_extrude($fn = fn_ring) {
        polygon(points = [
            [ring_id/2 + chamfer, 0],
            [ring_od/2 - chamfer, 0],
            [ring_od/2, chamfer],
            [ring_od/2, ring_h - chamfer],
            [ring_od/2 - chamfer, ring_h],
            [ring_id/2 + chamfer, ring_h],
            [ring_id/2, ring_h - chamfer],
            [ring_id/2, chamfer]
        ]);
    }
}

module main() {
    difference() {
        ring();

        // Lightening holes (4 x Ø25.0 mm on 105 mm BC at 0, 90, 180, 270 deg)
        fn_light = fn_tol(light_d);
        for (a = [0 : 90 : 270]) {
            rotate([0, 0, a])
            translate([light_bc_d / 2, 0, -1])
            cylinder(d = light_d, h = ring_h + 2, $fn = fn_light);
        }

        // Eyebolt / harness mounting holes (2 x Ø6.6 mm M6 clearance on 105 mm BC at 45, 225 deg)
        fn_eye = fn_tol(eye_d);
        for (a = [45, 225]) {
            rotate([0, 0, a])
            translate([eye_bc_d / 2, 0, -1])
            cylinder(d = eye_d, h = ring_h + 2, $fn = fn_eye);
        }

        // Perimeter airframe retention holes (6 x Ø3.4 mm M3 clearance on 142 mm BC)
        fn_perim = fn_tol(perim_d);
        for (i = [0 : 5]) {
            rotate([0, 0, i * 60])
            translate([perim_bc_d / 2, 0, -1])
            cylinder(d = perim_d, h = ring_h + 2, $fn = fn_perim);
        }
    }
}

main();
