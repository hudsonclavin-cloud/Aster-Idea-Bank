/* Hole Stack — the page. Everything it shows comes from HoleStack.build() over the snapshots, and the
   FLIGHT rows and OpenSCAD are checked live by PartForge's own parseFlight() and flightLint(). */
(function () {
  'use strict';
  var H = window.HoleStack, PF = window.PartForgeCode, HD = window.HoleStackData || {};
  var $ = function (id) { return document.getElementById(id); };
  var D = H.makeData(HD.fasteners_metric.json, HD.fits.json, PF);
  var last = null;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function code(t) { return el('code', { text: t }); }
  function pill(conf) { return el('span', { class: 'pill c-' + conf, text: conf }); }

  /* ---------- inputs ---------- */
  var params = (function () { try { return new URLSearchParams(window.location.search); } catch (e) { return new URLSearchParams(''); } })();
  function setRadio(name, v) { var r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; }
  function init() {
    var sizeSel = $('size');
    var want = params.get('size');
    D.keys.forEach(function (k) { sizeSel.appendChild(el('option', { value: k, text: k + ' × ' + D.rows[k].pitch_mm })); });
    if (want && !D.keys.some(function (k) { return k.toLowerCase() === want.toLowerCase(); })) sizeSel.appendChild(el('option', { value: want, text: want + ' (not in the table)' }));
    sizeSel.value = want ? (D.keys.filter(function (k) { return k.toLowerCase() === want.toLowerCase(); })[0] || want) : H.DEFAULTS.size;
    var proc = $('process');
    Object.keys(D.processes).forEach(function (k) { proc.appendChild(el('option', { value: k, text: D.processes[k].name + ' (±' + D.processes[k].tol_general_mm + ')' })); });
    proc.value = params.get('process') && D.processes[params.get('process')] ? params.get('process') : H.DEFAULTS.process;
    if (params.get('head')) setRadio('head', params.get('head'));
    if (params.get('series')) setRadio('series', params.get('series'));
    if (params.get('far')) setRadio('far', params.get('far'));
    if (params.get('washer') === '1') $('washer').checked = true;
    if (params.get('plate')) $('plate_t').value = params.get('plate');
    if (params.get('part')) $('part_t').value = params.get('part');
    if (params.get('end') === 'blind') $('tap_end').value = 'blind';
    if (params.get('drill') === 'stainless') $('drill').value = 'stainless';
    if (params.get('at') === 'drill') $('model_at').value = 'drill';
    if (params.get('tess')) $('tess').value = params.get('tess');
    $('controls').addEventListener('change', render);
    $('controls').addEventListener('input', function (e) { if (e.target && e.target.type === 'number') render(); });
    $('copyScad').addEventListener('click', function () { copy($('scad').textContent, $('copyScad'), $('scad')); });
    $('copyFlight').addEventListener('click', function () { copy($('flight').textContent, $('copyFlight'), $('flight')); });
    $('dlScad').addEventListener('click', download);
    $('commit').textContent = PF.commit.slice(0, 7);
    render();
  }
  function input() {
    var v = function (name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : undefined; };
    return { size: $('size').value, head: v('head'), washer: $('washer').checked, series: v('series'), plate_t: $('plate_t').value, far: v('far'),
      part_t: $('part_t').value, tap_end: $('tap_end').value, drill: $('drill').value, model_at: $('model_at').value, process: $('process').value, tess: $('tess').value };
  }

  /* ---------- render ---------- */
  function render() {
    var x = input();
    $('tapped-opts').hidden = x.far !== 'tapped';
    var res = H.build(x, D);
    last = res;
    var blocks = { clamp: H.flightBlock(res, 'clamp'), tapped: H.flightBlock(res, 'tapped') };
    var parsed = {};
    Object.keys(blocks).forEach(function (k) { if (blocks[k]) parsed[k] = PF.parseFlight(blocks[k]); });
    verdict(res, parsed);
    $('figure').innerHTML = res.geometry ? H.svg(res) : '<p class="empty">No section to draw: the size was refused.</p>';
    refusals(res);
    stack(res);
    checks(res);
    $('scad').textContent = res.scad || '// nothing to model: the size was refused';
    $('flight').textContent = [blocks.clamp ? '// clamped plate\n' + blocks.clamp : '', blocks.tapped ? '// tapped mating part\n' + blocks.tapped : ''].filter(Boolean).join('\n\n') || '// no rows: nothing was built';
    verify(res, parsed);
    sources(res);
  }

  function verdict(res, parsed) {
    var w = $('vword'), s = $('vsub');
    if (!res.key) { w.textContent = 'Refused'; w.className = 'ref'; s.textContent = res.refusals.map(function (q) { return q.reason; }).join(' '); return; }
    var cited = 0, def = 0, gauges = 0;
    Object.keys(parsed).forEach(function (k) { var f = parsed[k]; cited += f.provenance.dims.source; def += f.provenance.dims.default; gauges += f.gauges.length; });
    w.textContent = res.key + '×' + H.fmt(res.pitch);
    w.className = res.refusals.length ? 'part' : 'ok';
    s.textContent = res.features.filter(function (f) { return f.provenance !== 'refused'; }).length + ' feature' + (res.features.length === 1 ? '' : 's') + ' · ' + cited + ' cited row' + (cited === 1 ? '' : 's') + ' · ' + def + ' default row' + (def === 1 ? '' : 's') + ' · ' + gauges + ' gauge' + (gauges === 1 ? '' : 's') + ' · ' + res.refusals.length + ' refused';
  }

  function refusals(res) {
    var box = $('refusals'), ul = $('refList');
    ul.textContent = '';
    box.hidden = !res.refusals.length;
    res.refusals.forEach(function (q) {
      ul.appendChild(el('li', null, [el('strong', { text: q.feature }), ' ', el('span', { class: 'code-tag', text: q.code }), el('p', { text: q.reason }), el('p', { class: 'help' }, [el('em', { text: 'What would help: ' }), q.help])]));
    });
  }

  var PROV = { source: ['src', 'cited: tol_src "source"'], default: ['def', 'tol_src "default" (tool default)'], recall: ['rec', 'recall data: gauge or display only'], refused: ['ref', 'refused'] };
  function stack(res) {
    var box = $('stack');
    box.textContent = '';
    if (!res.key) { box.appendChild(el('p', { class: 'empty', text: 'Nothing to stack.' })); return; }
    res.features.forEach(function (f) {
      var p = PROV[f.provenance] || PROV.default;
      var head = el('div', { class: 'fhead' }, [el('h3', { text: f.label }), el('span', { class: 'tag ' + p[0], text: f.id === 'nut' || f.id === 'countersink' ? (f.provenance === 'refused' ? 'refused' : 'FLIGHT gauge, GO') : f.id === 'button' ? 'nothing cut' : p[1] })]);
      var main = el('p', { class: 'fmain' });
      if (f.id === 'nut' && f.band) main.textContent = H.f3(f.band.centre) + ' ±' + H.fmt(f.band.half) + ' across flats (' + H.f3(f.band.lo) + '–' + H.f3(f.band.hi) + '), ' + H.f3(f.ac) + ' across corners, ' + H.fmt(f.depth) + ' deep';
      else if (f.band) main.textContent = 'Ø' + H.f3(f.band.centre) + ' ±' + H.fmt(f.band.half) + ' (' + H.f3(f.band.lo) + '–' + H.f3(f.band.hi) + ')' + (f.depth != null && f.id !== 'tapped' ? ', ' + H.fmt(f.depth) + ' deep' : '') + (f.id === 'tapped' ? ', ' + (f.end === 'blind' ? H.fmt(f.depth) + ' deep' : 'through ' + H.fmt(f.partT)) : '');
      else if (f.id === 'clearance') main.textContent = 'Ø' + H.fmt(f.nominal) + ' — the H' + f.grade + ' band is refused, so no FLIGHT row';
      else if (f.id === 'countersink') main.textContent = 'Ø' + H.fmt(f.model) + ' at the face, ' + f.angle + '° included, ' + H.f3(f.depth) + ' deep to the clearance hole';
      else if (f.id === 'button') main.textContent = 'Head ' + H.fmt(f.headD) + ' × ' + H.fmt(f.headH) + ' stands proud of the face';
      var ul = el('ul', { class: 'fields' });
      f.fields.forEach(function (q) { ul.appendChild(el('li', null, [code(q.field), ' = ', el('strong', { text: q.value == null ? 'null' : H.fmt(q.value) }), ' ', pill(q.conf), el('span', { class: 'src-text', text: q.source })])); });
      if (f.band && f.band.it_um) {
        var fit = PF.dbFit(f.nominal, 'H', f.grade, 'h', f.grade);
        ul.appendChild(el('li', null, [code('fits.json ' + f.band.stepName + ' mm'), ' IT' + f.grade + ' = ', el('strong', { text: f.band.it_um + ' µm' }), ' ', pill(f.band.conf), el('span', { class: 'src-text', text: 'ISO 286-1 formulas, two derivations agree; PartForge\'s dbFit() gives ' + (fit ? H.f3(fit.hole[0]) + '–' + H.f3(fit.hole[1]) + (Math.abs(fit.hole[1] - f.band.hi) < 1e-9 ? ' (agrees)' : ' (DIFFERS)') : 'no answer') })]));
      }
      if (f.id === 'clearance' && !f.band) {
        var nofit = PF.dbFit(f.nominal, 'H', f.grade, 'h', f.grade);
        ul.appendChild(el('li', null, ['PartForge\'s dbFit(' + H.fmt(f.nominal) + ', H' + f.grade + ') returns ', el('strong', { text: nofit ? 'a band' : 'null' }), ' too.']));
      }
      if (f.recallShown) ul.appendChild(el('li', { class: 'shown' }, ['Shown, not used: ', code(f.recallShown.field), ' = ', el('strong', { text: H.fmt(f.recallShown.value) }), ' ', pill(f.recallShown.conf), el('span', { class: 'src-text', text: f.recallShown.source })]));
      if (f.id === 'counterbore') ul.appendChild(el('li', { class: 'rule' }, ['Minimum ', el('strong', { text: H.f3(f.band.lo) }), ' = ' + f.why + '; band + ' + (res.process ? 'FLIGHT_PROCESSES.' + res.process.key + '.tol_general_mm ' + H.fmt(res.process.tol_general_mm) : '') + ' each side of the centre.']));
      if (f.id === 'nut' && f.band) ul.appendChild(el('li', { class: 'rule' }, ['Minimum across flats ', el('strong', { text: H.fmt(f.af) }), ' (the nut at s max); centred + ' + (res.process ? 'FLIGHT_PROCESSES.' + res.process.key + '.tol_general_mm ' + H.fmt(res.process.tol_general_mm) : '') + '. The pocket\'s ' + H.f3(f.ac) + ' across corners clears the sharp ' + H.f3(f.acSharp) + '.']));
      if (f.appCheck) ul.appendChild(el('li', { class: f.appCheck.ok ? 'rule' : 'rule bad' }, ['PartForge\'s own thread check (verbatim ', code('threadCheck'), ') at the table\'s ' + H.fmt(f.appCheck.Le) + ' mm: ', el('strong', { text: f.appCheck.ok ? 'PASS' : 'FAIL' }), ' — strip needs ' + H.f3(f.appCheck.Le_req_mm) + ' mm, the ' + H.fmt(f.appCheck.rule_multiple) + '·d rule ' + H.fmt(f.appCheck.rule_mm) + ' mm. At this stack\'s ' + H.fmt(f.appCheckAtLength.Le) + ' mm: ', el('strong', { text: f.appCheckAtLength.ok ? 'PASS' : 'FAIL' }), '.']));
      if (f.id === 'tapped') ul.appendChild(el('li', { class: 'rule' }, ['Table minimum engagement (8.8 in 6061-T6) ' + H.fmt(f.Le) + ' mm + ' + D.rules.engPitches.join('–') + ' pitches = ' + H.fmt(f.need[0]) + '–' + H.fmt(f.need[1]) + ' mm; this hole: ', el('strong', { text: f.verdict })]));
      box.appendChild(el('article', { class: 'feature ' + p[0] }, [head, main, ul]));
    });
  }

  function checks(res) {
    var ul = $('checks');
    ul.textContent = '';
    $('checks-card').hidden = !res.checks.length;
    res.checks.forEach(function (c) { ul.appendChild(el('li', { class: c.level }, [el('span', { class: 'lvl', text: c.level === 'warn' ? 'Note' : 'Info' }), ' ', c.text])); });
  }

  function verify(res, parsed) {
    var p = $('verify');
    if (!res.key) { p.textContent = ''; return; }
    var parts = Object.keys(parsed).map(function (k) {
      var f = parsed[k];
      return (k === 'clamp' ? 'clamped plate' : 'tapped part') + ': ' + f.holes.length + ' hole' + (f.holes.length === 1 ? '' : 's') + ', ' + f.bores.length + ' bore' + (f.bores.length === 1 ? '' : 's') + ', ' + f.gauges.length + ' gauge' + (f.gauges.length === 1 ? '' : 's') + '; dropped ' + f.dropped + ', demoted ' + f.demoted + '; cited ' + f.provenance.dims.source + ', default ' + f.provenance.dims.default;
    });
    var lint = PF.flightLint(res.scad);
    p.textContent = 'Checked on this page by PartForge\'s own parseFlight() and flightLint(), copied verbatim from index.html at ' + PF.commit.slice(0, 7) + ': ' + (parts.length ? parts.join(' · ') : 'no rows') + ' · OpenSCAD: ' + (lint.length ? lint.join('; ') : 'flightLint clean') + '.';
    p.className = 'verify' + ((lint.length || Object.keys(parsed).some(function (k) { return parsed[k].dropped || parsed[k].demoted; })) ? ' bad' : '');
  }

  function sources(res) {
    var ul = $('sources');
    ul.textContent = '';
    var fmS = HD.fasteners_metric, fiS = HD.fits;
    ul.appendChild(el('li', null, [code(fmS.path), ' at ', code(fmS.commit.slice(0, 7)), ', sha256 ', code(fmS.sha256.slice(0, 12) + '…'), ': the exact file text' + (res.key ? ', row ' + res.key : '') + '. Field confidence is the row\'s ', code('field_confidence'), ' entry, else the row label for a field in ', code('core_fields'), ', else ', el('em', { text: 'unlabelled' }), '.']));
    var grades = []; fiS.json.rows.forEach(function (r) { Object.keys(r.it_um || {}).forEach(function (g) { if (grades.indexOf(+g) < 0) grades.push(+g); }); });
    grades.sort(function (a, b) { return a - b; });
    ul.appendChild(el('li', null, [code(fiS.path), ' at ', code(fiS.commit.slice(0, 7)), ', sha256 ', code(fiS.sha256.slice(0, 12) + '…'), ': IT widths for ' + fiS.json.rows.length + ' size steps, grades IT' + grades[0] + '–IT' + grades[grades.length - 1] + ' at most; ' + (fiS.json.disputed || []).length + ' values withheld where two derivations disagree.']));
    var R = D.rules;
    ul.appendChild(el('li', null, ['Rules read out of the table\'s own column text, never typed here: clearance grades ', el('strong', { text: 'H' + R.grade.fine + ' / H' + R.grade.medium + ' / H' + R.grade.coarse }), ' (', code('columns.clearance_*_mm'), '); counterbore ≥ knurled dk + ', el('strong', { text: H.fmt(R.cboreAllowance) }), ' (', code('columns.cbore_d_mm'), '); flush depth k + ', el('strong', { text: H.fmt(R.cboreDepthAllowance) }), ' (', code('columns.cbore_depth_flush_mm'), '); countersink ', el('strong', { text: R.cskAngle + '°' }), ' (', code('columns.csk_head_d_mm'), '); engagement + ', el('strong', { text: R.engPitches.join('–') + ' pitches' }), ' (', code('columns.min_engagement_6061T6_8_8_mm'), ').']));
    if (res.process) ul.appendChild(el('li', null, ['Default tolerance ', el('strong', { text: '±' + H.fmt(res.process.tol_general_mm) + ' mm' }), ': ', code('FLIGHT_PROCESSES.' + res.process.key + '.tol_general_mm'), ' in PartForge\'s index.html ("typical ± without a callout"; ' + res.process.src + '). A default row prints in PartForge as "tool default — accept or replace before release".']));
    ul.appendChild(el('li', null, ['PartForge code run here, verbatim from ', code('index.html'), ' at ', code(PF.commit.slice(0, 7)), ': ' + PF.CUTS.filter(function (c) { return !/\(string\)$/.test(c.what); }).map(function (c) { return 'line' + (c.a === c.b ? ' ' + c.a : 's ' + c.a + '–' + c.b) + ' (' + c.what.split(':')[0] + ')'; }).join('; ') + '.']));
    var PD = HD.provenanceDoctrine;
    if (PD) ul.appendChild(el('li', null, ['The doctrine quoted in the notes: ', code(PD.path), ' line ' + PD.doctrineLine + ', and the flight doctrine\'s "Use standard sizes" line, ', code('index.html'), ' line ' + PF.DOCTRINE.standardSizesLine + '.']));
  }

  /* ---------- copy / download ---------- */
  function copy(text, btn, pre) {
    var done = function (msg) { var t = btn.textContent; btn.textContent = msg; setTimeout(function () { btn.textContent = t === 'Copied' || t === 'Select and copy' ? 'Copy' : t; }, 1400); };
    var fallback = function () {
      try { var r = document.createRange(); r.selectNodeContents(pre); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) { /* nothing to select */ }
      done('Select and copy');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done('Copied'); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }
  function download() {
    if (!last || !last.scad) return;
    try {
      var url = URL.createObjectURL(new Blob([last.scad], { type: 'text/plain' }));
      var a = el('a', { href: url, download: 'hole_stack_' + last.id + '.scad' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { /* a browser that cannot download still shows the text above */ }
  }

  init();
})();
