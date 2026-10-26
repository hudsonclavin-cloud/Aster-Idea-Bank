/* app.js: renders the saved Rule One report in page-data.js. No network, no storage,
 * no computation of its own beyond filtering: every number on this page comes from
 * one run of lint_canon.py and is shown as that run wrote it. */
(function () {
  'use strict';
  var D = window.RULE_ONE_DATA;
  var CLASSES = ['NEW', 'KNOWN OPEN', 'ACCEPTED', 'LABELLED'];
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function cls(c) { return c.replace(' ', '_'); }
  function fmtCanon(list) {
    if (!list || !list.length) return '';
    var first = list[0];
    var v = Array.isArray(first.value) ? first.value.join(', ') : String(first.value);
    var s = first.key + ' = ' + v;
    if (list.length > 1) s += '; also allowed: ' + list.slice(1).map(function (x) { return String(x.value); }).join(', ');
    return s;
  }

  if (!D) {
    $('meta').textContent = 'page-data.js did not load. Run: python3 lint_canon.py <checkout> --emit-page-data page-data.js';
    return;
  }
  var m = D.meta;

  // Header line: what was scanned, at which commit, against which canon bytes.
  $('meta').innerHTML = '';
  $('meta').appendChild(el('span', null, [
    'Report of ', el('b', { text: m.scanned }), ' at ', el('b', { text: (m.commit || 'unknown').slice(0, 7) }),
    m.dirty ? ' (dirty)' : '', ' · ' + m.files_scanned + ' files · canon ', el('b', { text: m.canon_path }),
    ' (' + m.revision + ', verified ' + m.last_verified + ', ' + m.verification_memo + ') sha256 ' + m.canon_sha256.slice(0, 16) + '… · allow-list ' +
    m.deviations_rows + ' rows · generated ' + m.generated + ' · exit ' + (D.counts.NEW ? 1 : 0)
  ]));

  // Tiles.
  var active = 'ALL';
  var tiles = $('tiles');
  var tileDefs = [['ALL', D.findings.length, 'all']].concat(CLASSES.map(function (c) { return [c, D.counts[c] || 0, c.toLowerCase().replace(' ', '')]; }));
  tileDefs.forEach(function (t) {
    var b = el('button', { type: 'button', class: 'tile ' + (t[2] === 'knownopen' ? 'open' : t[2]), 'data-cls': t[0], 'aria-pressed': String(t[0] === active) }, [
      el('span', { class: 'n', text: String(t[1]) }), el('span', { class: 'l', text: t[0] === 'ALL' ? 'all findings' : t[0] })]);
    b.addEventListener('click', function () { active = t[0]; render(); });
    tiles.appendChild(b);
  });

  function render() {
    tiles.querySelectorAll('.tile').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-cls') === active)); });
    var q = ($('q').value || '').trim().toLowerCase();
    var list = $('findings');
    list.innerHTML = '';
    var shown = 0;
    D.findings.forEach(function (f) {
      if (active !== 'ALL' && f.cls !== active) return;
      var hay = (f.path + ' ' + f.rule + ' ' + f.what + ' ' + f.found + ' ' + f.context + ' ' + fmtCanon(f.canon)).toLowerCase();
      if (q && hay.indexOf(q) < 0) return;
      shown++;
      var head = el('div', null, [
        el('span', { class: 'badge ' + cls(f.cls), text: f.cls }),
        el('span', { class: 'loc', text: f.path + ':' + f.line }),
        f.deviation ? el('span', { class: 'what', text: '  DEVIATIONS #' + f.deviation.no }) : null
      ]);
      var li = el('li', { class: 'finding ' + cls(f.cls) }, [
        head,
        el('p', { class: 'what', text: '[' + f.rule + '] ' + f.what + (f.label ? ' · label "' + f.label + '"' : '') }),
        el('p', { class: 'kv' }, [el('b', { text: 'found ' + f.found }), ' · canon ' + fmtCanon(f.canon)]),
        f.note ? el('p', { class: 'note', text: f.note }) : null,
        el('pre', { class: 'ctx', text: f.context })
      ]);
      list.appendChild(li);
    });
    if (!shown) list.appendChild(el('li', { class: 'finding', text: 'No findings match.' }));
    $('count').textContent = shown + ' of ' + D.findings.length + ' shown · ' + D.suppressed.length + ' labelled pattern mentions skipped';
  }
  $('q').addEventListener('input', render);
  render();
  if (m.declared_other_params && m.declared_other_params.length) {
    $('declared').textContent = 'Scanned for patterns and schema only, because they declare the draft in-space parameter set: ' + m.declared_other_params.join(', ') + '.';
  }
  $('declared').textContent += ' Skipped on purpose: ' + m.skipped.join(', ') + '.';

  // Quote card: every numeric key, grouped by its top-level section.
  var sel = $('key');
  var keys = Object.keys(D.cards);
  var groups = {};
  keys.forEach(function (k) { var g = k.split('.')[0]; (groups[g] = groups[g] || []).push(k); });
  Object.keys(groups).forEach(function (g) {
    var og = el('optgroup', { label: g });
    groups[g].forEach(function (k) {
      var leaf = k.slice(g.length + 1);
      og.appendChild(el('option', { value: k, text: leaf + '  (' + flatValue(k) + (D.units[k] ? ' ' + D.units[k] : '') + ')' }));
    });
    sel.appendChild(og);
  });
  function flatValue(key) {
    var parts = key.split('.');
    var node = D.rev_a;
    for (var i = 0; i < parts.length && node != null; i++) {
      var mm = /^([^\[]+)(?:\[(\d+)\])?$/.exec(parts[i]);
      node = node[mm[1]];
      if (mm[2] != null && node != null) node = node[Number(mm[2])];
    }
    return node;
  }
  function showCard() {
    $('card').textContent = D.cards[sel.value] || '';
    $('copy-status').textContent = '';
  }
  sel.value = keys.indexOf('kinematics.v_tip_kms') >= 0 ? 'kinematics.v_tip_kms' : keys[0];
  sel.addEventListener('change', showCard);
  showCard();
  $('copy').addEventListener('click', function () {
    var text = $('card').textContent;
    var done = function () { $('copy-status').textContent = 'Copied.'; };
    var fail = function () {
      try {
        var r = document.createRange();
        r.selectNodeContents($('card'));
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        $('copy-status').textContent = 'Clipboard unavailable here; the card is selected, press Ctrl/Cmd+C.';
      } catch (e) {
        $('copy-status').textContent = 'Clipboard unavailable here; select the card and copy it.';
      }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
      else fail();
    } catch (e) { fail(); }
  });

  // Canon self-check table.
  var tb = $('verify').querySelector('tbody');
  var bad = 0;
  (D.verify || []).forEach(function (r) {
    if (!r.ok) bad++;
    tb.appendChild(el('tr', { class: r.ok ? '' : 'bad' }, [
      el('td', { text: r.quantity }), el('td', { class: 'num', text: String(r.computed) }), el('td', { class: 'num', text: String(r.canon) }),
      el('td', { class: 'verdict ' + (r.ok ? 'ok' : 'bad'), text: r.ok ? 'matches' : 'DISAGREES' }), el('td', { text: r.how })]));
  });
  var n = (D.verify || []).length;
  $('verify-summary').textContent = (n - bad) + ' of ' + n + ' derived values reproduce from the file’s own inputs' +
    (bad ? '; ' + bad + ' do not: ' + D.verify.filter(function (r) { return !r.ok; }).map(function (r) { return r.quantity; }).join('; ') + '.' : '.') +
    ' Physical constants used that are not in rev_a.json: R_E 6371 km (as physics/skyhook_physics.py), the sidereal day 86164.0905 s, g0 9.80665 m/s².';

  // Rules, sinks, labels, suppressed, deviations.
  var rb = $('rules').querySelector('tbody');
  D.rules.rules.forEach(function (r) {
    var allowed = (r.keys || []).concat(Array.isArray(r.derived) ? r.derived : (r.derived ? ['derived: ' + r.derived] : []));
    rb.appendChild(el('tr', null, [
      el('td', null, [el('code', { text: r.id })]), el('td', { text: r.what }), el('td', { text: r.unit }),
      el('td', null, [el('code', { text: (r.keywords || r.bare || '').slice(0, 160) })]),
      el('td', null, [el('code', { text: allowed.join(', ').replace(/mass_ratio\.integrated_tether_to_payload_both_arms\./g, 'mass_ratio.*.') })])]));
  });
  $('sinks').textContent = D.rules.sinks.join('   ');
  $('labels').textContent = D.rules.self_labels.join('   ');
  var sup = $('suppressed');
  $('sup-summary').textContent = 'Labelled pattern mentions that were skipped (' + D.suppressed.length + ')';
  D.suppressed.forEach(function (s) {
    sup.appendChild(el('li', null, [el('span', { class: 'loc', text: s.path + ':' + s.line }), ' ' + s.found + ' [' + s.rule + '] label “' + s.label + '”']));
  });
  var db = $('devs').querySelector('tbody');
  (D.deviations || []).forEach(function (r) {
    db.appendChild(el('tr', null, [
      el('td', { class: 'num', text: String(r.no) }), el('td', null, [el('code', { text: r.paths.join(', ') })]), el('td', { text: r.state }),
      el('td', null, [el('code', { text: r.snippets.join(' | ') })]), el('td', { class: 'num', text: r.values.join(' ') })]));
  });
})();
