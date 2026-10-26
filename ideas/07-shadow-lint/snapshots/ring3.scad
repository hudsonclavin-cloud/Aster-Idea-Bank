// PART: 6 in centering ring for 54 mm motor mount
// KIND: mechanical
// MAKE: CNC milled from 6061-T6 plate; deburr 0.5x45 deg chamfers; inspect bore with plug gauge and OD with micrometer
// NOTE: 6 in airframe ID 152.40 mm (6.000 in) per openrocket-database [likely]. Ring OD 152.30 mm gives 0.10 mm diametral clearance.
// NOTE: 54 mm MMT tube OD 57.40 mm (LOC/Madcow MMT-2.14) [likely]. Ring bore 57.50 mm gives 0.10 mm clearance for epoxy bond.
// NOTE: Loki L2050 peak thrust 3331 N [likely] used as load floor for 6 x M4 mounting bolt shear check.
// SPEC-BEGIN
// {"name":"centering_ring_6in_54mm","size_mm":[152.3,152.3,8.0],"parts":[{"name":"ring","role":"centering ring body","size_mm":[152.3,152.3,8.0]}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_mill","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"overall diameter","module":"ring","axis":"x","nominal_mm":152.300,"tol_mm":0.05,"tol_src":"user","round":true},
//              {"name":"plate thickness","module":"ring","axis":"z","nominal_mm":8.000,"tol_mm":0.05,"tol_src":"user"}],
//  "od":[{"name":"outer diameter","d_mm":152.300,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":8.0,"tol_src":"source","tol_ref":"openrocket-database 6in airframe shared 152.4mm ID"}],
//  "bores":[{"name":"MMT bore","d_mm":57.500,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":8.0,"to_mm":0,"tol_src":"source","tol_ref":"LOC Precision MMT-2.14 57.40mm OD"}],
//  "holes":[{"name":"airframe mounting holes","d_mm":4.50,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":6,"bc_d_mm":140.0,"start_deg":0,"axis":"z","from_mm":8.0,"to_mm":0,"tol_src":"default"},
//           {"name":"tie rod clearance holes","d_mm":6.60,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":2,"bc_d_mm":105.0,"start_deg":90,"axis":"z","from_mm":8.0,"to_mm":0,"tol_src":"default"},
//           {"name":"lightening holes","d_mm":28.00,"tol_mm":0.15,"pos_tol_mm":0.15,"pattern":"circle","n":4,"bc_d_mm":105.0,"start_deg":45,"axis":"z","from_mm":8.0,"to_mm":0,"tol_src":"default"}],
//  "loads":[{"check":"bolt_shear","name":"thrust retention bolts","motor":"Loki L2050","size":"M4","grade":"8.8","n":6,"force_N":3331,"plate_t_mm":8.0,"sf_min":2.0,"inputs_src":"source"}],
//  "mfg":{"stock":"158.75 mm (6.25 in) 6061-T6 aluminum plate","finish":"deburr and clear anodize","heat_treat":"none","deburr":"0.5 x 45 deg chamfer all external edges","inspect":["OD micrometer 152.30 mm","MMT bore plug gauge 57.50 mm","plate thickness caliper 8.00 mm","bolt circle PCD pin gauge"],"notes":["micrometer test airframe ID before final machining","epoxy bond MMT and airframe with structural adhesive"]}}
// FLIGHT-END

tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
ring_od = 152.30; // outer diameter of centering ring (mm)
mmt_bore = 57.50; // inner bore diameter for 54 mm MMT tube (mm)
ring_thickness = 8.00; // thickness of centering ring (mm)

mount_hole_d = 4.50; // diameter of airframe mounting clearance holes (M4)
mount_bc_d = 140.00; // bolt circle diameter for mounting holes (mm)
mount_n = 6; // number of mounting holes

tierod_hole_d = 6.60; // diameter of tie rod clearance holes (M6)
tierod_bc_d = 105.00; // bolt circle diameter for tie rod holes (mm)

lightening_d = 28.00; // diameter of lightening cutouts (mm)
lightening_bc_d = 105.00; // bolt circle diameter for lightening cutouts (mm)

chamfer = 0.50; // edge deburr chamfer size (mm)

// --- end parameters ---

function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));

module ring() {
    r_in = mmt_bore / 2;
    r_out = ring_od / 2;
    c = chamfer;
    
    rotate_extrude($fn=fn_tol(ring_od)) {
        polygon(points=[
            [r_in + c, 0],
            [r_out - c, 0],
            [r_out, c],
            [r_out, ring_thickness - c],
            [r_out - c, ring_thickness],
            [r_in + c, ring_thickness],
            [r_in, ring_thickness - c],
            [r_in, c]
        ]);
    }
}

module main() {
    difference() {
        ring();
        
        // Airframe mounting holes (6x M4 clearance = 4.5 mm at 0, 60, 120, 180, 240, 300 deg)
        for (i = [0 : mount_n - 1]) {
            angle = i * (360 / mount_n);
            rotate([0, 0, angle])
                translate([mount_bc_d / 2, 0, -1])
                    cylinder(d=mount_hole_d, h=ring_thickness + 2, $fn=fn_tol(mount_hole_d));
        }
        
        // Tie rod clearance holes (2x M6 clearance = 6.6 mm at 90 and 270 deg)
        for (i = [0 : 1]) {
            angle = 90 + i * 180;
            rotate([0, 0, angle])
                translate([tierod_bc_d / 2, 0, -1])
                    cylinder(d=tierod_hole_d, h=ring_thickness + 2, $fn=fn_tol(tierod_hole_d));
        }
        
        // Lightening holes (4x 28.0 mm at 45, 135, 225, 315 deg)
        for (i = [0 : 3]) {
            angle = 45 + i * 90;
            rotate([0, 0, angle])
                translate([lightening_bc_d / 2, 0, -1])
                    cylinder(d=lightening_d, h=ring_thickness + 2, $fn=fn_tol(lightening_d));
        }
    }
}

main();
