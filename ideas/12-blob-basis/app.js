/* Blob Basis page. Draws the saved CLI runs (example-data.js) and runs basis.js on a copy the
   reader picks. Every number shown comes from example-data.js (a saved run of blob-basis.mjs,
   with its command shown at the foot of the page) or is computed here by basis.js. */
(function () {
  'use strict';
  var BB = window.BlobBasis;
  var EX = window.BlobBasisExample;
  var g3 = BB.group3;
  var SIZE_LIMIT = 100 * 1024 * 1024;

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return parent;
  }
  function code(text) { return h('code', null, text); }
  function short(x, n) { return x.slice(0, n || 16) + '…'; }
  function runById(id) {
    for (var i = 0; i < EX.runs.length; i++) if (EX.runs[i].id === id) return EX.runs[i];
    return null;
  }
  function plural(n, one, many) { return g3(n) + ' ' + (n === 1 ? one : many); }

  var CHIP = {
    'BLOB-BASIS': 'ok', IDENTICAL: 'ok',
    'CRLF-BASIS': 'warn', 'CRLF-CHECKOUT': 'warn', 'EOL-ONLY': 'warn', 'LF-BASIS': 'warn',
    'WORKTREE-BASIS': 'info', HISTORY: 'info',
    'NO-MATCH': 'bad', DIRTY: 'bad', 'NOT-THE-BLOB': 'bad', INVALID: 'bad',
  };
  function chip(c) { return h('span', 'chip ' + (CHIP[c] || 'na'), c); }

  // ---------------------------------------------------------------------------------------------
  // The six-basis grid. Rows are transforms, columns the two sources; one colour and one letter
  // per distinct byte string, so equal bases read as equal without relying on colour.
  var TRANSFORM_ROWS = [['', 'as it is'], ['-lf', 'CRLF folded to LF'], ['-crlf', 'a CR before every bare LF']];
  function basisGrid(rows, pins, algo) {
    algo = algo || 'sha256';
    var byName = {};
    var fam = {};
    var next = 0;
    rows.forEach(function (r) { byName[r.name] = r; });
    // Letters and colours go to the committed blob's bytes first, so A (teal) is always the blob
    // when there is one and its CRLF form is B (amber).
    ['blob', 'blob-lf', 'blob-crlf', 'disk', 'disk-lf', 'disk-crlf'].forEach(function (n) {
      var r = byName[n];
      if (r && r.available !== false && fam[r.family] == null) fam[r.family] = next++;
    });
    var grid = h('div', 'bgrid');
    add(grid, h('div', 'colhead corner', ''), h('div', 'colhead', 'disk: bytes under test'), h('div', 'colhead', 'blob: committed'));
    TRANSFORM_ROWS.forEach(function (tr) {
      add(grid, h('div', 'rowlabel', tr[1]));
      ['disk', 'blob'].forEach(function (src) {
        var name = src + tr[0];
        var r = byName[name];
        var c = h('div', 'cell');
        c.setAttribute('data-basis', name);
        if (!r || r.available === false) {
          c.className += ' na';
          add(c, h('div', 'nm', name), h('div', 'why', 'UNAVAILABLE: ' + (r ? r.why : 'not computed')));
        } else {
          var k = fam[r.family];
          c.className += ' f' + ((k % 4) + 1);
          c.setAttribute('data-family', String.fromCharCode(65 + k));
          var nm = h('div', 'nm', name);
          var badge = h('span', 'fam', String.fromCharCode(65 + k));
          badge.setAttribute('title', 'bytes ' + String.fromCharCode(65 + k));
          add(nm, ' ', badge);
          add(c,
            nm,
            h('div', 'by', g3(r.bytes) + ' bytes'),
            h('div', 'h', (algo === 'sha256' ? '' : BB.ALGO_LABEL[algo] + ' ') + short(r[algo])));
          (pins[name] || []).forEach(function (p) { add(c, ' ', h('span', 'pinmark', '◆ ' + p)); });
        }
        add(grid, c);
      });
    });
    var wrap = h('div');
    add(wrap, grid, h('p', 'legend', 'Same letter and colour = the same bytes, hashed once. Hashes are cut to 16 hex digits here; the full values are in example.txt and below.'));
    return wrap;
  }

  // Where a recorded value was recorded, from the scan runs.
  function recordedAt(value) {
    for (var i = 0; i < EX.runs.length; i++) {
      var scans = EX.runs[i].scans || [];
      for (var j = 0; j < scans.length; j++) {
        var es = scans[j].entries;
        for (var k = 0; k < es.length; k++) if (es[k].value === value) return { source: scans[j].source, entry: es[k] };
      }
    }
    return null;
  }
  function baseName(p) { return p.split('/').pop(); }

  // ---------------------------------------------------------------------------------------------
  function renderTop() {
    var aster = runById('aster-scan');
    var hl = $('headline');
    aster.scans.forEach(function (scan) {
      scan.entries.forEach(function (e) {
        var li = h('li');
        var where = baseName(scan.source.path) + ' \u203a ' + e.pointer.split('/').slice(-2).join('.');
        add(li, chip(e.match ? e.match.code : 'UNRESOLVED'), ' ', h('span', 'mono', where), ' ', h('span', 'more', short(e.value, 8)));
        add(hl, li);
      });
    });
    var sky = runById('skyhook-grid');
    $('run-note').textContent = 'Everything above "Check a copy" is a saved run of blob-basis.mjs against Aster ' +
      aster.git.commit.slice(0, 7) + ' (' + aster.git.commitDate.slice(0, 10) + ') and Skyhook ' + sky.git.commit.slice(0, 7) +
      ', both shallow clones, git ' + aster.git.version + '. The commands are listed at the foot of the page.';
  }

  function renderSix() {
    var r = runById('aster-horizons');
    var p = r.paths[0];
    var pins = {};
    var pinList = $('six-pins');
    p.expect.forEach(function (m) {
      var at = recordedAt(m.value);
      var label = at ? baseName(at.source.path) : 'recorded hash';
      m.matches.forEach(function (n) { (pins[n] = pins[n] || []).push(label); });
      var li = h('li');
      add(li, chip(m.code), ' ', h('span', 'mono', short(m.value)), ' ');
      if (at) add(li, 'recorded in ', code(at.source.path), ' at ', code(at.entry.pointer));
      add(li, h('div', 'more', (BB.MATCH_TEXT[m.code] || '') + '. Equals ' + m.matches.join(' = ') + '.' +
        (m.recordedBytes != null ? ' Recorded bytes ' + g3(m.recordedBytes) + (m.bytesAgree ? ' agree.' : ' do not agree.') : '')));
      add(pinList, li);
    });
    var sub = $('six-sub');
    add(sub, code(p.repoPath), ' at ', code(r.git.commit.slice(0, 7)), ', the Earth ephemeris the screening cache and the Slice 12 vZ measurement both hashed. ',
      'git ls-files --eol says ', code(p.attributes.lsFilesEol), '. Working copy against the blob: ', chip(p.verdict.code), '.');
    $('six-grid').appendChild(basisGrid(p.rows, pins));
    // The byte arithmetic, recomputed here from the run's counts.
    var blob = p.rows.filter(function (x) { return x.name === 'blob'; })[0];
    var crlf = p.rows.filter(function (x) { return x.name === 'blob-crlf'; })[0];
    var rec = p.expect.filter(function (m) { return m.recordedBytes != null; })[0];
    var sum = blob.bytes + blob.bareLf;
    var a = $('six-arith');
    add(a, 'The CRLF form is the blob plus one CR per bare LF: ', h('strong', null, g3(blob.bytes) + ' + ' + g3(blob.bareLf) + ' = ' + g3(sum)),
      ' bytes' + (sum === crlf.bytes ? ', which is the blob-crlf size' : ', which is NOT the blob-crlf size ' + g3(crlf.bytes)) +
      (rec ? (sum === rec.recordedBytes ? ' and the ' + g3(rec.recordedBytes) + ' bytes the measurement recorded.' : ', not the ' + g3(rec.recordedBytes) + ' recorded.') : '.'));
  }

  var VERDICT_NOTE = {
    'NO-MATCH': function (e) {
      var hs = e.match.history;
      if (!hs) return '';
      if (hs.found) return 'It matches an older committed version: ' + hs.found.commit.slice(0, 7) + ' (' + hs.found.date.slice(0, 10) + ').';
      var s = plural(hs.versions, 'committed version', 'committed versions') + ' of the file reachable here, back to ' +
        (hs.oldest ? hs.oldest.commit.slice(0, 7) + ' (' + hs.oldest.date.slice(0, 10) + ')' : 'the start') + ': none matches.';
      if (hs.shallow) s += ' This is a shallow clone, so older versions are not here to check; the README records what the full history shows.';
      return s;
    },
  };

  function renderPlaced() {
    var box = $('placed');
    $('gen-rev').textContent = EX.asterRev.slice(0, 7);
    ['aster-scan', 'skyhook-grid', 'skyhook-grid-parent'].forEach(function (id) {
      var r = runById(id);
      r.scans.forEach(function (scan) {
        var proj = /skyhook/.test(scan.source.repo) ? 'Skyhook' : 'Aster';
        var t = h('h3', 'group-title');
        add(t, proj + ' · ', code(scan.source.path), ' at ', code(scan.source.commit.slice(0, 7)),
          scan.source.mode === 'derived' ? ' (from history, the parent of the commit that changed the hashing)' : '');
        add(box, t);
        var ul = h('ul', 'cards');
        scan.entries.forEach(function (e) {
          var li = h('li', 'card');
          add(li, h('div', 'where', e.pointer));
          add(li, h('div', 'val', BB.ALGO_LABEL[e.algo] + ' ' + e.value + (e.recordedBytes != null ? ' · bytes ' + g3(e.recordedBytes) : '')));
          if (!e.match) {
            add(li, h('div', 'verdict'), chip('UNRESOLVED'));
            add(li, h('div', 'expl', 'No file is named for this hash; blob-basis needs --map ' + e.key + '=<path>.'));
          } else {
            var fileLine = h('div', 'more');
            add(fileLine, 'about ', code(e.path), ' (', e.pathFrom, ')');
            add(li, fileLine);
            var v = h('div', 'verdict');
            add(v, chip(e.match.code), ' ', h('span', 'expl', BB.MATCH_TEXT[e.match.code]));
            add(li, v);
            var more = [];
            if (e.match.matches.length) more.push('Equals ' + e.match.matches.join(' = ') + '.');
            if (e.match.recordedBytes != null) more.push('Recorded bytes ' + g3(e.match.recordedBytes) + (e.match.bytesAgree ? ' agree.' : ' do not agree.'));
            if (VERDICT_NOTE[e.match.code]) more.push(VERDICT_NOTE[e.match.code](e));
            if (more.length) add(li, h('div', 'more', more.join(' ')));
          }
          add(ul, li);
        });
        if (scan.ids.length) {
          var li = h('li', 'card');
          add(li, h('div', 'more', 'Forty hex digits under keys that name no blob are object ids (commits, mostly), so they are listed, not placed:'));
          var idl = h('ul', 'idlist');
          scan.ids.forEach(function (d) {
            var it = h('li');
            add(it, h('span', 'where', d.pointer), ' ', h('span', 'val', short(d.value, 12)), ' ',
              h('span', 'more', d.type ? d.type + ' in this clone' : 'not in this clone' + (d.shallow ? ' (shallow)' : '')));
            add(idl, it);
          });
          add(li, idl);
          add(ul, li);
        }
        add(box, ul);
      });
      var req = r.command.indexOf('--require blob') >= 0;
      if (req) {
        var all = [];
        r.scans.forEach(function (s) { all = all.concat(s.entries); });
        var off = all.filter(function (e) { return !e.match || e.match.matches.indexOf('blob') < 0; }).length;
        var p = h('p', 'exitline');
        add(p, 'With ', code('--require blob'), ' this run exits ', h('strong', null, String(r.exit)), ': ' +
          off + ' of ' + all.length + ' recorded hashes are not on the committed-blob basis, so they cannot be reproduced from a clone with ', code('git cat-file blob'), '.');
        add(box, p);
      }
    });
  }

  function renderBaked() {
    var r = runById('aster-baked');
    var s = r.source;
    var n = r.paths.length;
    var same = r.paths.filter(function (p) { return p.verdict.code === 'IDENTICAL'; }).length;
    add($('baked-sub'), code(s.path), ' copies these ' + n + ' files from the working tree into the package (', code('runtimeAssetPaths'), ' at :' + s.listLine + ', ',
      code('copyFileSync'), ' at :' + s.copyLine + ', at ', code(s.commit.slice(0, 7)), '). A working copy that is not the committed blob would put bytes into the package that no clone has. At this commit ' +
      same + ' of ' + n + ' are identical to the blob; ', code('--require blob'), ' exits ' + r.exit + '.');
    var ul = h('ul', 'rows');
    r.paths.forEach(function (p) {
      var blob = p.rows.filter(function (x) { return x.name === 'blob'; })[0];
      var li = h('li');
      add(li, chip(p.verdict.code), h('span', 'p', p.repoPath), h('span', 'b', blob && blob.available !== false ? g3(blob.bytes) + ' B' : ''));
      add(ul, li);
    });
    add($('baked'), ul);
  }

  function renderFoot() {
    var f = $('foot-prov');
    var d = h('details', 'full');
    add(d, h('summary', null, 'The commands behind this page (run from the bank root; output saved in example.txt)'));
    EX.runs.forEach(function (r) {
      var p = h('p');
      add(p, r.title + ' (exit ' + r.exit + '):', h('br'), code('$ ' + r.command));
      add(d, p);
    });
    add(f, d);
  }

  // ---------------------------------------------------------------------------------------------
  // Check a copy. Hashing is plain JavaScript (basis.js); results for the same byte array are
  // remembered so editing the hash fields does not rehash the file.
  var memo = new WeakMap();
  function memoized(fn, key) {
    return function (b) {
      var m = memo.get(b);
      if (!m) { m = {}; memo.set(b, m); }
      if (m[key] == null) m[key] = fn(b);
      return m[key];
    };
  }
  var HASHER = { sha256: memoized(BB.sha256, 's'), md5: memoized(BB.md5, 'm'), blobId: memoized(BB.gitBlobId, 'b') };
  var SAMPLES = BB.sampleVariants();
  var SAMPLE_LABEL = { lf: 'sample: LF original', crlf: 'sample: CRLF twin', mixed: 'sample: mixed endings', edited: 'sample: mixed endings, one digit changed' };
  var state = { bytes: null, name: '', sample: null, diskBases: null, full: null, fullKey: null, filled: null };

  function setCopy(bytes, name, sample) {
    state.bytes = bytes;
    state.name = name;
    state.sample = sample;
    state.diskBases = null;
    state.full = null;
    state.fullKey = null;
    var btns = document.querySelectorAll('[data-sample]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-sample') === sample));
    var note = $('sample-note');
    if (sample) {
      var blobId = BB.gitBlobId(SAMPLES.lf);
      var rec = BB.sha256(SAMPLES.crlf);
      if (!state.filled || $('blobid').value === state.filled.blobId || !$('blobid').value) $('blobid').value = blobId;
      if (!state.filled || $('recorded').value === state.filled.recorded || !$('recorded').value) $('recorded').value = rec;
      state.filled = { blobId: blobId, recorded: rec };
      note.hidden = false;
      note.textContent = 'Sample values filled in: the LF original stands in for the committed blob (its blob id), and the recorded hash is the sha256 of the CRLF twin, the way earth-vz-span-max.json recorded the fixture. Edit either field to see the verdicts change.';
    } else {
      if (state.filled) {
        if ($('blobid').value === state.filled.blobId) $('blobid').value = '';
        if ($('recorded').value === state.filled.recorded) $('recorded').value = '';
      }
      state.filled = null;
      note.hidden = true;
    }
    schedule();
  }

  var timer = null;
  function schedule() {
    var out = $('check-out');
    if (state.bytes && state.bytes.length > 4 * 1024 * 1024 && !state.diskBases) {
      out.textContent = '';
      add(out, h('p', 'sub', 'Hashing ' + g3(state.bytes.length) + ' bytes in plain JavaScript…'));
    }
    clearTimeout(timer);
    timer = setTimeout(update, state.bytes && state.bytes.length > 4 * 1024 * 1024 ? 30 : 0);
  }

  function withBlobWhy(bases, why) {
    return {
      families: bases.families,
      rows: bases.rows.map(function (r) {
        if (r.source !== 'blob') return r;
        var c = {};
        for (var k in r) c[k] = r[k];
        c.why = why;
        return c;
      }),
    };
  }

  function update() {
    var out = $('check-out');
    out.textContent = '';
    if (!state.bytes) {
      add(out, h('p', 'sub', 'No copy chosen yet: pick a file or a sample above.'));
      return;
    }
    if (!state.diskBases) state.diskBases = BB.computeBases({ disk: state.bytes, blob: null, blobWhy: 'no blob' }, HASHER);
    var inf = BB.inferBlob(state.bytes, state.diskBases, $('blobid').value);
    var bases;
    if (inf.blob) {
      if (state.fullKey !== inf.via) {
        state.full = BB.computeBases({ disk: state.bytes, blob: inf.blob }, HASHER);
        state.fullKey = inf.via;
      }
      bases = state.full;
    } else bases = withBlobWhy(state.diskBases, inf.why);
    var verdict = BB.workingVerdict(bases, { blobCode: inf.code === 'NOT-FOUND' ? 'NOT-THE-BLOB' : 'UNAVAILABLE' });
    var disk = BB.row(bases, 'disk');

    var head = h('div', 'out-head');
    add(head, h('div', 'file', state.name), h('div', 'more', g3(disk.bytes) + ' bytes · ' + plural(disk.stats.crlf, 'CRLF', 'CRLFs') + ', ' +
      plural(disk.stats.bareLf, 'bare LF', 'bare LFs') + ', ' + plural(disk.stats.bareCr, 'bare CR', 'bare CRs') +
      (disk.binary ? ' · binary (a NUL byte in the first ' + g3(BB.BINARY_SNIFF_BYTES) + ' bytes): git never converts its line endings' : '')));
    add(out, head);

    var v = h('p');
    add(v, chip(verdict.code), ' ', verdict.text + '.');
    if (inf.code === 'FOUND' && inf.via !== 'disk') add(v, ' The committed blob is this copy ' + (inf.via === 'disk-lf' ? 'with CRLF folded to LF' : 'with a CR before every bare LF') + ' (its blob id matches).');
    add(out, v);

    if (!inf.blob) {
      var ref = h('div', 'refusal');
      if (inf.code === 'NOT-FOUND') {
        add(ref, h('strong', null, 'This copy is not that blob in any line-ending form.'),
          'Its as-is, LF and CRLF forms have blob ids ' + short(BB.row(bases, 'disk').blobId, 12) + ', ' + short(BB.row(bases, 'disk-lf').blobId, 12) + ', ' + short(BB.row(bases, 'disk-crlf').blobId, 12) +
          '; none is the id given. Either the content differs (DIRTY), or the id belongs to another file or revision. Without git the page cannot tell which, so the blob row stays unavailable.');
      } else {
        add(ref, h('strong', null, 'Blob basis unavailable.'), inf.why + '. ');
        add(ref, 'What would help: paste the output of ', code('git rev-parse HEAD:<path>'), ', or run ', code('node blob-basis.mjs <repo> <path>'), ' in the checkout.');
      }
      add(out, ref);
    }

    var rec = $('recorded').value.trim();
    var pins = {};
    if (rec) {
      var m = BB.matchHash(rec, bases);
      var pl = h('div', 'placement');
      if (!m.ok) add(pl, chip('INVALID'), ' ', m.why + '.');
      else {
        m.matches.forEach(function (n) { (pins[n] = pins[n] || []).push('recorded'); });
        add(pl, chip(m.code), ' ', BB.MATCH_TEXT[m.code] + '.');
        if (m.matches.length) add(pl, h('div', 'more', (m.prefix ? 'Prefix of ' : '') + BB.ALGO_LABEL[m.algo] + ' equals ' + m.matches.join(' = ') + '.' + (m.discriminating ? '' : ' Every available basis has these bytes, so this cannot tell the bases apart.')));
        if (!m.blobAvailable) add(pl, h('div', 'more', 'The blob rows are unavailable, so this says nothing about whether the hash is also the committed blob’s.'));
      }
      add(out, pl);
    }

    add(out, basisGrid(bases.rows, pins));

    var d = h('details', 'full');
    add(d, h('summary', null, 'Full hashes'));
    var table = h('table');
    var seen = {};
    bases.rows.forEach(function (r) {
      if (r.available === false || seen[r.family]) return;
      seen[r.family] = true;
      var names = bases.rows.filter(function (q) { return q.available !== false && q.family === r.family; }).map(function (q) { return q.name; }).join(' = ');
      [['bases', names + ' (' + g3(r.bytes) + ' bytes)'], ['sha256', r.sha256], ['md5', r.md5], ['git blob id', r.blobId]].forEach(function (pair, i) {
        var tr = h('tr');
        add(tr, h('th', null, pair[0]), h('td', i ? 'mono' : null, pair[1]));
        add(table, tr);
      });
    });
    add(d, table);
    add(out, d);
  }

  function wireCheck() {
    var btns = document.querySelectorAll('[data-sample]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', 'false');
      btns[i].addEventListener('click', function () {
        var k = this.getAttribute('data-sample');
        setCopy(SAMPLES[k], SAMPLE_LABEL[k], k);
      });
    }
    function takeFile(f) {
      if (!f) return;
      var out = $('check-out');
      if (f.size > SIZE_LIMIT) {
        out.textContent = '';
        var ref = h('div', 'refusal');
        add(ref, h('strong', null, 'Too large for this page.'), f.name + ' is ' + g3(f.size) + ' bytes. The page hashes in plain JavaScript and stops at ' + g3(SIZE_LIMIT) + '. What would help: ', code('node blob-basis.mjs <repo> <path>'), ', which uses node:crypto.');
        add(out, ref);
        return;
      }
      out.textContent = '';
      add(out, h('p', 'sub', 'Reading ' + f.name + '…'));
      f.arrayBuffer().then(function (buf) {
        setCopy(new Uint8Array(buf), f.name, null);
      }, function (err) {
        out.textContent = '';
        add(out, h('div', 'refusal', 'Could not read ' + f.name + ': ' + (err && err.message ? err.message : err)));
      });
    }
    $('file').addEventListener('change', function () { takeFile(this.files && this.files[0]); });
    var zone = $('check');
    zone.addEventListener('dragover', function (e) { e.preventDefault(); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      takeFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    $('blobid').addEventListener('input', schedule);
    $('recorded').addEventListener('input', schedule);
    update();
  }

  renderTop();
  renderSix();
  renderPlaced();
  renderBaked();
  renderFoot();
  wireCheck();
})();
