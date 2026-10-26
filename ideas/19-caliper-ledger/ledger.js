/* Caliper Ledger: the pure part. Readings of a machined article, typed at the bench, against the FLIGHT
 * declaration of the .scad it was cut from. No DOM, no clock, no network.
 *
 * The declaration is read with PartForge's own parser (snapshots/partforge.js carries index.html's DECL
 * block verbatim). Sizes are compared in exact decimal arithmetic (BigInt picometres), so a reading that
 * sits exactly on a limit is inside it: 6.60 + 0.10 is 6.699999999999999 in floating point, and a naive
 * comparison would reject a 6.70 hole that the declaration accepts.
 *
 * Loads as a classic script (window.CaliperLedger, after snapshots/partforge.js) and with require().
 * Confidence labels: [Certain] arithmetic and the declaration's own numbers; [Likely] the 10:1 rule of
 * thumb (a convention, not a standard this page can cite); verdicts are only as good as what was typed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./snapshots/partforge.js'));
  else root.CaliperLedger = factory(root.PartForgeDecl);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';

  var FORMAT = 'caliper-ledger/1';
  var PM_PER_MM = 1000000000n;            // exact arithmetic unit: 1 pm = 1e-9 mm
  var MAX_MM = 10000n * PM_PER_MM;        // nothing in a rocket club's shop is 10 m across
  var MAX_TYPED_DECIMALS = 6;             // 1 nm in mm, 1 micro-inch in inches: finer than any bench instrument
  var MAX_READINGS = 50;                  // per feature; more is refused, never silently cut
  var KEEP_READINGS = 100;                // what a stored entry keeps: still more than MAX, so a refusal survives cleaning
  var MAX_CHARS = 40;                     // longer than this is not a number typed at a bench (and survives cleaning to 60)
  var INCH_PM = 25400000000n;             // 25.4 mm exactly (the 1959 international inch)

  var INSTRUMENT_TYPES = [
    ['caliper', 'Caliper'], ['micrometer', 'Micrometer'], ['bore_gauge', 'Bore gauge'],
    ['height_gauge', 'Height gauge'], ['depth_micrometer', 'Depth micrometer'], ['cmm', 'CMM'], ['other', 'Other']
  ];
  var TYPE_NAMES = {};
  INSTRUMENT_TYPES.forEach(function (t) { TYPE_NAMES[t[0]] = t[1]; });

  var RULE_OF_THUMB = 'The 10:1 rule of thumb: an instrument whose resolution (or stated accuracy, if larger) is more than a tenth of the tolerance band cannot tell a good size from a bad one near the limits. A shop convention, not a cited standard.';
  var SIMPLE_ACCEPTANCE = 'IN means every reading typed lies within nominal ± tolerance, limits included, compared with no allowance for the instrument (simple acceptance). It says nothing about readings that were not taken.';

  /* ------------------------------------------------------------------ exact decimals */

  function strip(digits, decimals) {
    // drop trailing zeros of the fraction so "6.600" and "6.6" are the same number
    while (decimals > 0 && digits.length > 1 && digits.charAt(digits.length - 1) === '0') { digits = digits.slice(0, -1); decimals--; }
    return { digits: digits, decimals: decimals };
  }
  /* A number as typed at the bench: digits with one optional decimal point or comma (some phone keypads
     only offer a comma), optional sign. No exponents, no thousands separators. */
  function parseTyped(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return { ok: false, empty: true, why: 'empty' };
    if (s.length > MAX_CHARS) return { ok: false, why: 'more than ' + MAX_CHARS + ' characters is not a size typed at a bench' };
    var m = /^([+-]?)(\d*)(?:[.,](\d*))?$/.exec(s);
    if (!m || (m[2] + (m[3] || '')) === '') return { ok: false, why: '"' + s + '" is not a number' };
    var frac = m[3] || '';
    if (frac.length > MAX_TYPED_DECIMALS) return { ok: false, why: '"' + s + '" has more than ' + MAX_TYPED_DECIMALS + ' decimals, finer than any bench instrument resolves' };
    var p = strip((m[2] || '0') + frac, frac.length);
    return { ok: true, neg: m[1] === '-', digits: p.digits, decimals: p.decimals, text: s };
  }
  /* A number from the FLIGHT JSON (a double). String() gives the shortest decimal that round-trips, which
     is the decimal the file spells for any literal of up to 15 significant digits. */
  function parseDeclared(num) {
    if (typeof num !== 'number' || !isFinite(num)) return { ok: false, why: 'not a finite number' };
    var m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(num));
    if (!m) return { ok: false, why: 'cannot read ' + String(num) };
    var frac = m[3] || '', e = m[4] ? parseInt(m[4], 10) : 0;
    var p = strip(m[2] + frac, frac.length - e);
    return { ok: true, neg: m[1] === '-', digits: p.digits, decimals: p.decimals, text: String(num) };
  }
  /* parts -> BigInt picometres. unit 'mm' or 'in'. Null when the value is not exact at 1 pm. */
  function toPm(parts, unit) {
    var n = BigInt(parts.digits), d = parts.decimals, v;
    if (unit === 'in') {
      // x in = digits * 10^-d * 25.4 mm = digits * 254 * 10^(8-d) pm
      if (d > 8) return null;
      v = n * 254n * (10n ** BigInt(8 - d));
    } else {
      if (d > 9) return null;
      v = n * (10n ** BigInt(9 - d));
    }
    return parts.neg ? -v : v;
  }
  function typedToPm(text, unit) {
    var p = parseTyped(text);
    if (!p.ok) return p;
    var pm = toPm(p, unit);
    if (pm === null) return { ok: false, why: '"' + p.text + '" cannot be held exactly' };
    return { ok: true, pm: pm, text: p.text, decimals: p.decimals };
  }
  function declaredToPm(num) {
    var p = parseDeclared(num);
    if (!p.ok) return null;
    return toPm(p, 'mm');
  }
  var absB = function (x) { return x < 0n ? -x : x; };
  var minB = function (a, b) { return a < b ? a : b; };
  var maxB = function (a, b) { return a > b ? a : b; };

  /* num/den picometres -> mm string with exactly d decimals, rounded half away from zero. */
  function fmtRatio(num, den, d) {
    var neg = (num < 0n) !== (den < 0n) && num !== 0n;
    var a = absB(num) * (10n ** BigInt(d)), b = absB(den) * PM_PER_MM;
    var q = a / b, r = a % b;
    if (r * 2n >= b) q += 1n;
    var s = q.toString();
    if (d > 0) { while (s.length < d + 1) s = '0' + s; s = s.slice(0, s.length - d) + '.' + s.slice(s.length - d); }
    return (neg && q !== 0n ? '-' : '') + s;
  }
  function fmtPm(pm, d) { return fmtRatio(pm, 1n, d); }
  /* The exact value, with at least `min` decimals and as many more as it needs (at most 9). */
  function fmtExact(pm, min) {
    var d = min == null ? 3 : min;
    while (d < 9 && pm % (10n ** BigInt(9 - d)) !== 0n) d++;
    return fmtPm(pm, d);
  }
  /* mm (pm) -> inches with 5 decimals, rounded toward `dir` ('up' | 'down' | 'near'). Used to print limits
     in inches rounded INWARD, so a person reading an inch instrument against the printed limit can never
     accept a size the millimetre band rejects. */
  function fmtInch(pm, dir) {
    // inches * 1e5 = pm * 1e5 / 25.4e9 = pm / 254000
    var den = 254000n, q = pm / den, r = pm % den;
    if (r !== 0n) {
      if (dir === 'up' && pm > 0n) q += 1n;
      else if (dir === 'near' && absB(r) * 2n >= den) q += pm > 0n ? 1n : -1n;
    }
    var s = absB(q).toString();
    while (s.length < 6) s = '0' + s;
    return (q < 0n ? '-' : '') + s.slice(0, s.length - 5) + '.' + s.slice(s.length - 5);
  }

  /* ------------------------------------------------------------------ sha256 (FIPS 180-4), synchronous, so
     the page needs no secure context and Node gets the same bytes; tested against node:crypto. */
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return Uint8Array.from(out);
  }
  function sha256Hex(input) {
    var bytes = typeof input === 'string' ? utf8(input) : input;
    var len = bytes.length, bitLen = len * 8;
    var padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(bytes); padded[len] = 0x80;
    var dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, bitLen >>> 0);
    dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Uint32Array(64);
    var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (var off = 0; off < padded.length; off += 64) {
      for (var t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4);
      for (t = 16; t < 64; t++) {
        var s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        var s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[t] + W[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }

  /* ------------------------------------------------------------------ the declaration */

  function normalise(text) { return String(text).replace(/\r\n?/g, '\n'); }
  /* The exact lines of the FLIGHT block, from the line holding FLIGHT-BEGIN to the end of the line holding
     FLIGHT-END, located with parseFlight's own pattern, line endings normalised to LF first (a CRLF checkout
     must not look like another revision). For a file with one block this is byte-for-byte what
     `sed -n '/FLIGHT-BEGIN/,/FLIGHT-END/p' part.scad` prints. */
  function flightBlockText(scad) {
    var t = normalise(scad);
    var m = /\/\/\s*FLIGHT-BEGIN\s*\n([\s\S]*?)\/\/\s*FLIGHT-END/.exec(t);
    if (!m) return null;
    var start = t.lastIndexOf('\n', m.index) + 1;
    var endNl = t.indexOf('\n', m.index + m[0].length);
    return endNl < 0 ? t.slice(start) : t.slice(start, endNl + 1);
  }
  /* PartForge's firstPartName() (index.html:7166): the PART line, or 'part'. */
  function partName(scad) {
    var m = /^\/\/\s*PART:\s*(.*)$/m.exec(String(scad));
    return m ? m[1] : 'part';
  }
  /* Hole centres of a pattern, in the axis frame's (u, v), mirroring measureHoles() (index.html:3983) and
     cmmFrame() (:3789): for axis y the v coordinate runs the other way. For labels only. */
  function holePositions(h) {
    if (h.pattern === 'circle') {
      var c = h.centre_mm || [0, 0], r = h.bc_d_mm / 2, sv = h.axis === 'y' ? -1 : 1, out = [];
      for (var i = 0; i < h.n; i++) {
        var a = (h.start_deg + i * 360 / h.n) * Math.PI / 180;
        out.push([c[0] + r * Math.cos(a), c[1] + sv * r * Math.sin(a)]);
      }
      return out;
    }
    return (h.at_mm || []).map(function (p) { return [p[0], p[1]]; });
  }
  function r3(v) { var s = (Math.round(v * 1000) / 1000).toString(); return s === '-0' ? '0' : s; }

  function provLabel(e) { return e.tol_src === 'source' ? 'cited: ' + e.tol_ref : e.tol_src === 'user' ? 'user' : 'tool default'; }

  function buildFeatures(f) {
    var out = [], seen = {};
    function ordinal(kind, name) { var k = kind + '\u0001' + name; seen[k] = seen[k] || 0; return seen[k]++; }
    function variable(kind, e, nominal, label, sense, extra) {
      var o = ordinal(kind, e.name);
      var base = { id: kind + '|' + e.name + '|' + o, kind: kind, name: e.name, ordinal: o, type: 'variable', sense: sense,
        label: label, nominal_mm: nominal, tol_mm: e.tol_mm, tol_src: e.tol_src, tol_ref: e.tol_ref || '',
        tol_label: provLabel(e), axis: e.axis, hints: [] };
      if (/tap drill/i.test(e.name)) base.hints.push('Declared at its tap-drill size. After tapping, this diameter no longer exists on the part: measure it before tapping, or note the thread-gauge result in the remarks. This ledger has no thread verdict. (Spotted by the word "tap drill" in the name.)');
      return Object.assign(base, extra || {});
    }
    f.critical.forEach(function (c) {
      out.push(variable('critical', c, c.nominal_mm, c.name + ' (' + c.module + ', ' + c.axis + ')', 'external', { module: c.module }));
    });
    f.od.forEach(function (e) {
      out.push(variable('od', e, e.d_mm, 'OD ' + e.name + ' at (' + e.at_mm.join(', ') + ') ' + e.axis + ' ' + e.from_mm + '→' + e.to_mm, 'external', { diameter: true }));
    });
    f.bores.forEach(function (e) {
      out.push(variable('bores', e, e.d_mm, 'Bore ' + e.name + ' at (' + e.at_mm.join(', ') + ') ' + e.axis + ' ' + e.from_mm + '→' + e.to_mm, 'internal', { diameter: true, pos_tol_mm: e.pos_tol_mm }));
    });
    f.holes.forEach(function (e) {
      var o = ordinal('holes', e.name), pos = holePositions(e);
      pos.forEach(function (p, i) {
        out.push({ id: 'holes|' + e.name + '|' + o + '|' + i, kind: 'holes', name: e.name, ordinal: o, type: 'variable', sense: 'internal',
          label: 'Holes ' + e.name + ' #' + (i + 1) + ' of ' + pos.length + ' at (' + r3(p[0]) + ', ' + r3(p[1]) + ') ' + e.axis,
          hole: { index: i, of: pos.length, at: [p[0], p[1]] }, nominal_mm: e.d_mm, tol_mm: e.tol_mm, tol_src: e.tol_src, tol_ref: e.tol_ref || '',
          tol_label: provLabel(e), axis: e.axis, diameter: true, pos_tol_mm: e.pos_tol_mm,
          hints: /tap drill/i.test(e.name) ? ['Declared at its tap-drill size. After tapping, this diameter no longer exists on the part: measure it before tapping, or note the thread-gauge result in the remarks. This ledger has no thread verdict. (Spotted by the word "tap drill" in the name.)'] : [] });
      });
    });
    f.revolve.forEach(function (e) {
      var o = ordinal('revolve', e.name);
      out.push({ id: 'revolve|' + e.name + '|' + o, kind: 'revolve', name: e.name, ordinal: o, type: 'profile',
        label: 'Profile ' + e.name + ': ' + e.type + ' L ' + e.L_mm + ' R ' + e.R_mm, tol_mm: e.tol_mm, tol_src: e.tol_src,
        tol_ref: e.tol_ref || '', tol_label: provLabel(e), hints: ['A profile tolerance is checked with a template or a CMM scan, not a single size: record how, and whether it conforms.'] });
    });
    f.gauges.forEach(function (g) {
      var o = ordinal('gauges', g.name);
      out.push({ id: 'gauges|' + g.name + '|' + o, kind: 'gauges', name: g.name, ordinal: o, type: 'gauge', expect: g.expect, why: g.why,
        label: 'Gauge ' + g.name + ' (' + g.module + ', must ' + (g.expect === 'interfere' ? 'be blocked' : 'clear') + ')', module: g.module, hints: [] });
    });
    out.forEach(function (x) {
      if (x.type !== 'variable') return;
      var n = declaredToPm(x.nominal_mm), t = declaredToPm(x.tol_mm);
      if (n === null || t === null) { x.refused = 'the declared nominal or tolerance has more than 9 decimals and cannot be compared exactly'; return; }
      x.nominal_pm = n; x.tol_pm = t; x.lower_pm = n - t; x.upper_pm = n + t; x.band_pm = 2n * t;
    });
    return out;
  }

  function refusal(code, reason, help) { return { ok: false, refusal: { code: code, reason: reason, what_would_help: help } }; }

  /* Read a .scad. Refuses (with what would help) when there is nothing to inspect against. */
  function loadDeclaration(scad, source) {
    if (typeof scad !== 'string' || !scad.trim()) return refusal('insufficient_data', 'No file was given.', 'Pick one of the seven templates, or paste the whole .scad of the part you machined.');
    var f = PF.parseFlight(scad);
    if (!f) return refusal('insufficient_data', 'This file has no FLIGHT block, so it declares no dimension and no tolerance to inspect the article against.', 'Open it in PartForge with flight grade on: the model writes a FLIGHT-BEGIN … FLIGHT-END block naming every critical dimension, its tolerance and where the tolerance came from. Inspect against that, not against the mesh.');
    if (f.malformed) return refusal('invalid_input', 'The FLIGHT block is not valid JSON; PartForge\'s own parser (parseFlight) rejects it the same way.', 'Fix the JSON between FLIGHT-BEGIN and FLIGHT-END (each line starts with //), or re-export the part from PartForge.');
    var feats = buildFeatures(f);
    if (!feats.length) return refusal('insufficient_data', 'The FLIGHT block declares nothing a person can measure on the article: no critical, od, bores, holes, revolve or gauges entries survived PartForge\'s parser' + (f.dropped ? ' (' + f.dropped + ' were dropped as invalid)' : '') + '.', 'Declare the interface dimensions with nominal_mm or d_mm and tol_mm, as the templates do.');
    var block = flightBlockText(scad);
    var notAssessed = [];
    var posRows = feats.filter(function (x) { return x.pos_tol_mm != null; }).length;
    if (posRows) notAssessed.push('Position (pos_tol_mm) of ' + posRows + ' bore/hole row' + (posRows > 1 ? 's' : '') + ': it needs a datum reference frame, which neither the declaration nor this ledger has. PartForge\'s own evaluation (docs/roadmap-evaluation.md, idea 29) notes the app compares a radial centre offset against it, not a Y14.5 diametral zone.');
    if (f.loads.length) notAssessed.push(f.loads.length + ' load row' + (f.loads.length > 1 ? 's' : '') + ' (' + f.loads.map(function (l) { return l.name; }).join('; ') + '): analysis, not something a caliper inspects.');
    notAssessed.push('Surface finish, thread class, flatness, roundness and every dimension the FLIGHT block does not declare.');
    var pv = f.provenance;
    return {
      ok: true, part: partName(scad), flight: f, features: feats,
      declSha256: sha256Hex(block), fileSha256: sha256Hex(normalise(scad)), blockText: block,
      source: source || { kind: 'pasted' }, counts: PF.flightCounts(f), dropped: f.dropped, demoted: f.demoted,
      provenance: { cited: pv.dims.source, user: pv.dims.user, tool_default: pv.dims.default, refs: pv.refs },
      inspect: (f.mfg && f.mfg.inspect) || [], notAssessed: notAssessed
    };
  }

  /* ------------------------------------------------------------------ instruments */

  function validateInstrument(ins) {
    var why = [];
    if (!ins || typeof ins !== 'object') return { ok: false, why: ['no instrument chosen'] };
    if (!TYPE_NAMES[ins.type]) why.push('choose what kind of instrument it is');
    var unit = ins.unit === 'in' ? 'in' : ins.unit === 'mm' ? 'mm' : null;
    if (!unit) why.push('choose mm or in');
    var res = typedToPm(ins.resolution, unit || 'mm');
    if (!res.ok) why.push(res.empty ? 'give its resolution (the smallest step it displays)' : 'resolution: ' + res.why);
    else if (res.pm <= 0n) why.push('resolution must be more than zero');
    var acc = null;
    if (ins.accuracy != null && String(ins.accuracy).trim() !== '') {
      var a = typedToPm(ins.accuracy, unit || 'mm');
      if (!a.ok) why.push('stated accuracy: ' + a.why);
      else if (a.pm < 0n) why.push('stated accuracy cannot be negative');
      else acc = a.pm;
    }
    if (why.length) return { ok: false, why: why };
    var figure = acc !== null && acc > res.pm ? acc : res.pm;
    return { ok: true, unit: unit, resolution_pm: res.pm, accuracy_pm: acc, figure_pm: figure, figure_is: figure === res.pm ? 'resolution' : 'stated accuracy' };
  }
  function instrumentLabel(ins) {
    if (!ins) return '—';
    var t = TYPE_NAMES[ins.type] || 'Instrument';
    return t + (ins.label ? ' ' + ins.label : '') + ' (' + ins.resolution + ' ' + ins.unit + (ins.accuracy ? ', ±' + ins.accuracy + ' ' + ins.unit : '') + ')';
  }

  /* ------------------------------------------------------------------ one feature */

  var STATUS = { IN: 'IN', OUT: 'OUT', UNDECIDED: 'UNDECIDED', NONE: 'NOT MEASURED' };

  function methodsFor(f) {
    return f.type === 'gauge' ? ['gauge'] : f.type === 'profile' ? ['profile'] : ['readings', 'gonogo'];
  }

  function evalReadings(f, entry, shelf, res) {
    var ins = (shelf || []).filter(function (x) { return x && x.id === entry.instrument; })[0];
    if (!ins) { res.problems.push('Choose an instrument from the shelf. A number without the instrument and its resolution is not evidence.'); }
    var v = ins ? validateInstrument(ins) : null;
    if (v && !v.ok) v.why.forEach(function (w) { res.problems.push('Instrument: ' + w + '.'); });
    var unit = v && v.ok ? v.unit : (ins && ins.unit === 'in' ? 'in' : 'mm');
    var raw = Array.isArray(entry.readings) ? entry.readings : [];
    var vals = [];
    var typed = raw.filter(function (x) { return String(x == null ? '' : x).trim() !== ''; }).length;
    if (typed > MAX_READINGS) { res.problems.push(typed + ' readings in one row: more than ' + MAX_READINGS + ' is refused rather than cut short. Split them, or keep a CMM report beside the ledger.'); return res; }
    raw.forEach(function (s, i) {
      var p = typedToPm(s, unit);
      if (p.empty) return;
      if (!p.ok) { res.problems.push('Reading ' + (i + 1) + ': ' + p.why + '.'); return; }
      if (p.pm <= 0n) { res.problems.push('Reading ' + (i + 1) + ': a size must be more than zero.'); return; }
      if (p.pm > MAX_MM) { res.problems.push('Reading ' + (i + 1) + ': more than 10 m; check the unit.'); return; }
      vals.push({ pm: p.pm, text: p.text, at: i });
    });
    if (!vals.length && !res.problems.length) res.problems.push('No readings yet.');
    if (res.problems.length) return res;
    var L = f.lower_pm, U = f.upper_pm, sum = 0n, lo = vals[0].pm, hi = vals[0].pm, worst = null, worstAt = null;
    vals.forEach(function (r) {
      sum += r.pm; lo = minB(lo, r.pm); hi = maxB(hi, r.pm);
      var m = minB(r.pm - L, U - r.pm);
      if (worst === null || m < worst) { worst = m; worstAt = r; }
    });
    var n = BigInt(vals.length);
    res.status = worst >= 0n ? STATUS.IN : STATUS.OUT;
    res.instrument = { id: ins.id, label: instrumentLabel(ins), unit: v.unit, figure_pm: v.figure_pm, figure_is: v.figure_is };
    res.stats = {
      n: vals.length, unit: unit, readings: vals.map(function (r) { return r.text; }),
      mean_mm: fmtRatio(sum, n, 4), min_mm: fmtExact(lo, 3), max_mm: fmtExact(hi, 3), range_mm: fmtExact(hi - lo, 3),
      dev_mean_mm: fmtRatio(sum - n * f.nominal_pm, n, 4), worst_margin_mm: fmtExact(worst, 3), worst_reading: worstAt.text,
      lower_mm: fmtExact(L, 3), upper_mm: fmtExact(U, 3)
    };
    res.why = res.status === STATUS.IN
      ? 'All ' + vals.length + ' reading' + (vals.length > 1 ? 's lie' : ' lies') + ' within ' + fmtExact(L, 3) + ' … ' + fmtExact(U, 3) + ' mm (limits included).'
      : 'Reading ' + worstAt.text + ' ' + unit + ' is ' + fmtExact(-worst, 3) + ' mm outside the band ' + fmtExact(L, 3) + ' … ' + fmtExact(U, 3) + ' mm.';
    var figure = v.figure_pm;
    if (figure * 10n > f.band_pm) {
      res.flags.push({ code: 'discrimination', text: 'The instrument\'s ' + v.figure_is + ' (' + fmtExact(figure, 3) + ' mm) is more than a tenth of the ' + fmtExact(f.band_pm, 3) + ' mm tolerance band: by the 10:1 rule of thumb it cannot discriminate this tolerance.' });
    }
    var near = vals.filter(function (r) { return absB(r.pm - L) <= figure || absB(r.pm - U) <= figure; });
    if (near.length) res.flags.push({ code: 'near_limit', text: near.length + ' reading' + (near.length > 1 ? 's lie' : ' lies') + ' within the instrument\'s ' + v.figure_is + ' (' + fmtExact(figure, 3) + ' mm) of a limit: a better instrument could reverse this verdict.' });
    var off = vals.filter(function (r) { return r.pm % v.resolution_pm !== 0n; });
    if (off.length) res.flags.push({ code: 'off_step', text: 'Reading' + (off.length > 1 ? 's ' : ' ') + off.map(function (r) { return r.text; }).join(', ') + (off.length > 1 ? ' are not steps' : ' is not a step') + ' of the stated resolution ' + ins.resolution + ' ' + unit + ': check the resolution or the reading.' });
    return res;
  }

  /* GO/NO-GO members. A pin or plug of size s that enters a hole proves D >= s; one that stops proves D <= s.
     A ring or snap gauge that passes over a shaft proves D <= s; one that stops proves D >= s. The verdict is
     IN only if what the members prove lies wholly inside the band. */
  function evalGoNoGo(f, entry, res) {
    var unit = entry.unit === 'in' ? 'in' : 'mm';
    var members = [];
    [['go', 'GO'], ['nogo', 'NO-GO']].forEach(function (k) {
      var size = entry[k[0]], result = entry[k[0] + '_result'];
      var hasSize = size != null && String(size).trim() !== '', hasRes = result === 'pass' || result === 'stop';
      if (!hasSize && !hasRes) return;
      if (!hasSize) { res.problems.push(k[1] + ': give the gauge size.'); return; }
      if (!hasRes) { res.problems.push(k[1] + ': say whether it went ' + (f.sense === 'internal' ? 'in' : 'over') + ' or stopped.'); return; }
      var p = typedToPm(size, unit);
      if (!p.ok) { res.problems.push(k[1] + ' size: ' + p.why + '.'); return; }
      if (p.pm <= 0n) { res.problems.push(k[1] + ' size must be more than zero.'); return; }
      members.push({ name: k[1], pm: p.pm, text: p.text, result: result });
    });
    if (!members.length && !res.problems.length) res.problems.push('No gauge results yet.');
    if (res.problems.length) return res;
    var lo = null, hi = null, why = [];
    members.forEach(function (m) {
      var atLeast = f.sense === 'internal' ? m.result === 'pass' : m.result === 'stop';
      if (atLeast) lo = lo === null ? m.pm : maxB(lo, m.pm); else hi = hi === null ? m.pm : minB(hi, m.pm);
    });
    if (lo !== null && hi !== null && lo > hi) {
      res.problems.push('The results contradict each other: they say the size is at least ' + fmtExact(lo, 3) + ' and at most ' + fmtExact(hi, 3) + ' mm. Check which member is which.');
      return res;
    }
    var L = f.lower_pm, U = f.upper_pm;
    res.stats = { unit: unit, members: members.map(function (m) { return { name: m.name, size: m.text, result: m.result }; }),
      proven_min_mm: lo === null ? null : fmtExact(lo, 3), proven_max_mm: hi === null ? null : fmtExact(hi, 3),
      lower_mm: fmtExact(L, 3), upper_mm: fmtExact(U, 3) };
    var proven = 'The gauges prove ' + (lo === null && hi === null ? 'nothing' : (lo !== null ? fmtExact(lo, 3) : '?') + ' ≤ size ≤ ' + (hi !== null ? fmtExact(hi, 3) : '?') + ' mm') + '; the band is ' + fmtExact(L, 3) + ' … ' + fmtExact(U, 3) + ' mm.';
    if ((hi !== null && hi <= L) || (lo !== null && lo >= U)) { res.status = STATUS.OUT; res.why = proven + ' The size is outside it.'; return res; }
    if (lo !== null && hi !== null && lo >= L && hi <= U) { res.status = STATUS.IN; res.why = proven + ' Wholly inside.'; return res; }
    if (lo === null) why.push('nothing here proves the size is at least the lower limit ' + fmtExact(L, 3));
    else if (lo < L) why.push('the member that proves "at least ' + fmtExact(lo, 3) + '" is ' + fmtExact(L - lo, 3) + ' mm below the lower limit ' + fmtExact(L, 3) + ': a size between them passes it but is outside the band');
    if (hi === null) why.push('nothing here proves the size is at most the upper limit ' + fmtExact(U, 3));
    else if (hi > U) why.push('the member that proves "at most ' + fmtExact(hi, 3) + '" is ' + fmtExact(hi - U, 3) + ' mm above the upper limit ' + fmtExact(U, 3) + ': a size between them passes it but is outside the band');
    res.status = STATUS.UNDECIDED;
    res.why = proven + ' Undecided: ' + why.join('; ') + '.';
    return res;
  }

  function evaluate(f, entry, shelf) {
    var res = { id: f.id, status: STATUS.NONE, why: '', problems: [], flags: [], stats: null, instrument: null };
    if (f.refused) { res.problems.push(f.refused); res.why = f.refused; return res; }
    if (!entry || !entry.method) { res.why = 'Not measured yet.'; res.problems.push('No entry yet.'); return res; }
    if (methodsFor(f).indexOf(entry.method) < 0) { res.problems.push('Method "' + entry.method + '" does not apply to a ' + f.type + ' row.'); res.why = res.problems[0]; return res; }
    if (entry.method === 'readings') evalReadings(f, entry, shelf, res);
    else if (entry.method === 'gonogo') evalGoNoGo(f, entry, res);
    else {
      var how = String(entry.how || '').trim(), obs = entry.observed;
      if (!how) res.problems.push('Say what was used (the physical gauge, template or method). An observation without it is not evidence.');
      var choices = f.type === 'gauge' ? ['clear', 'blocked'] : ['conforms', 'deviates'];
      if (choices.indexOf(obs) < 0) res.problems.push('Record what happened: ' + choices.join(' or ') + '.');
      if (!res.problems.length) {
        var good = f.type === 'gauge' ? (f.expect === 'interfere' ? 'blocked' : 'clear') : 'conforms';
        res.status = obs === good ? STATUS.IN : STATUS.OUT;
        res.stats = { how: how, observed: obs, expected: good };
        res.why = f.type === 'gauge'
          ? 'The declaration requires this gauge to ' + (good === 'clear' ? 'clear' : 'be blocked') + (f.why ? ' (' + f.why + ')' : '') + '; ' + how + ' was ' + obs + '.'
          : 'Checked with ' + how + ': ' + obs + '.';
      }
    }
    if (res.problems.length && res.status === STATUS.NONE) res.why = res.problems.join(' ');
    return res;
  }

  /* ------------------------------------------------------------------ the part */

  function validDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  function evaluateAll(decl, state) {
    var shelf = (state && state.shelf) || [], entries = (state && state.entries) || {};
    return decl.features.map(function (f) { return evaluate(f, entries[f.id], shelf); });
  }

  function partStatus(decl, evals, meta) {
    var counts = { IN: 0, OUT: 0, UNDECIDED: 0, 'NOT MEASURED': 0 };
    evals.forEach(function (e) { counts[e.status]++; });
    var missing = [];
    if (!meta || !String(meta.operator || '').trim()) missing.push('operator');
    if (!meta || !validDate(meta.date)) missing.push('inspection date');
    var total = evals.length, verdict, line;
    if (counts.OUT) {
      verdict = 'NONCONFORMING';
      line = counts.OUT + ' of ' + total + ' feature' + (total > 1 ? 's' : '') + ' OUT' + (counts['NOT MEASURED'] ? '; ' + counts['NOT MEASURED'] + ' not measured yet' : '') + '.';
    } else if (counts['NOT MEASURED'] || missing.length) {
      verdict = 'INCOMPLETE';
      var bits = [];
      if (counts['NOT MEASURED']) bits.push(counts['NOT MEASURED'] + ' of ' + total + ' features not measured');
      if (missing.length) bits.push(missing.join(' and ') + ' not recorded');
      line = bits.join('; ') + '.';
    } else if (counts.UNDECIDED) {
      verdict = 'UNDECIDED';
      line = counts.UNDECIDED + ' feature' + (counts.UNDECIDED > 1 ? 's were' : ' was') + ' gauged with members that do not bound the band; none is OUT.';
    } else {
      verdict = 'ALL IN';
      line = 'All ' + total + ' declared features have entries and every one is IN.';
    }
    var caveats = [SIMPLE_ACCEPTANCE];
    var pv = decl.provenance;
    if (pv.tool_default) caveats.push(pv.tool_default + ' of ' + (pv.cited + pv.user + pv.tool_default) + ' tolerances were proposed by the tool (tol_src default), not set by an engineer or cited: IN against them is IN against a starting point nobody has stood behind yet.');
    var flagged = evals.filter(function (e) { return e.flags.some(function (x) { return x.code === 'discrimination'; }); }).length;
    if (flagged) caveats.push(flagged + ' feature' + (flagged > 1 ? 's were' : ' was') + ' measured with an instrument too coarse for its tolerance by the 10:1 rule of thumb.');
    return { verdict: verdict, line: line, counts: counts, total: total, missing: missing, caveats: caveats, notAssessed: decl.notAssessed };
  }

  /* ------------------------------------------------------------------ "as modelled": a PartForge report */

  var KINDS = ['critical', 'od', 'bores', 'holes', 'revolve', 'gauges'];
  var round4 = function (v) { return typeof v === 'number' && isFinite(v) ? (Math.round(v * 1e4) / 1e4 || 0) : v; };

  /* Accepts what PartForge writes: the browser's "Measurement report (.json)" (measurementReport(),
     index.html:6816: { app:'PartForge', part, measurements: lastGate.flightRows, ... }), the envelope
     `cli.mjs check` prints ({ tool:'check', value:{ part, flight:{ measurements:[rows] } } }), or its value.
     Browser flightRows go through PartForge's own measurementRows() (headless/partforge.mjs:97), so both
     shapes are compared row for row. Never touches the readings. */
  function importReport(input, decl) {
    var obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { return refusal('invalid_input', 'That is not JSON.', 'Use the file PartForge saves from ⋯ → Measurement report (.json), or the output of `node headless/cli.mjs check part.scad`.'); }
    }
    if (!obj || typeof obj !== 'object') return refusal('invalid_input', 'That is not a measurement report.', 'Use PartForge\'s measurement report (.json) or the JSON `cli.mjs check` prints.');
    if (Array.isArray(obj)) return refusal('wrong_part', 'A bare list of rows names no part, so it cannot be bound to this declaration.', 'Import the whole report: it carries the part name from the PART line.');
    var part, rows, shape;
    if (obj.tool === 'check' && 'value' in obj) {
      if (obj.refusal) return refusal('insufficient_data', 'The report is itself a refusal: ' + (obj.refusal.reason || obj.summary || 'no reason given') + '.', 'Run the check again until it measures the part.');
      shape = 'cli.mjs check envelope'; part = obj.value && obj.value.part; rows = obj.value && obj.value.flight ? obj.value.flight.measurements : null;
    } else if (obj.flight && typeof obj.flight === 'object' && 'measurements' in obj.flight) {
      shape = 'cli.mjs check value'; part = obj.part; rows = obj.flight.measurements;
    } else if (obj.app === 'PartForge' && 'measurements' in obj) {
      shape = 'browser measurement report'; part = obj.part; rows = obj.measurements;
    } else return refusal('invalid_input', 'This JSON is not a PartForge measurement report (no `measurements`).', 'Use PartForge\'s measurement report (.json) or the JSON `cli.mjs check` prints.');
    if (rows && !Array.isArray(rows) && typeof rows === 'object') rows = PF.measurementRows(rows);   // lastGate.flightRows, or `detail: 'full'`
    if (!Array.isArray(rows)) return refusal('insufficient_data', 'The report carries no flight measurements (made in hobby grade, or from a file with no FLIGHT block).', 'Measure the part in flight grade, then save the report again.');
    if (typeof part !== 'string' || part !== decl.part) return refusal('wrong_part', 'The report is for "' + part + '"; this declaration\'s PART line says "' + decl.part + '".', 'Import the report made from this .scad, or load the .scad the report came from.');
    var groups = {};
    rows.forEach(function (r) {
      if (!r || KINDS.indexOf(r.kind) < 0) return;               // loads are analysis rows, not features
      var k = r.kind + '\u0001' + r.name; (groups[k] = groups[k] || []).push(r);
    });
    var modelled = {}, problems = [], used = {};
    var declared = {}, missingSeen = {};
    decl.features.forEach(function (f) {
      var key = f.kind + '\u0001' + f.name;
      var row = (groups[key] || [])[f.ordinal];
      var gk = key + '\u0001' + f.ordinal;
      if (declared[gk]) { attach(f, declared[gk]); return; }
      if (!row) {
        if (!missingSeen[gk]) problems.push('no row for ' + f.kind + ' "' + f.name + '"' + (f.ordinal ? ' (#' + (f.ordinal + 1) + ')' : ''));
        missingSeen[gk] = true; return;
      }
      used[gk] = true; declared[gk] = row;
      if (f.type === 'variable') {
        if (round4(row.nominal_mm) !== round4(f.nominal_mm)) problems.push(f.kind + ' "' + f.name + '": nominal ' + row.nominal_mm + ' in the report, ' + f.nominal_mm + ' in this declaration');
        if (round4(row.tol_mm) !== round4(f.tol_mm)) problems.push(f.kind + ' "' + f.name + '": tolerance ±' + row.tol_mm + ' in the report, ±' + f.tol_mm + ' here');
        if (f.kind === 'holes' && (!Array.isArray(row.measured_mm) || row.measured_mm.length !== f.hole.of)) problems.push('holes "' + f.name + '": ' + (Array.isArray(row.measured_mm) ? row.measured_mm.length : 'no') + ' holes in the report, ' + f.hole.of + ' declared');
      }
      attach(f, row);
    });
    function attach(f, row) {
      var m = { ok: !!row.ok };
      if (f.kind === 'holes') {
        var arr = Array.isArray(row.measured_mm) ? row.measured_mm : [];
        m.measured_mm = typeof arr[f.hole.index] === 'number' ? arr[f.hole.index] : null;
        m.present = Array.isArray(row.present) ? row.present[f.hole.index] !== false : true;
      } else if (f.type === 'gauge') { m.note = row.note || null; }
      else { m.measured_mm = typeof row.measured_mm === 'number' ? row.measured_mm : null; if (row.present === false) m.present = false; }
      modelled[f.id] = m;
    }
    Object.keys(groups).forEach(function (k) {
      groups[k].forEach(function (r, i) { if (!used[k + '\u0001' + i]) problems.push('the report has ' + r.kind + ' "' + r.name + '"' + (i ? ' (#' + (i + 1) + ')' : '') + ', which this declaration does not'); });
    });
    if (problems.length) return refusal('wrong_revision', 'The report and this declaration do not describe the same features: ' + problems.slice(0, 6).join('; ') + (problems.length > 6 ? '; and ' + (problems.length - 6) + ' more' : '') + '.', 'Import the report made from exactly this revision of the .scad.');
    var fails = obj.tool === 'check' ? (obj.value && obj.value.fails) : obj.fails;
    return { ok: true, modelled: modelled, from: { shape: shape, part: part, rows: rows.length, model_fails: Array.isArray(fails) ? fails.length : null } };
  }

  function modelledText(f, m) {
    if (!m) return '—';
    if (f.type === 'gauge') return (m.note || (m.ok ? 'holds' : 'does not hold')) + (m.ok ? '' : ' (model does not match its own declaration)');
    if (m.present === false) return 'absent in the model';
    if (m.measured_mm == null) return m.ok ? 'holds' : 'does not hold';
    return m.measured_mm.toFixed(3) + (m.ok ? '' : ' (model does not match its own declaration)');
  }

  /* ------------------------------------------------------------------ the record */

  function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    var s = function (v) { return v == null ? '' : String(v).slice(0, 120); };
    var r = function (v) { return v == null ? '' : String(v).slice(0, MAX_CHARS + 20); };
    if (e.method === 'readings') return { method: 'readings', instrument: s(e.instrument), readings: (Array.isArray(e.readings) ? e.readings : []).slice(0, KEEP_READINGS).map(r) };
    if (e.method === 'gonogo') return { method: 'gonogo', unit: e.unit === 'in' ? 'in' : 'mm', go: r(e.go), go_result: e.go_result === 'pass' || e.go_result === 'stop' ? e.go_result : '', nogo: r(e.nogo), nogo_result: e.nogo_result === 'pass' || e.nogo_result === 'stop' ? e.nogo_result : '', gauge_id: s(e.gauge_id) };
    if (e.method === 'gauge' || e.method === 'profile') return { method: e.method, how: s(e.how), observed: s(e.observed) };
    return null;
  }
  function cleanInstrument(i) {
    if (!i || typeof i !== 'object') return null;
    var s = function (v) { return v == null ? '' : String(v).slice(0, 80); };
    var r = function (v) { return v == null ? '' : String(v).slice(0, MAX_CHARS + 20); };
    return { id: s(i.id), type: TYPE_NAMES[i.type] ? i.type : 'other', label: s(i.label), unit: i.unit === 'in' ? 'in' : 'mm', resolution: r(i.resolution), accuracy: r(i.accuracy) };
  }

  /* The as-built record: everything typed, everything computed, bound to the FLIGHT block by its sha256. */
  function exportLedger(decl, state) {
    state = state || {};
    var meta = state.meta || {};
    var shelf = (state.shelf || []).map(cleanInstrument).filter(Boolean);
    var evals = evaluateAll(decl, { shelf: shelf, entries: state.entries || {} });
    var st = partStatus(decl, evals, meta);
    var modelled = state.modelled || null;
    return {
      format: FORMAT,
      what: 'Readings of the physical article, typed by the operator, against the FLIGHT declaration of the .scad it was made from. Made with Caliper Ledger, an Aster Idea Bank prototype (no. 19); not a PartForge document.',
      part: decl.part,
      declaration_sha256: decl.declSha256,
      file_sha256: decl.fileSha256,
      source: decl.source,
      operator: String(meta.operator || ''),
      date: String(meta.date || ''),
      remarks: String(meta.remarks || ''),
      status: { verdict: st.verdict, line: st.line, counts: st.counts, missing: st.missing },
      rule: SIMPLE_ACCEPTANCE,
      rule_of_thumb: RULE_OF_THUMB,
      instruments: shelf,
      rows: decl.features.map(function (f, i) {
        var e = evals[i];
        var row = { id: f.id, kind: f.kind, name: f.name, label: f.label };
        if (f.hole) row.hole = { index: f.hole.index, of: f.hole.of };
        if (f.type === 'variable' && !f.refused) { row.nominal_mm = fmtExact(f.nominal_pm, 3); row.tol_mm = fmtExact(f.tol_pm, 3); row.lower_mm = fmtExact(f.lower_pm, 3); row.upper_mm = fmtExact(f.upper_pm, 3); }
        if (f.type === 'gauge') row.expect = f.expect;
        if (f.tol_label) row.tol_from = f.tol_label;
        row.entry = cleanEntry((state.entries || {})[f.id]);
        row.verdict = e.status; row.why = e.why;
        if (e.flags.length) row.flags = e.flags.map(function (x) { return { code: x.code, text: x.text }; });
        if (e.stats) row.stats = e.stats;
        if (modelled && modelled[f.id]) row.as_modelled = modelled[f.id];
        return row;
      }),
      as_modelled_from: state.modelledFrom || null,
      not_assessed: decl.notAssessed
    };
  }

  /* Resume from an exported record. Refuses one made against any other FLIGHT block. */
  function importLedger(input, decl) {
    var obj = input;
    if (typeof input === 'string') { try { obj = JSON.parse(input); } catch (e) { return refusal('invalid_input', 'That is not JSON.', 'Use a file this page exported (as-built .json).'); } }
    if (!obj || obj.format !== FORMAT) return refusal('invalid_input', 'That is not a Caliper Ledger record (format ' + FORMAT + ').', 'Use a file this page exported (as-built .json).');
    if (obj.declaration_sha256 !== decl.declSha256) return refusal('wrong_revision', 'This record was taken against a different FLIGHT block (sha256 ' + String(obj.declaration_sha256).slice(0, 12) + '…; this declaration is ' + decl.declSha256.slice(0, 12) + '…). Its readings may not mean what this declaration says.', 'Load the exact .scad revision the record names, or start a new ledger for this one.');
    if (obj.part !== decl.part) return refusal('wrong_part', 'The record is for "' + obj.part + '"; this file is "' + decl.part + '".', 'Load the .scad the record names.');
    var ids = {}; decl.features.forEach(function (f) { ids[f.id] = true; });
    var entries = {}, modelled = null;
    (obj.rows || []).forEach(function (r) {
      if (!r || !ids[r.id]) return;
      var e = cleanEntry(r.entry); if (e) entries[r.id] = e;
      if (r.as_modelled) { modelled = modelled || {}; modelled[r.id] = r.as_modelled; }
    });
    return { ok: true, state: { shelf: (obj.instruments || []).map(cleanInstrument).filter(Boolean), entries: entries,
      meta: { operator: String(obj.operator || ''), date: String(obj.date || ''), remarks: String(obj.remarks || '') },
      modelled: modelled, modelledFrom: obj.as_modelled_from || null } };
  }

  function inchOf(mm) { return (mm / 25.4).toFixed(4); }   // the ICD's own inch() (index.html:6589), for the nominal column

  function articleCell(e) {
    var s = e.stats;
    if (e.status === STATUS.NONE) return 'not measured';
    if (s && s.readings) return e.status + ' · ' + s.min_mm + (s.n > 1 ? '–' + s.max_mm : '') + ' mm (n=' + s.n + ', ' + e.instrument.label + ')' + (e.flags.length ? ' · ' + e.flags.map(function (x) { return x.code.replace('_', ' '); }).join(', ') : '');
    if (s && s.members) return e.status + ' · ' + s.members.map(function (m) { return m.name + ' ' + m.size + ' ' + s.unit + ' ' + (m.result === 'pass' ? 'passed' : 'stopped'); }).join(', ');
    if (s && s.how) return e.status + ' · ' + s.how + ': ' + s.observed;
    return e.status;
  }

  /* Markdown in the ICD's column order (icdSheet(), index.html:6768), the last column filled. */
  function toMarkdown(decl, state) {
    var rec = exportLedger(decl, state);
    var evals = evaluateAll(decl, { shelf: rec.instruments, entries: state.entries || {} });
    var safe = PF.mdSafe;
    var L = [];
    L.push('# ' + safe(decl.part) + ' — as-built inspection ledger');
    L.push('');
    L.push('Declaration: FLIGHT block sha256 `' + decl.declSha256 + '` · file sha256 `' + decl.fileSha256 + '` · ' + (decl.source.kind === 'template' ? '`' + decl.source.file + '` at PartForge ' + String(decl.source.commit).slice(0, 7) : 'pasted file') + '.');
    L.push('');
    L.push('Inspected by ' + (rec.operator.trim() ? '**' + safe(rec.operator) + '**' : '*(operator not recorded)*') + ' on ' + (validDate(rec.date) ? rec.date : '*(date not recorded)*') + '. Status: **' + rec.status.verdict + '** — ' + safe(rec.status.line));
    if (rec.remarks.trim()) { L.push(''); L.push('Remarks: ' + safe(rec.remarks)); }
    L.push('');
    L.push('> ' + SIMPLE_ACCEPTANCE + ' Readings are as typed; this record has not checked any instrument\'s calibration.');
    L.push('');
    L.push('| Interface | Nominal (mm) | Nominal (in) | Tol (mm) | Tolerance from | As modelled | Verified on the article |');
    L.push('|---|---|---|---|---|---|---|');
    decl.features.forEach(function (f, i) {
      var e = evals[i], m = state.modelled && state.modelled[f.id];
      var nom = f.type === 'variable' ? (f.diameter ? 'Ø' : '') + (+f.nominal_mm).toFixed(3) : '—';
      var inch = f.type === 'variable' ? (f.diameter ? 'Ø' : '') + inchOf(f.nominal_mm) : '—';
      var tol = f.type === 'gauge' ? '—' : '±' + f.tol_mm;
      var from = f.type === 'gauge' ? '—' : (f.tol_src === 'source' ? 'cited: ' + f.tol_ref : f.tol_src === 'user' ? 'user' : '**tool default**');
      L.push('| ' + [f.label, nom, inch, tol, from, safe(modelledText(f, m)), safe(articleCell(e))].join(' | ') + ' |');
    });
    L.push('');
    L.push('## Readings');
    L.push('| Interface | Method | Readings (as typed) | Mean (mm) | Range (mm) | Worst margin (mm) | Notes |');
    L.push('|---|---|---|---|---|---|---|');
    decl.features.forEach(function (f, i) {
      var e = evals[i], s = e.stats, en = (state.entries || {})[f.id];
      if (e.status === STATUS.NONE) { L.push('| ' + f.label + ' | — | — | — | — | — | ' + safe(e.why) + ' |'); return; }
      if (s.readings) L.push('| ' + f.label + ' | ' + safe(e.instrument.label) + ' | ' + s.readings.join(', ') + ' ' + s.unit + ' | ' + s.mean_mm + ' | ' + s.range_mm + ' | ' + s.worst_margin_mm + ' | ' + safe(e.flags.map(function (x) { return x.text; }).join(' ')) + ' |');
      else if (s.members) L.push('| ' + f.label + ' | GO/NO-GO' + (en && en.gauge_id ? ' ' + safe(en.gauge_id) : '') + ' | ' + s.members.map(function (m) { return m.name + ' ' + m.size + ' ' + (m.result === 'pass' ? 'passed' : 'stopped'); }).join(', ') + ' ' + s.unit + ' | — | — | — | ' + safe(e.why) + ' |');
      else L.push('| ' + f.label + ' | ' + safe(s.how) + ' | ' + s.observed + ' | — | — | — | ' + safe(e.why) + ' |');
    });
    L.push('');
    L.push('## Not assessed by this ledger');
    decl.notAssessed.forEach(function (x) { L.push('- ' + safe(x)); });
    L.push('');
    if (decl.inspect.length) { L.push('## Inspection plan (from the declaration)'); decl.inspect.forEach(function (x) { L.push('- ' + x); }); L.push(''); }
    L.push('## Caveats');
    partStatus(decl, evals, rec).caveats.forEach(function (x) { L.push('- ' + safe(x)); });
    L.push('');
    L.push('---');
    L.push('*' + RULE_OF_THUMB + ' Made with Caliper Ledger, an Aster Idea Bank prototype; not a PartForge document and not a first-article inspection report.*');
    return L.join('\n') + '\n';
  }

  return {
    FORMAT: FORMAT, INSTRUMENT_TYPES: INSTRUMENT_TYPES, RULE_OF_THUMB: RULE_OF_THUMB, SIMPLE_ACCEPTANCE: SIMPLE_ACCEPTANCE, STATUS: STATUS,
    parseTyped: parseTyped, typedToPm: typedToPm, declaredToPm: declaredToPm, fmtExact: fmtExact, fmtRatio: fmtRatio, fmtInch: fmtInch,
    sha256Hex: sha256Hex, flightBlockText: flightBlockText, partName: partName, holePositions: holePositions,
    loadDeclaration: loadDeclaration, buildFeatures: buildFeatures, validateInstrument: validateInstrument, instrumentLabel: instrumentLabel,
    methodsFor: methodsFor, evaluate: evaluate, evaluateAll: evaluateAll, partStatus: partStatus, validDate: validDate,
    importReport: importReport, modelledText: modelledText, exportLedger: exportLedger, importLedger: importLedger, toMarkdown: toMarkdown,
    cleanEntry: cleanEntry, cleanInstrument: cleanInstrument, PartForge: PF
  };
});
