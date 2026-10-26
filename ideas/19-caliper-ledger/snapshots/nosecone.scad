// PART: 6-in nose cone, von Karman, hollow CF shell with shoulder and aluminium-tip pocket
// KIND: mechanical
// MAKE: CF layup in a 2-piece female mould cut from this profile (set tip_insert=0 for the plug); tip section filled solid before cure; one lathe setup on an expanding mandrel in the shoulder bore: face the tip station, drill 19.50 and ream the pocket Ø20.00 H7; profile template, micrometer, plug gauge
// NOTE: Airframe assumed OD 152.40 mm = 6.000 in, ID 149.60 mm = 5.890 in (1.40 mm wall); set base_d and airframe_id to your tube. Shoulder OD = ID - 0.15 slip clearance = 149.45 mm = 5.884 in
// NOTE: Nose length L 400 mm = 15.75 in (2.62 cal) is base plane to the theoretical sharp apex, as OpenRocket defines it. Body is cut 40 mm below that apex (D 34.77 at the cut); the aluminium tip continues the same profile to a 3 mm spherical blunt apex. Overall body length = 76 + 400 - 40 = 436.00 mm = 17.165 in
// NOTE: Shoulder 76 mm = 2.99 in (0.5 cal); wall 3.0 mm laminate. Shoulder bore Ø143.45 runs straight up until it meets the 3 mm shell (thicker base region, no undercut)
// NOTE: Tip pocket Ø20.00 +/-0.05 x 40 deep from the cut face (z 396..436); drill 19.50, ream 20.00 H7. Tip shank Ø19.95 for a bonded (epoxy) fit
// NOTE: profile: 0 conical, 1 tangent ogive, 2 von Karman (default), 3 LV-Haack. Equations per Crowell/Wikipedia; OpenSCAD trig is in degrees so the Haack theta is converted explicitly. Changing the profile changes only the tip-cut diameter, not any declared dimension
// NOTE: tip_insert=0 renders the full profile with the 3 mm blunt apex for the mould plug; its overall length is then 476 minus the blunt cut (1.62 mm for von Karman, see echo) and the FLIGHT overall-length nominal no longer applies
// NOTE: module shoulder() is the same profile clipped to z 0..76 so the app can measure shoulder OD and length; it is not a separate part and is not drawn by main()
// SPEC-BEGIN
// {"name":"6-in von Karman nose cone with tip pocket","size_mm":[152.4,152.4,436],
//  "parts":[{"name":"body","role":"revolved hollow nose cone with shoulder, solid tip block and Ø20 tip pocket","size_mm":[152.4,152.4,436]}]}
// SPEC-END
// FLIGHT-BEGIN
// {"material":"CF-laminate","process":"composite_layup","tolerance_class":"ISO 2768-m","tess_tol_mm":0.01,"hazard":"none",
//  "critical":[{"name":"base D","module":"body","axis":"x","nominal_mm":152.40,"tol_mm":0.15,"round":true,"tol_src":"default"},
//              {"name":"shoulder OD","module":"shoulder","axis":"x","nominal_mm":149.45,"tol_mm":0.10,"round":true,"tol_src":"default"},
//              {"name":"overall length","module":"body","axis":"z","nominal_mm":436.00,"tol_mm":0.30,"tol_src":"default"},
//              {"name":"shoulder length","module":"shoulder","axis":"z","nominal_mm":76.00,"tol_mm":0.25,"tol_src":"default"}],
//  "bores":[{"name":"tip insert pocket","d_mm":20.00,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":436,"to_mm":396,"tol_src":"default"},
//           {"name":"shoulder bore","d_mm":143.45,"tol_mm":0.30,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":76,"tol_src":"default"}],
//  "holes":[],
//  "loads":[],
//  "mfg":{"stock":"2-piece female mould machined from this profile (tip_insert=0 plug); 3.0 mm CF laminate, tip section filled solid with chopped-fibre epoxy before cure",
//         "finish":"gel coat, wet sand 400 grit, prime; shoulder OD sanded to size",
//         "heat_treat":"none (post-cure per resin data sheet)",
//         "deburr":"0.5 x 45 chamfer on shoulder lead-in, shoulder bore lead-in and pocket mouth; break the cut-face edge",
//         "inspect":["profile with a cut template at 5 stations from the base","shoulder OD with a micrometer at 3 places","pocket with a Ø20 GO/NO-GO plug gauge","overall length and shoulder length from the shoulder bottom face"],
//         "notes":["pocket is machined after cure with the cone on a mandrel in the shoulder bore so it is coaxial with the shoulder","aluminium tip is a separate part: same profile from x=40 to the 3 mm blunt apex, shank Ø19.95 x 39"]}}
// FLIGHT-END
tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)
profile = 2;        // nose shape: 0 conical, 1 tangent ogive, 2 von Karman (LD-Haack C=0), 3 LV-Haack (C=1/3)
L = 400;            // nose length, base plane to theoretical sharp apex (2.62 calibers; 15.75 in)
base_d = 152.40;    // base diameter = airframe OD, 6.000 in
airframe_id = 149.60; // airframe ID, 5.890 in (6-in tube with 1.40 mm wall) — assumption
shoulder_clr = 0.15;  // diametral clearance, shoulder in airframe (painted slip fit)
shoulder_l = 76;    // shoulder length, 0.5 caliber
wall = 3.0;         // laminate wall: shoulder tube and cone shell
tip_r = 3;          // spherical blunt tip radius (aluminium tip / mould plug)
tip_insert = 1;     // 1 = composite body cut for the aluminium tip, with pocket; 0 = full blunted profile (mould plug)
tip_cut = 40;       // body cut station below the theoretical apex; the aluminium tip runs from here to the apex
pocket_d = 20.00;   // tip insert shank pocket, reamed H7 (drill 19.50)
pocket_depth = 40;  // pocket depth from the cut face
tip_block = 50;     // solid length below the cut face that carries the pocket (pocket_depth + 10)
chamfer = 0.5;      // 0.5 x 45 deburr / lead-in chamfer
N = 120;            // profile sample points from the tip, cosine spaced (dense at both ends)
// --- end parameters ---
function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));

// derived
R = base_d/2;                        // base radius
shoulder_d = airframe_id - shoulder_clr; // shoulder OD 149.45
shoulder_r = shoulder_d/2;
hollow_r = shoulder_r - wall;        // shoulder bore radius (Ø143.45)
pocket_r = pocket_d/2;
z_apex = shoulder_l + L;             // theoretical sharp apex
z_face = z_apex - tip_cut;           // tip cut face (top of the composite body)
z_blk = z_face - tip_block;          // bottom of the solid tip block
rho = (R*R + L*L)/(2*R);             // tangent ogive radius

// profile radius y at distance x from the sharp apex (x in 0..L), Crowell / Wikipedia forms
function y_ogive(x) = sqrt(rho*rho - (L - x)*(L - x)) + R - rho;
function y_haack(x, C) = let(th_deg = acos(1 - 2*x/L), th = th_deg*PI/180)   // theta in degrees for sin(), radians for the linear term
  R/sqrt(PI) * sqrt(th - sin(2*th_deg)/2 + C*pow(sin(th_deg), 3));
function y_prof(xr) = let(x = max(0, min(L, xr)))
  profile == 0 ? x*R/L : profile == 1 ? y_ogive(x) : profile == 2 ? y_haack(x, 0) : y_haack(x, 1/3);
function slope(x) = let(h = 0.01) (y_prof(x + h) - y_prof(x - h))/(2*h);   // dy/dx, central difference

// spherical blunting: the sphere of radius tip_r centred on the axis is tangent where y*sqrt(1+m^2) = tip_r
function g_tan(x) = let(m = slope(x)) y_prof(x)*sqrt(1 + m*m) - tip_r;
function bisect(a, b, n) = n == 0 ? (a + b)/2 : let(c = (a + b)/2) (g_tan(c) < 0 ? bisect(c, b, n - 1) : bisect(a, c, n - 1));
x_t = bisect(0.001, L/2, 40);        // tangency station
y_t = y_prof(x_t);
m_t = slope(x_t);
s_t = sqrt(1 + m_t*m_t);
x_c = x_t + tip_r*m_t/s_t;           // sphere centre on the axis
x_apex = x_c - tip_r;                // blunted apex sits this far below the sharp apex
phi_t = acos(m_t/s_t);               // arc angle from apex to tangency (deg)
n_arc = max(2, ceil(fn_tol(2*tip_r)*phi_t/360));

// outer curve samples, cosine spaced in x from x0 to L; listed base -> tip as [r, z]
x0 = tip_insert ? tip_cut : x_t;
function xs(i) = x0 + (L - x0)*(1 - cos(180*i/N))/2;
outer_pts = [for (i = [0:N]) let(x = xs(N - i)) [y_prof(x), z_apex - x]];
// inner shell: outer point moved `wall` along the inward normal; clamped to the shoulder bore near the base
function inner_pt(x) = let(m = slope(x), s = sqrt(1 + m*m)) [y_prof(x) - wall/s, z_apex - x - wall*m/s];
inner_pts = [for (i = [0:N]) let(p = inner_pt(xs(i))) if (p[1] <= z_blk) [min(p[0], hollow_r), p[1]]];   // tip -> base
arc_pts = [for (i = [0:n_arc]) let(phi = phi_t*(1 - i/n_arc)) [tip_r*sin(phi), z_apex - (x_c - tip_r*cos(phi))]];   // tangency -> apex

assert(!tip_insert || y_prof(tip_cut) - pocket_r >= wall, "tip_cut is too close to the apex: wall around the pocket at the cut face is under one laminate wall");
echo(str("nosecone: profile ", profile, ", blunt apex cut ", x_apex, " mm, tangency at x=", x_t, " mm, cut-face D ", 2*y_prof(tip_cut), " mm, tip-block D ", 2*y_prof(tip_cut + tip_block), " mm"));

// one closed [r, z] profile, counter-clockwise: bottom face -> shoulder -> outer curve -> tip -> axis -> inner cavity -> bottom
bottom_pts = [[hollow_r + chamfer, 0], [shoulder_r - chamfer, 0], [shoulder_r, chamfer], [shoulder_r, shoulder_l]];
prof_pts = tip_insert
  ? concat(bottom_pts, outer_pts,
           [[pocket_r + chamfer, z_face], [pocket_r, z_face - chamfer], [pocket_r, z_face - pocket_depth], [0, z_face - pocket_depth], [0, z_blk], [inner_pts[0][0], z_blk]],
           inner_pts, [[hollow_r, chamfer]])
  : concat(bottom_pts, outer_pts, arc_pts, [[0, shoulder_l], [hollow_r, shoulder_l], [hollow_r, chamfer]]);

module body(){ // whole nose cone, one revolve, resting on its shoulder face at z=0
  rotate_extrude($fn = fn_tol(base_d)) polygon(prof_pts);
}
module shoulder(){ // same profile clipped to the shoulder (z 0..76): measurement helper for shoulder OD and length, not drawn by main()
  rotate_extrude($fn = fn_tol(shoulder_d)) intersection(){ polygon(prof_pts); square([base_d, shoulder_l]); }
}
module main(){ body(); }
main();
