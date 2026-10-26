// PART: 6in airframe 54mm MMT aluminum centering ring
// KIND: mechanical
// MAKE: cnc_mill · 6061-T6 round bar stock 158.75 mm (6.25 in) x 12.7 mm (0.50 in) · 2 setups · CMM inspection
// NOTE: Airframe ID 152.400 mm = 6.000 in [likely, openrocket-database (Blue Tube, Giant Leap, Madcow)]. Centering ring OD 152.300 mm provides 0.10 mm clearance for epoxy fit.
// NOTE: 54 mm MMT tube OD 57.400 mm [likely, LOC Precision MMT-2.14 / Madcow T54-180]. Centering ring bore 57.500 mm provides 0.10 mm clearance for fit.
// NOTE: Peak thrust load 3331 N based on Loki L2050 certified data (ThrustCurve.org) [likely].

// SPEC-BEGIN
// {"name":"6in 54mm centering ring","size_mm":[152.3,152.3,8.0],"parts":[{"name":"ring","role":"main body","size_mm":[152.3,152.3,8.0]}]}
// SPEC-END

// FLIGHT-BEGIN
// {"material":"6061-T6","process":"cnc_mill","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"overall diameter","module":"ring","axis":"x","nominal_mm":152.300,"tol_mm":0.05,"round":true,"tol_src":"user"},
//              {"name":"ring thickness","module":"ring","axis":"z","nominal_mm":8.000,"tol_mm":0.05,"tol_src":"user"}],
//  "od":[{"name":"ring OD","d_mm":152.300,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":8,"tol_src":"user","tol_ref":"Fit into 152.40 mm ID airframe"}],
//  "bores":[{"name":"MMT bore","d_mm":57.500,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":8,"to_mm":0,"tol_src":"source","tol_ref":"LOC Precision MMT-2.14 OD 57.4 mm"}],
//  "holes":[{"name":"thrust bolts","d_mm":5.50,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":8,"bc_d_mm":120.0,"start_deg":0,"axis":"z","from_mm":8,"to_mm":0,"tol_src":"source","tol_ref":"ISO 273 medium M5 clearance"},
//           {"name":"lightening holes","d_mm":20.00,"tol_mm":0.10,"pos_tol_mm":0.10,"pattern":"circle","n":6,"bc_d_mm":88.0,"start_deg":30,"axis":"z","from_mm":8,"to_mm":0,"tol_src":"default"}],
//  "loads":[{"check":"bolt_shear","name":"thrust bolts","size":"M5","n":8,"force_N":3331,"plate_t_mm":8.00,"grade":"8.8","sf_min":2.0,"motor":"Loki L2050","inputs_src":"source"}],
//  "mfg":{"stock":"158.75 mm (6.25 in) 6061-T6 round bar","finish":"deburr / anodize clear type II","heat_treat":"none","deburr":"0.5 x 45 chamfer all external edges","inspect":["OD with micrometer at 3 clockings","MMT bore with plug gauge","bolt circle on CMM"],"notes":["bonded into airframe tube with epoxy","verify actual MMT tube OD before final machining"]}}
// FLIGHT-END

tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
ring_od = 152.30; // outer diameter of centering ring (mm)
mmt_bore = 57.50; // inner bore diameter for 54mm MMT tube (mm)
thickness = 8.00; // thickness of centering ring (mm)
bolt_bc_d = 120.00; // bolt circle diameter for thrust/tie bolts (mm)
bolt_d = 5.50; // clearance hole diameter for M5 bolts (mm)
bolt_n = 8; // number of M5 thrust bolt holes
light_bc_d = 88.00; // circle diameter for lightening holes (mm)
light_d = 20.00; // diameter of lightening holes (mm)
light_n = 6; // number of lightening holes
chamfer = 0.50; // edge chamfer size (mm)
// --- end parameters ---

function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));

module ring() {
    rotate_extrude($fn=fn_tol(ring_od)) {
        polygon(points=[
            [mmt_bore/2 + chamfer, 0],
            [ring_od/2 - chamfer, 0],
            [ring_od/2, chamfer],
            [ring_od/2, thickness - chamfer],
            [ring_od/2 - chamfer, thickness],
            [mmt_bore/2 + chamfer, thickness],
            [mmt_bore/2, thickness - chamfer],
            [mmt_bore/2, chamfer]
        ]);
    }
}

module main() {
    difference() {
        ring();

        // 8x M5 thrust/retention bolt clearance holes
        for (i = [0 : bolt_n - 1]) {
            angle = i * (360 / bolt_n);
            rotate([0, 0, angle])
                translate([bolt_bc_d / 2, 0, -1])
                    cylinder(d = bolt_d, h = thickness + 2, $fn = fn_tol(bolt_d));
        }

        // 6x Lightening / pass-through holes
        for (i = [0 : light_n - 1]) {
            angle = 30 + i * (360 / light_n);
            rotate([0, 0, angle])
                translate([light_bc_d / 2, 0, -1])
                    cylinder(d = light_d, h = thickness + 2, $fn = fn_tol(light_d));
        }
    }
}

main();
