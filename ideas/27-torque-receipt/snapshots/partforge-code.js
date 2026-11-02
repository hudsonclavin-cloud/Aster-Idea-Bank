/* derived by build-data.mjs: code cut verbatim out of PartForge index.html at 0974a62 — 780-899 (thread tables, parseThreadSize, tensileStressArea_mm2, ENGAGEMENT_RULE, threadCheck, boltShear); 935-999 (FLIGHT_MATERIALS); 5744 (matClass (a local of the loads evaluator)); 5804 (GRADE_SY (a local of the bolt_shear branch)).
   See the .provenance.json sidecar beside this file. Do not edit: re-run build-data.mjs. */
(function (root, factory) {
  var d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d;
  else { root.TorqueData = root.TorqueData || {}; root.TorqueData["code"] = d; }
})(typeof self !== 'undefined' ? self : this, function () {
/* ---- index.html 780-899, verbatim ---- */
// ---------------------------------------------------------------------------
// Thread tables and parsing
// ---------------------------------------------------------------------------
// ISO 261 / ISO 724 coarse pitches (mm). [Certain]
const METRIC_COARSE_PITCH = {
  M2: 0.4, 'M2.5': 0.45, M3: 0.5, M4: 0.7, M5: 0.8, M6: 1.0, M8: 1.25,
  M10: 1.5, M12: 1.75, M14: 2.0, M16: 2.0, M20: 2.5,
};
// ASME B1.1 basic major diameters (in). Numbered sizes: D = 0.060 + 0.013·N. [Certain]
const UN_MAJOR_IN = {
  '#2': 0.086, '#4': 0.112, '#6': 0.138, '#8': 0.164, '#10': 0.190, '#12': 0.216,
  '1/4': 0.250, '5/16': 0.3125, '3/8': 0.375, '7/16': 0.4375, '1/2': 0.500,
};
const IN_TO_MM = 25.4;

// Accepts 'M6', 'M6x1', 'M6-1.0', '#10-32', '1/4-20', '5/16-18', '1/4"-20'.
// Returns { system:'metric'|'un', d_mm, p_mm, tpi? }.
function parseThreadSize(size) {
  const s = String(size).trim().replace(/["\s]/g, '');
  let m = /^M(\d+(?:\.\d+)?)(?:[x×\-](\d+(?:\.\d+)?))?$/i.exec(s);
  if (m) {
    const d = parseFloat(m[1]);
    const key = 'M' + m[1];
    const p = m[2] ? parseFloat(m[2]) : METRIC_COARSE_PITCH[key];
    if (!p) throw new Error('Unknown metric coarse pitch for ' + size + '; give it explicitly, e.g. M7x1');
    return { system: 'metric', d_mm: d, p_mm: p, label: key + 'x' + p };
  }
  m = /^(#\d+|\d+\/\d+|\d*\.\d+)-(\d+)$/.exec(s);
  if (m) {
    let D;
    if (m[1][0] === '#') D = UN_MAJOR_IN[m[1]];
    else if (m[1].includes('/')) { const [n, q] = m[1].split('/'); D = parseFloat(n) / parseFloat(q); }
    else D = parseFloat(m[1]);
    if (!D) throw new Error('Unknown UN size ' + size);
    const tpi = parseInt(m[2], 10);
    return { system: 'un', d_mm: D * IN_TO_MM, p_mm: IN_TO_MM / tpi, tpi, D_in: D, label: m[1] + '-' + tpi };
  }
  throw new Error('Cannot parse thread size "' + size + '"');
}

// Tensile stress area.
//   ISO 898-1 §9.1.6.1:  As = (π/4)·((d2+d3)/2)² ≡ 0.7854·(d − 0.9382·p)²  [mm²]  [Certain]
//   ASME B1.1 App. B:    At = 0.7854·(D − 0.9743/n)²                        [in²]  [Certain]
function tensileStressArea_mm2(t) {
  if (t.system === 'metric') return 0.7854 * (t.d_mm - 0.9382 * t.p_mm) ** 2;
  const At_in2 = 0.7854 * (t.D_in - 0.9743 / t.tpi) ** 2;
  return At_in2 * IN_TO_MM * IN_TO_MM;
}

// Rule-of-thumb minimum engagement (multiples of nominal diameter) by the
// tapped material. Common shop guidance (e.g. Engineers Edge, Boston Gear /
// screw-supplier design notes); values vary by source. [Likely]
const ENGAGEMENT_RULE = { steel: 1.0, stainless: 1.0, titanium: 1.0, aluminum: 2.0, aluminium: 2.0, brass: 1.5, plastic: 2.5 };

// ---------------------------------------------------------------------------
// threadCheck — bolt tensile capacity vs internal-thread stripping
// ---------------------------------------------------------------------------
// Internal thread shear area:
//   Machinery's Handbook / FED-STD-H28 / ASME B1.1:
//     As_n = π·n·Le·Ds_min·[1/(2n) + 0.57735·(Ds_min − En_max)]
//   With BASIC dimensions (Ds = D, En = D − 0.649519·p for 60° threads) this is
//   exactly 0.875·π·D·Le (reported as As_strip_MH_mm2). Tolerance-class minima
//   (2A/2B, 6g/6H) typically reduce it to ≈0.7–0.8·π·D·Le.
//   We USE the widely quoted conservative simplification
//     As_internal = 0.5·π·D·Le                                          [Likely]
//   and shear strength τu ≈ 0.5·σu of the tapped material (0.6·σu is the usual
//   figure for steels; 0.5 is deliberately conservative).                [Likely]
//   F_strip = τu·As_internal;  Le_req = F_bolt / (0.5·σu_int·0.5·π·D).
function threadCheck({ size, engagement_mm, bolt_sigma_u_MPa, internal_sigma_u_MPa, internal_material_class }) {
  const t = parseThreadSize(size);
  const d = t.d_mm, p = t.p_mm, Le = engagement_mm;
  const At = tensileStressArea_mm2(t);
  const F_bolt = At * bolt_sigma_u_MPa;
  const As_strip = 0.5 * Math.PI * d * Le;                     // conservative
  const As_strip_MH = Math.PI * d * Le * (0.5 + 0.57735 * 0.649519); // = 0.875·π·D·Le, basic dims
  const tau_u = 0.5 * internal_sigma_u_MPa;
  const F_strip = tau_u * As_strip;
  const Le_req = F_bolt / (tau_u * 0.5 * Math.PI * d);
  const cls = String(internal_material_class || 'steel').toLowerCase();
  const rule = ENGAGEMENT_RULE[cls] != null ? ENGAGEMENT_RULE[cls] : 1.0;
  return {
    size: t.label, system: t.system,
    d_mm: d, p_mm: p, At_mm2: At,
    F_bolt_N: F_bolt,
    As_strip_mm2: As_strip, As_strip_MH_mm2: As_strip_MH,
    F_strip_N: F_strip,
    Le_req_mm: Le_req,
    Le_over_d: Le / d,
    Le_min_rule_mm: rule * d, rule_multiple: rule,
    ok_strip: F_strip >= F_bolt,
    ok_rule: Le >= rule * d,
  };
}

// ---------------------------------------------------------------------------
// boltShear — single-shear bolt check plus plate bearing
// ---------------------------------------------------------------------------
// τ = F/A with A = At (threads in the shear plane) or π d²/4 (shank).
// Allowable τ = 0.577·σy (von Mises / distortion-energy: τy = σy/√3). [Certain]
// Bearing σb = F/(d·t) checked against plate σy. Many codes allow ≈1.5·σy
// (or 2·Ftu/… in aerospace) for bearing; we use 1.0·σy conservatively. [Likely]
function boltShear({ size, n, force_N, sigma_y_bolt_MPa, plate_t_mm, plate_sigma_y_MPa, threads_in_shear }) {
  const t = parseThreadSize(size);
  const nb = n || 1;
  const F = force_N / nb;
  const A = threads_in_shear ? tensileStressArea_mm2(t) : Math.PI * t.d_mm * t.d_mm / 4;
  const tau = F / A;
  const tau_allow = 0.577 * sigma_y_bolt_MPa;
  const sb = F / (t.d_mm * plate_t_mm);
  return {
    size: t.label, d_mm: t.d_mm,
    F_per_N: F,
    A_shear_mm2: A,
    tau_MPa: tau,
    tau_allow_MPa: tau_allow,
    sf_shear: tau > 0 ? tau_allow / tau : Infinity,
    sigma_bearing_MPa: sb,
    sf_bearing: sb > 0 ? plate_sigma_y_MPa / sb : Infinity,
  };
}
/* ---- index.html 935-999, verbatim ---- */
const FLIGHT_MATERIALS = {
  '6061-T6': { name: 'Aluminum 6061-T6', den: 2.70, sy: 276, su: 310, E: 68.9, G: 26.0, kind: 'metal',
    note: 'General-purpose airframe/coupler/bulkhead alloy. Weldable; loses temper near welds.',
    src: 'ASM Aerospace Specification Metals / MatWeb "Aluminum 6061-T6; 6061-T651"', verify: true },
  '7075-T6': { name: 'Aluminum 7075-T6', den: 2.81, sy: 503, su: 572, E: 71.7, G: 26.9, kind: 'metal',
    note: 'High strength, poor weldability/corrosion; fin cans, couplers, bulkheads.',
    src: 'MatWeb "Aluminum 7075-T6; 7075-T651" (G reported 26–26.9 GPa across sources)', verify: true },
  '2024-T3': { name: 'Aluminum 2024-T3', den: 2.78, sy: 345, su: 483, E: 73.1, G: 28.0, kind: 'metal',
    note: 'Sheet/plate; good fatigue, poor corrosion (clad usual).',
    src: 'MatWeb "Aluminum 2024-T3" (kmac-distribution / aerospacemetals reprints)', verify: false },
  '304': { name: 'Stainless 304 (annealed)', den: 8.00, sy: 215, su: 505, E: 193, G: 77.0, kind: 'metal',
    note: 'Annealed bar/sheet. Cold-worked tempers are much stronger (sy 500–1000+).',
    src: 'MatWeb "AISI Type 304 Stainless Steel" (annealed)', verify: false },
  '316': { name: 'Stainless 316 (annealed)', den: 8.00, sy: 205, su: 515, E: 193, G: 77.0, kind: 'metal',
    note: 'Annealed. Better corrosion than 304; sy often quoted 205–290 depending on form.',
    src: 'MatWeb "AISI Type 316 Stainless Steel, annealed bar"; Farnell/Aalco grade 316 datasheet', verify: true },
  '17-4PH-H900': { name: 'Stainless 17-4PH, H900', den: 7.81, sy: 1170, su: 1310, E: 196, G: 77.2, kind: 'metal',
    note: 'Precipitation-hardened; spec minima (ASTM A564) sy 1170 / su 1310. Nozzle retainers, high-load fittings.',
    src: 'Sandmeyer Steel 17-4PH datasheet (H900 minima); MatWeb 17-4PH H900 for E/G', verify: true },
  '4130-N': { name: 'Chromoly 4130, normalized', den: 7.85, sy: 435, su: 670, E: 205, G: 80, kind: 'metal',
    note: 'Normalized at 870 °C. Motor cases/thrust structures; weldable.',
    src: 'MatWeb "AISI 4130 Steel, normalized at 870°C" (G: MatWeb 80 GPa; MakeItFrom 73 GPa)', verify: true },
  'Ti-6Al-4V': { name: 'Titanium Ti-6Al-4V (Grade 5), annealed', den: 4.43, sy: 880, su: 950, E: 113.8, G: 44, kind: 'metal',
    note: 'Annealed bar. Nozzle/retainer/high-temp fittings.',
    src: 'MatWeb "Titanium Ti-6Al-4V (Grade 5), Annealed" (Professional Plastics reprint)', verify: true },
  'C360-brass': { name: 'Brass C360 (free-cutting), H02 half-hard', den: 8.49, sy: 310, su: 400, E: 97, G: 37, kind: 'metal',
    note: 'H02 temper rod (45/58 ksi). Fittings, inserts; do not use where strength-critical.',
    src: 'copper.org C36000 (H02 strengths); MatWeb "Free-Cutting Brass, UNS C36000, H02" for den/E/G', verify: true },
  'C110-copper': { name: 'Copper C110 ETP, H04 hard', den: 8.89, sy: 310, su: 345, E: 115, G: 44, kind: 'metal',
    note: 'H04 hard temper. Annealed (O60) is ~69 sy / 220 su. Igniter/thermal parts.',
    src: 'Aurubis C11000 (Cu-ETP) datasheet (H04 ranges); MatWeb "Copper, UNS C11000, H04" for E/G/den', verify: true },
  'Inconel-718': { name: 'Inconel 718, solution treated + aged', den: 8.19, sy: 1034, su: 1241, E: 200, G: 77, kind: 'metal',
    note: 'AMS 5662/5663 minima; retains strength to ~650 °C. Nozzle/hot-section parts.',
    src: 'Special Metals INCONEL 718 datasheet; Xometry Inconel 718 material page (STA minima)', verify: true },
  'G10-FR4': { name: 'G10 / FR-4 glass-epoxy laminate', den: 1.85, sy: null, su: 275, E: 18.6, G: 4.1, kind: 'composite',
    note: 'NEMA LI-1 lengthwise minima (tensile 40 ksi, flex mod 2.7 Msi); product sheets quote up to 455 MPa tensile. G is the suggested working shear modulus for flutter (600 ksi); measured ~775 ksi (5.3 GPa).',
    src: 'Acculam Epoxyglas G10/FR4 datasheet (den); NEMA LI-1 G-10 minima; Bennett PoF #615 (G)', verify: true },
  'CF-laminate': { name: 'Carbon/epoxy laminate, quasi-isotropic', den: 1.55, sy: null, su: 500, E: 50, G: 19, kind: 'composite',
    note: 'Layup-dependent. 55–60% Vf prepreg quasi-iso: E ~45–55 GPa, UTS ~500–600; wet layup 30–35 wt% fibre measured E 49.7 GPa / UTS 249 MPa. G = E/(2(1+ν)), ν≈0.3.',
    src: 'ResearchGate/Scribd quasi-isotropic CF laminate property sheets; Performance Composites Ltd table (recalled)', verify: true },
  'Fiberglass-laminate': { name: 'E-glass/epoxy woven laminate', den: 1.90, sy: null, su: 300, E: 22, G: 4.1, kind: 'composite',
    note: 'Hand/vacuum layup woven E-glass: UTS 250–440, E 20–25 GPa. G per Bennett #615 (same working value as G10).',
    src: 'Performance Composites Ltd "Mechanical properties of E-glass fibre composites" (recalled); Bennett PoF #615 (G)', verify: true },
  'Phenolic': { name: 'Paper phenolic laminate (NEMA XX)', den: 1.30, sy: null, su: 100, E: 8.7, G: 3.3, kind: 'composite',
    note: 'Motor liners / nozzle insulators (canvas/linen grades similar). E is flexural; G estimated E/(2(1+0.3)).',
    src: 'MakeItFrom "NEMA Grade XX (PBG) Paper-Phenolic Laminate"', verify: true },
  'PEEK': { name: 'PEEK, unfilled (Victrex 450G)', den: 1.30, sy: 98, su: 98, E: 4.0, G: 1.4, kind: 'polymer',
    note: 'Tensile yield 98 MPa (ISO 527). G estimated E/(2(1+0.4)); not on datasheet.',
    src: 'Victrex VICTREX PEEK 450G technical datasheet', verify: true },
  'Ultem-9085': { name: 'ULTEM 9085 (FDM, Stratasys)', den: 1.34, sy: 70, su: 70, E: 2.51, G: 0.9, kind: 'polymer',
    note: 'XZ orientation (ASTM D638): yield 70 (= max stress, so su = 70), break 68, E 2.51 GPa; ZX (across layers) break 49 MPa, E 2.41. G estimated.',
    src: 'Stratasys ULTEM 9085 Resin FDM material data sheet (GoEngineer mirror)', verify: true },
  'PA12-SLS': { name: 'PA12 nylon, SLS (EOS PA 2200)', den: 0.93, sy: 48, su: 48, E: 1.65, G: 0.6, kind: 'polymer',
    note: 'XY orientation; laser-sintered part density 0.93. G estimated E/(2(1+0.4)).',
    src: 'EOS PA 2200 material data sheet (Balance 1.0)', verify: true },
  'CF-Nylon': { name: 'Chopped-CF nylon (FDM, Markforged Onyx class)', den: 1.2, sy: 40, su: 40, E: 2.4, G: 0.9, kind: 'polymer',
    note: 'Onyx current datasheet: yield 40 (= max stress, so su = 40), break 37, E 2.4 GPa; an older revision lists 36 MPa / 1.4 GPa. Other CF-PA filaments range 50–100 MPa XY. G estimated.',
    src: 'Markforged Composites Data Sheet (Onyx)', verify: true },
  'Delrin-POM': { name: 'Acetal homopolymer (Delrin 150)', den: 1.41, sy: 71, su: 71, E: 3.1, G: 1.1, kind: 'polymer',
    note: 'Tensile 11 ksi; E quoted 2.4–3.1 GPa across sheets (ISO 527 vs ASTM D638). G estimated E/(2(1+0.35)).',
    src: 'Ensinger / Polymershapes Delrin 150 datasheet; MatWeb Ensinger Delrin 150', verify: true },
  'Graphite': { name: 'Graphite, fine-grain isomolded (nozzle grade, ATJ/EDM-3 class)', den: 1.78, sy: null, su: 27, E: 9.7, G: 4.0, kind: 'other',
    note: 'su is TENSILE (weak); flexural 40–100 MPa, compressive 80–140 MPa typical. Grade-dependent (isomolded 1.65–1.9 g/cc). Brittle: no yield.',
    src: 'ATJ graphite (UCAR) / Poco EDM-3 datasheets (recalled); isomolded graphite property ranges from US patent 6,799,626', verify: true },
};
/* ---- index.html 5744, verbatim ---- */
  const matClass = m => m.kind === 'metal' ? (/steel|stainless|inconel|4130|17-4/i.test(m.name) ? 'steel' : /titanium|ti-6/i.test(m.name) ? 'steel' : /brass|copper/i.test(m.name) ? 'brass' : 'aluminum') : 'plastic';
/* ---- index.html 5804, verbatim ---- */
        const GRADE_SY = { '8.8':640, '10.9':940, '12.9':1100, '2':393, 'grade 2':393, '5':634, 'grade 5':634, '8':896, 'grade 8':896, 'a2-70':450, '18-8':450, 'a4-80':600 };
return { parseThreadSize: parseThreadSize, tensileStressArea_mm2: tensileStressArea_mm2, threadCheck: threadCheck, boltShear: boltShear, METRIC_COARSE_PITCH: METRIC_COARSE_PITCH, UN_MAJOR_IN: UN_MAJOR_IN, ENGAGEMENT_RULE: ENGAGEMENT_RULE, FLIGHT_MATERIALS: FLIGHT_MATERIALS, matClass: matClass, GRADE_SY: GRADE_SY, commit: "0974a62b309b8cf7acd33771b49e9357d4d191f4", cuts: [{"what":"thread tables, parseThreadSize, tensileStressArea_mm2, ENGAGEMENT_RULE, threadCheck, boltShear","from":780,"to":899},{"what":"FLIGHT_MATERIALS","from":935,"to":999},{"what":"matClass (a local of the loads evaluator)","from":5744,"to":5744},{"what":"GRADE_SY (a local of the bolt_shear branch)","from":5804,"to":5804}] };
});
