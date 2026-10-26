// Round-Trip Ledger: Aster's ΔV stack measured against JPL NHATS min-ΔV round trips.
//
// Pure logic, no DOM. Loads as a classic script (window.Ledger) and via require() for the Node
// tests and the CLI. Every number comes from the data module handed to create() (nhats-data.js,
// built from provenance-carrying snapshots of Aster's fixtures and source); nothing physical is
// retyped here except the four CITED altitudes below, each with the file:line it comes from.
//
// Confidence labels: [Certain] arithmetic on snapshotted values; [Likely] an interpretation of a
// NHATS field that the data is consistent with but the repo does not state; [Speculative] estimate.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ledger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.1.0';
  const MODES = ['one-way', 'sample-return'];
  const DEPARTURE_BASES = ['symmetric', 'nhats'];
  const NOTE = 'src/v2/research/slice-11-porkchop/perplexity-jpl-trajectory-browser-nhats.md';

  // The only numbers typed in this module. Each is a label read from a cited line, not a physics
  // constant from memory; the parking altitude is also confirmed by the data (see injectionCheck).
  const CITED = {
    LEO_ALTITUDE_KM: { value: 200, cite: "Aster src/v2/app/porkchop/main.ts:981 '200 km circular LEO (r = 6578.137 km)'; INVARIANTS.md:191 INV-016c '200km LEO'", label: 'Certain' },
    NHATS_PARKING_ALTITUDE_KM: { value: 400, cite: `Aster ${NOTE}:46 'Earth departure from a 400 km parking orbit'; confirmed here: injection at R_E + 400 km reproduces every dv_dep_park within the records' 1 m/s rounding`, label: 'Certain' },
    NHATS_ENTRY_ALTITUDE_KM: { value: 125, cite: `Aster ${NOTE}:42 'Earth atmospheric entry speed ≤ 12 km/s at 125 km altitude'; reading v_arr_earth as the speed at that altitude is an interpretation`, label: 'Likely' },
    TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM: { value: 200, cite: `Aster ${NOTE}:17 '200 km Earth inertial reentry' (Trajectory Browser FAQ); shown as the alternative convention`, label: 'Likely' },
    NHATS_ENTRY_SPEED_CAP_KMPS: { value: 12, cite: `Aster ${NOTE}:42 'Earth atmospheric entry speed ≤ 12 km/s'`, label: 'Certain' },
  };

  const num = (s) => (s === null || s === undefined || s === '' ? NaN : Number(s));
  // NHATS writes an unnumbered body's fullname as "(2000 SG344)"; show the designation alone then.
  function displayName(des, fullname) {
    const f = String(fullname || '').trim();
    const bare = /^\((.*)\)$/.exec(f);
    if (!f || (bare && bare[1].trim() === des)) return des;
    return f;
  }
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  function refuse(code, reason, whatWouldHelp) {
    return { refusal: { code, reason, what_would_help: whatWouldHelp } };
  }
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const median = (sorted) => quantile(sorted, 0.5);
  function argExtreme(items, key, sign) {
    let best = null;
    for (const it of items) {
      const v = it[key];
      if (!isNum(v)) continue;
      if (best === null || sign * (v - best[key]) > 0) best = it;
    }
    return best;
  }

  // ---------------------------------------------------------------- NHATS record parsing
  const TRAJ_NUMERIC = ['c3', 'dv_dep_park', 'vrel_arr_neo', 'vrel_dep_neo', 'vrel_arr_earth', 'v_arr_earth', 'v_dep_earth', 'dv_total', 'dec_dep', 'dec_arr'];
  const TRAJ_INT = ['dur_out', 'dur_at', 'dur_ret', 'dur_total', 'tid'];
  function parseTraj(raw) {
    const t = { launch: raw.launch };
    for (const k of TRAJ_NUMERIC) t[k] = num(raw[k]);
    for (const k of TRAJ_INT) t[k] = num(raw[k]);
    return t;
  }

  function create(DATA) {
    if (!DATA || !Array.isArray(DATA.records) || !DATA.constants) {
      return { ok: false, ...refuse('insufficient_data', 'no NHATS records or Aster constants were supplied', 'run build-data.mjs against an Aster checkout to produce nhats-data.js') };
    }
    const K0 = DATA.constants;
    for (const k of ['EARTH_MU_KM3_PER_S2', 'LEO_PARKING_RADIUS_KM', 'STATIONKEEPING_DV_KMPS', 'DV_MARGIN_FRACTION', 'SCREENING_ISP_S', 'DETERMINISTIC_MARGIN_FRACTION', 'SPACECRAFT_STATIONKEEPING_MPS', 'G0_MPS2']) {
      if (!isNum(K0[k])) return { ok: false, ...refuse('not_found', `Aster constant ${k} is missing from the data module`, 'rebuild nhats-data.js; build-data.mjs reads it from the snapshotted TypeScript') };
    }
    if (!K0.sites || !K0.sites.CAPE_CANAVERAL || !K0.sites.VANDENBERG_SFB) {
      return { ok: false, ...refuse('not_found', 'launch sites are missing from the data module', 'rebuild nhats-data.js from snapshots/feasibility.ts') };
    }
    const R_E = K0.LEO_PARKING_RADIUS_KM - CITED.LEO_ALTITUDE_KM.value;
    const C = Object.freeze({
      ...K0,
      EARTH_RADIUS_KM: R_E,
      NHATS_PARKING_RADIUS_KM: R_E + CITED.NHATS_PARKING_ALTITUDE_KM.value,
      NHATS_ENTRY_RADIUS_KM: R_E + CITED.NHATS_ENTRY_ALTITUDE_KM.value,
      TRAJECTORY_BROWSER_ENTRY_RADIUS_KM: R_E + CITED.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value,
      EXHAUST_VELOCITY_MPS: K0.G0_MPS2 * K0.SCREENING_ISP_S,
    });

    // Unique bodies: a designation present in both fixture directories is kept once, with both
    // sources listed and a flag saying whether the two records agree.
    const byDes = new Map();
    const duplicates = [];
    for (const r of DATA.records) {
      const prev = byDes.get(r.des);
      if (!prev) {
        byDes.set(r.des, { des: r.des, fullname: r.fullname, computed: r.computed, raw: r.min_dv_traj, t: parseTraj(r.min_dv_traj), sources: [r.src] });
      } else {
        prev.sources.push(r.src);
        // the API writes keys in varying order; compare the values, not the byte order
        const canon = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
        duplicates.push({ des: r.des, sources: prev.sources.slice(), identical: canon(prev.raw) === canon(r.min_dv_traj) && prev.computed === r.computed && prev.fullname === r.fullname });
      }
    }
    const bodies = [...byDes.values()].sort((a, b) => (a.des < b.des ? -1 : a.des > b.des ? 1 : 0));
    const notFound = (DATA.notFound || []).map((n) => ({ des: n.des, error: n.error, src: n.src }));
    const cacheByDes = new Map(((DATA.cache && DATA.cache.bodies) || []).map((b) => [b.designation, b]));

    // ---------------------------------------------------------------- Aster's stack, ported line for line
    // src/v2/porkchop/delta-v.ts:18-26 [Certain]
    function injectionDvFromC3(c3, mu = C.EARTH_MU_KM3_PER_S2, r = C.LEO_PARKING_RADIUS_KM) {
      const circular = Math.sqrt(mu / r);
      const perigee = Math.sqrt(c3 + (2 * mu) / r);
      return perigee - circular;
    }
    // delta-v.ts:28-34: rendezvous = v∞_arr; departure = v∞_arr (the symmetric-return assumption).
    const rendezvousDvFromVInf = (v) => v;
    const departureDvFromVInf = (v) => v;
    // delta-v.ts:36-58 with one addition: an optional departure override (km/s) in sample-return mode.
    function asterStack(c3, vInfArr, mode, departureOverrideKmps) {
      if (!MODES.includes(mode)) return refuse('out_of_envelope', `unknown mission mode '${mode}'`, `one of ${MODES.join(', ')}`);
      if (!isNum(c3) || !isNum(vInfArr)) return refuse('insufficient_data', 'C3 or arrival v∞ is not a finite number', 'a NHATS record with c3 and vrel_arr_neo, or Aster cache c3 and vInfArr');
      const override = departureOverrideKmps !== undefined && departureOverrideKmps !== null;
      if (override && !isNum(departureOverrideKmps)) return refuse('insufficient_data', 'departure override is not a finite number', 'a NHATS vrel_dep_neo');
      const injectionKmps = injectionDvFromC3(c3);
      const rendezvousKmps = rendezvousDvFromVInf(vInfArr);
      const departureKmps = mode === 'sample-return' ? (override ? departureOverrideKmps : departureDvFromVInf(vInfArr)) : 0;
      const stationkeepingKmps = C.STATIONKEEPING_DV_KMPS;
      const subtotalKmps = injectionKmps + rendezvousKmps + departureKmps + stationkeepingKmps;
      const marginKmps = subtotalKmps * C.DV_MARGIN_FRACTION;
      return { mode, departureBasis: mode !== 'sample-return' ? 'none' : override ? 'nhats' : 'symmetric', injectionKmps, rendezvousKmps, departureKmps, stationkeepingKmps, subtotalKmps, marginKmps, totalKmps: subtotalKmps + marginKmps };
    }
    // The cost card's spacecraft budget, src/v2/app/porkchop/main.ts:437-451 and
    // launch-vehicles.ts deterministicMarginMps/deliveredMassKg [Certain]: margin is 5% of the
    // deterministic maneuvers (rendezvous, departure), stationkeeping is not margined, delivered mass
    // = payload-at-C3 × exp(−Δv/(g0·Isp)). Injection is absent by construction (DEC-13-4).
    function costCard(vInfArrKmps, departureKmps, mode) {
      if (!MODES.includes(mode)) return refuse('out_of_envelope', `unknown mission mode '${mode}'`, `one of ${MODES.join(', ')}`);
      const rendezvousMps = rendezvousDvFromVInf(vInfArrKmps) * 1000;
      const departureMps = mode === 'sample-return' ? departureKmps * 1000 : 0;
      const stationkeepingMps = C.SPACECRAFT_STATIONKEEPING_MPS;
      const marginMps = (mode === 'sample-return' ? rendezvousMps + departureMps : rendezvousMps) * C.DETERMINISTIC_MARGIN_FRACTION;
      const dvSpacecraftMps = rendezvousMps + stationkeepingMps + marginMps + departureMps;
      return { mode, rendezvousMps, departureMps, stationkeepingMps, marginMps, dvSpacecraftMps, massFraction: Math.exp(-dvSpacecraftMps / C.EXHAUST_VELOCITY_MPS) };
    }
    // delivered mass with the NHATS departure ÷ delivered mass with the symmetric one.
    const massFactor = (dvSymmetricMps, dvNhatsMps) => Math.exp(-(dvNhatsMps - dvSymmetricMps) / C.EXHAUST_VELOCITY_MPS);

    // ---------------------------------------------------------------- NHATS's own bookkeeping
    // dv_total = dv_dep_park + vrel_arr_neo + vrel_dep_neo + vrel_arr_earth, to the records' 1 m/s
    // rounding [Certain for these records; the field semantics are the API's].
    function nhatsLedger(t) {
      const sum = t.dv_dep_park + t.vrel_arr_neo + t.vrel_dep_neo + t.vrel_arr_earth;
      return { dv_dep_park: t.dv_dep_park, vrel_arr_neo: t.vrel_arr_neo, vrel_dep_neo: t.vrel_dep_neo, vrel_arr_earth: t.vrel_arr_earth, sumKmps: sum, dv_total: t.dv_total, residualKmps: sum - t.dv_total, vDepEarthFromC3: Math.sqrt(Math.max(t.c3, 0)), vDepEarthResidualKmps: Math.sqrt(Math.max(t.c3, 0)) - t.v_dep_earth };
    }
    // Aster's injection formula at NHATS's parking radius versus NHATS's dv_dep_park, and at Aster's own radius.
    function injectionCheck(t) {
      const atNhats = injectionDvFromC3(t.c3, C.EARTH_MU_KM3_PER_S2, C.NHATS_PARKING_RADIUS_KM);
      const atAster = injectionDvFromC3(t.c3);
      return { nhatsRadiusKm: C.NHATS_PARKING_RADIUS_KM, asterRadiusKm: C.LEO_PARKING_RADIUS_KM, dv_dep_park: t.dv_dep_park, atNhatsRadiusKmps: atNhats, atAsterRadiusKmps: atAster, deltaNhatsKmps: atNhats - t.dv_dep_park, deltaAsterKmps: atAster - t.dv_dep_park };
    }
    // Which parking radius makes Aster's formula reproduce dv_dep_park best (1 km grid).
    function fitParkingRadius(ts, loKm, hiKm, stepKm) {
      let best = null;
      for (let r = loKm; r <= hiKm; r += stepKm) {
        let worst = 0;
        for (const t of ts) worst = Math.max(worst, Math.abs(injectionDvFromC3(t.c3, C.EARTH_MU_KM3_PER_S2, r) - t.dv_dep_park));
        if (best === null || worst < best.maxAbsDeltaKmps) best = { radiusKm: r, maxAbsDeltaKmps: worst };
      }
      return best;
    }

    // ---------------------------------------------------------------- Earth arrival
    // v∞ = √(v² − 2μ/r) at the entry radius: the K1/K2 interface quantity. Refuses below escape speed.
    function impliedArrivalVinf(vArrEarthKmps, altitudeKm, roundingKmps = 0.0005) {
      if (!isNum(vArrEarthKmps)) return refuse('insufficient_data', 'v_arr_earth is not a finite number', 'a NHATS record with v_arr_earth');
      if (!isNum(altitudeKm) || altitudeKm < 0) return refuse('out_of_envelope', 'entry altitude must be a non-negative number of km', '125 km (NHATS API) or 200 km (Trajectory Browser)');
      const r = C.EARTH_RADIUS_KM + altitudeKm;
      const twoMuOverR = (2 * C.EARTH_MU_KM3_PER_S2) / r;
      const escape = Math.sqrt(twoMuOverR);
      if (vArrEarthKmps < escape) return refuse('out_of_envelope', `v_arr_earth ${vArrEarthKmps} km/s is below the escape speed ${escape.toFixed(4)} km/s at ${altitudeKm} km, so it is not a hyperbolic arrival at that altitude`, 'the altitude the API quotes v_arr_earth at; this study assumes 125 km from the research note');
      const v = (x) => Math.sqrt(Math.max(x * x - twoMuOverR, 0));
      return { value: v(vArrEarthKmps), altitudeKm, radiusKm: r, escapeKmps: escape, roundingLowKmps: v(vArrEarthKmps - roundingKmps), roundingHighKmps: v(vArrEarthKmps + roundingKmps) };
    }

    // ---------------------------------------------------------------- Aster's DLA bands, feasibility.ts:60-85 [Certain port]
    function dlaBand(decDeg, site = C.sites.CAPE_CANAVERAL) {
      if (!isNum(decDeg)) return null;
      const a = Math.abs(decDeg);
      if (a <= site.iMinDeg) return 'GREEN';
      if (a <= site.dlaCeilingDeg) return 'AMBER';
      return 'RED';
    }

    // ---------------------------------------------------------------- per-body ledger
    function bodyLedger(des, opts = {}) {
      const mode = opts.mode || 'sample-return';
      const basis = opts.departure || 'symmetric';
      if (!MODES.includes(mode)) return refuse('out_of_envelope', `unknown mission mode '${mode}'`, `one of ${MODES.join(', ')}`);
      if (!DEPARTURE_BASES.includes(basis)) return refuse('out_of_envelope', `unknown departure basis '${basis}'`, `one of ${DEPARTURE_BASES.join(', ')}`);
      const body = byDes.get(des);
      if (!body) {
        const nf = notFound.find((n) => n.des === des);
        if (nf) return refuse('not_found', `NHATS has no record for ${des}: the fixture ${nf.src.dir}/${nf.src.file} holds the API's error '${nf.error}'`, 'a body that is in NHATS (an accessible NEA under the API\'s standard filters), or the API re-queried for this one');
        return refuse('not_found', `no NHATS fixture for designation '${des}' in the two snapshotted directories`, `one of the ${bodies.length} designations this study holds`);
      }
      const t = body.t;
      const symmetric = asterStack(t.c3, t.vrel_arr_neo, mode);
      const withNhats = asterStack(t.c3, t.vrel_arr_neo, mode, t.vrel_dep_neo);
      const cardSym = costCard(t.vrel_arr_neo, t.vrel_arr_neo, mode);
      const cardNhats = costCard(t.vrel_arr_neo, t.vrel_dep_neo, mode);
      const cache = cacheByDes.get(des) || null;
      return {
        des: body.des,
        fullname: body.fullname,
        name: displayName(body.des, body.fullname),
        computed: body.computed,
        sources: body.sources,
        traj: { ...t },
        raw: body.raw,
        mode,
        departureBasis: mode === 'sample-return' ? basis : 'none',
        stack: mode === 'sample-return' && basis === 'nhats' ? withNhats : symmetric,
        stackSymmetric: symmetric,
        stackNhats: withNhats,
        ratio: t.vrel_dep_neo / t.vrel_arr_neo,
        departureMinusArrivalKmps: t.vrel_dep_neo - t.vrel_arr_neo,
        costCardSymmetric: cardSym,
        costCardNhats: cardNhats,
        massFactor: mode === 'sample-return' ? massFactor(cardSym.dvSpacecraftMps, cardNhats.dvSpacecraftMps) : 1,
        nhats: nhatsLedger(t),
        injection: injectionCheck(t),
        arrival: {
          vArrEarthKmps: t.v_arr_earth,
          entryCapKmps: CITED.NHATS_ENTRY_SPEED_CAP_KMPS.value,
          atNhatsAltitude: impliedArrivalVinf(t.v_arr_earth, CITED.NHATS_ENTRY_ALTITUDE_KM.value),
          atTrajectoryBrowserAltitude: impliedArrivalVinf(t.v_arr_earth, CITED.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value),
          vrelArrEarthKmps: t.vrel_arr_earth,
        },
        declination: {
          depDeg: t.dec_dep,
          arrDeg: t.dec_arr,
          depBandCape: dlaBand(t.dec_dep, C.sites.CAPE_CANAVERAL),
          depBandVandenberg: dlaBand(t.dec_dep, C.sites.VANDENBERG_SFB),
          arrBandCape: dlaBand(t.dec_arr, C.sites.CAPE_CANAVERAL),
        },
        cache: cache ? { ...cache, objective: 'different objective: Aster minimises outbound C3 over a 2026-2040 one-way grid; NHATS minimises total round-trip ΔV with ≥ 8-day stays over its own launch window' } : refuse('not_found', `${des} is not in Aster's screening cache excerpt`, 'the full cache, or a body the cache screened'),
        returnLeg: refuse('insufficient_data', 'Aster computes no return leg (K1 is a CONCEPT kernel); the departure line above is either the symmetric assumption or NHATS\'s number, never Aster\'s', 'K1, the return-leg porkchop, producing departure v∞ at the asteroid and arrival v∞ at Earth per branch'),
      };
    }

    // ---------------------------------------------------------------- the measured spread
    function histogram(values, edges) {
      const bins = [];
      for (let i = 0; i < edges.length - 1; i++) bins.push({ lo: edges[i], hi: edges[i + 1], count: 0, items: [] });
      let outside = 0;
      values.forEach((v, idx) => {
        if (!isNum(v)) return;
        let placed = false;
        for (let i = 0; i < bins.length; i++) {
          const last = i === bins.length - 1;
          if (v >= bins[i].lo && (v < bins[i].hi || (last && v <= bins[i].hi))) {
            bins[i].count++;
            bins[i].items.push(idx);
            placed = true;
            break;
          }
        }
        if (!placed) outside++;
      });
      return { bins, outside };
    }
    const geometricEdges = (lo, hi, n) => Array.from({ length: n + 1 }, (_, i) => lo * Math.pow(hi / lo, i / n));
    const linearEdges = (lo, hi, n) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);

    function stats() {
      const rows = bodies.map((b) => {
        const t = b.t;
        const sym = costCard(t.vrel_arr_neo, t.vrel_arr_neo, 'sample-return');
        const nh = costCard(t.vrel_arr_neo, t.vrel_dep_neo, 'sample-return');
        const inj = injectionCheck(t);
        const nl = nhatsLedger(t);
        const a125 = impliedArrivalVinf(t.v_arr_earth, CITED.NHATS_ENTRY_ALTITUDE_KM.value);
        const a200 = impliedArrivalVinf(t.v_arr_earth, CITED.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value);
        const cache = cacheByDes.get(b.des) || null;
        return {
          des: b.des,
          fullname: b.fullname,
          computed: b.computed,
          launch: t.launch,
          c3: t.c3,
          vrelArr: t.vrel_arr_neo,
          vrelDep: t.vrel_dep_neo,
          ratio: t.vrel_dep_neo / t.vrel_arr_neo,
          depMinusArr: t.vrel_dep_neo - t.vrel_arr_neo,
          massFactor: massFactor(sym.dvSpacecraftMps, nh.dvSpacecraftMps),
          stackSymmetricTotal: asterStack(t.c3, t.vrel_arr_neo, 'sample-return').totalKmps,
          stackNhatsTotal: asterStack(t.c3, t.vrel_arr_neo, 'sample-return', t.vrel_dep_neo).totalKmps,
          nhatsTotal: t.dv_total,
          nhatsResidual: nl.residualKmps,
          vDepEarthResidual: nl.vDepEarthResidualKmps,
          vrelArrEarth: t.vrel_arr_earth,
          injDeltaNhats: inj.deltaNhatsKmps,
          injDeltaAster: inj.deltaAsterKmps,
          vArrEarth: t.v_arr_earth,
          vinf125: a125.value === undefined ? NaN : a125.value,
          vinf125Low: a125.roundingLowKmps === undefined ? NaN : a125.roundingLowKmps,
          vinf125High: a125.roundingHighKmps === undefined ? NaN : a125.roundingHighKmps,
          vinf200: a200.value === undefined ? NaN : a200.value,
          decDep: t.dec_dep,
          decArr: t.dec_arr,
          bandDepCape: dlaBand(t.dec_dep, C.sites.CAPE_CANAVERAL),
          bandDepVandenberg: dlaBand(t.dec_dep, C.sites.VANDENBERG_SFB),
          bandArrCape: dlaBand(t.dec_arr, C.sites.CAPE_CANAVERAL),
          cacheMinC3: cache ? cache.minC3 : NaN,
          cacheMinC3Date: cache ? cache.minC3Date : null,
          cacheVInfArr: cache ? cache.minC3VInfArr : NaN,
          cacheStatus: cache ? cache.status : null,
          cacheCoOrbital: cache ? cache.isCoOrbital : null,
        };
      });
      const ratiosUnique = rows.map((r) => r.ratio).sort((a, b) => a - b);
      const ratiosAllRecords = DATA.records.map((r) => num(r.min_dv_traj.vrel_dep_neo) / num(r.min_dv_traj.vrel_arr_neo)).sort((a, b) => a - b);
      const diffs = rows.map((r) => r.depMinusArr).sort((a, b) => a - b);
      const factors = rows.map((r) => r.massFactor).sort((a, b) => a - b);
      const ts = bodies.map((b) => b.t);
      const allTs = DATA.records.map((r) => parseTraj(r.min_dv_traj));
      const vinf125 = rows.map((r) => r.vinf125).filter(isNum).sort((a, b) => a - b);
      const vinf200 = rows.map((r) => r.vinf200).filter(isNum).sort((a, b) => a - b);
      const years = rows.map((r) => Number(String(r.launch).slice(0, 4)));
      const computedDates = rows.map((r) => r.computed).sort();
      const count = (pred) => rows.filter(pred).length;
      const bandCounts = (key) => ({ GREEN: count((r) => r[key] === 'GREEN'), AMBER: count((r) => r[key] === 'AMBER'), RED: count((r) => r[key] === 'RED') });
      const absMax = (arr) => arr.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      const minMax = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) });
      const cacheRows = rows.filter((r) => isNum(r.cacheMinC3));
      return {
        counts: { fixtureFiles: DATA.records.length + notFound.length, records: DATA.records.length, uniqueBodies: bodies.length, notFound: notFound.length, duplicates: duplicates.length, duplicatesIdentical: duplicates.every((d) => d.identical) },
        computed: { earliest: computedDates[0], latest: computedDates[computedDates.length - 1] },
        launch: { earliestYear: Math.min(...years), latestYear: Math.max(...years), before2026: years.filter((y) => y < 2026).length, in2026to2040: years.filter((y) => y >= 2026 && y <= 2040).length, after2040: years.filter((y) => y > 2040).length },
        ratio: {
          unique: { n: ratiosUnique.length, min: ratiosUnique[0], q1: quantile(ratiosUnique, 0.25), median: median(ratiosUnique), q3: quantile(ratiosUnique, 0.75), max: ratiosUnique[ratiosUnique.length - 1], minBody: argExtreme(rows, 'ratio', -1).des, maxBody: argExtreme(rows, 'ratio', 1).des },
          allRecords: { n: ratiosAllRecords.length, min: ratiosAllRecords[0], median: median(ratiosAllRecords), max: ratiosAllRecords[ratiosAllRecords.length - 1] },
          below1: count((r) => r.ratio < 1),
          above1: count((r) => r.ratio > 1),
          exactly1: count((r) => r.ratio === 1),
          within10pct: count((r) => Math.abs(r.ratio - 1) <= 0.1),
          within25pct: count((r) => Math.abs(r.ratio - 1) <= 0.25),
          offByTwoOrMore: count((r) => r.ratio >= 2 || r.ratio <= 0.5),
        },
        departureMinusArrivalKmps: { min: diffs[0], median: median(diffs), max: diffs[diffs.length - 1] },
        massFactor: { min: factors[0], median: median(factors), max: factors[factors.length - 1], minBody: argExtreme(rows, 'massFactor', -1).des, maxBody: argExtreme(rows, 'massFactor', 1).des, below0p9: count((r) => r.massFactor < 0.9), above1p1: count((r) => r.massFactor > 1.1) },
        injection: {
          nhatsRadiusKm: C.NHATS_PARKING_RADIUS_KM,
          asterRadiusKm: C.LEO_PARKING_RADIUS_KM,
          maxAbsDeltaAtNhatsRadiusKmps: absMax(allTs.map((t) => injectionCheck(t).deltaNhatsKmps)),
          deltaAtAsterRadiusKmps: minMax(allTs.map((t) => injectionCheck(t).deltaAsterKmps)),
          bestFitRadius: fitParkingRadius(allTs, C.EARTH_RADIUS_KM + 100, C.EARTH_RADIUS_KM + 800, 1),
        },
        nhatsLedger: { maxAbsResidualKmps: absMax(allTs.map((t) => nhatsLedger(t).residualKmps)), maxAbsVDepEarthResidualKmps: absMax(allTs.map((t) => nhatsLedger(t).vDepEarthResidualKmps)), vrelArrEarthAllZero: allTs.every((t) => t.vrel_arr_earth === 0), c3: minMax(ts.map((t) => t.c3)), dvTotal: minMax(ts.map((t) => t.dv_total)), stayDays: minMax(ts.map((t) => t.dur_at)) },
        arrival: {
          vArrEarth: minMax(ts.map((t) => t.v_arr_earth)),
          entryCapKmps: CITED.NHATS_ENTRY_SPEED_CAP_KMPS.value,
          allBelowCap: ts.every((t) => t.v_arr_earth <= CITED.NHATS_ENTRY_SPEED_CAP_KMPS.value),
          escapeAt125Kmps: Math.sqrt((2 * C.EARTH_MU_KM3_PER_S2) / C.NHATS_ENTRY_RADIUS_KM),
          escapeAt200Kmps: Math.sqrt((2 * C.EARTH_MU_KM3_PER_S2) / C.TRAJECTORY_BROWSER_ENTRY_RADIUS_KM),
          vinf125: { n: vinf125.length, min: vinf125[0], median: median(vinf125), max: vinf125[vinf125.length - 1], minBody: argExtreme(rows, 'vinf125', -1).des, maxBody: argExtreme(rows, 'vinf125', 1).des, minRoundingLow: argExtreme(rows, 'vinf125', -1).vinf125Low, minRoundingHigh: argExtreme(rows, 'vinf125', -1).vinf125High },
          vinf200: { n: vinf200.length, min: vinf200[0], max: vinf200[vinf200.length - 1] },
          refusedAt125: rows.length - vinf125.length,
        },
        declination: { dep: minMax(ts.map((t) => t.dec_dep)), arr: minMax(ts.map((t) => t.dec_arr)), depCape: bandCounts('bandDepCape'), depVandenberg: bandCounts('bandDepVandenberg'), arrCape: bandCounts('bandArrCape') },
        cache: { rows: cacheRows.length, of: rows.length, coOrbital: cacheRows.filter((r) => r.cacheCoOrbital).length, statuses: cacheRows.reduce((m, r) => ((m[r.cacheStatus] = (m[r.cacheStatus] || 0) + 1), m), {}), minC3BelowNhatsC3: cacheRows.filter((r) => r.cacheMinC3 < r.c3).length, screeningWindow: DATA.cache && DATA.cache.metadata ? DATA.cache.metadata.screeningWindow : null },
        rows,
      };
    }

    // ---------------------------------------------------------------- SVG histogram (page and CLI share it)
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    const fmtTick = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) : Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
    // opts: { bins, scale: 'linear'|'log', xLabel, marker: {x, label}, bands: [{lo, hi, cls, label}], width, height, title }
    function svgHistogram(opts) {
      const W = opts.width || 640;
      const H = opts.height || 220;
      // the marker's label sits under the tick row, off the data, so the bottom band grows with it
      const m = { l: 36, r: 12, t: 22, b: opts.marker && opts.marker.label ? 54 : 40 };
      const pw = W - m.l - m.r;
      const ph = H - m.t - m.b;
      const bins = opts.bins;
      const x0 = bins[0].lo;
      const x1 = bins[bins.length - 1].hi;
      const sx = opts.scale === 'log' ? (v) => m.l + (pw * Math.log(v / x0)) / Math.log(x1 / x0) : (v) => m.l + (pw * (v - x0)) / (x1 - x0);
      const maxCount = Math.max(1, ...bins.map((b) => b.count));
      const yTicks = [];
      const step = maxCount > 40 ? 10 : maxCount > 20 ? 5 : maxCount > 8 ? 2 : 1;
      for (let c = 0; c <= maxCount; c += step) yTicks.push(c);
      const sy = (c) => m.t + ph - (ph * c) / maxCount;
      let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.title || 'histogram')}" class="ledger-hist">`;
      out += `<style>.ledger-hist{--ink:#52514e;--muted:#898781;--hair:#e1e0d9;--axis:#c3c2b7;--bar:#2a78d6;--surface:#fcfcfb;--good:#0ca30c;--warn:#fab219;--crit:#d03b3b;font:11px system-ui,-apple-system,"Segoe UI",sans-serif}@media (prefers-color-scheme:dark){.ledger-hist{--ink:#c3c2b7;--muted:#898781;--hair:#2c2c2a;--axis:#383835;--bar:#3987e5;--surface:#1a1a19}}.ledger-hist .grid{stroke:var(--hair);stroke-width:1}.ledger-hist .axis{stroke:var(--axis);stroke-width:1}.ledger-hist .bar{fill:var(--bar)}.ledger-hist .hit{fill:transparent}.ledger-hist text{fill:var(--muted)}.ledger-hist .title{fill:var(--ink);font-weight:600}.ledger-hist .marker{stroke:var(--ink);stroke-width:1.5}.ledger-hist .marker-label{fill:var(--ink);font-weight:600}.ledger-hist .band-GREEN{fill:var(--good);fill-opacity:.12}.ledger-hist .band-AMBER{fill:var(--warn);fill-opacity:.14}.ledger-hist .band-RED{fill:var(--crit);fill-opacity:.12}</style>`;
      if (opts.title) out += `<text class="title" x="${m.l}" y="14">${esc(opts.title)}</text>`;
      for (const band of opts.bands || []) {
        const bx0 = sx(Math.max(band.lo, x0));
        const bx1 = sx(Math.min(band.hi, x1));
        if (bx1 > bx0) out += `<rect class="band-${esc(band.cls)}" x="${bx0.toFixed(1)}" y="${m.t}" width="${(bx1 - bx0).toFixed(1)}" height="${ph}"/>`;
        if (band.label && bx1 - bx0 > 30) out += `<text x="${((bx0 + bx1) / 2).toFixed(1)}" y="${m.t + 11}" text-anchor="middle">${esc(band.label)}</text>`;
      }
      for (const c of yTicks) {
        const y = sy(c).toFixed(1);
        out += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 6}" y="${(sy(c) + 3.5).toFixed(1)}" text-anchor="end">${c}</text>`;
      }
      out += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
      // bars (1 px in from each bin edge, so neighbours keep a 2 px surface gap; 4 px rounded data-end,
      // square at the baseline), then the full-height hit targets on top so hover, tap and focus land.
      bins.forEach((b, i) => {
        const bx0 = sx(b.lo) + 1;
        const bx1 = sx(b.hi) - 1;
        const w = Math.max(bx1 - bx0, 1);
        const y = sy(b.count);
        const h = m.t + ph - y;
        if (b.count > 0) {
          const r = Math.min(4, w / 2, h);
          out += `<path class="bar" data-i="${i}" d="M${bx0.toFixed(1)},${(m.t + ph).toFixed(1)} V${(y + r).toFixed(1)} A${r},${r} 0 0 1 ${(bx0 + r).toFixed(1)},${y.toFixed(1)} H${(bx1 - r).toFixed(1)} A${r},${r} 0 0 1 ${bx1.toFixed(1)},${(y + r).toFixed(1)} V${(m.t + ph).toFixed(1)} Z"/>`;
        }
      });
      bins.forEach((b, i) => {
        out += `<rect class="hit" data-i="${i}" x="${sx(b.lo).toFixed(1)}" y="${m.t}" width="${(sx(b.hi) - sx(b.lo)).toFixed(1)}" height="${ph}" tabindex="0" aria-label="${esc(`${fmtTick(b.lo)} to ${fmtTick(b.hi)}: ${b.count}`)}"/>`;
      });
      const labelEvery = opts.labelEvery || 1;
      bins.forEach((b, i) => {
        if (i % labelEvery === 0) out += `<text x="${sx(b.lo).toFixed(1)}" y="${m.t + ph + 14}" text-anchor="middle">${fmtTick(b.lo)}</text>`;
      });
      const last = bins[bins.length - 1];
      if ((bins.length) % labelEvery === 0) out += `<text x="${sx(last.hi).toFixed(1)}" y="${m.t + ph + 14}" text-anchor="middle">${fmtTick(last.hi)}</text>`;
      if (opts.marker && opts.marker.x >= x0 && opts.marker.x <= x1) {
        const mx = sx(opts.marker.x).toFixed(1);
        out += `<line class="marker" x1="${mx}" x2="${mx}" y1="${m.t}" y2="${m.t + ph}"/>`;
        if (opts.marker.label) out += `<text class="marker-label" x="${mx}" y="${m.t + ph + 28}" text-anchor="middle">${esc(opts.marker.label)}</text>`;
      }
      if (opts.xLabel) out += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle">${esc(opts.xLabel)}</text>`;
      out += '</svg>';
      return out;
    }

    return Object.freeze({
      ok: true,
      version: VERSION,
      cited: CITED,
      constants: C,
      aster: DATA.aster,
      signature: DATA.signature,
      fixtureDirs: DATA.fixtureDirs,
      bodies,
      notFound,
      duplicates,
      cacheSource: DATA.cache ? DATA.cache.source : null,
      cacheMetadata: DATA.cache ? DATA.cache.metadata : null,
      injectionDvFromC3,
      asterStack,
      costCard,
      massFactor,
      nhatsLedger,
      injectionCheck,
      fitParkingRadius,
      impliedArrivalVinf,
      dlaBand,
      bodyLedger,
      displayName,
      stats,
      histogram,
      geometricEdges,
      linearEdges,
      svgHistogram,
      esc,
    });
  }

  return { create, VERSION, MODES, DEPARTURE_BASES, CITED };
});
