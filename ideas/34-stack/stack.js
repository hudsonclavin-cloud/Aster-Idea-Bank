/* Stack: a whole rocket. Stages, engines, propellant loads, tank volumes from the propellant densities, dry masses,
 * payload; staged ideal delta-v, burn times, thrust-to-weight; real vehicles as presets with sourced masses.
 *
 * Idea 34 of the Aster Idea Bank, module 4 of "The Long Way Round". A pure kernel: no DOM, no network. Every engine
 * is idea 33's (snapshots/engine.js, unmodified, on ideas 31 and 32's kernels): a preset is built with idea 33's
 * engineSpec() and cycle(), an imported handoff is re-computed with them and refused unless it matches. What is new:
 *
 *   burn       a stage burn is a sequence of segments separated by events (a jettison, an engine shut down early);
 *              in each segment the engines are identical, so the exhaust velocity c = F/mdot is constant and
 *              delta-v = c ln(m_start / m_end) exactly (Tsiolkovsky); time = propellant / (n mdot).
 *   ledger     every kilogram of a stage leaves by one road: burned in a burn (propellant), lost without thrust at
 *              a burn's start (shed: thrust build-up, frost, purges), lost between burns (coast: venting), dropped
 *              mid-burn (jettison), or dropped at separation (dry + remaining). Liftoff mass is their sum plus the
 *              payload, and the last stage's burnout less its dry and remaining mass is the payload again.
 *   bounds     the vacuum engine-level Isp is the headline (gas-generator exhaust giving no thrust, idea 33's lower
 *              bound); the first stage's burns are also given at its sea-level Isp (a lower bound on what the
 *              atmosphere allows) and every gas-generator stage at idea 33's upper bound. Losses to gravity, drag
 *              and steering are module 35's: this is ideal delta-v.
 *   tanks      propellant split by the engine-level mixture ratio, volumes at idea 31's measured densities.
 *
 * Units: SI throughout (kg, s, m/s, N, m^3, Pa). English units only in the flight report and its checks, converted
 * with exact definitions (1 lb = 0.45359237 kg, g0 = 9.80665 m/s^2, 1 ft = 0.3048 m).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Stack = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [Certain] exact unit definitions
  var LBM = 0.45359237, G_STD = 9.80665, FT = 0.3048, LBF = LBM * G_STD;
  // idea 33's engine presets usable on a launch vehicle, and the cycle reference each is run with (idea 33's
  // own pairing, app.js REF_OF); the YLR113-AJ-1 sled engine is left out (it has no turbomachinery data).
  var PRESET_ENGINES = ['F-1', 'H-1', 'J-2', 'LR89-NA-7', 'RL10A-3-3'];
  var CYCLE_OF = { 'F-1': 'F-1', 'H-1': 'H-1', 'J-2': 'J-2', 'LR89-NA-7': 'MA-5 booster', 'RL10A-3-3': 'RL10A-3-3A' };
  var DECK_THROTTLES = [0.4, 0.6, 0.8, 1, 1.1];
  var MAX_STAGES = 5;

  function refusal(code, reason, help, extra) {
    var r = { code: code, reason: reason, what_would_help: help };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function fmt(v, d) { return (typeof v === 'number' && isFinite(v)) ? +v.toPrecision(d || 4) + '' : String(v); }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function create(deps) {
    var E = deps.E, isa = deps.isa, g0 = deps.g0 || G_STD;

    // ================================================================== engines (all idea 33's)
    /** An engine record from idea 33's quantities at nominal throttle: thrust chamber point v (vacuum), sl (sea
     * level), the cycle and engine level, per chamber; multiplied by the number of chambers here. */
    function record(spec, ctx, cyc, base) {
      var n = spec.chambers || 1;
      var v = E.point(ctx, spec.pc, 0), sl = E.point(ctx, spec.pc, isa(0).P_Pa);
      var refs = [];
      if (v.refusal) return { refusal: v.refusal };
      if (!(v.mdot > 0 && v.Fvac > 0)) return { refusal: refusal('insufficient_data', 'This engine has no throat area, so idea 33 gives no thrust or mass flow (only Isp): a stage needs both.', 'Size the nozzle for a thrust in idea 32 or idea 33, or choose an engine preset.') };
      if (cyc && cyc.refusal) refs.push(Object.assign({}, cyc.refusal, { applies_to: 'cycle', from: '33-engine-deck' }));
      var cOk = cyc && !cyc.refusal ? cyc : null;
      var ev = E.engineLevel(v, cOk), es = sl.refusal ? null : E.engineLevel(sl, cOk);
      var gg = cOk && cOk.cycle === 'gas-generator';
      var d = E.densities(spec.prop);
      var mo = v.mdotOx + (gg ? cOk.pumps.ox.flow - v.mdotOx : 0), mf = ev.mdot - mo;
      if (sl.refusal) refs.push(Object.assign({}, sl.refusal, { applies_to: 'thrust_sea_level', from: '33-engine-deck' }));
      var deckRows = DECK_THROTTLES.map(function (tau) {
        var p = E.point(ctx, tau * spec.pc, 0);
        return { tau: tau, Fvac: p.Fvac != null ? n * p.Fvac : null, mdot: p.mdot != null ? n * p.mdot : null, sepOnsetPa: p.sepOnset != null ? p.sepOnset : null };
      });
      var r = {
        id: base.id, label: base.label, kind: base.kind, chambers: n,
        propellant: { preset: spec.preset || null, label: spec.prop.label || spec.preset || 'propellant', oxidizer: spec.prop.oxidizer, fuel: spec.prop.fuel },
        cycle: cOk ? cOk.cycle : (spec.cycle || null),
        thrustVac: n * v.Fvac, thrustVacUpper: gg ? n * ev.ispVacHigh * ev.mdot : null,
        thrustSL: es ? n * sl.F : null,
        mdot: n * ev.mdot, ggFlow: gg ? n * cOk.mdotGG : 0,
        ispVac: gg ? ev.ispVacLow : ev.ispVac, ispVacUpper: gg ? ev.ispVacHigh : null,
        ispSL: es ? (gg ? es.ispLow : sl.isp) : null, ispSLUpper: es && gg ? es.ispHigh : null,
        mixtureRatio: mo / mf, rhoOx: d.ox && d.ox.value, rhoFuel: d.fuel && d.fuel.value,
        exitArea: n * v.Ae, sepOnsetPa: v.sepOnset,
        deckVac: { throttle: DECK_THROTTLES.slice(), thrust_vac: deckRows.map(function (x) { return x.Fvac; }), mass_flow_chamber: deckRows.map(function (x) { return x.mdot; }), separation_onset_pa: deckRows.map(function (x) { return x.sepOnsetPa; }) },
        refusals: refs, source: base.source,
      };
      if (!(r.rhoOx > 0 && r.rhoFuel > 0)) r.refusals.push({ applies_to: 'tank_volume', code: 'insufficient_data', reason: 'No measured density for one of this engine\'s propellants in idea 31\'s table, so no tank volume.', what_would_help: 'A measured density for it (idea 31\'s snapshots/propellant-densities.js).' });
      return r;
    }
    /** An engine record for one of idea 33's presets, at nominal throttle, with its own cycle reference. */
    function engineFromPreset(id) {
      if (PRESET_ENGINES.indexOf(id) < 0) return { refusal: refusal('not_found', 'No engine preset "' + id + '" for a stage.', 'One of ' + PRESET_ENGINES.join(', ') + ', or an engine imported from idea 33.') };
      var s = E.engineSpec(id);
      if (s.refusal) return s;
      var spec = s.spec, ctx = s.context;
      var d = E.densities(spec.prop), v = E.point(ctx, spec.pc, 0);
      var cyc = E.cycle(E.cycleReference(CYCLE_OF[id]), { pc: v.pc, mdotOx: v.mdotOx, mdotFuel: v.mdotFuel, prop: spec.prop, rhoOx: d.ox.value, rhoFuel: d.fuel.value });
      return record(spec, ctx, cyc, { id: id, label: id + ' (' + spec.row.application + ')', kind: 'preset',
        source: '33-engine-deck/engine.js engineSpec("' + id + '") (NASA SP-8120 Table I, calibrated) and cycle("' + CYCLE_OF[id] + '") (NASA SP-8107), at nominal throttle' });
    }
    /**
     * An engine record from idea 33's handoff: the chamber, nozzle, deck and cycle are re-computed with idea 33's
     * kernel from the handoff's inputs and must reproduce its engine-level outputs to 1e-8; otherwise refused.
     */
    function engineFromHandoff(input) {
      var h = input;
      if (typeof input === 'string') { try { h = JSON.parse(input); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'The handoff idea 33 (Engine Deck) exports.') }; } }
      if (!h || typeof h !== 'object' || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'The handoff idea 33 (Engine Deck) exports.') };
      if (h.from === '32-bell' || h.from === '31-mixture') return { refusal: refusal('insufficient_data', 'A ' + h.from + ' handoff is a ' + (h.from === '32-bell' ? 'chamber and nozzle' : 'chamber') + ' without an engine (no throttle, cycle or engine-level flow).', 'Open it in idea 33 (Engine Deck) and export that handoff.') };
      if (h.from !== '33-engine-deck') return { refusal: refusal('invalid_input', 'A handoff from ' + (h.from || 'an unknown module') + ' is not an engine; this module reads idea 33\'s.', 'A handoff exported by 33-engine-deck.') };
      var p = E.parseHandoff(h);
      if (p.refusal) return { refusal: p.refusal };
      var eng = h.inputs.engine || {}, eff = eng.efficiencies || {};
      if (!(eng.throat_area_m2 > 0)) return { refusal: refusal('insufficient_data', 'This engine handoff has no throat area, so no thrust or mass flow.', 'Size the nozzle for a thrust in idea 32 or idea 33 and export again.') };
      var O = h.outputs || {};
      var checks = ['thrust_vacuum', 'mass_flow', 'specific_impulse_vacuum'];
      var modes = ['shifting', 'frozen'], last = null;
      for (var mi = 0; mi < modes.length; mi++) {
        var spec;
        if (PRESET_ENGINES.indexOf(eng.id) >= 0 || eng.id === 'YLR113-AJ-1') { var es = E.engineSpec(eng.id); if (es.refusal) return es; spec = Object.assign({}, es.spec); }
        else spec = E.specFromNozzle(p, { At: eng.throat_area_m2 });
        spec = Object.assign(spec, { At: eng.throat_area_m2, etaCstar: eff.cstar, etaCF: eff.thrust_coefficient, mode: modes[mi] });
        var ctx = E.context(spec);
        if (!ctx.ok) return { refusal: ctx.refusals[0] };
        var v = E.point(ctx, spec.pc, 0), d = E.densities(spec.prop);
        var cyc = eng.cycle_reference ? E.cycle(E.cycleReference(eng.cycle_reference), { pc: v.pc, mdotOx: v.mdotOx, mdotFuel: v.mdotFuel, prop: spec.prop, rhoOx: d.ox.value, rhoFuel: d.fuel.value }, { richSide: eng.rich_side || undefined }) : null;
        var rec = record(spec, ctx, cyc, { id: 'imported:' + (eng.id || 'engine'), label: (eng.label || eng.id || 'engine') + ', imported from idea 33', kind: 'imported',
          source: '33-engine-deck handoff (produced ' + (h.produced || '?') + '), re-computed with 33-engine-deck/engine.js' });
        if (rec.refusal) return rec;
        var n = rec.chambers;
        var mine = { thrust_vacuum: rec.thrustVac / n, mass_flow: rec.mdot / n, specific_impulse_vacuum: rec.ispVac };
        var bad = checks.filter(function (k) { return !O[k] || !num(O[k].value) || Math.abs(O[k].value / mine[k] - 1) > 1e-8; });
        if (!bad.length) { rec.mode = modes[mi]; rec.handoff = h; return { record: rec }; }
        if (!last) last = { k: bad[0], got: O[bad[0]] ? O[bad[0]].value : null, want: mine[bad[0]] };
      }
      return { refusal: refusal('invalid_input', 'The engine handoff says ' + last.k + ' = ' + fmt(last.got, 9) + ', but idea 33\'s kernel computes ' + fmt(last.want, 9) + ' from its inputs (and neither a shifting nor a frozen nozzle matches): it was edited, or made with a setting the handoff does not record (idea 33 does not record a typed turbine inlet temperature).', 'The unedited handoff idea 33 exported, made without a typed turbine inlet temperature.') };
    }

    // ================================================================== the vehicle
    function stageMass(s) {
      var m = (s.dry || 0) + (s.remaining || 0);
      (s.burns || []).forEach(function (b) {
        m += (b.propellant || 0) + (b.shed || 0) + (b.coast || 0);
        (b.jettisons || []).forEach(function (j) { m += j.mass || 0; });
      });
      return m;
    }
    function stagePropellant(s) { return (s.burns || []).reduce(function (a, b) { return a + (b.propellant || 0); }, 0); }
    function validate(veh, engines) {
      var out = [];
      if (!veh || !Array.isArray(veh.stages) || !veh.stages.length) return [refusal('invalid_input', 'A vehicle needs at least one stage.', 'Add a stage.')];
      if (veh.stages.length > MAX_STAGES) out.push(refusal('out_of_envelope', veh.stages.length + ' stages is more than this page handles (' + MAX_STAGES + ').', 'Five stages or fewer.'));
      var pl = veh.payload && veh.payload.mass;
      if (!(num(pl) && pl >= 0)) out.push(refusal('invalid_input', 'The payload mass must be a number of kilograms, zero or more.', 'A payload mass.', { applies_to: 'payload' }));
      veh.stages.forEach(function (s, i) {
        var where = 'stage ' + (i + 1) + (s.label ? ' (' + s.label + ')' : '');
        var e = engines[s.engine];
        if (!e) out.push(refusal('not_found', 'No engine "' + s.engine + '" for ' + where + '.', 'An engine preset or an engine imported from idea 33.', { applies_to: 'stage ' + (i + 1) }));
        else if (e.refusal) out.push(Object.assign({}, e.refusal, { applies_to: 'stage ' + (i + 1) }));
        if (!(Number.isInteger(s.count) && s.count >= 1)) out.push(refusal('invalid_input', where + ': the number of engines must be a whole number, 1 or more.', 'A whole number of engines.', { applies_to: 'stage ' + (i + 1) }));
        ['dry', 'remaining'].forEach(function (k) { if (!(num(s[k]) && s[k] >= 0)) out.push(refusal('invalid_input', where + ': the ' + (k === 'dry' ? 'dry' : 'remaining (unburned)') + ' mass must be a number of kilograms, zero or more.', 'A mass in kilograms.', { applies_to: 'stage ' + (i + 1) })); });
        if (!(s.dry > 0)) { if (num(s.dry) && s.dry === 0) out.push(refusal('out_of_envelope', where + ' has no dry mass: tanks and engines weigh something.', 'A dry mass (sourced, or scaled from a real stage\'s inert fraction).', { applies_to: 'stage ' + (i + 1) })); }
        if (!(s.burns && s.burns.length)) out.push(refusal('invalid_input', where + ' has no burn.', 'A propellant load.', { applies_to: 'stage ' + (i + 1) }));
        (s.burns || []).forEach(function (b, k) {
          if (!(num(b.propellant) && b.propellant > 0)) out.push(refusal('invalid_input', where + ', burn ' + (k + 1) + ': the propellant burned must be a positive number of kilograms.', 'A propellant mass.', { applies_to: 'stage ' + (i + 1) }));
          ['shed', 'coast'].forEach(function (q) { if (b[q] != null && !(num(b[q]) && b[q] >= 0)) out.push(refusal('invalid_input', where + ': ' + q + ' mass must be zero or more.', 'A mass in kilograms.', { applies_to: 'stage ' + (i + 1) })); });
          (b.jettisons || []).forEach(function (j) { if (!(num(j.mass) && j.mass >= 0 && num(j.t) && j.t >= 0)) out.push(refusal('invalid_input', where + ': a jettison needs a mass and a time after ignition, both zero or more.', 'A mass and a time.', { applies_to: 'stage ' + (i + 1) })); });
          (b.engineOut || []).forEach(function (o) { if (!(Number.isInteger(o.count) && o.count >= 1 && num(o.t) && o.t >= 0)) out.push(refusal('invalid_input', where + ': an engine cutoff needs a whole number of engines and a time.', 'A count and a time.', { applies_to: 'stage ' + (i + 1) })); });
          var outs = (b.engineOut || []).reduce(function (a, o) { return a + (o.count || 0); }, 0);
          if (Number.isInteger(s.count) && outs >= s.count) out.push(refusal('invalid_input', where + ': the scheduled cutoffs shut down all ' + s.count + ' engines before the propellant is gone.', 'Fewer early cutoffs.', { applies_to: 'stage ' + (i + 1) }));
        });
      });
      return out;
    }

    /**
     * Fly the stack (ideal, no gravity or drag): every stage's burns in order. opts.timeline: sample points for the
     * charts (default true). Returns per-stage and total delta-v, burn times, masses, thrust-to-weight, tank volumes.
     */
    function evaluate(veh, engines, opts) {
      opts = opts || {};
      var errs = validate(veh, engines);
      if (errs.length) return { ok: false, refusals: errs };
      var refusals = [], warnings = [];
      var payload = veh.payload.mass;
      var masses = veh.stages.map(stageMass);
      var m0 = payload + masses.reduce(function (a, b) { return a + b; }, 0);
      var m = m0;
      var e0 = engines[veh.stages[0].engine];
      var liftoff = { mass: m0 };
      if (e0.thrustSL == null) {
        refusals.push(refusal('out_of_envelope', 'The first stage\'s ' + e0.id + ' nozzle separates at sea level (idea 33, SP-8120\'s criterion): no sea-level thrust, so this stack cannot be lit on the ground.', 'A first-stage engine that flows full at sea level (F-1, H-1, LR89-NA-7, or a smaller area ratio in idea 32).', { applies_to: 'liftoff' }));
      } else {
        liftoff.thrust = veh.stages[0].count * e0.thrustSL;
        liftoff.tw = liftoff.thrust / (m0 * g0);
        if (!(liftoff.tw > 1)) refusals.push(refusal('out_of_envelope', 'Thrust-to-weight at liftoff is ' + fmt(liftoff.tw, 3) + ': the stack does not leave the pad.', 'More or bigger first-stage engines, or less mass above them.', { applies_to: 'liftoff' }));
      }
      var dv = 0, dvSL = 0, dvUp = 0, T = 0, timeline = [], stages = [];
      var want = opts.timeline !== false;
      veh.stages.forEach(function (s, si) {
        var e = engines[s.engine];
        var st = { label: s.label, engine: s.engine, count: s.count, massIgnition: m, stageMass: masses[si], burns: [], dv: 0, dvSL: 0, dvUpper: 0, burnTime: 0, carried: 0 };
        var cVac = e.ispVac, cSL = si === 0 && e.ispSL != null ? e.ispSL : e.ispVac, cUp = e.ispVacUpper || e.ispVac;
        s.burns.forEach(function (b, bi) {
          m -= b.shed || 0;
          var mStart = m, n = s.count, t = 0, P = b.propellant, bdv = 0;
          var evs = (b.jettisons || []).map(function (j) { return { t: j.t, kind: 'jettison', mass: j.mass, label: j.label }; })
            .concat((b.engineOut || []).map(function (o) { return { t: o.t, kind: 'engine-out', count: o.count, label: o.label }; }))
            .sort(function (a, c) { return a.t - c.t; });
          var applied = [], segs = [];
          var push = function (mm, tt, nn) { if (want) timeline.push({ t: T + tt, m: mm, v: dv + bdv, a: nn * e.thrustVac / mm, stage: si, burn: bi }); };
          push(m, 0, n);
          var burnTo = function (dP) {
            var dt = dP / (n * e.mdot), m1 = m - dP, k = Math.log(m / m1);
            if (want) { for (var q = 1; q <= 8; q++) { var mq = m - dP * q / 8; push(mq, t + dt * q / 8, n); timeline[timeline.length - 1].v = dv + bdv + cVac * Math.log(m / mq); } }
            segs.push({ t0: t, t1: t + dt, m0: m, m1: m1, n: n });
            bdv += cVac * k; st.dvSL += cSL * k; st.dvUpper += cUp * k;
            m = m1; t += dt;
          };
          for (var i = 0; i < evs.length; i++) {
            var ev = evs[i], dP = n * e.mdot * (ev.t - t);
            if (dP >= P) break;
            burnTo(dP); P -= dP;
            if (ev.kind === 'jettison') { m -= ev.mass; push(m, t, n); }
            else { n -= ev.count; push(m, t, n); }
            applied.push(ev);
          }
          burnTo(P);
          var late = evs.filter(function (x) { return applied.indexOf(x) < 0; });
          late.forEach(function (x) {
            if (x.kind === 'jettison') { st.carried += x.mass; warnings.push({ applies_to: 'stage ' + (si + 1), reason: (x.label || 'A jettison') + ' at ' + fmt(x.t, 4) + ' s comes after this burn ends (' + fmt(t, 4) + ' s): its ' + fmt(x.mass, 4) + ' kg is carried to separation.' }); }
            else warnings.push({ applies_to: 'stage ' + (si + 1), reason: (x.label || 'An engine cutoff') + ' at ' + fmt(x.t, 4) + ' s comes after this burn ends (' + fmt(t, 4) + ' s) and is ignored.' });
          });
          st.burns.push({ propellant: b.propellant, shed: b.shed || 0, coast: b.coast || 0, mIgnition: mStart, mCutoff: m, dv: bdv, time: t, nIgnition: s.count, nCutoff: n,
            thrustIgnitionVac: s.count * e.thrustVac, accelCutoffVac: n * e.thrustVac / m, twIgnitionVac: s.count * e.thrustVac / (mStart * g0), applied: applied, late: late, segments: segs, startT: T });
          st.dv += bdv; st.burnTime += t; T += t; dv += bdv;
          m -= b.coast || 0;
        });
        dvSL += st.dvSL; dvUp += st.dvUpper;
        st.massBurnout = m;
        m -= s.dry + s.remaining + st.carried;
        st.massAfterSeparation = m;
        var P = stagePropellant(s), r = e.mixtureRatio;
        st.propellant = P; st.oxidizer = P * r / (1 + r); st.fuel = P / (1 + r);
        st.volumeOx = e.rhoOx > 0 ? st.oxidizer / e.rhoOx : null; st.volumeFuel = e.rhoFuel > 0 ? st.fuel / e.rhoFuel : null;
        st.inertFraction = (s.dry + s.remaining) / masses[si];
        st.massRatio = st.burns.length ? st.burns[0].mIgnition / st.burns[st.burns.length - 1].mCutoff : null;
        stages.push(st);
      });
      return { ok: true, refusals: refusals, warnings: warnings, liftoff: liftoff, payload: payload, finalMass: m, stages: stages,
        dv: dv, dvSL: dvSL, dvUpper: dvUp, burnTime: T, payloadFraction: payload / m0, timeline: timeline };
    }

    /** The same masses with no in-flight events: one burn per stage to depletion with every engine, jettisoned
     * items carried to separation (added to dry), losses between burns lost at the start. Mass is conserved. */
    function simplify(veh) {
      var v = clone(veh);
      v.stages = v.stages.map(function (s) {
        var P = 0, shed = 0, jet = 0;
        s.burns.forEach(function (b) { P += b.propellant; shed += (b.shed || 0) + (b.coast || 0); (b.jettisons || []).forEach(function (j) { jet += j.mass; }); });
        return Object.assign({}, s, { dry: s.dry + jet, burns: [{ propellant: P, shed: shed, coast: 0, jettisons: [], engineOut: [] }] });
      });
      v.simplified = true;
      return v;
    }
    function withPayload(veh, mass) { var v = clone(veh); v.payload = Object.assign({}, v.payload, { mass: mass }); return v; }
    /** Total ideal delta-v (vacuum, headline) against payload, for the trade chart. */
    function sweepPayload(veh, engines, maxPayload, n) {
      n = n || 41;
      var out = [];
      for (var i = 0; i < n; i++) {
        var p = maxPayload * i / (n - 1), r = evaluate(withPayload(veh, p), engines, { timeline: false });
        out.push({ payload: p, dv: r.ok ? r.dv : null, tw: r.ok ? r.liftoff.tw : null });
      }
      return out;
    }
    /** The payload at which the stack's total ideal delta-v (vacuum, headline) equals dvTarget, by bisection. */
    function solvePayload(veh, engines, dvTarget) {
      if (!(num(dvTarget) && dvTarget > 0)) return { refusal: refusal('invalid_input', 'A target delta-v must be a positive number of m/s.', 'A target delta-v.') };
      var f = function (p) { var r = evaluate(withPayload(veh, p), engines, { timeline: false }); return r.ok ? r.dv : null; };
      var d0 = f(0);
      if (d0 == null) return { refusal: refusal('invalid_input', 'The stack itself is refused.', 'Fix the stack first.') };
      if (d0 < dvTarget) return { refusal: refusal('out_of_envelope', 'Even with no payload this stack gives ' + fmt(d0, 5) + ' m/s of ideal delta-v, short of the ' + fmt(dvTarget, 5) + ' m/s asked.', 'More propellant, lighter stages, a higher-Isp upper stage, or another stage.'), dvAtZero: d0 };
      var lo = 0, hi = 1000;
      while (f(hi) >= dvTarget) { lo = hi; hi *= 2; if (hi > 1e10) return { refusal: refusal('out_of_envelope', 'No finite payload brings the delta-v down to the target.', 'Check the masses.') }; }
      for (var i = 0; i < 100 && hi - lo > 1e-6 * Math.max(1, hi); i++) { var mid = (lo + hi) / 2; if (f(mid) >= dvTarget) lo = mid; else hi = mid; }
      return { payload: (lo + hi) / 2, dvAtZero: d0 };
    }

    // ================================================================== AS-512 (Apollo 17) as flown
    /** Sum of the non-total rows of Table 16-9 strictly between two running-total rows (by label, in order). */
    function span(D, from, to, from_i) {
      var seq = D.sequence, i = from_i != null ? from_i : seq.findIndex(function (r) { return r[0] === from; });
      if (i < 0) throw new Error('no row ' + from);
      var rows = [];
      for (var k = i + 1; k < seq.length && seq[k][0] !== to; k++) if (!/FLT STG/.test(seq[k][0])) rows.push({ label: seq[k][0], kg: -seq[k][1] });
      return rows;
    }
    function pick(rows, re) { return rows.filter(function (r) { return re.test(r.label); }).reduce(function (a, r) { return a + r.kg; }, 0); }
    function rest(rows, re) { return rows.filter(function (r) { return !re.test(r.label); }).reduce(function (a, r) { return a + r.kg; }, 0); }
    /**
     * The AS-512 vehicle from the flight report (snapshots/as512-flight.js), defined from holddown-arm release (the
     * liftoff mass) to the S-IVB's second cutoff. Every row of Table 16-9 between those events is assigned to one
     * stage's propellant, shed, jettison, coast or separation; burn clocks start at each "mainstage" time.
     */
    function fromAS512(D) {
      var ST = D.stageTables, EV = D.events;
      var tHda = ST['S-IC'].events['holddown arm release'].t, tMs2 = ST['S-II'].events['S-II mainstage'].t;
      var tMs3 = ST['S-IVB burn 1'].events['S-IVB mainstage'].t;
      var MAIN = /^MAINSTAGE$/;
      // S-IC: holddown release to OECO; dropped from OECO to S-II start sequence
      var b1 = span(D, '1ST FLT STG AT HDAR', '1ST FLT STG AT OECO');
      var sep1 = span(D, '1ST FLT STG AT OECO', '1ST FLT STG AT SEP').concat(span(D, '1ST FLT STG AT SEP', '2ND FLT STG AT SSC'));
      var sicDry = ST['S-IC'].events['holddown arm release'].dry + pick(sep1, /SMALL IS/);
      var sicDrop = sep1.reduce(function (a, r) { return a + r.kg; }, 0);
      // S-II: start sequence to mainstage (shed), mainstage to cutoff, cutoff to the S-IVB's start sequence (dropped)
      var s2a = span(D, '2ND FLT STG AT SSC', '2ND FLT STG AT IGN').concat(span(D, '2ND FLT STG AT IGN', '2ND FLT STG AT MS'));
      var b2 = span(D, '2ND FLT STG AT MS', '2ND FLT STG AT COS');
      var sep2 = span(D, '2ND FLT STG AT COS', '2ND FLT STG AT SEP').concat(span(D, '2ND FLT STG AT SEP', '3RD FLT STG 1ST SSC'));
      var siiDry = ST['S-II'].events['S-II ignition'].dry + pick(sep2, /IS DRY/);
      var siiDrop = sep2.reduce(function (a, r) { return a + r.kg; }, 0);
      var tJett = EV.siiAftInterstageJettison - tMs2;
      // S-IVB: two burns and the coast between them
      var s3a = span(D, '3RD FLT STG 1ST SSC', '3RD FLT STG 1ST IGN').concat(span(D, '3RD FLT STG 1ST IGN', '3RD FLT STG 1ST MS'));
      var b3 = span(D, '3RD FLT STG 1ST MS', '3RD FLT STG 1ST COS');
      var c3 = span(D, '3RD FLT STG 1ST COS', '3RD FLT STG 1ST ETD').concat(span(D, '3RD FLT STG 1ST ETD', '3RD FLT STG 2ND SSC'));
      var s4a = span(D, '3RD FLT STG 2ND SSC', '3RD FLT STG 2ND IGN').concat(span(D, '3RD FLT STG 2ND IGN', '3RD FLT STG 2ND MS'));
      var b4 = span(D, '3RD FLT STG 2ND MS', '3RD FLT STG 2ND COS');
      var eco2 = ST['S-IVB burn 2'].events['S-IVB engine cutoff'];
      var sivbDry = eco2.dry, sivbRem = eco2.stage - eco2.dry, payload = eco2.vehicle - eco2.stage;
      var src = D.report;
      return {
        id: 'AS-512', label: D.label, source: src, payload: { mass: payload, label: 'Instrument unit and spacecraft (CSM, LM, SLA) after the launch escape system is jettisoned', source: src + ', Table 16-7 (vehicle less S-IVB at second cutoff)' },
        reference: { startRange: [tHda, tMs2, tMs3, ST['S-IVB burn 2'].events['S-IVB mainstage'].t] },
        stages: [
          { label: 'S-IC', engine: 'F-1', count: 5, dry: sicDry, remaining: sicDrop - sicDry,
            note: 'Dry: Table 16-1 DRY STAGE plus the small S-IC/S-II interstage dropped with it. Remaining: everything else dropped at separation (residuals, gases, thrust decay after cutoff, retro-rocket propellant).',
            burns: [{ propellant: pick(b1, MAIN), shed: rest(b1, MAIN), coast: 0, jettisons: [],
              engineOut: [{ t: EV.sicCeco - tHda, count: 1, label: 'Center engine cutoff' }] }] },
          { label: 'S-II', engine: 'J-2', count: 5, dry: siiDry, remaining: siiDrop - siiDry,
            note: 'Dry: Table 16-3 DRY STAGE plus the S-II/S-IVB interstage. The aft interstage (jettisoned 192.9 s, Table 2-2) and the launch escape system (no time in the report; placed with the interstage, assumed) are jettisons in this burn.',
            burns: [{ propellant: pick(b2, MAIN), shed: pick(s2a, /./) + rest(b2, /^(MAINSTAGE|LES|S-IC\/S-II LARGE IS)$/), coast: 0,
              jettisons: [{ t: tJett, mass: pick(b2, /LARGE IS/), label: 'S-II aft interstage' }, { t: tJett, mass: pick(b2, /^LES$/), label: 'Launch escape system (time assumed)', assumed: true }],
              engineOut: [{ t: EV.siiCeco - tMs2, count: 1, label: 'Center engine cutoff' }] }] },
          { label: 'S-IVB', engine: 'J-2', count: 1, dry: sivbDry, remaining: sivbRem,
            note: 'Dry and remaining: Table 16-7 at second cutoff. Two burns: to the parking orbit, then translunar injection; the coast between loses vented hydrogen.',
            burns: [{ propellant: pick(b3, MAIN), shed: pick(s3a, /./) + rest(b3, /^(MAINSTAGE|ULLAGE ROCKET CASE)$/), coast: pick(c3, /./),
                      jettisons: [{ t: EV.sivbUllageCaseJettison - tMs3, mass: pick(b3, /ULLAGE ROCKET CASE/), label: 'Ullage rocket cases' }], engineOut: [] },
                    { propellant: pick(b4, MAIN), shed: pick(s4a, /./) + rest(b4, MAIN), coast: 0, jettisons: [], engineOut: [] }] },
        ],
      };
    }
    function as512Engines() { return { 'F-1': engineFromPreset('F-1'), 'J-2': engineFromPreset('J-2') }; }
    /** Inert fraction of each AS-512 stage (dropped at separation / stage mass), for scaling a new stage's dry mass. */
    function inertFractions(D) {
      var v = fromAS512(D);
      return v.stages.map(function (s) { return { label: 'AS-512 ' + s.label, value: (s.dry + s.remaining) / stageMass(s), source: D.report + ' (Tables 16-1 to 16-9)' }; });
    }
    /** Dry mass for propellant P at inert fraction f (dry / (dry + propellant), residuals counted as dry). */
    function dryForFraction(P, f) { return P * f / (1 - f); }
    /** A vehicle from simple stage specs [{label, engine, count, propellant, fraction: {label, value}}] and a payload
     * mass: one burn per stage, dry mass scaled from a real stage's inert fraction (residuals counted as dry). */
    function customVehicle(specs, payload, label) {
      return { id: 'custom', label: label || 'Custom stack', payload: { mass: payload, label: 'Payload', source: 'user input' },
        stages: specs.map(function (x, i) {
          return { label: x.label || ('Stage ' + (i + 1)), engine: x.engine, count: x.count, dry: dryForFraction(x.propellant, x.fraction.value), remaining: 0,
            note: 'Dry mass scaled from ' + x.fraction.label + '\'s inert fraction (' + fmt(100 * x.fraction.value, 4) + ' %), assumed.', fraction: x.fraction,
            burns: [{ propellant: x.propellant, shed: 0, coast: 0, jettisons: [], engineOut: [] }] };
        }) };
    }

    /**
     * Model against flight: the AS-512 stack with idea 33's F-1 and J-2 against the report's reconstruction.
     * Returns rows {group, label, model, flight, units, gap (model/flight - 1, or model - flight for 'diff'), note}.
     */
    function flightCheck(D, engines) {
      engines = engines || as512Engines();
      var veh = fromAS512(D), r = evaluate(veh, engines);
      var rows = [], F = engines['F-1'], J = engines['J-2'], X = D.engines;
      var add = function (group, label, model, flight, units, note, kind) { rows.push({ group: group, label: label, model: model, flight: flight, units: units, gap: kind === 'diff' ? model - flight : model / flight - 1, kind: kind || 'ratio', note: note || '' }); };
      var mean = function (a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; };
      var seq = function (lab) { var row = D.sequence.filter(function (x) { return x[0] === lab; })[0]; return row[1]; };
      // masses
      add('Mass', 'Liftoff (holddown release)', r.liftoff.mass, seq('1ST FLT STG AT HDAR'), 'kg', 'Sum of the stage ledgers and payload against Table 16-9.', 'diff');
      add('Mass', 'S-IC outboard cutoff', r.stages[0].burns[0].mCutoff, seq('1ST FLT STG AT OECO'), 'kg', 'Table 16-9 running total.', 'diff');
      add('Mass', 'S-II outboard cutoff', r.stages[1].burns[0].mCutoff, seq('2ND FLT STG AT COS'), 'kg', 'Table 16-9 running total.', 'diff');
      add('Mass', 'S-IVB first cutoff', r.stages[2].burns[0].mCutoff, seq('3RD FLT STG 1ST COS'), 'kg', 'Table 16-9 running total.', 'diff');
      add('Mass', 'S-IVB second cutoff', r.stages[2].burns[1].mCutoff, seq('3RD FLT STG 2ND COS'), 'kg', 'Table 16-9 running total.', 'diff');
      // engines
      add('Engine (idea 33)', 'F-1 sea-level thrust', F.thrustSL, mean(X.f1StandardSeaLevel.thrustKlbf) * 1000 * LBF, 'N', 'Table 5-2, mean of five engines reduced to standard sea level.');
      add('Engine (idea 33)', 'F-1 mass flow', F.mdot, mean(X.f1StandardSeaLevel.flowLbmS) * LBM, 'kg/s', 'Engine level (chamber plus gas generator).');
      add('Engine (idea 33)', 'F-1 sea-level Isp', F.ispSL, mean(X.f1StandardSeaLevel.ispS) * g0, 'm/s', 'Idea 33\'s lower bound (turbine exhaust giving no thrust beyond the calibration).');
      var sii = X.siiStageEsc61;
      add('Engine (idea 33)', 'J-2 vacuum thrust, S-II high-EMR phase', J.thrustVac, sii.thrustLbf / sii.engines * LBF, 'N', 'Section 6.3: stage thrust at ESC +61 s over five engines (at altitude, not vacuum).');
      add('Engine (idea 33)', 'J-2 mass flow, S-II', J.mdot, sii.flowLbmS / sii.engines * LBM, 'kg/s', 'Includes pressurization flow.');
      add('Engine (idea 33)', 'J-2 Isp, S-II', J.ispVac, sii.ispS * g0, 'm/s');
      var b1 = X.sivbFirstBurn;
      add('Engine (idea 33)', 'J-2 vacuum thrust, S-IVB', J.thrustVac, b1.thrustLbf * LBF, 'N', 'Table 7-1 at standard altitude conditions: the S-IVB ran at mixture ratio 5.0, idea 33\'s J-2 is SP-8120\'s 5.5 point.');
      add('Engine (idea 33)', 'J-2 mass flow, S-IVB', J.mdot, (b1.loxFlowLbmS + b1.fuelFlowLbmS) * LBM, 'kg/s');
      add('Engine (idea 33)', 'J-2 Isp, S-IVB', J.ispVac, b1.ispS * g0, 'm/s');
      // burn durations (mainstage clock to cutoff)
      var EV = D.events, ST = D.stageTables;
      add('Burn time', 'S-IC, holddown release to outboard cutoff', r.stages[0].burns[0].time, EV.sicOeco - ST['S-IC'].events['holddown arm release'].t, 's', 'Same propellant as flown, idea 33\'s flow, centre engine out at 139.30 s.');
      add('Burn time', 'S-II, mainstage to outboard cutoff', r.stages[1].burns[0].time, ST['S-II'].events['S-II engine cutoff'].t - ST['S-II'].events['S-II mainstage'].t, 's', 'The flight shifted to mixture ratio 4.8 at 489.2 s, cutting flow; idea 33\'s J-2 holds 5.5.');
      add('Burn time', 'S-IVB first burn, mainstage to cutoff', r.stages[2].burns[0].time, ST['S-IVB burn 1'].events['S-IVB engine cutoff'].t - ST['S-IVB burn 1'].events['S-IVB mainstage'].t, 's', 'Mixture ratio 5.0 in flight.');
      add('Burn time', 'S-IVB second burn, mainstage to cutoff', r.stages[2].burns[1].time, ST['S-IVB burn 2'].events['S-IVB engine cutoff'].t - ST['S-IVB burn 2'].events['S-IVB mainstage'].t, 's');
      // acceleration at cutoff (thrust over the cutoff mass), ambient from the 1976 atmosphere at the cutoff altitude
      var A = D.acceleration, C = D.cutoff;
      var b0 = r.stages[0].burns[0], pa = isa(C.sicOeco[1] * 1000).P_Pa;
      add('Acceleration', 'S-IC at outboard cutoff (4 engines, ' + C.sicOeco[1] + ' km)', b0.nCutoff * (F.thrustVac - pa * F.exitArea) / b0.mCutoff, A.sic[1], 'm/s^2', 'Table 4-1 maximum non-gravitational acceleration. In flight the F-1\'s thrust rose through the burn (pump inlet pressure grows with acceleration); idea 33 holds the nominal.');
      var sb = r.stages[1].burns[0], tC = EV.siiCeco - ST['S-II'].events['S-II mainstage'].t, mC = massAt(sb, tC, J.mdot);
      add('Acceleration', 'S-II just before centre cutoff (5 engines)', 5 * J.thrustVac / mC, A.sii[1], 'm/s^2', 'Mass at 461.21 s from idea 33\'s flow, so this mixes a flow and a thrust error.');
      add('Acceleration', 'S-IVB at first cutoff', r.stages[2].burns[0].accelCutoffVac, A.sivb1[1], 'm/s^2');
      add('Acceleration', 'S-IVB at second cutoff', r.stages[2].burns[1].accelCutoffVac, A.sivb2[1], 'm/s^2');
      // tanks: the propellant loaded at each stage's ignition split at the engine's mixture ratio, against the split loaded
      [['S-IC', ST['S-IC'].events['ground ignition'], F], ['S-II', ST['S-II'].events['S-II ignition'], J], ['S-IVB', ST['S-IVB burn 1'].events['S-IVB ignition'], J]].forEach(function (x) {
        var ev = x[1], lox = ev.lox[0] + ev.lox[1], fuel = ev.fuel[0] + ev.fuel[1], e = x[2], tot = lox + fuel;
        add('Tanks', x[0] + ' fuel volume at the engine\'s mixture ratio', tot / (1 + e.mixtureRatio) / e.rhoFuel, fuel / e.rhoFuel, 'm^3', 'Same loaded total (' + fmt(tot / 1000, 5) + ' t, Table ' + D.stageTables[x[0] === 'S-IVB' ? 'S-IVB burn 1' : x[0]].table + ') and density both sides: loaded oxidizer/fuel ' + fmt(lox / fuel, 4) + ' against the engine\'s ' + fmt(e.mixtureRatio, 4) + '.');
      });
      // velocity: ideal delta-v against the flight's space-fixed velocity change (the difference is losses)
      add('Velocity', 'S-II burn: ideal delta-v vs space-fixed gain', r.stages[1].dv, C.siiOeco[2] - C.sicOeco[2], 'm/s', 'Gain from S-IC to S-II cutoff (Table 4-2). The difference is gravity and steering loss over 393 s, not a model error.', 'diff');
      add('Velocity', 'S-IVB first burn: ideal vs gain', r.stages[2].burns[0].dv, C.sivb1Gcs[2] - C.siiOeco[2], 'm/s', 'Gain from S-II cutoff to S-IVB first cutoff.', 'diff');
      add('Velocity', 'S-IVB first burn at the flight\'s Isp', r.stages[2].burns[0].dv * X.sivbFirstBurn.ispS * g0 / J.ispVac, C.sivb1Gcs[2] - C.siiOeco[2], 'm/s', 'The same masses with Table 7-1\'s 427.7 s: the ledger itself against the flight, near-horizontal flight with little gravity loss.', 'diff');
      add('Velocity', 'S-IVB second burn: ideal vs gain', r.stages[2].burns[1].dv, C.sivb2Gcs[2] - D.parkingOrbit.velocity, 'm/s', 'Gain from parking-orbit insertion (Table 4-4, circular, e = 0.0000) to second cutoff; assumes the speed at second ignition equals the insertion speed.', 'diff');
      add('Velocity', 'S-IVB second burn at the flight\'s Isp', r.stages[2].burns[1].dv * X.sivbSecondBurn.ispS * g0 / J.ispVac, C.sivb2Gcs[2] - D.parkingOrbit.velocity, 'm/s', 'Table 7-2\'s 427.6 s; the difference is the gravity loss of a 351 s burn climbing out of orbit.', 'diff');
      return { rows: rows, result: r, vehicle: veh };
    }

    /** Vehicle mass at time t (s from the burn's start) within a burn, from its segments (rate n mdot each). */
    function massAt(b, t, mdot) {
      for (var i = 0; i < b.segments.length; i++) { var g = b.segments[i]; if (t <= g.t1 + 1e-9) return g.m0 - g.n * mdot * Math.max(0, t - g.t0); }
      return b.mCutoff;
    }

    // ================================================================== handoff (series schema v1)
    var KERNEL = '34-stack/stack.js';
    function q(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function engineOut(e) {
      var o = { id: e.id, label: e.label, kind: e.kind, chambers: e.chambers, propellant: e.propellant, cycle: e.cycle,
        thrust_vacuum_N: e.thrustVac, thrust_vacuum_upper_N: e.thrustVacUpper, thrust_sea_level_N: e.thrustSL, mass_flow_kg_s: e.mdot, gas_generator_flow_kg_s: e.ggFlow,
        specific_impulse_vacuum_m_s: e.ispVac, specific_impulse_vacuum_upper_m_s: e.ispVacUpper, specific_impulse_sea_level_m_s: e.ispSL,
        mixture_ratio: e.mixtureRatio, oxidizer_density_kg_m3: e.rhoOx, fuel_density_kg_m3: e.rhoFuel, exit_area_m2: e.exitArea, separation_onset_ambient_pressure_Pa: e.sepOnsetPa,
        deck_vacuum: e.deckVac, refusals: e.refusals, source: e.source };
      if (e.kind === 'preset') o.recompute = { kernel: '33-engine-deck/engine.js', engineSpec: e.id, cycleReference: CYCLE_OF[e.id] };
      else o.engine_handoff = e.handoff;
      return o;
    }
    /** The handoff module 35 (Max Q) imports. veh: the vehicle; engines: records by id; r: evaluate(veh). */
    function makeHandoff(veh, engines, r, extra) {
      extra = extra || {};
      var used = {};
      veh.stages.forEach(function (s) { used[s.engine] = engines[s.engine]; });
      var out = { handoff: 'long-way-round', version: 1, from: '34-stack', produced: extra.produced || new Date().toISOString(),
        inputs: { vehicle: clone(veh), engines: Object.keys(used).reduce(function (a, k) { a[k] = engineOut(used[k]); return a; }, {}) },
        outputs: {}, refusals: [], assumptions: [
          'Ideal delta-v: c ln(m_start/m_end) per burn segment with idea 33\'s vacuum engine-level Isp (gas-generator exhaust giving no thrust); no gravity, drag or steering loss (module 35), no thrust-vector loss.',
          'Engines at nominal throttle (idea 33\'s calibrated operating point) for the whole burn; flow and thrust do not change with time.',
          'Propellant split by the engine-level mixture ratio; volumes at idea 31\'s measured densities (liquid oxygen at its normal boiling point, RP-1 at 298 K, liquid hydrogen at its normal boiling point): propellant volume, not tank volume (no ullage, no residual geometry).',
          'Frames and time scales: none (a vehicle has no position or epoch); burn clocks start at each burn\'s mainstage.',
        ].concat(veh.id === 'AS-512' ? ['AS-512 masses are the flight report\'s reconstruction (MPR-SAT-FE-73-1, Table 16-9); the launch escape system jettison time is not in the report and is placed with the S-II aft interstage (192.9 s).'] : []).concat(veh.simplified ? ['Flight events removed: one burn per stage, jettisoned items carried to separation, no early engine cutoffs.'] : []).concat(extra.assumptions || []) };
      var O = out.outputs, src = KERNEL + ' evaluate()';
      if (!r.ok) { out.refusals = r.refusals.slice(); return out; }
      var conf = veh.id === 'AS-512' ? 'derived' : 'derived';
      O.liftoff_mass = q(r.liftoff.mass, 'kg', veh.id === 'AS-512' ? 'measured' : 'assumed', veh.id === 'AS-512' ? veh.source + ' (Table 16-9 ledger)' : 'user input (stage masses and payload)');
      O.payload_mass = q(r.payload, 'kg', veh.id === 'AS-512' ? 'measured' : 'assumed', veh.payload.source || 'user input');
      if (r.liftoff.thrust != null) { O.liftoff_thrust = q(r.liftoff.thrust, 'N', 'derived', src + ' (first stage, sea level, idea 33)'); O.liftoff_thrust_to_weight = q(r.liftoff.tw, '1', 'derived', src); }
      O.delta_v_ideal = q(r.dv, 'm/s', conf, src + ' (vacuum engine-level Isp, all burns)');
      O.delta_v_ideal_sea_level_first_stage = q(r.dvSL, 'm/s', conf, src + ' (first stage at its sea-level Isp: a lower bound)');
      O.delta_v_ideal_upper = q(r.dvUpper, 'm/s', conf, src + ' (gas-generator exhaust expanded completely: an upper bound)');
      O.burn_time_total = q(r.burnTime, 's', conf, src);
      O.payload_fraction = q(r.payloadFraction, '1', conf, src);
      O.stages = q(r.stages.map(function (s) {
        return { label: s.label, engine: s.engine, count: s.count, mass_ignition_kg: s.massIgnition, mass_burnout_kg: s.massBurnout, stage_mass_kg: s.stageMass, propellant_kg: s.propellant,
          oxidizer_kg: s.oxidizer, fuel_kg: s.fuel, oxidizer_volume_m3: s.volumeOx, fuel_volume_m3: s.volumeFuel, inert_fraction: s.inertFraction,
          delta_v_m_s: s.dv, delta_v_sea_level_m_s: s.dvSL, delta_v_upper_m_s: s.dvUpper, burn_time_s: s.burnTime,
          burns: s.burns.map(function (b) { return { propellant_kg: b.propellant, mass_ignition_kg: b.mIgnition, mass_cutoff_kg: b.mCutoff, delta_v_m_s: b.dv, time_s: b.time, engines_at_ignition: b.nIgnition, engines_at_cutoff: b.nCutoff,
            thrust_to_weight_ignition_vacuum: b.twIgnitionVac, acceleration_cutoff_vacuum_m_s2: b.accelCutoffVac,
            segments: b.segments.map(function (g) { return { t0_s: g.t0, t1_s: g.t1, mass_start_kg: g.m0, mass_end_kg: g.m1, engines: g.n }; }) }; }) };
      }), 'kg, s, m/s, m^3', conf, src + '; masses from the vehicle ledger, engines from idea 33');
      r.refusals.forEach(function (x) { out.refusals.push(x); });
      Object.keys(used).forEach(function (k) {
        var e = used[k];
        (e.refusals || []).forEach(function (x) { out.refusals.push(Object.assign({ engine: k }, x)); });
        if (e.handoff) (e.handoff.refusals || []).forEach(function (x) { if (x.applies_to === 'engine_dry_mass') out.refusals.push(Object.assign({ engine: k, from: x.from || '33-engine-deck' }, x, { reason: x.reason + ' (Here each stage\'s dry mass includes its engines: sourced for AS-512, otherwise typed or scaled.)' })); });
      });
      out.refusals.push({ applies_to: 'losses', code: 'insufficient_data', reason: 'Gravity, drag and steering losses, and so the orbit this stack reaches, are not computed here: that needs an ascent trajectory.', what_would_help: 'Module 35 (Max Q) flies this vehicle through the 1976 atmosphere.' });
      return out;
    }
    /** Read this module's own handoff back (round trip): the vehicle and its engines, engines re-built. */
    function parseHandoff(input) {
      var h = input;
      if (typeof input === 'string') { try { h = JSON.parse(input); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 33 or idea 34.') }; } }
      if (!h || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 33 or idea 34.') };
      if (h.from === '33-engine-deck') { var e = engineFromHandoff(h); return e.refusal ? e : { engine: e.record }; }
      if (h.from !== '34-stack') return engineFromHandoff(h);
      var veh = h.inputs && h.inputs.vehicle, eng = (h.inputs && h.inputs.engines) || {};
      if (!veh) return { refusal: refusal('invalid_input', 'This 34-stack handoff carries no vehicle.', 'A handoff exported by this page.') };
      var engines = {};
      for (var k in eng) {
        var x = eng[k];
        var rec = x.kind === 'preset' ? engineFromPreset(x.recompute && x.recompute.engineSpec || k) : engineFromHandoff(x.engine_handoff);
        if (rec.refusal) return { refusal: rec.refusal };
        engines[k] = rec.record || rec;
      }
      return { vehicle: veh, engines: engines };
    }

    return {
      PRESET_ENGINES: PRESET_ENGINES, CYCLE_OF: CYCLE_OF, engineFromPreset: engineFromPreset, engineFromHandoff: engineFromHandoff,
      stageMass: stageMass, stagePropellant: stagePropellant, validate: validate, evaluate: evaluate, simplify: simplify, withPayload: withPayload,
      sweepPayload: sweepPayload, solvePayload: solvePayload, fromAS512: fromAS512, as512Engines: as512Engines, inertFractions: inertFractions, dryForFraction: dryForFraction, customVehicle: customVehicle,
      flightCheck: flightCheck, massAt: massAt, makeHandoff: makeHandoff, parseHandoff: parseHandoff, g0: g0,
    };
  }

  return { create: create, LBM: LBM, LBF: LBF, FT: FT, G_STD: G_STD };
});
