/* Said vs Derived page. Renders the saved run in page-data.js (written by
 * said-vs-derived.mjs --emit-page-data) and runs said-derived.js on a pasted snippet. Every
 * value shown comes from the run or from that scan; nothing here is typed. Text is always set
 * with textContent. */
(function () {
  'use strict';
  var SD = window.SaidDerived;
  var RUN = window.SAID_DERIVED_RUN;

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'cls') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }
  function code(t) {
    return el('code', { text: t });
  }
  function refusal(title, body) {
    return el('div', { cls: 'refusal', role: 'note' }, el('strong', { text: title }), el('p', { text: body }));
  }
  function fmt(n) {
    return Number(n).toLocaleString('en-US');
  }
  var FAILING = SD.FAILING;
  function badgeKind(cls, allowed) {
    if (allowed) return 'ok';
    return FAILING.indexOf(cls) >= 0 ? 'fail' : 'info';
  }

  if (!RUN || !SD) {
    document.getElementById('run-meta').textContent = '';
    document.getElementById('pairs').appendChild(refusal('No saved run.', 'page-data.js or said-derived.js did not load. Re-create it with: node said-vs-derived.mjs <aster-checkout> --emit-page-data page-data.js'));
    return;
  }

  // canon rows arrive as arrays under RUN.canonFields
  RUN.canon = RUN.canon.map(function (a) {
    var o = {};
    RUN.canonFields.forEach(function (f, i) { o[f] = a[i]; });
    return o;
  });

  // ---------------------------------------------------------------- run header
  var m = RUN.meta;
  var info = RUN.findings.filter(function (f) { return FAILING.indexOf(f.class) < 0; }).length;
  document.getElementById('run-meta').textContent =
    'Saved run against Aster ' + (m.commit || '(no commit)') + ': ' + fmt(m.scanned.ts) + ' TypeScript and ' + fmt(m.scanned.html) +
    ' HTML files, ' + fmt(m.scanned.literals) + ' literals (' + fmt(m.scanned.displayLiterals) + ' display text); canon of ' + fmt(m.canon.total) +
    ' homes; allow-list ' + (m.allowlistFile ? m.allowlistFile + ' (' + RUN.allowlist.applied + ' applied)' : 'none') +
    '. Result: ' + fmt(RUN.failing.length) + ' failing, ' + fmt(info) + ' informational.';

  // ---------------------------------------------------------------- the pairs
  function findingsAt(path, line) {
    return RUN.findings.filter(function (f) { return f.path === path && f.line === line; });
  }
  function derivedAt(path, line) {
    return RUN.derived.filter(function (d) { return d.path === path && d.line === line; });
  }
  function where(path, line) {
    return path + (line ? ':' + line : '');
  }

  var PAIRS = [
    {
      title: 'The feasibility threshold',
      build: function () {
        var said = findingsAt('src/v2/app/catalog-list/honesty-disclosure.ts', 59).filter(function (f) { return f.class === 'LITERAL-MATCHES-CONSTANT'; })[0];
        if (!said || !said.homes.length) return null;
        var home = said.homes[0];
        var reads = RUN.runtimeReads.filter(function (r) { return r.reads === home.name; });
        if (!reads.length) return null;
        return {
          said: [el('p', { cls: 'big', text: said.literal }), el('p', { cls: 'where' }, 'typed at ', code(where(said.path, said.line))), el('p', { text: said.context })],
          derived: [el('p', { cls: 'big', text: home.value }), el('p', { cls: 'where' }, code(home.name), ' in ', code(home.at)), el('p', { cls: 'where' }, 'read at run time at ', code(where(reads[0].path, reads[0].line)), ', as DEC-17-5 rider (a) requires')],
        };
      },
      missing: 'honesty-disclosure.ts:59 with a home that the code reads at run time',
    },
    {
      title: 'The albedo range',
      build: function () {
        var said = findingsAt('src/v2/app/compare/main.ts', 270).filter(function (f) { return f.class === 'LITERAL-MATCHES-CONSTANT'; });
        var reads = derivedAt('src/v2/app/compare/main.ts', 271);
        if (said.length < 2 || !reads.length) return null;
        return {
          said: [el('p', { cls: 'big', text: said.map(function (f) { return f.literal; }).join(' – ') }), el('p', { cls: 'where' }, 'typed at ', code(where(said[0].path, said[0].line))), el('p', { text: said[0].context })],
          derived: [el('p', { cls: 'big', text: said.map(function (f) { return f.homes[0].value; }).join(' – ') }), el('p', { cls: 'where' }, said.map(function (f) { return f.homes[0].name + ' (' + f.homes[0].at + ')'; }).join('; ')), el('p', { cls: 'where' }, 'the next line, ', code(where(reads[0].path, reads[0].line)), ', reads ', reads.map(function (d) { return d.reads; }).join(', '))],
        };
      },
      missing: 'compare/main.ts:270 and the derived note on :271',
    },
    {
      title: 'The deterministic margin',
      build: function () {
        var said = RUN.findings.filter(function (f) { return f.class === 'LITERAL-MATCHES-CONSTANT' && f.path.indexOf('mcp/') === 0 && f.literal === '5%'; });
        var d = derivedAt('src/v2/app/porkchop/main.ts', 892).filter(function (x) { return x.via && x.via.indexOf(said.length ? said[0].homes[0].name : '') >= 0; })[0];
        if (!said.length || !d) return null;
        return {
          said: [el('p', { cls: 'big', text: said[0].literal }), el('p', { cls: 'where' }, 'typed in the MCP at ', said.map(function (f) { return where(f.path, f.line); }).join(', ')), el('p', { text: said[0].context })],
          derived: [el('p', { cls: 'big', text: said[0].homes[0].value }), el('p', { cls: 'where' }, code(said[0].homes[0].name), ' in ', code(said[0].homes[0].at)), el('p', { cls: 'where' }, 'the porkchop page reads it at ', code(where(d.path, d.line)), ' through ', code(d.reads))],
        };
      },
      missing: "the MCP's 5% margin text and the porkchop page's derived margin line",
    },
    {
      title: 'The window end',
      build: function () {
        var g = RUN.dateGroups.filter(function (x) { return x.value === '2040-01-01'; })[0];
        if (!g || !g.sameYear || !g.sameYear.length) return null;
        return {
          said: [el('p', { cls: 'big', text: "'" + g.value + "'" }), el('p', { cls: 'where' }, 'typed in ' + g.files.length + ' files: ', g.sites.join(', '))],
          derived: [el('p', { cls: 'big', text: g.sameYear[0].value }), el('p', { cls: 'where' }, code(g.sameYear[0].name), ' in ', code(g.sameYear[0].at)), el('p', { cls: 'where', text: 'Two windows both once labelled "2026–2040" (S17-F2): the views end at the typed date, the cache at the data’s date.' })],
        };
      },
      missing: "a '2040-01-01' group with a cache date in the same year",
    },
  ];

  var pairsBox = document.getElementById('pairs');
  PAIRS.forEach(function (p) {
    var card = el('article', { cls: 'pair' }, el('h3', { text: p.title }));
    var built = p.build();
    if (!built) {
      card.appendChild(refusal('Not in this run.', 'The saved run has no ' + p.missing + '. Re-run the scan against a checkout where it exists; this card shows nothing rather than a remembered value.'));
    } else {
      var said = el('div', { cls: 'side said' }, el('span', { cls: 'tag', text: 'Said' }));
      built.said.forEach(function (n) { said.appendChild(n); });
      var derived = el('div', { cls: 'side derived' }, el('span', { cls: 'tag', text: 'Derived' }));
      built.derived.forEach(function (n) { derived.appendChild(n); });
      card.appendChild(el('div', { cls: 'sides' }, said, derived));
    }
    pairsBox.appendChild(card);
  });

  // ---------------------------------------------------------------- findings
  var active = null;
  var tilesBox = document.getElementById('tiles');
  var listBox = document.getElementById('findings');
  var countBox = document.getElementById('count');
  var q = document.getElementById('q');

  function renderFinding(f, allowedReason) {
    var kind = badgeKind(f.class, allowedReason);
    var li = el('li', { cls: 'finding' },
      el('div', { cls: 'top' },
        el('span', { cls: 'badge ' + kind, text: allowedReason ? f.class + ' · allowed' : f.class }),
        el('span', { cls: 'loc mono', text: where(f.path, f.line) }),
        el('span', { cls: 'lit mono', text: f.literal })));
    if (f.context) li.appendChild(el('p', { cls: 'ctx', text: f.context }));
    if (f.homes && f.homes.length) {
      var ul = el('ul', { cls: 'homes' });
      f.homes.forEach(function (h) { ul.appendChild(el('li', null, code(h.name + ' = ' + h.value), ' at ', code(h.at))); });
      li.appendChild(ul);
    }
    if (f.alsoEqual && f.alsoEqual.length) {
      li.appendChild(el('p', { cls: 'ctx', text: 'Same value, no shared name word, so not counted as a match: ' + f.alsoEqual.map(function (h) { return h.name + ' (' + h.at + ')'; }).join('; ') }));
    }
    if (allowedReason) li.appendChild(el('p', { cls: 'why', text: 'Allowed: ' + allowedReason }));
    return li;
  }

  // Tiles are built once and updated in place, so a tile keeps keyboard focus after Enter/Space.
  var tileButtons = [];
  SD.CLASS_ORDER.forEach(function (c) {
    var n = RUN.counts[c] || 0;
    var allowed = RUN.findings.filter(function (f) { return f.class === c && f.allowed; }).length;
    var kind = FAILING.indexOf(c) >= 0 ? 'fail' : 'info';
    var b = el('button', { type: 'button', cls: 'tile ' + kind, 'aria-pressed': 'false', 'data-class': c },
      el('span', { cls: 'n', text: fmt(n) }),
      el('span', { cls: 'k', text: c }),
      el('span', { cls: 'a', text: kind === 'fail' ? (allowed ? allowed + ' allowed with a reason, ' + (n - allowed) + ' fail' : 'fails the run') : 'informational' }));
    b.addEventListener('click', function () {
      active = active === c ? null : c;
      renderTiles();
      renderList();
    });
    tilesBox.appendChild(b);
    tileButtons.push(b);
  });
  function renderTiles() {
    tileButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(active === b.getAttribute('data-class'))); });
  }

  function renderList() {
    var needle = q.value.trim().toLowerCase();
    var shown = RUN.findings.filter(function (f) {
      if (active && f.class !== active) return false;
      if (!needle) return true;
      var hay = [f.class, f.path + ':' + f.line, f.literal, f.context].concat((f.homes || []).map(function (h) { return h.name + ' ' + h.value + ' ' + h.at; })).join(' ').toLowerCase();
      return hay.indexOf(needle) >= 0;
    });
    listBox.textContent = '';
    shown.forEach(function (f) { listBox.appendChild(renderFinding(f, f.allowed)); });
    countBox.textContent = shown.length + ' of ' + RUN.findings.length + ' findings' + (active ? ' in ' + active : '') + (needle ? ' matching “' + q.value.trim() + '”' : '') + '.';
  }
  q.addEventListener('input', renderList);
  renderTiles();
  renderList();

  // ---------------------------------------------------------------- dates, derived, canon
  var datesBody = document.getElementById('dates-body');
  if (!RUN.dateGroups.length) datesBody.appendChild(el('p', { text: 'No ISO date is typed as a literal in two or more files.' }));
  RUN.dateGroups.forEach(function (g) {
    var ul = el('ul');
    g.sites.forEach(function (s) { ul.appendChild(el('li', null, code(s))); });
    datesBody.appendChild(el('p', null, el('strong', { text: "'" + g.value + "'" }), ' typed in ' + g.files.length + ' files' + (g.owners.length ? '; named homes: ' + g.owners.join(', ') : '; no named home')));
    datesBody.appendChild(ul);
    (g.sameYear || []).forEach(function (y) {
      datesBody.appendChild(el('p', { cls: 'hint' }, 'Same year, another day in the data: ', code(y.name + ' = ' + y.value), ' (' + y.at + ')'));
    });
  });

  var derivedBody = document.getElementById('derived-body');
  derivedBody.appendChild(el('p', { cls: 'hint', text: RUN.derived.length + ' interpolations in display text read a named constant (one level of indirection inside a file is followed).' }));
  var byFile = {};
  RUN.derived.forEach(function (d) { (byFile[d.path] = byFile[d.path] || []).push(d); });
  var dl = el('ul');
  Object.keys(byFile).sort().forEach(function (p) {
    dl.appendChild(el('li', null, code(p), ': ' + byFile[p].map(function (d) { return ':' + d.line + ' ' + d.reads + (d.via ? ' (← ' + d.via.join(', ') + ')' : ''); }).join(', ')));
  });
  derivedBody.appendChild(dl);
  if (RUN.runtimeReads.length) {
    derivedBody.appendChild(el('p', { cls: 'hint', text: 'Code that reads the cache metadata at run time:' }));
    var rl = el('ul');
    RUN.runtimeReads.forEach(function (r) { rl.appendChild(el('li', null, code(r.reads), ' at ', code(where(r.path, r.line)))); });
    derivedBody.appendChild(rl);
  }

  var tbody = document.querySelector('#canon-table tbody');
  var cq = document.getElementById('cq');
  function renderCanon() {
    var needle = cq.value.trim().toLowerCase();
    tbody.textContent = '';
    RUN.canon.forEach(function (r) {
      var home = where(r.path, r.line);
      if (needle && (r.name + ' ' + r.value + ' ' + home + ' ' + r.dim).toLowerCase().indexOf(needle) < 0) return;
      tbody.appendChild(el('tr', null, el('td', { text: r.name }), el('td', { text: r.value }), el('td', { text: r.dim }), el('td', { text: home })));
    });
  }
  cq.addEventListener('input', renderCanon);
  renderCanon();

  // ---------------------------------------------------------------- try a snippet
  var EXAMPLE = [
    'const range = `the ${label} screening range`;',
    'const low = `departure C3 ≤ 25 km²/s² somewhere in ${range}.`;',
    'const grid = `Grid spans ${GRID_PARAMS.tofMinDays}–${GRID_PARAMS.tofMaxDays} day flight times.`;',
    "const margin = 'deterministic 5% margin on maneuver lines';",
    "console.log('debug: C3 ≤ 25 km²/s²');",
    'const offset = 69.184;',
  ].join('\n');
  var canon = RUN.canon.map(SD.homeFromRow);
  var canonNames = new Set(canon.map(function (h) { return h.name; }));
  var jsonNames = new Set(canon.filter(function (h) { return h.source === 'json'; }).map(function (h) { return h.name; }));
  var snippet = document.getElementById('snippet');
  var out = document.getElementById('try-out');
  snippet.value = EXAMPLE;

  function scanSnippet() {
    out.textContent = '';
    var text = snippet.value;
    if (!text.trim()) {
      out.appendChild(refusal('Nothing to scan.', 'Paste at least one line of TypeScript that holds a string or template literal (or a numeric literal, for the retyped-constant check).'));
      return;
    }
    var L = SD.lex(text);
    var cut = L.errors.filter(function (e) { return /unterminated/.test(e); });
    if (cut.length) {
      out.appendChild(refusal('The lexer could not close this text: ' + cut.join('; ') + '.', 'A string, template or comment left open would make every later line read wrong, so nothing is reported. Close it and scan again.'));
      return;
    }
    var lits = el('ol', { cls: 'lits' });
    L.literals.forEach(function (lit) {
      var st = SD.staticText(lit);
      var cls = SD.classifyLiteral(lit, st.joined);
      lits.appendChild(el('li', null, el('span', { cls: 'cls', text: 'line ' + lit.line + ' · ' + cls }), el('span', { cls: 'mono', text: st.joined.split(SD.SENTINEL).join('${…}') })));
    });
    var scan = SD.scanSource('snippet.ts', text, { canonNames: canonNames, jsonNames: jsonNames });
    var rep = SD.buildReport([scan], canon, { classes: ['LITERAL-MATCHES-CONSTANT', 'LITERAL-DATE-SPAN', 'RETYPED-CONSTANT', 'LITERAL-WITH-UNITS'] });
    out.appendChild(el('p', { cls: 'hint', text: L.literals.length + ' literal' + (L.literals.length === 1 ? '' : 's') + ', classed as the scanner classes them (only display text is read for claims):' }));
    if (L.literals.length) out.appendChild(lits);
    if (rep.findings.length) {
      out.appendChild(el('p', { cls: 'hint', text: rep.findings.length + ' finding' + (rep.findings.length === 1 ? '' : 's') + ' against the checkout’s canon:' }));
      var ol = el('ol', { cls: 'findings', id: 'try-findings' });
      rep.findings.forEach(function (f) { ol.appendChild(renderFinding(f, null)); });
      out.appendChild(ol);
    } else {
      out.appendChild(el('p', { cls: 'hint', text: 'No findings: nothing in this text types a value the canon owns, a date, a year span or a unit-bearing number.' }));
    }
    if (rep.derived.length) {
      out.appendChild(el('p', { cls: 'hint', text: 'Derived: ' + rep.derived.map(function (d) { return 'line ' + d.line + ' reads ' + d.reads + (d.via ? ' (← ' + d.via.join(', ') + ')' : ''); }).join('; ') + '.' }));
    }
  }
  document.getElementById('scan').addEventListener('click', scanSnippet);
  document.getElementById('reset').addEventListener('click', function () {
    snippet.value = EXAMPLE;
    scanSnippet();
  });
  scanSnippet();
})();
