// registry.js — the concordance: every place Aster or Skyhook states an Earth constant (mu, radius,
// standard gravity, rotation speed) or a reboost energy per kilogram, with the file, the line, the exact
// text that must be on that line, and how to read the number. Curated by hand from a scan of both
// checkouts (Aster 62ddb17, Skyhook 34935cb); whose-earth.mjs re-verifies every row and re-runs the scan,
// so a row that moves or a new occurrence that is not listed here fails the run instead of going stale.
// Loads as a classic script (window.WhoseEarthRegistry) and with require().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhoseEarthRegistry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REPOS = {
    aster: { name: 'Aster', dir: '/home/user/asteroid-mining-planner', expectCommit: '62ddb17' },
    skyhook: { name: 'Skyhook', dir: '/home/user/skyhook', expectCommit: '34935cb' },
  };

  // role: where the number lives. kind: how to read it.
  //   literal          a constant written in code or data
  //   comment          the number in a code comment or a reference kernel's commentary, not used by code
  //   prose            stated in documentation; approx: true when written with ~ or ≈
  //   implied-*        a radius from which an Earth radius follows (see model.impliedRadius)
  //   parking-altitude the altitude that turns a parking radius into an Earth radius (not itself a radius)
  //   equivalent       the same physical speed stated as metres of ground per second of clock error
  //   formula          code that computes the quantity (no literal; the value is computed)
  //   claim            a statement about a number elsewhere (no literal of its own)
  const ROLES = {
    canon: 'canon',
    module: 'code',
    page: 'page/sim',
    test: 'test',
    prose: 'docs',
    research: 'research',
    vendor: 'vendored kernel',
  };

  const rows = [];
  function E(id, family, repo, path, line, token, literal, unit, role, kind, note, extra) {
    rows.push(Object.assign({ id, family, repo, path, line, token, literal, unit, role, kind, note: note || '' }, extra || {}));
  }

  // ---------------- Skyhook ----------------
  const RA = 'params/rev_a.json';
  E('sk-canon-mu', 'mu', 'skyhook', RA, 11, '"mu_earth_m3s2": 398600000000000.0', '398600000000000.0', 'm3s2', 'canon', 'literal',
    'orbital.mu_earth_m3s2, the canon mu; physics/skyhook_physics.py:39 imports it');
  E('sk-canon-com', 'R', 'skyhook', RA, 10, '"com_radius_km": 6988', '6988', 'km', 'canon', 'implied-com',
    'orbital.com_radius_km; minus com_altitude_km 610 gives R = 6378 (Tip Match F1, Rule One #8)');
  E('sk-canon-rtip-upper', 'R', 'skyhook', RA, 27, 'r=R_E+610+320=7301 km', '7301', 'km', 'canon', 'implied-tip',
    'kinematics._upper_release_note: r_tip 7301 = R + 610 + 320, so R = 6371');
  E('sk-canon-rtip-c3', 'R', 'skyhook', RA, 31, 'r_tip=7301 km', '7301', 'km', 'canon', 'implied-tip', 'kinematics._c3_note');
  E('sk-canon-rtip-mkt', 'R', 'skyhook', RA, 114, 'r=R_E+610+320=7301 km', '7301', 'km', 'canon', 'implied-tip', 'market_thresholds._note');
  E('sk-canon-vrot', 'rot', 'skyhook', RA, 25, '7.55 - 2.5 - 0.465', '0.465', 'kms', 'canon', 'prose',
    'kinematics._lower_tip_note; a note, not a key, so nothing can import it');

  const PHY = 'physics/skyhook_physics.py';
  E('sk-phys-mu-comment', 'mu', 'skyhook', PHY, 39, '# 3.986e14 m³/s²', '3.986e14', 'm3s2', 'module', 'comment',
    'MU_EARTH = PARAMS["orbital"]["mu_earth_m3s2"]: imported from the canon; the comment restates it');
  E('sk-phys-R', 'R', 'skyhook', PHY, 40, 'R_EARTH_KM = 6371.0', '6371.0', 'km', 'module', 'literal',
    'module literal, "mean radius"; rev_a.json has no radius key to import (CLAUDE.md rule 2)');
  E('sk-phys-g0', 'g0', 'skyhook', PHY, 41, 'G_STD = 9.80665', '9.80665', 'ms2', 'module', 'literal', 'module literal');
  E('sk-phys-vrot-doc', 'rot', 'skyhook', PHY, 105, '~0.46 km/s', '0.46', 'kms', 'module', 'prose', 'EQ-3a docstring', { approx: true });
  E('sk-phys-vrot', 'rot', 'skyhook', PHY, 109, 'v_earth_rot = 0.465', '0.465', 'kms', 'module', 'literal',
    'EQ-3a literal "km/s at equator"; not in rev_a.json (CLAUDE.md rule 2; Two Seconds at the Bottom F4)');
  E('sk-twin-R', 'R', 'skyhook', 'tools/twin/physics.js', 21, 'export const R_EARTH_KM = 6371.0', '6371.0', 'km', 'module', 'literal',
    'the digital twin mirrors the module literal');
  E('sk-twin-g0', 'g0', 'skyhook', 'tools/twin/physics.js', 23, 'export const G_STD = 9.80665', '9.80665', 'ms2', 'module', 'literal', '');
  E('sk-legcost-g0', 'g0', 'skyhook', 'finance/leg_cost.py', 46, '"g0_ms2": 9.80665', '9.80665', 'ms2', 'module', 'literal', 'rocket-leg cost model');
  E('sk-test-R', 'R', 'skyhook', 'tests/test_rev_a_physics.py', 79, 'R_m = (alt + 6371) * 1e3', '6371', 'km', 'test', 'literal', '');
  E('sk-test-g0', 'g0', 'skyhook', 'tests/test_tether_dynamics.py', 39, 'G_STD = 9.80665', '9.80665', 'ms2', 'test', 'literal', '');

  const CALC = 'tools/sims/skyhook_calculator.jsx';
  E('sk-calc-mu', 'mu', 'skyhook', CALC, 4, 'const MU = 3.986004418e14', '3.986004418e14', 'm3s2', 'page', 'literal',
    'the Aster value, not the canon value');
  E('sk-calc-R', 'R', 'skyhook', CALC, 5, 'const R_EARTH = 6371e3', '6371e3', 'm', 'page', 'literal', '');
  E('sk-calc-vrot', 'rot', 'skyhook', CALC, 6, 'const V_EQ = 465', '465', 'ms', 'page', 'literal', '');
  E('sk-calc-g-252', 'g0', 'skyhook', CALC, 252, '{fmt(r.atip / 9.81, 1)} g — re-rate', '9.81', 'ms2', 'page', 'literal', 'tip-load warning');
  E('sk-calc-g-268', 'g0', 'skyhook', CALC, 268, 'value={fmt(r.atip / 9.81, 1)}', '9.81', 'ms2', 'page', 'literal', 'tip g-load row');

  const TH = 'tools/sims/skyhook_orbit_theater.html';
  E('sk-theater-mu', 'mu', 'skyhook', TH, 38, 'const MU=398600, RE=6371;', '398600', 'km3s2', 'page', 'literal', '');
  E('sk-theater-R', 'R', 'skyhook', TH, 38, 'const MU=398600, RE=6371;', '6371', 'km', 'page', 'literal', '');

  const SITE = 'tools/sims/skyhook_program_site.html';
  E('sk-site-mu-238', 'mu', 'skyhook', SITE, 238, '<td>3.986 × 10¹⁴ m³/s²</td>', '3.986 × 10¹⁴', 'm3s2', 'page', 'prose', 'symbol table');
  E('sk-site-vrot-317', 'rot', 'skyhook', SITE, 317, 'surface rotates east at ≈ 0.46 km/s', '0.46', 'kms', 'page', 'prose', 'FIG 1 label', { approx: true });
  E('sk-site-vrot-355', 'rot', 'skyhook', SITE, 355, 'subtracts a further ~0.465 km/s', '0.465', 'kms', 'page', 'prose', 'FIG 2 caption', { approx: true });
  E('sk-site-energy-648', 'energy', 'skyhook', SITE, 648, 'Restoring ~30 MJ/kg of orbital energy', '30', 'MJkg', 'page', 'prose', 'toll-bridge paragraph', { approx: true });
  E('sk-site-mu-794', 'mu', 'skyhook', SITE, 794, 'var MU=398600, RE=6371;', '398600', 'km3s2', 'page', 'literal', 'same text as :1268');
  E('sk-site-R-794', 'R', 'skyhook', SITE, 794, 'var MU=398600, RE=6371;', '6371', 'km', 'page', 'literal', 'same text as :1268');
  E('sk-site-R-975', 'R', 'skyhook', SITE, 975, 'var RE=6371, cv=', '6371', 'km', 'page', 'literal', '');
  E('sk-site-mu-1133', 'mu', 'skyhook', SITE, 1133, 'var MU=3.986004418e14, RE=6371e3, VEQ=465;', '3.986004418e14', 'm3s2', 'page', 'literal',
    'the Aster value, not the canon value');
  E('sk-site-R-1133', 'R', 'skyhook', SITE, 1133, 'var MU=3.986004418e14, RE=6371e3, VEQ=465;', '6371e3', 'm', 'page', 'literal', '');
  E('sk-site-vrot-1133', 'rot', 'skyhook', SITE, 1133, 'var MU=3.986004418e14, RE=6371e3, VEQ=465;', '465', 'ms', 'page', 'literal', '');
  E('sk-site-g-1172', 'g0', 'skyhook', SITE, 1172, 'textContent=f(atip/9.81,1);', '9.81', 'ms2', 'page', 'literal', '');
  E('sk-site-g-1177', 'g0', 'skyhook', SITE, 1177, '(atip/9.81>6?"bad":"")', '9.81', 'ms2', 'page', 'literal', '');
  E('sk-site-g-1191', 'g0', 'skyhook', SITE, 1191, 'tip_g:+(atip/9.81).toFixed(2)', '9.81', 'ms2', 'page', 'literal', 'exported JSON');
  E('sk-site-g-1209', 'g0', 'skyhook', SITE, 1209, 'if(atip/9.81>6)w.push', '9.81', 'ms2', 'page', 'literal', '');
  E('sk-site-mu-1268', 'mu', 'skyhook', SITE, 1268, 'var MU=398600, RE=6371;', '398600', 'km3s2', 'page', 'literal', 'same text as :794');
  E('sk-site-R-1268', 'R', 'skyhook', SITE, 1268, 'var MU=398600, RE=6371;', '6371', 'km', 'page', 'literal', 'same text as :794');

  const PI = 'docs/project_instructions.md';
  E('sk-doc-mu', 'mu', 'skyhook', PI, 37, 'μ = 3.986 × 10¹⁴ m³/s² for Earth', '3.986 × 10¹⁴', 'm3s2', 'prose', 'prose', 'founding document §2.2');
  E('sk-doc-vrot-39', 'rot', 'skyhook', PI, 39, 'another ~0.46 km/s of help', '0.46', 'kms', 'prose', 'prose', '', { approx: true });
  E('sk-doc-vrot-45', 'rot', 'skyhook', PI, 45, '~7.55 − 2.5 − 0.46', '0.46', 'kms', 'prose', 'prose', '', { approx: true });
  E('sk-doc-energy-218', 'energy', 'skyhook', PI, 218, 'restoring ~30 MJ/kg of orbital energy', '30', 'MJkg', 'prose', 'prose', 'founding document, marginal cost', { approx: true });
  E('sk-dl-rtip', 'R', 'skyhook', 'docs/DECISION_LOG.md', 30, 'r = R_E + 610 + 320 = 7,301 km', '7,301', 'km', 'prose', 'implied-tip', 'item 4, C3 bookkeeping');

  const MP = 'docs/research/mp001_market_pricing.md';
  E('sk-mp-energy', 'energy', 'skyhook', MP, 37, 'Rev A imparts 44.8 MJ/kg', '44.8', 'MJkg', 'research', 'prose', 'MP-001 §3a, labelled [Anchored]');
  E('sk-mp-energy-kwh', 'energy', 'skyhook', MP, 37, '= 12.4 kWh/kg of mechanical energy', '12.4', 'kWhkg', 'research', 'prose', 'MP-001 §3a: the same figure in kWh');
  E('sk-mp-elec', 'elec', 'skyhook', MP, 37, 'Our 48 kWh/kg electrical placeholder', '48', 'kWhkgE', 'research', 'prose', 'MP-001 §3a: electrical, "~26% wall-to-momentum"');
  E('sk-brief-elec', 'elec', 'skyhook', 'docs/research/perplexity_research_brief.md', 75, 'Placeholder: 48 kWh/kg baseline reboost energy', '48', 'kWhkgE', 'research', 'prose', '');
  E('sk-manifest-elec-53', 'elec', 'skyhook', 'docs/program_manifest.md', 53, 'reboost re-laddered (48 kWh/kg baseline)', '48', 'kWhkgE', 'prose', 'prose',
    'says the stress tester was re-laddered to 48; its code default is 33 (tools/sims/skyhook_no_leo_stress_test.jsx:58)');
  E('sk-manifest-elec-65', 'elec', 'skyhook', 'docs/program_manifest.md', 65, 'reboost 48 kWh/kg ≡ ~26% ED efficiency', '48', 'kWhkgE', 'prose', 'prose', '');
  E('sk-manifest-energy-65', 'energy', 'skyhook', 'docs/program_manifest.md', 65, 'the 12.4 kWh/kg canon energy', '12.4', 'kWhkg', 'prose', 'prose',
    'calls 12.4 kWh/kg "canon"; rev_a.json has no reboost-energy key');
  E('sk-manifest-claim-71', 'energy', 'skyhook', 'docs/program_manifest.md', 71, 'energy figure 30→30–60 MJ/kg', null, 'MJkg', 'prose', 'claim',
    'says the founding document\'s energy figure was changed from 30 to 30–60 MJ/kg; the repository copy (docs/project_instructions.md:218) still says ~30');
  E('sk-stress-elec', 'elec', 'skyhook', 'tools/sims/skyhook_no_leo_stress_test.jsx', 58, 'reboostKwhPerKg: 33,', '33', 'kWhkgE', 'page', 'literal',
    'the simulator CLAUDE.md names canonical; default 33, labelled [Likely]');
  E('sk-fin-energy', 'energy', 'skyhook', 'finance/skyhook_finance.py', 215, 'reboost_MJ_per_kg = 2.0 * v_orb * s.tip_speed_kms', null, 'MJkg', 'module', 'formula',
    'the finance model: 2·v_orb·v_tip, "workbook EQ-5 momentum view" (:211)', { formula: 'momentum' });

  // ---------------- Aster ----------------
  const DV = 'src/v2/porkchop/delta-v.ts';
  E('as-dv-mu', 'mu', 'aster', DV, 3, 'export const EARTH_MU_KM3_PER_S2 = 398_600.4418;', '398_600.4418', 'km3s2', 'module', 'literal',
    'the porkchop ΔV stack; also served by the MCP resource aster://reference/dv-stack-model (mcp/src/resources/reference.ts:141)');
  E('as-dv-rpark', 'R', 'aster', DV, 4, 'export const LEO_PARKING_RADIUS_KM = 6_578.137;', '6_578.137', 'km', 'module', 'implied-parking',
    'parking radius; minus the 200 km disclosed at src/v2/app/porkchop/main.ts:981 gives R = 6378.137 (the WGS84 a)', { pair: 'as-main-hpark' });
  E('as-main-hpark', 'R', 'aster', 'src/v2/app/porkchop/main.ts', 981, '200 km circular LEO (r = ${LEO_PARKING_RADIUS_KM.toFixed(3)} km)', '200', 'km', 'page', 'parking-altitude',
    'the porkchop page discloses the parking orbit as 200 km');
  E('as-lv-g0', 'g0', 'aster', 'src/v2/porkchop/launch-vehicles.ts', 63, 'export const G0_MPS2 = 9.80665;', '9.80665', 'ms2', 'module', 'literal', 'delivered-mass screening');
  E('as-body-R', 'R', 'aster', 'src/v2/core/constants/bodies.ts', 45, 'naifId: 399, radiusM:   6_378_136.6', '6_378_136.6', 'm', 'module', 'literal',
    'protected core body constant (NAIF pck00010 BODY399_RADII a)');
  E('as-em-R', 'R', 'aster', 'src/v2/app/earth-moon/runtime.ts', 17, 'const EARTH_RADIUS_M = 6_371_010;', '6_371_010', 'm', 'page', 'literal',
    'Earth–Moon view: render radius and camera floor');
  const S11 = 'src/v2/SLICE_11_FOUNDING.md';
  E('as-s11-mu', 'mu', 'aster', S11, 452, 'μ=398600.4418', '398600.4418', 'km3s2', 'prose', 'prose', 'Slice 11 founding record, D2 ΔV stack');
  E('as-s11-rpark', 'R', 'aster', S11, 452, 'rp=6578.137 km', '6578.137', 'km', 'prose', 'implied-parking', '', { pair: 'as-s11-hpark' });
  E('as-s11-hpark', 'R', 'aster', S11, 452, '200 km circular LEO (rp=6578.137 km', '200', 'km', 'prose', 'parking-altitude', '');
  const CR = 'src/v2/core/constants/README.md';
  E('as-readme-R-24', 'R', 'aster', CR, 24, '| 399     | Earth   | 3362     | 6378.1366', '6378.1366', 'km', 'prose', 'prose', 'constants table, cites pck00010.tpc line 3362');
  E('as-readme-R-34', 'R', 'aster', CR, 34, 'BODY399_RADII = (   6378.1366', '6378.1366', 'km', 'prose', 'prose', '');
  E('as-readme-R-39', 'R', 'aster', CR, 39, '(6378.1366, 6378.1366, 6356.7519)', '6378.1366', 'km', 'prose', 'prose', '');
  E('as-readme-R-345', 'R', 'aster', CR, 345, '`a = 6378.1366 km`', '6378.1366', 'km', 'prose', 'prose', 'Earth rendered as a sphere of radius a');
  const PCK = 'vendor/naif/pck00010.tpc';
  E('as-pck-R-3362', 'R', 'aster', PCK, 3362, 'BODY399_RADII     = ( 6378.1366   6378.1366   6356.7519 )', '6378.1366', 'km', 'vendor', 'literal',
    'the kernel data line (IAU 2009 report values)');
  E('as-pck-R-555', 'R', 'aster', PCK, 555, 'BODY399_RADII     = ( 6378.1366   6378.1366   6356.7519 )', '6378.1366', 'km', 'vendor', 'comment', 'syntax example in the kernel header');
  E('as-pck-R-562', 'R', 'aster', PCK, 562, 'BODY399_RADII     = ( 6378.1366', '6378.1366', 'km', 'vendor', 'comment', 'syntax example');
  E('as-pck-R-563', 'R', 'aster', PCK, 563, '6378.1366', '6378.1366', 'km', 'vendor', 'comment', 'syntax example, continued');
  E('as-pck-R-831', 'R', 'aster', PCK, 831, 'BODY399_RADII     = ( 6378.1366   6378.1366   6356.7519 )', '6378.1366', 'km', 'vendor', 'comment', 'syntax example');
  E('as-pck-R-3354', 'R', 'aster', PCK, 3354, 'body399_radii     = ( 6378.14   6378.14   6356.75 )', '6378.14', 'km', 'vendor', 'comment', '"Old values ... from the 2006 IAU report"');
  E('as-test-mu-e2e', 'mu', 'aster', 'tests/v2-lambert/lambert-endtoend.test.mjs', 37, 'const MU_EARTH = 398600.0;', '398600.0', 'km3s2', 'test', 'literal', 'Lambert test fixture mu');
  E('as-test-mu-mr', 'mu', 'aster', 'tests/v2-lambert/lambert-multi-rev.test.mjs', 58, 'const MU_EARTH = 398600.0;', '398600.0', 'km3s2', 'test', 'literal', 'Lambert test fixture mu');
  E('as-test-g0-lv', 'g0', 'aster', 'src/v2/porkchop/launch-vehicles.test.mjs', 236, '(320 * 9.80665)', '9.80665', 'ms2', 'test', 'comment', '');
  E('as-test-g0-golden', 'g0', 'aster', 'tests/v2-golden/launch-vehicles.golden.test.mjs', 77, 'g0 9.80665 m/s^2', '9.80665', 'ms2', 'test', 'comment', '');
  const VR = 'tools/audit/sanity-69472a3/s19-5-runs/verify-REPORT.md';
  E('as-audit-mu', 'mu', 'aster', VR, 96, '√(398600.4418/6578.137)', '398600.4418', 'km3s2', 'research', 'prose', 'audit: C3=0 injection 3.224 km/s');
  E('as-audit-rpark', 'R', 'aster', VR, 96, '√(398600.4418/6578.137)', '6578.137', 'km', 'research', 'implied-parking', '', { pair: 'as-audit-hpark' });
  E('as-audit-hpark', 'R', 'aster', VR, 96, 'LEO 200 km → C3=0', '200', 'km', 'research', 'parking-altitude', '');
  const VR3 = 'tools/slice13-research/literature/3d-verification-record.md';
  E('as-3d-mu', 'mu', 'aster', VR3, 27, '√(398600.4418/6578.137)', '398600.4418', 'km3s2', 'research', 'prose', 'same check as the audit line');
  E('as-3d-rpark', 'R', 'aster', VR3, 27, '√(398600.4418/6578.137)', '6578.137', 'km', 'research', 'implied-parking', '', { pair: 'as-3d-hpark' });
  E('as-3d-hpark', 'R', 'aster', VR3, 27, 'LEO 200 km → C3=0', '200', 'km', 'research', 'parking-altitude', '');
  E('as-s17-g0', 'g0', 'aster', 'tools/slice17-research/recon/S17_RECON_REPORT.md', 329, 'g0 9.80665 m/s^2', '9.80665', 'ms2', 'research', 'comment', '');
  E('as-dvscope-mu', 'mu', 'aster', 'tools/slice18-research/dv-scope.mjs', 33, 'Earth: 398600.435507', '398600.435507', 'km3s2', 'research', 'literal', 'JPL DE GM, audit-side');
  E('as-part3-mu', 'mu', 'aster', 'tools/slice18-research/part3-no-encounter-drift.mjs', 38, 'earth: 398600.435507', '398600.435507', 'km3s2', 'research', 'literal',
    '"JPL DE values (audit-side reference, not repo code)"');
  E('as-roadmap-rot', 'rot', 'aster', 'strategy/ASTER_ROADMAP_2026-08.md', 285, '1 s ≈ 465 m equatorial', '465', 'mPerUT1s', 'prose', 'equivalent',
    'Slice 21 plan: 465 m of equator per second of UT1 error, i.e. 0.465 km/s; not a constant in code');
  E('as-roadmap-R', 'R', 'aster', 'strategy/ASTER_ROADMAP_2026-08.md', 287, 'a=6,378,137 m', '6,378,137', 'm', 'prose', 'prose', 'Slice 21 plan: WGS84 site math');
  E('as-ledger-R', 'R', 'aster', 'strategy/RESEARCH_LEDGER_2026-08.md', 42, 'a=6,378,137 m', '6,378,137', 'm', 'prose', 'prose', '');
  const P2 = 'tools/slice21-research/literature/P2_EARTH_ORIENTATION_RESULT.md';
  E('as-p2-rot-18', 'rot', 'aster', P2, 18, 'at the equator is about 465 m', '465', 'mPerUT1s', 'research', 'equivalent', '', { approx: true });
  E('as-p2-R-22', 'R', 'aster', P2, 22, 'semi-major axis is 6,378,137 m and flattening', '6,378,137', 'm', 'research', 'prose', '');
  E('as-p2-R-42', 'R', 'aster', P2, 42, 'WGS84 semi-major axis is 6,378,137 m', '6,378,137', 'm', 'research', 'prose', '');
  E('as-p2-rot-68', 'rot', 'aster', P2, 68, 'About 465 m per 1 s UT1 error at equator', '465', 'mPerUT1s', 'research', 'equivalent', '', { approx: true });
  E('as-p2-R-73', 'R', 'aster', P2, 73, 'WGS84 semi-major axis 6,378,137 m', '6,378,137', 'm', 'research', 'prose', '');

  // The Earth each program computes on. Every number comes from a row above, so the sets move when the rows do.
  const EARTH_SETS = [
    { id: 'skyhook', label: 'Skyhook physics module', mu: 'sk-canon-mu', R: 'sk-phys-R', g0: 'sk-phys-g0', vRot: 'sk-phys-vrot',
      why: 'what physics/skyhook_physics.py computes with: the canon mu (imported) and the module literals for R, g0 and rotation' },
    { id: 'aster', label: 'Aster v2 porkchop', mu: 'as-dv-mu', R: 'as-dv-rpark', g0: 'as-lv-g0', vRot: null,
      why: 'what Aster\'s porkchop ΔV stack and cost card compute with; Aster states no Earth rotation rate in src/v2' },
    { id: 'canon-com', label: 'rev_a.json orbital block', mu: 'sk-canon-mu', R: 'sk-canon-com', g0: 'sk-phys-g0', vRot: 'sk-phys-vrot',
      why: 'the radius rev_a.json\'s own com_radius_km implies (6988 − 610); everything else as the module' },
  ];

  // Scan scope. The scan reads every tracked text file not excluded here and looks for the patterns below;
  // a hit on a line no row above covers (same file, line and family) is UNREGISTERED and fails the run.
  const SCAN = {
    families: [
      { family: 'mu', re: '\\b398600000000000(?:\\.0+)?\\b|3\\.986\\d*\\s*(?:e\\+?14|[×x]\\s*10(?:¹⁴|\\^?14))|\\b398[_,]?600(?:\\.\\d+)?\\b' },
      { family: 'R', re: '\\b6[_,]?37[18](?:[._,]?\\d+)*(?:e3)?\\b|\\b6[_,]?578[._]137\\b' },
      { family: 'g0', re: '\\b9\\.80665\\b|\\b9\\.81\\b' },
      { family: 'rot', re: '\\b0\\.46[45]?\\b|\\bV_?EQ\\s*=\\s*465\\b|\\b465 ?m\\b|7\\.292\\d*', context: 'rotat|equat|v_earth|VEQ|V_EQ' },
      { family: 'energy', re: '\\d[\\d.,]*\\s*(?:MJ\\/kg|kWh\\/kg)|reboostKwhPerKg\\s*:\\s*\\d+|reboost_MJ_per_kg\\s*=',
        context: 'reboost|orbital energy|mechanical energy|imparts|restor', covers: ['energy', 'elec'] },
    ],
    binary: '\\.(png|jpe?g|gif|glb|gltf|bin|pdf|woff2?|ttf|otf|ico|webp|gz|zip|xlsx|pptx|docx|csv|svg|mp4|ktx2?)$',
    maxBytes: 2000000,
    exclude: {
      aster: [
        { re: '^docs/', why: 'deployed build output (AGENTS.md:31, :294)' },
        { re: '^(legacy/|index\\.html$|physics\\.worker\\.js$|worker/|src/(data|economics|main\\.ts|physics|renderer|state|styles|ui|utils|workers)(/|$))',
          why: 'legacy V1, excluded from tsc (tsconfig.json:21-35; AGENTS.md:37-38; LEGACY.md)', summarize: 'legacy' },
        { re: '^_rescued-agent-defs/', why: 'V1-era prior art, read-only reference (AGENTS.md:34)' },
        { re: '^tests/fixtures/', why: 'test fixtures (ephemeris and catalog data)' },
        { re: '^tools/slice16-harness/', why: 'sealed agent-honesty harness' },
        { re: '\\.jsonl?$', why: 'data files: coordinates and catalog values whose digits match by coincidence' },
      ],
      skyhook: [
        { re: '^(?!params/).*\\.json$', why: 'generated data (finance/decision_grid.json, tools/twin/golden.json, package.json); params/*.json is scanned' },
      ],
    },
  };

  // What the source repos said at the commits read. If a refreshed checkout stops matching, the run fails and the
  // README's findings are stale: that is the point of writing them down here.
  const EXPECTED = {
    // Earth-dependent rev_a.json values that do not reproduce on the Skyhook physics-module Earth (R 6371)
    skyhookNonReproducing: ['orbital.com_radius_km', 'orbital.v_orb_kms', 'kinematics.phase3_growth_option.v_upper_release_kms'],
    // the row whose stated energy the reboost sweep looks for
    mp001EnergyRow: 'sk-mp-energy',
    // the rows whose line text carries Aster's own published injection Δv values
    asterPinRows: ['as-audit-mu', 'as-s11-mu'],
  };

  return { REPOS, ROLES, rows, EARTH_SETS, SCAN, EXPECTED };
});
