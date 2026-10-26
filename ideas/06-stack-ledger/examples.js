/* examples.js — the worked stacks the page and the CLI offer. Where a number comes from a PartForge template
   it is READ from the snapshot module's parsed FLIGHT block or NOTE line, never retyped here; where a number is
   this idea's own illustration it says so in the contributor's name and tol_ref. Loads as a classic script
   (window.StackExamples) and with require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StackExamples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function noteNumber(template, re) {
    for (var i = 0; i < template.header.length; i++) {
      var m = re.exec(template.header[i].text);
      if (m) return { value: Number(m[1]), text: template.header[i].text, tag: template.header[i].tag };
    }
    return null;
  }
  function find(list, name) {
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  /* S is the snapshot module. Returns an ordered list of { id, title, why, stack }. */
  function build(S) {
    var B = S.templates.bulkhead, C = S.templates.coupler;
    var bOD = find(B.flight.critical, 'bulkhead OD');                       // {nominal_mm: 146.2, tol_mm: 0.05, tol_src: 'default'}
    var bCouplerID = noteNumber(B, /Coupler ID ([\d.]+) mm/);                // NOTE: "Coupler ID 146.30 mm (5.760 in) assumed ..."
    var bFinish = B.flight.mfg.finish;                                       // "bare or type II clear anodize; ..."
    var cOD = find(C.flight.od, 'coupler OD');                               // {d_mm: 149.3, tol_mm: 0.05, tol_src: 'default'}
    var cAirframeID = noteNumber(C, /Airframe ID ([\d.]+) mm/);              // NOTE: "Airframe ID 149.60 mm (5.890 in) assumed ..."
    var cFinish = C.flight.mfg.finish;                                       // "bare or type II anodize; the OD is a sliding fit ..."
    var ANODISE = { per_side_mm: [0.005, 0.025], src: 'fits.json notes (6): "Anodise adds roughly 0.005 to 0.025 mm per surface on a Type II coating" (prose, no row)' };
    var FLIGHT_DT = [-60, 20];                                               // 40 C pad to -40 C altitude, relative to the 20 C reference; dbHints() uses -60 for the drop
    var COUPLER_BAND = 0.03;                                                 // ILLUSTRATIVE measured band on the coupler ID, labelled so below
    // The bare bulkhead's worst-case minimum at 20 C, and the window of coupler hoop CTE inside which it survives the
    // pad-to-altitude range: (a_hoop - a_6061)·D·dT >= -bareMin at both ends of FLIGHT_DT, solved for a_hoop.
    var bareMin = bCouplerID ? (bCouplerID.value - COUPLER_BAND) - (bOD.nominal_mm + bOD.tol_mm) : null;
    var aShaft = (S.dbMaterialThermal(B.flight.material) || {}).cte_um_m_K;
    var hoopLo = bareMin != null ? aShaft - bareMin / (bOD.nominal_mm * 1e-6 * FLIGHT_DT[1]) : null;
    var hoopHi = bareMin != null ? aShaft + bareMin / (bOD.nominal_mm * 1e-6 * -FLIGHT_DT[0]) : null;

    var ex = [];

    ex.push({
      id: 'bulkhead-as-declared',
      title: 'Bulkhead in coupler, exactly as the template declares it',
      why: 'tests/templates/bulkhead.scad: the bulkhead OD is a FLIGHT critical with limits; the coupler ID is a NOTE ("assumed"), the finish is "bare or type II", and the coupler is fibreglass. Three contributors cannot be sourced, so the stack is REFUSED and says what would help.',
      stack: {
        gap_name: 'bulkhead OD inside the coupler ID (diametral), bulkhead.scad as shipped',
        contributors: [
          { kind: 'declared', name: 'coupler ID (NOTE: "' + (bCouplerID ? bCouplerID.text.slice(0, 60) : '') + '...")', nominal_mm: bCouplerID ? bCouplerID.value : null, dir: 1 },
          { kind: 'declared', name: 'bulkhead OD (FLIGHT critical "' + bOD.name + '")', nominal_mm: bOD.nominal_mm, tol_mm: bOD.tol_mm, tol_src: bOD.tol_src, dir: -1 },
          { kind: 'coating', name: 'finish per mfg.finish: "' + bFinish + '"' },
          { kind: 'thermal', name: '6061 bulkhead in the fibreglass coupler, pad to altitude', D_mm: bOD.nominal_mm, hole_mat: 'Fiberglass-laminate', shaft_mat: B.flight.material, dT_K: FLIGHT_DT },
        ],
        require: { min_mm: 0 },
      },
    });

    ex.push({
      id: 'bulkhead-declared',
      title: 'Bulkhead in coupler, with the missing declarations supplied (illustrative)',
      why: 'The same joint once the coupler ID carries a measured band (ILLUSTRATIVE +/-' + COUPLER_BAND.toFixed(2) + ', tol_src user: replace with your three-clocking measurement) and the anodise is sized from fits.json note (6). With Type II on the OD the worst case interferes, which is "what the 50 missed" item 7. The thermal term is left out because the fibreglass hoop CTE is unknown, so the bare variant (delete the coating) clears only at 20 C: its minimum is ' + (bareMin != null ? bareMin.toFixed(3) : '?') + ' mm, and dbFitThermal() at this diameter over ' + FLIGHT_DT[0] + ' to +' + FLIGHT_DT[1] + ' K keeps it at or above zero only for a coupler hoop CTE between ' + (hoopLo != null ? hoopLo.toFixed(1) : '?') + ' and ' + (hoopHi != null ? hoopHi.toFixed(1) : '?') + ' um/m/K. Nobody has measured it; the evaluation puts laminate hoop CTE at 10 to 30.',
      stack: {
        gap_name: 'bulkhead OD inside the coupler ID (diametral), declarations supplied',
        contributors: [
          { kind: 'declared', name: 'coupler ID, measured (ILLUSTRATIVE band)', nominal_mm: bCouplerID ? bCouplerID.value : null, plus_mm: COUPLER_BAND, minus_mm: COUPLER_BAND, tol_src: 'user', tol_ref: 'ILLUSTRATIVE +/-' + COUPLER_BAND.toFixed(2) + ' mm: replace with the delivered coupler measured at three clockings', dir: 1 },
          { kind: 'declared', name: 'bulkhead OD (FLIGHT critical "' + bOD.name + '")', nominal_mm: bOD.nominal_mm, tol_mm: bOD.tol_mm, tol_src: bOD.tol_src, dir: -1 },
          { kind: 'coating', name: 'Type II anodise on the bulkhead OD, both sides', per_side_mm: ANODISE.per_side_mm, surfaces: 2, src: ANODISE.src },
        ],
        require: { min_mm: 0 },
      },
    });

    ex.push({
      id: 'coupler-as-declared',
      title: 'Coupler in airframe, exactly as the template declares it',
      why: 'tests/templates/coupler.scad: the coupler OD is a FLIGHT od entry with limits; the airframe ID is a NOTE ("assumed; measure your tube"), and the finish is "bare or type II anodize" on an OD the same line calls a sliding fit. Two contributors cannot be sourced: REFUSED.',
      stack: {
        gap_name: 'coupler OD inside the airframe ID (diametral), coupler.scad as shipped',
        contributors: [
          { kind: 'declared', name: 'airframe ID (NOTE: "' + (cAirframeID ? cAirframeID.text.slice(0, 60) : '') + '...")', nominal_mm: cAirframeID ? cAirframeID.value : null, dir: 1 },
          { kind: 'declared', name: 'coupler OD (FLIGHT od "' + cOD.name + '")', nominal_mm: cOD.d_mm, tol_mm: cOD.tol_mm, tol_src: cOD.tol_src, dir: -1 },
          { kind: 'coating', name: 'finish per mfg.finish: "' + cFinish + '"' },
        ],
        require: { min_mm: 0.1, max_mm: 0.5 },
      },
    });

    ex.push({
      id: 'motor-tube-in-ring',
      title: 'Motor tube in a centring ring, H8/f7 at 54 mm, both 6061',
      why: 'fits.json names H8/f7 "free running ... a motor tube in a centring ring". One fit contributor and a thermal term between the same alloy on both sides, which dbFitThermal() makes exactly zero. The worst case CLEARS a 0.02-0.15 mm requirement (a screening verdict, never a pass); the RSS line has N=1 and says it has no basis.',
      stack: {
        gap_name: '54 mm motor tube in a 6061 centring ring (diametral)',
        contributors: [
          { kind: 'fit', name: 'H8/f7 at 54 mm', size_mm: 54, hole: ['H', 8], shaft: ['f', 7], dir: 1 },
          { kind: 'thermal', name: '6061 ring on a 6061 tube, pad to altitude', D_mm: 54, hole_mat: '6061-T6', shaft_mat: '6061-T6', dT_K: FLIGHT_DT },
        ],
        require: { min_mm: 0.02, max_mm: 0.15 },
      },
    });

    ex.push({
      id: 'plug-in-steel-bore',
      title: '6061 plug in a 304 bore, H7/g6 at 101.6 mm, pad to altitude',
      why: 'The fit the table\'s own worked example uses, at the 4 in tank bore PartForge\'s tests use, with the shipped dbFitThermal() between two "likely" rows. The hot pad (+20 K) closes the clearance by more than the fit\'s minimum, so the worst case interferes: FAIL against min 0. With one manufacturing contributor the RSS band is the fit\'s own band, and shifted by the thermal envelope it is the worst case again: no narrowing.',
      stack: {
        gap_name: '6061 plug in a 304 stainless bore (diametral)',
        contributors: [
          { kind: 'fit', name: 'H7/g6 at 101.6 mm', size_mm: 101.6, hole: ['H', 7], shaft: ['g', 6], dir: 1 },
          { kind: 'thermal', name: '304 bore on a 6061 plug, -60 to +20 K', D_mm: 101.6, hole_mat: '304', shaft_mat: '6061-T6', dT_K: FLIGHT_DT },
        ],
        require: { min_mm: 0 },
      },
    });

    ex.push({
      id: 'plug-in-g10-coupler',
      title: '6061 plug in a G10 coupler, H7/g6 at 101.6 mm (refused)',
      why: 'materials_thermal.json\'s own note says this pair gains "about 0.1 mm" of clearance from a 40 C pad to -40 C. Two refusals. The G10 row\'s cte_um_m_K is IN-PLANE by its own note, and a bore grows by its hoop value, so the thermal contributor is refused until a hoop CTE with a source is supplied (hoop_cte.hole). And an H7 bore in a G10 coupler is a fit class on a composite tube, which fits.json LIMITS (5) and PartForge\'s doctrine rule out whatever the CTE: a hoop CTE lifts the first refusal, not the second. Declare the coupler bore as a measurement instead.',
      stack: {
        gap_name: '6061 plug in a G10-FR4 coupler (diametral)',
        contributors: [
          { kind: 'fit', name: 'H7/g6 at 101.6 mm', size_mm: 101.6, hole: ['H', 7], shaft: ['g', 6], dir: 1 },
          { kind: 'thermal', name: 'G10 coupler on a 6061 plug, -60 to +20 K', D_mm: 101.6, hole_mat: 'G10-FR4', shaft_mat: '6061-T6', dT_K: FLIGHT_DT },
        ],
        require: { min_mm: 0 },
      },
    });

    ex.push({
      id: 'bar-as-pin',
      title: '1/4 in cold-finished bar used as a pin, unmachined, in an H7 hole',
      why: 'An as-supplied stock surface in a fit: stock.json\'s bar_6061_i_0.250 row (+0.038/-0.076, asymmetric, "likely") against a 6.35 H7 hole from fits.json. The bar\'s plus side interferes and its minus side leaves up to 0.091 mm against the 0.050 allowed: FAIL both ways, which is what stock.json notes (1) warn.',
      stack: {
        gap_name: 'as-supplied 1/4 in bar in a 6.35 H7 reamed hole (diametral)',
        contributors: [
          { kind: 'iso', name: 'hole H7 at 6.35 mm', size_mm: 6.35, feature: 'hole', letter: 'H', grade: 7, dir: 1 },
          { kind: 'stock', name: 'bar_6061_i_0.250 as supplied', key: 'bar_6061_i_0.250', surface: 'od', dir: -1 },
          { kind: 'thermal', name: '6061 on 6061', D_mm: 6.35, hole_mat: '6061-T6', shaft_mat: '6061-T6', dT_K: FLIGHT_DT },
        ],
        require: { min_mm: 0, max_mm: 0.05 },
      },
    });

    ex.push({
      id: 'stock-recall-as-source',
      title: 'A recall stock row claimed as a cited source (refused)',
      why: 'bar_6061_i_6.000 has tolerance_confidence "recall". Declaring it with tol_src "source" is refused: a recall row is never presented as cited. Leave tol_src off and the row prints with its recall word instead.',
      stack: {
        gap_name: '6 in extruded bar OD against a 152.4 mm declared bore',
        contributors: [
          { kind: 'declared', name: 'bore, measured', nominal_mm: 152.4, plus_mm: 0.05, minus_mm: 0.05, tol_src: 'user', tol_ref: 'ILLUSTRATIVE', dir: 1 },
          { kind: 'stock', name: 'bar_6061_i_6.000 claimed as source', key: 'bar_6061_i_6.000', surface: 'od', tol_src: 'source', tol_ref: 'ASTM B221', dir: -1 },
        ],
        require: { min_mm: 0 },
      },
    });

    ex.push({
      id: 'two-plus-minus',
      title: 'Two contributors of +/-0.05: the RSS false comfort',
      why: 'The evaluation\'s own wrong-number example (docs/roadmap-evaluation.md:668): two +/-0.05 contributors give a 0.10 worst-case half-band but 0.071 by RSS, 29% narrower, and at N=2 the RSS number has no statistical basis. The worst case clears +/-0.2; the point is the footnote.',
      stack: {
        gap_name: 'two declared contributors of +/-0.05 (teaching example)',
        contributors: [
          { kind: 'declared', name: 'A, 0 +/-0.05 (teaching example)', nominal_mm: 0, tol_mm: 0.05, tol_src: 'user', tol_ref: 'teaching example', dir: 1 },
          { kind: 'declared', name: 'B, 0 +/-0.05 (teaching example)', nominal_mm: 0, tol_mm: 0.05, tol_src: 'user', tol_ref: 'teaching example', dir: 1 },
        ],
        require: { min_mm: -0.2, max_mm: 0.2 },
      },
    });

    return ex;
  }

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  return { build: build, byId: byId };
});
