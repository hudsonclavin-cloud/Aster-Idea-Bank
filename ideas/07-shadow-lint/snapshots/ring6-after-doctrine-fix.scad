// PART: 6 in Airframe Centering Ring for 54 mm Motor Mount
// KIND: mechanical
// MAKE: CNC milled from 6061-T6 aluminum plate · 1 setup · CMM / micrometer inspection
// NOTE: Airframe ID nominal 152.40 mm = 6.000 in (Blue Tube ARR / Madcow / Giant Leap [likely]). Ring OD 152.30 mm gives 0.05 mm radial clearance for epoxy bond.
// NOTE: Motor mount tube (MMT) OD nominal 57.40 mm = 2.260 in (LOC MMT-2.14 / Madcow T54-180 [likely]). Ring bore 57.50 mm gives 0.05 mm radial bond clearance.
// NOTE: Sized for peak thrust of 3331 N from certified Loki L2050 54 mm motor [likely, ThrustCurve.org].
// SPEC-BEGIN
// {"name":"centering_ring_6in_54mm","size_mm":[152.3,152.3,8.0],"parts":[{"name":"plate","role":"main body","size_mm":[152.3,152.3,8.0]}],"joints":[]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_mill","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"overall diameter","module":"plate","axis":"x","nominal_mm":152.300,"tol_mm":0.10,"tol_src":"source","tol_ref":"openrocket-database airframe ID 152.4mm","round":true},
//              {"name":"plate thickness","module":"plate","axis":"z","nominal_mm":8.000,"tol_mm":0.10,"tol_src":"user"}],
//  "od":[{"name":"ring OD","d_mm":152.300,"tol_mm":0.10,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":8,"tol_src":"source","tol_ref":"openrocket-database airframe ID 152.4mm"}],
//  "bores":[{"name":"motor mount bore","d_mm":57.500,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":8,"to_mm":0,"tol_src":"source","tol_ref":"LOC BT-2.14 / Madcow T54-180 OD 57.4mm"}],
//  "holes":[{"name":"mounting bolt circle","d_mm":5.50,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":8,"bc_d_mm":138.0,"start_deg":0,"axis":"z","from_mm":8,"to_mm":0,"tol_src":"default"},
//           {"name":"lightening pass-through ports","d_mm":12.00,"tol_mm":0.15,"pos_tol_mm":0.15,"pattern":"circle","n":4,"bc_d_mm":105.0,"start_deg":45,"axis":"z","from_mm":8,"to_mm":0,"tol_src":"default"},
//           {"name":"harness U-bolt holes","d_mm":6.60,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"list","at_mm":[[-17.5,45.0],[17.5,45.0]],"axis":"z","from_mm":8,"to_mm":0,"tol_src":"default"}],
//  "loads":[{"check":"bolt_shear","name":"thrust retention bolts","motor":"Loki L2050","size":"M5","grade":"8.8","n":8,"force_N":3331,"plate_t_mm":8.0,"sf_min":2.0,"inputs_src":"source"}],
//  "mfg":{"stock":"160 x 160 x 10 mm 6061-T6 aluminum plate","finish":"anodize type II clear","heat_treat":"none","deburr":"0.5 x 45 chamfer all external edges","inspect":["OD with micrometer","bore with plug gauge","bolt pattern with CMM"],"notes":["Verify airframe ID (152.4 mm) and MMT OD (57.4 mm) before final machining","Bond with structural epoxy (Hysol E-120HP or JB Weld)"]}}
// FLIGHT-END

tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
ring_od = 152.30; // ring outer diameter (mm)
mmt_bore = 57.50; // motor mount tube inner bore diameter (mm)
thickness = 8.00; // ring plate thickness (mm)
mount_bc_d = 138.0; // mounting bolt circle diameter (mm)
mount_hole_d = 5.5; // mounting hole diameter (M5 clearance) (mm)
port_bc_d = 105.0; // pass-through port circle diameter (mm)
port_d = 12.0; // pass-through port diameter (mm)
ubolt_x = 17.5; // U-bolt hole half-spacing (mm)
ubolt_y = 45.0; // U-bolt position Y offset (mm)
ubolt_d = 6.6; // U-bolt hole diameter (M6 clearance) (mm)
chamfer = 0.5; // edge chamfer (mm)
// --- end parameters ---

function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));

module plate() {
    r_out = ring_od / 2;
    r_in = mmt_bore / 2;
    c = chamfer;
    
    rotate_extrude($fn=fn_tol(ring_od)) {
        polygon(points=[
            [r_in + c, 0],
            [r_out - c, 0],
            [r_out, c],
            [r_out, thickness - c],
            [r_out - c, thickness],
            [r_in + c, thickness],
            [r_in, thickness - c],
            [r_in, c]
        ]);
    }
}

module main() {
    difference() {
        plate();
        
        // 8x M5 peripheral mounting / shear pin holes
        for (i = [0:7]) {
            a = i * 45;
            rotate([0, 0, a])
            translate([mount_bc_d / 2, 0, -1])
            cylinder(d=mount_hole_d, h=thickness + 2, $fn=fn_tol(mount_hole_d));
        }
        
        // 4x pass-through / vent / wiring ports
        for (i = [0:3]) {
            a = 45 + i * 90;
            rotate([0, 0, a])
            translate([port_bc_d / 2, 0, -1])
            cylinder(d=port_d, h=thickness + 2, $fn=fn_tol(port_d));
        }
        
        // 2x M6 U-bolt holes for recovery harness anchor
        translate([-ubolt_x, ubolt_y, -1])
        cylinder(d=ubolt_d, h=thickness + 2, $fn=fn_tol(ubolt_d));
        
        translate([ubolt_x, ubolt_y, -1])
        cylinder(d=ubolt_d, h=thickness + 2, $fn=fn_tol(ubolt_d));
    }
}

main();
