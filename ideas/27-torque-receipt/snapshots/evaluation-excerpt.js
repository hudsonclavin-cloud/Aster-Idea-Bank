/* derived by build-data.mjs: lines 79, 396, 398, 399, 400, 401, 402, 403, 404, 405 of PartForge docs/roadmap-evaluation.md at 0974a62, exact text.
   See the .provenance.json sidecar beside this file. Do not edit: re-run build-data.mjs. */
(function (root, factory) {
  var d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d;
  else { root.TorqueData = root.TorqueData || {}; root.TorqueData["evaluation"] = d; }
})(typeof self !== 'undefined' ? self : this, function () {
  return { path: "docs/roadmap-evaluation.md", commit: "0974a62b309b8cf7acd33771b49e9357d4d191f4", lines: [
 {
  "line": 79,
  "text": "| 4 | Bolt preload & flange separation | 3 | 9 | 0.33 | build trimmed (2 d of 9) — tension only | The missing tension primitive is real; separation is the wrong criterion for a radial piston seal. |"
 },
 {
  "line": 396,
  "text": "**#4 Bolt preload & flange separation** — value 3, 9 days, *build-trimmed*. Preloaded-joint math; the missing tension primitive is real, but separation is the wrong criterion for a radial piston seal."
 },
 {
  "line": 398,
  "text": "- Method: Build the cheap half only (~1.5-2 d of the 9): bolt tensile stress at the declared joint load vs ISO 898-1 PROOF, a torque-vs-proof installation check (T = K*F*d), and thread strip at the joint load. Drop the joint diagram (k_b, Shigley frustum k_m, C, p_sep) until someone builds a face-sealed bolted closure. The proof strengths, nut factors K = 0.20 dry / 0.14-0.16 lubricated, the +/-25% scatter figure and the 0.65-0.75x proof target ALREADY SHIP in data/tables/fasteners_metric.json with sources and confidence — the sketch's proposed inline BOLT_PROOF_MPa table is a duplicate that tests/flight-db-embed.test.mjs exists to prevent."
 },
 {
  "line": 399,
  "text": "- Hook: Whitelist at index.html:4126, evaluator branches at 4900-4934, GRADE_SY at 4929, renderer 5736. Tier gap: partTier() escalates on check === 'hoop' (index.html:4178), so a bulkhead declaring only bolt_tension stays tier A and gets a RELEASE SHEET carrying a preload margin."
 },
 {
  "line": 400,
  "text": "- Needs: load-case declaration, assembly/multi-part, material data columns, measured-input cross-reference"
 },
 {
  "line": 401,
  "text": "- Open source: me-toolbox (OmriStein) (MIT (verified by extracting the sdist; note the notice names 'The Python Packaging Authority', a packaging-template leftover); no — Python + numpy; use as an offline cross-check oracle for unit tests; ThreadedFastener with multi-layer 30-degree frustum k_m summed in series, C = kb/(kb+km), bolt_load, member_load, separation factor n0 = preload/(F(1-C)); Bolt with proof_strength, stress_area, estimate_preload and a per-grade Sp/Sut/Sy table)"
 },
 {
  "line": 402,
  "text": "- Rejected: py 'bolted-joint', 'boltedjoint', 'vdi2230', 'boltcalc' — all 404 on PyPI; fastener (MIT) — feature-selection algorithm; pybolt (MPL-2.0) — matrix library; both unrelated; RocketPy / OpenRocket — no joint-stiffness code"
 },
 {
  "line": 403,
  "text": "- Wrong-number risk: The scope's own worked example fails its own check: 25 N.m on lubricated M8 8.8 with K=0.15 gives F_i = 20.8 kN against a 21.2 kN proof load (At 36.6 mm2, 580 MPa), so at F_i,max = 1.25 F_i the bolt stress is 712 MPa and the proof SF is 0.82 — the flagship row comes out RED, contradicting the value claim that it 'passes with margin' [Certain — re-derived by both skeptics]. D_seal ~= 99 mm is wrong: tests/dryrun/endcap.scad documents a RADIAL PISTON seal against a 101.60 mm bore, and 96.32 is explicitly the face-seal number the file warns is NOT the radial gland; the existing bolt_shear row already uses the right diameter (48641 N = 6.0 x pi/4 x 101.6^2). Shigley Eq 8-23 is the symmetric same-material special case and the sketch carries one E_member: Al-on-steel under-predicts k_m, over-predicts C and over-predicts p_sep — non-conservative on the one output that justifies the feature. frustum_valid does not fire on the motivating part (real thickness at the bolts is 25.4 mm, not the 5.4 mm flange_z the scope quotes; pitch is 5.65d, under the 6d gate). Confusing proof with yield or UTS (8.8: 580 / 640 / 800) inflates the bolt SF 10-40%."
 },
 {
  "line": 404,
  "text": "- Guard: Evaluate separation at F_i,min and bolt yield at F_i,max. Force COMPUTED, never PASS, for torque-derived preload. State that the repo's own fasteners_metric.json says 'do not rely on torque alone for a pressure boundary'. Do not claim separation protects a radial piston seal — the plug seals as long as it stays in the bore. threadCheck() cannot be called with F_b,max: its signature (index.html:835) takes bolt_sigma_u_MPa and derives F_bolt internally, and the endcap already declares a separate thread row, so the part would render two strip rows with contradictory Le_req_mm."
 },
 {
  "line": 405,
  "text": "- Skeptic overruled: The engineering skeptic revised value 4 -> 2, on the sound ground that PartForge's one pressure fixture is a radial piston seal where separation is not the leak path and no club part is a face-sealed bolted closure. I keep 3 rather than 2 because the tension carve-out that skeptic themselves rates 4 lives inside this idea, and both skeptics independently confirmed the defect it fixes in the tree: tests/dryrun/endcap.scad:49 declares a 48.6 kN axial pressure resultant as bolt_shear, and tests/templates/bulkhead.scad:11 says in plain text that recovery-shock TENSION was declared as bolt_shear. The separation half is dropped, as they recommend."
 }
] };
});
