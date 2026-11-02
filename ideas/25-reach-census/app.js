// Reach Census page. Every number here is recomputed in the browser by census.js from the
// packs in snapshots/ (the tracked file list at a commit plus the runner definitions read there).
(function () {
  'use strict';
  var C = window.ReachCensus;
  var P = window.REACH_PACKS || {};
  var REPOS = [
    { key: 'aster', commits: ['aster', 'aster-a697963'] },
    { key: 'partforge', commits: ['partforge', 'partforge-60a90cd'] },
    { key: 'skyhook', commits: ['skyhook'] },
  ];
  var EXAMPLES = {
    aster: [['npm test', ''], ['node --test tests/*.test.mjs', ''], ["node --test 'tests/**/*.test.mjs'", ''], ['node --test tools/slice16-harness/test/', ''], ['node tools/run-tests.mjs', ''], ['npm test', 'mcp']],
    partforge: [['node tests/run.mjs', ''], ['npm test', 'headless'], ['npm run test:parity', 'headless'], ['node --test tests/', ''], ['node --test tests/*.test.mjs', '']],
    skyhook: [['pytest tests/ -v', ''], ['python3 -m pytest tests/', ''], ['node tools/twin/verify.mjs', ''], ['python3 -m unittest discover tests', '']],
  };
  var CLASS_LABEL = { ci: 'CI', 'ci-less': 'CI-less', manual: 'manual only', orphan: 'orphan' };
  var CLASS_HELP = {
    ci: 'a CI workflow step launches it',
    'ci-less': 'a package script or a documented suite command launches it; no CI step does',
    manual: 'only one-file commands written in the docs launch it',
    orphan: 'nothing launches it',
  };
  var state = { repo: 'aster', pack: 'aster', route: '', show: { ci: true, 'ci-less': true, manual: true, orphan: true } };
  var cache = {};
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'cls') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function code(t) { return el('code', { text: t }); }
  function chip(cls, t) { return el('span', { cls: 'chip ' + cls, text: t }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function short(c) { return c ? c.slice(0, 7) : '-'; }

  function packOf(k) { return P[k]; }
  function treeOf(k) {
    var p = packOf(k);
    var cfg = p.base ? P[p.base].config : p.config;
    return C.treeFromPack(p, cfg, P);
  }
  function censusOf(k) {
    if (!cache[k]) { var t = treeOf(k); cache[k] = { tree: t, r: C.censusRepo(t, {}) }; }
    return cache[k];
  }
  function entryLabel(r, e) {
    if (e.kind === 'ci') return 'CI job ' + e.job + ' (' + e.source + ')';
    if (e.kind === 'script') return e.command + ' (' + e.file + ')';
    return e.command + ' (' + e.sources[0] + (e.sources.length > 1 ? ' +' + (e.sources.length - 1) : '') + ')';
  }

  // ---------------------------------------------------------------- repository cards
  function headline(r) {
    var parts = [];
    if (!r.workflows.length) parts.push('no CI workflow: no test runs on a push');
    var orph = r.files.filter(function (f) { return f.class === 'orphan'; });
    if (orph.length) parts.push(plural(orph.length, 'orphan') + ': ' + orph.map(function (f) { return f.path; }).join(', '));
    if (r.drift.length) { var d = r.drift[0]; parts.push(d.command + ' reaches ' + d.reach + ' of the ' + d.ciReach + ' files CI runs'); }
    var skips = r.files.filter(function (f) { return f.routes.some(function (x) { return x.fileConditions.some(function (c) { return c.satisfied === false; }); }); });
    if (skips.length) parts.push(plural(skips.length, 'file') + ' skip themselves under the documented install');
    return parts.join('; ');
  }
  function stackBar(counts, total) {
    var b = el('div', { cls: 'bar', role: 'img', 'aria-label': C.CLASSES.map(function (k) { return counts[k] + ' ' + CLASS_LABEL[k]; }).join(', ') });
    C.CLASSES.forEach(function (k) { if (counts[k]) b.appendChild(el('span', { cls: k, style: 'flex:' + counts[k] + ' 0 0', title: counts[k] + ' ' + CLASS_LABEL[k] })); });
    if (!total) b.appendChild(el('span', { style: 'flex:1 0 0' }));
    return b;
  }
  function renderRepos() {
    var box = $('repos');
    box.textContent = '';
    REPOS.forEach(function (R) {
      var cr = censusOf(R.key).r, p = packOf(R.key), c = cr.counts;
      var btn = el('button', { cls: 'repo', type: 'button', 'aria-pressed': String(state.repo === R.key), 'data-repo': R.key }, [
        el('div', { cls: 'name', text: cr.label }),
        el('div', { cls: 'sub' }, [code(p.id + ' @ ' + short(p.commit)), ' · ' + plural(c.candidates, 'test file') + ' · ' + (cr.workflows.length ? plural(cr.workflows.length, 'workflow') : 'no workflow')]),
        stackBar(c, c.candidates),
        el('div', { cls: 'counts' }, C.CLASSES.map(function (k) { return el('span', { 'data-count': k }, [chip(k, String(c[k])), ' ' + CLASS_LABEL[k]]); })),
        el('div', { cls: 'head', text: headline(cr) }),
      ]);
      btn.addEventListener('click', function () { selectRepo(R.key); });
      box.appendChild(btn);
    });
    var lg = $('legend');
    lg.textContent = '';
    C.CLASSES.forEach(function (k) { lg.appendChild(chip(k, CLASS_LABEL[k])); lg.appendChild(document.createTextNode(CLASS_HELP[k] + '.  ')); });
  }

  // ---------------------------------------------------------------- the map
  function routeOptions(r) {
    var sel = $('route');
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: 'every route (class view)' }));
    var groups = [
      ['CI steps', r.entries.filter(function (e) { return e.kind === 'ci' && e.reach.length; })],
      ['package.json scripts', r.entries.filter(function (e) { return e.kind === 'script' && e.reach.length; })],
      ['documented suite commands (reach two or more files)', r.entries.filter(function (e) { return e.kind === 'doc' && e.reach.length >= 2; })],
    ];
    groups.forEach(function (g) {
      if (!g[1].length) return;
      var og = el('optgroup', { label: g[0] });
      g[1].forEach(function (e) { og.appendChild(el('option', { value: e.id, text: (e.kind === 'ci' ? e.command + ' [job ' + e.job + ']' : e.kind === 'script' ? e.command + ' [' + e.file + ']' : e.command + ' [' + e.sources[0] + ']') + ' → ' + e.reach.length })); });
      sel.appendChild(og);
    });
    if (state.route && !r.entries.some(function (e) { return e.id === state.route; })) state.route = '';
    sel.value = state.route;
  }
  function commitOptions() {
    var sel = $('commit');
    sel.textContent = '';
    var R = REPOS.filter(function (x) { return x.key === state.repo; })[0];
    R.commits.forEach(function (k, i) {
      var p = packOf(k);
      sel.appendChild(el('option', { value: k, text: short(p.commit) + (i === 0 ? ' (pinned head)' : ' (historical)') }));
    });
    sel.value = state.pack;
    sel.disabled = R.commits.length < 2;
  }
  function renderFilters(r) {
    var box = $('filters');
    box.textContent = '';
    C.CLASSES.forEach(function (k) {
      var cb = el('input', { type: 'checkbox', id: 'show-' + k });
      cb.checked = !!state.show[k];
      cb.addEventListener('change', function () { state.show[k] = cb.checked; renderMap(); });
      box.appendChild(el('label', { for: 'show-' + k }, [cb, chip(k, CLASS_LABEL[k]), ' ' + r.counts[k]]));
    });
  }
  function fileRow(r, f, route) {
    var reached = route ? route.reach.indexOf(f.path) >= 0 : null;
    var cond = route ? route.conditionalReach.indexOf(f.path) >= 0 : f.conditional;
    var head = el('div', { cls: 'fhead' }, [
      el('span', { cls: 'fname', text: C.basename(f.path) }),
      chip(f.class, CLASS_LABEL[f.class]),
      cond ? chip('cond', 'conditional') : null,
      route ? chip(reached ? 'hit' : 'miss', reached ? 'reached' : 'not reached') : null,
      f.allowed ? chip('cond', 'allowed') : null,
    ]);
    var via = el('ul', { cls: 'via' });
    var seen = {};
    f.routes.forEach(function (x) {
      var e = r.entries.filter(function (y) { return y.id === x.entry; })[0];
      if (!e) return;
      var key = e.id + '|' + x.conditions.join('|');
      if (seen[key]) return;
      seen[key] = 1;
      var li = el('li', null, [entryLabel(r, e)]);
      x.conditions.forEach(function (c) { li.appendChild(el('span', { cls: 'q', text: ' — only ' + c })); });
      x.fileConditions.forEach(function (c) { li.appendChild(el('span', { cls: 'q', text: ' — ' + c.text + (c.satisfied === true ? ' (installed here)' : c.satisfied === false ? ' (NOT installed by this route)' : ' (install unknown)') })); });
      via.appendChild(li);
    });
    if (!f.routes.length) via.appendChild(el('li', { text: 'no runner, CI step or documented command launches it' }));
    if (f.declared) via.appendChild(el('li', { text: 'a candidate because ' + f.declared }));
    if (f.mentions && f.mentions.length) via.appendChild(el('li', { text: 'named, not as a command, in docs/config at ' + f.mentions.map(function (m) { return m.file + ':' + m.line; }).join(', ') }));
    return el('li', { cls: 'file' + (route && !reached ? ' dim' : ''), 'data-path': f.path, 'data-class': f.class }, [head, via]);
  }
  function renderMap() {
    var cr = censusOf(state.pack), r = cr.r, p = packOf(state.pack);
    $('map-title').textContent = r.label + ' @ ' + short(p.commit) + ': who reaches what';
    var route = state.route ? r.entries.filter(function (e) { return e.id === state.route; })[0] : null;
    var sum = $('route-summary');
    sum.textContent = '';
    if (route) {
      var ciSet = {};
      r.entries.forEach(function (e) { if (e.kind === 'ci') e.reach.forEach(function (x) { ciSet[x] = 1; }); });
      var ciN = Object.keys(ciSet).length;
      var missCi = Object.keys(ciSet).filter(function (x) { return route.reach.indexOf(x) < 0; }).length;
      sum.appendChild(code(route.command));
      sum.appendChild(document.createTextNode(' (' + (route.kind === 'doc' ? route.sources.length + ' place' + (route.sources.length === 1 ? '' : 's') + ', first ' + route.sources[0] : route.source) + ') reaches '));
      sum.appendChild(el('strong', { text: route.reach.length + ' of ' + r.counts.candidates }));
      sum.appendChild(document.createTextNode(' test files' + (route.conditionalReach.length ? ', ' + route.conditionalReach.length + ' of them only under a quoted condition' : '') + '.'));
      if (route.kind !== 'ci' && ciN) sum.appendChild(document.createTextNode(' Of the ' + ciN + ' files CI runs, it misses ' + missCi + '.'));
      if (route.kind === 'doc' && route.claimSources.length) sum.appendChild(document.createTextNode(' Presented as the suite at ' + route.claimSources.join(', ') + '.'));
    } else {
      sum.textContent = plural(r.counts.candidates, 'test file') + ' in ' + plural(groupDirs(r.files).length, 'folder') + '. Open a folder to see every route to each file; pick a runner above to see what it misses.';
    }
    var box = $('map');
    box.textContent = '';
    groupDirs(r.files).forEach(function (g) {
      var vis = g.files.filter(function (f) { return state.show[f.class]; });
      if (!vis.length) return;
      var counts = { ci: 0, 'ci-less': 0, manual: 0, orphan: 0 };
      vis.forEach(function (f) { counts[f.class]++; });
      var hit = route ? vis.filter(function (f) { return route.reach.indexOf(f.path) >= 0; }).length : null;
      var d = el('details', { cls: 'dir', 'data-dir': g.dir });
      var nonCi = vis.some(function (f) { return f.class !== 'ci'; });
      if ((nonCi && vis.length <= 15) || (route && hit < vis.length && vis.length <= 15)) d.open = true;
      d.appendChild(el('summary', null, [
        el('span', { cls: 'dname', text: (g.dir || '.') + '/' }),
        stackBar(counts, vis.length),
        el('span', { cls: 'dcount', text: route ? hit + ' of ' + vis.length + ' reached' : plural(vis.length, 'file') }),
      ]));
      var ul = el('ul', { cls: 'files' });
      vis.forEach(function (f) { ul.appendChild(fileRow(r, f, route)); });
      d.appendChild(ul);
      box.appendChild(d);
    });
    if (!box.childNodes.length) box.appendChild(el('p', { cls: 'muted', text: 'No file in the classes ticked above.' }));
  }
  function groupDirs(files) {
    var m = {}, order = [];
    files.forEach(function (f) { var d = C.dirname(f.path); if (!m[d]) { m[d] = []; order.push(d); } m[d].push(f); });
    return order.sort().map(function (d) { return { dir: d, files: m[d] }; });
  }

  // ---------------------------------------------------------------- findings
  function renderFindings() {
    var r = censusOf(state.pack).r, box = $('findings');
    box.textContent = '';
    var add = function (cls, title, kids) { box.appendChild(el('div', { cls: 'finding ' + cls }, [el('h3', { text: title })].concat(kids))); };
    if (r.fatal.length) {
      box.appendChild(el('div', { cls: 'refusal' }, [el('strong', { text: 'Census incomplete. ' }), plural(r.fatal.length, 'runner definition') + ' could not be read; files below may be reached by them, and the CLI exits 2.',
        el('ul', null, r.fatal.map(function (f) { return el('li', null, [f.entry + ': ', code(String(f.what)), ' — ' + f.why]); }))]));
    }
    if (!r.workflows.length) add('orphan', 'No CI workflow', [el('p', { text: 'There is no .github/workflows file at this commit, so nothing runs on a push or a pull request. Every runner below is run by hand.' })]);
    var orph = r.files.filter(function (f) { return f.class === 'orphan'; });
    if (orph.length) add('orphan', plural(orph.length, 'orphan') + ': nothing launches ' + (orph.length === 1 ? 'it' : 'them'), [el('ul', null, orph.map(function (f) {
      return el('li', null, [code(f.path), f.declared ? el('div', { cls: 'src', text: 'a candidate because ' + f.declared }) : null,
        f.mentions && f.mentions.length ? el('div', { cls: 'src', text: 'named, not as a command, in docs/config (Markdown, HTML, YAML, JSON; not source comments) at ' + f.mentions.map(function (m) { return m.file + ':' + m.line; }).join(', ') }) : null]);
    }))]);
    r.drift.forEach(function (d) {
      add('ci-less', 'Doc drift: ' + d.command, [el('p', null, [code(d.command), ' reaches ' + d.reach + ' of the ' + d.ciReach + ' files CI runs; it misses ' + d.missing.length + ': ' + C.describeSet(d.missing, 3) + '.']),
        d.claimSources.length ? el('p', { cls: 'src', text: 'Presented as the test suite at ' + d.claimSources.join(', ') + '.' }) : null,
        el('p', { cls: 'src', text: 'Written in ' + plural(d.sources.length, 'place') + ': ' + d.sources.slice(0, 6).join(', ') + (d.sources.length > 6 ? ' and ' + (d.sources.length - 6) + ' more' : '') + '.' })]);
    });
    var less = r.files.filter(function (f) { return f.class === 'ci-less'; });
    if (less.length && r.workflows.length) {
      var by = {};
      less.forEach(function (f) {
        var labels = f.routes.filter(function (x) { return x.kind !== 'ci'; }).map(function (x) { var e = r.entries.filter(function (y) { return y.id === x.entry; })[0]; return e && (e.kind === 'script' || e.reach.length >= 2) ? entryLabel(r, e) : null; }).filter(Boolean);
        var k = labels.filter(function (v, i) { return labels.indexOf(v) === i; }).slice(0, 2).join('; ');
        (by[k] = by[k] || []).push(f.path);
      });
      add('ci-less', plural(less.length, 'CI-less file') + ': a runner reaches them, no CI step runs it', [el('ul', null, Object.keys(by).map(function (k) { return el('li', null, [C.describeSet(by[k], 4), el('div', { cls: 'src', text: 'via ' + k })]); }))]);
    } else if (less.length) add('ci-less', plural(less.length, 'file') + ' reached by a runner, none by CI', [el('p', { text: C.describeSet(less.map(function (f) { return f.path; }), 3) })]);
    var man = r.files.filter(function (f) { return f.class === 'manual'; });
    if (man.length) add('manual', plural(man.length, 'file') + ' reached only by one-file commands in the docs', [el('p', { text: C.describeSet(man.map(function (f) { return f.path; }), 0) + '. Each is launched by hand, one at a time; no suite command reaches them.' })]);
    r.docBroken.forEach(function (d) {
      add('orphan', 'A documented command that reaches nothing', [el('p', null, [code(d.command), ' at ' + d.sources.join(', ')]), el('p', { cls: 'src', text: d.why.filter(function (v, i, a) { return a.indexOf(v) === i; }).join('; ') })]);
    });
    var skips = r.files.filter(function (f) { return f.routes.some(function (x) { return x.fileConditions.length; }); });
    if (skips.length) add('manual', plural(skips.length, 'file') + ' that skip themselves whole unless a module is importable', [el('ul', null, skips.map(function (f) {
      var fc = f.routes.filter(function (x) { return x.fileConditions.length; });
      return el('li', null, [code(fc[0].fileConditions[0].text), el('div', { cls: 'src', text: fc.map(function (x) { var e = r.entries.filter(function (y) { return y.id === x.entry; })[0]; var s = x.fileConditions.every(function (c) { return c.satisfied === true; }) ? 'installed' : x.fileConditions.some(function (c) { return c.satisfied === false; }) ? 'NOT installed' : 'install unknown'; return entryLabel(r, e) + ': ' + s; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' · ') })]);
    }))]);
    var cond = r.entries.filter(function (e) { return e.conditionalReach.length; });
    if (cond.length) add('note', 'Conditional routes', [el('ul', null, cond.map(function (e) {
      var f = r.files.filter(function (x) { return x.path === e.conditionalReach[0]; })[0];
      var rt = f && f.routes.filter(function (x) { return x.entry === e.id && x.conditions.length; })[0];
      return el('li', null, [C.describeSet(e.conditionalReach, 4) + ' via ', code(e.command), el('div', { cls: 'src', text: 'only ' + (rt ? rt.conditions.join(' & ') : 'under a condition') })]);
    }))]);
    if (r.docNotUnderstood.length) {
      var det = el('details', { cls: 'unread' }, [el('summary', { text: plural(r.docNotUnderstood.length, 'documented command') + ' the census could not read (not counted; the CLI lists them with --verbose)' }),
        el('ul', null, r.docNotUnderstood.map(function (d) { return el('li', null, [code(d.command), ' at ' + d.sources[0] + (d.sources.length > 1 ? ' +' + (d.sources.length - 1) : ''), el('div', { cls: 'src', text: d.why.filter(function (v, i, a) { return a.indexOf(v) === i; }).join('; ') })]); }))]);
      box.appendChild(el('div', { cls: 'finding note' }, [det]));
    }
    if (!box.childNodes.length) box.appendChild(el('p', { text: 'Every test file is reached by a CI step, unconditionally.' }));
  }

  // ---------------------------------------------------------------- try a command
  function cwdOptions() {
    var t = censusOf(state.pack).tree, sel = $('cwd');
    var dirs = [''];
    t.files.forEach(function (f) { if (/(^|\/)package\.json$/.test(f) && f.split('/').indexOf('node_modules') < 0) dirs.push(C.dirname(f)); });
    censusOf(state.pack).r.files.forEach(function (f) { dirs.push(f.path.split('/')[0] === f.path ? '' : f.path.split('/')[0]); dirs.push(C.dirname(f.path)); });
    dirs = dirs.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    sel.textContent = '';
    dirs.forEach(function (d) { sel.appendChild(el('option', { value: d, text: d ? d + '/' : 'repository root' })); });
  }
  function renderExamples() {
    var box = $('examples');
    box.textContent = '';
    (EXAMPLES[state.repo] || []).forEach(function (x) {
      var b = el('button', { type: 'button', text: (x[1] ? 'cd ' + x[1] + ' && ' : '') + x[0] });
      b.addEventListener('click', function () { $('cmd').value = x[0]; $('cwd').value = x[1]; tryCommand(); });
      box.appendChild(b);
    });
  }
  function tryCommand() {
    var cr = censusOf(state.pack), out = $('tryout');
    var cmd = $('cmd').value.trim();
    out.textContent = '';
    if (!cmd) { out.appendChild(el('p', { cls: 'muted', text: 'Type a command, or pick one above.' })); return; }
    var res;
    try {
      res = C.evaluateCommand(cr.tree, cmd, { cwd: $('cwd').value, node: Number($('node').value), shell: $('shell').value, candidates: C.inventory(cr.tree) });
    } catch (e) {
      out.appendChild(el('div', { cls: 'refusal' }, [el('strong', { text: 'Not evaluated. ' }), 'The census raised an error on this command (' + e.message + '); it reports nothing rather than guess.']));
      return;
    }
    var n = res.reach.length;
    if (res.notUnderstood.length) {
      out.appendChild(el('div', { cls: 'refusal' }, [el('strong', { text: 'Not understood. ' }), 'Part of this command is something the census does not model or cannot read, so the files it might launch are not counted as reached:',
        el('ul', null, res.notUnderstood.map(function (x) { return el('li', null, [code(String(x.what)), ' — ' + x.why]); }))]));
    }
    if (res.broken.length) {
      out.appendChild(el('div', { cls: 'refusal' }, [el('strong', { text: 'Broken. ' }), 'Run as written, this fails or launches nothing for these reasons:',
        el('ul', null, res.broken.map(function (x) { return el('li', null, [code(String(x.what)), ' — ' + x.why]); }))]));
    }
    out.appendChild(el('p', { cls: 'big', text: (res.notUnderstood.length && !n ? 'No test file counted as reached' : 'Reaches ' + plural(n, 'test file')) + (res.conditional.length ? ' (' + res.conditional.length + ' only under a condition)' : '') }));
    if (n) {
      var groups = groupDirs(res.reach.map(function (p) { return { path: p }; }));
      out.appendChild(el('ul', null, groups.map(function (g) {
        return el('li', null, [code((g.dir || '.') + '/'), ' ' + g.files.length + (g.files.length <= 6 ? ': ' + g.files.map(function (f) { return C.basename(f.path); }).join(', ') : '')]);
      })));
    }
    if (res.conditional.length) {
      var c0 = res.routes[res.conditional[0]][0];
      out.appendChild(el('p', { cls: 'line' }, ['Conditional: ' + C.describeSet(res.conditional, 3) + ' — only ', el('span', { cls: 'q', text: c0.conditions.join(' & ') })]));
    }
    res.versionNotes.forEach(function (v) {
      out.appendChild(el('p', { cls: 'line', text: 'Node version matters here: Node ' + v.primary.node + ' reaches ' + v.primary.files + (v.primary.problems.length ? ' and fails' : '') + '; Node ' + v.other.node + ' would reach ' + v.other.files + (v.other.problems.length ? ' and fail' : '') + '.' }));
    });
    if (res.nonCandidates.length) out.appendChild(el('p', { cls: 'line muted', text: 'Also launched, but not named like a test file (not counted): ' + C.describeSet(res.nonCandidates, 4) + '.' }));
    res.notes.forEach(function (x) { out.appendChild(el('p', { cls: 'line muted', text: 'Note: ' + x.why })); });
    if (res.others.length) out.appendChild(el('p', { cls: 'line muted', text: 'Other programs on the line (launch no test file): ' + res.others.slice(0, 6).join(' | ') + (res.others.length > 6 ? ' …' : '') }));
  }

  // ---------------------------------------------------------------- policy
  function renderPolicy() {
    var failOn = $('failon').value;
    var trees = REPOS.map(function (R) { return censusOf(R.key).tree; });
    var res = C.census(trees, { failOn: failOn });
    var box = $('policy');
    box.textContent = '';
    box.appendChild(el('p', { cls: 'big', text: 'exit ' + res.exit }));
    box.appendChild(el('p', { text: res.exit === 2 ? 'Census incomplete: a CI step or package script could not be read.' : res.exit === 1 ? plural(res.failing.length, 'file') + ' at or beyond "' + failOn + '" across the three pinned heads, and no allow list:' : 'No file at or beyond "' + failOn + '".' }));
    if (res.failing.length) {
      var by = {};
      res.failing.forEach(function (f) { (by[f.repo] = by[f.repo] || []).push(f.path); });
      box.appendChild(el('ul', null, Object.keys(by).map(function (k) { return el('li', null, [code(k), ': ' + C.describeSet(by[k], 3)]); })));
    }
    box.appendChild(el('p', { cls: 'muted', text: 'The CLI does the same over live checkouts: node reach-census.mjs <checkout>… --fail-on ' + failOn + ' exits 0 clean, 1 with files at or beyond the class (an --allow list of {glob, reason, cite} entries excuses intentional ones), 2 when the census is incomplete, 3 on a usage error.' }));
  }

  // ---------------------------------------------------------------- how it works
  function renderHow() {
    var box = $('how');
    box.textContent = '';
    box.appendChild(el('p', { text: 'A test file is any tracked *.test.* or *.spec.* JavaScript/TypeScript file, test_*.py or *_test.py, plus files a repository declares in census.config.json (PartForge\'s browser harness scripts, Skyhook\'s tools/twin/verify.mjs). For each one the census collects every route that launches it: workflow run steps (.github/workflows/*.yml, with each job\'s setup-node version), every package.json script (following npm run, pre/post hooks, cd, && and ||, tsc output folders), runner commands written in the Markdown, and two runner-script shapes it reads as text: a list/readdir launcher with existsSync conditions (PartForge\'s tests/run.mjs) and a recursive directory walker (Aster\'s tools/run-tests.mjs). Shell globs are expanded the way sh or bash would; node --test arguments the way Node 20 (paths, directory search) or Node 21+ (globs; a directory fails) would; pytest with its default collection rules and module-level importorskip lines.' }));
    box.appendChild(el('p', { text: 'Its model of Node, the shells, pytest and YAML was checked against the real things: Node 20.19.5, 22.22.0 and 24.18.0 on a fixture tree (oracle/node-behaviour.json), fs.globSync, dash and bash at test time, PyYAML on the workflows (oracle/yaml-behaviour.json), and the repositories\' own runners at the pinned commits (oracle/runners.json, oracle/pytest.txt).' }));
    var ul = el('ul');
    Object.keys(P).sort().forEach(function (k) {
      var p = P[k];
      ul.appendChild(el('li', null, [code('snapshots/pack-' + k + '.js'), ': ' + p.id + ' @ ' + short(p.commit) + ', ' + (p.fileCount || 0) + ' tracked files, built from ' + p.built + '; ' + p.docs + (p.why ? '. Pinned because ' + p.why : '') + '.']));
    });
    box.appendChild(ul);
    box.appendChild(el('p', { cls: 'muted', text: 'What it cannot see: whether a launched file passes, dependencies a runner needs other than the quoted existsSync and importorskip conditions, branch filters on workflow triggers, and any runner shape it does not read (those are refused, never counted).' }));
  }

  // ---------------------------------------------------------------- wiring
  function selectRepo(key) {
    state.repo = key;
    state.pack = key;
    state.route = '';
    $('cmd').value = (EXAMPLES[key] || [['']])[0][0];
    renderAll();
    try { history.replaceState(null, '', '#' + key); } catch (e) { /* file:// in some browsers */ }
  }
  function renderAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.repo'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-repo') === state.repo)); });
    var r = censusOf(state.pack).r;
    commitOptions();
    routeOptions(r);
    renderFilters(r);
    renderMap();
    renderFindings();
    cwdOptions();
    $('cwd').value = '';
    renderExamples();
    tryCommand();
  }
  function init() {
    if (!C || !P.aster || !P.partforge || !P.skyhook) {
      document.querySelector('main').insertBefore(el('div', { cls: 'refusal' }, [el('strong', { text: 'Data missing. ' }), 'census.js or a pack in snapshots/ did not load, so there is nothing to count. Open index.html from inside its folder.']), document.querySelector('main').firstChild);
      return;
    }
    var h = (location.hash || '').replace('#', '');
    if (REPOS.some(function (R) { return R.key === h; })) { state.repo = h; state.pack = h; }
    renderRepos();
    $('cmd').value = EXAMPLES[state.repo][0][0];
    $('route').addEventListener('change', function () { state.route = $('route').value; renderMap(); });
    $('commit').addEventListener('change', function () { state.pack = $('commit').value; state.route = ''; renderAll(); });
    var t = null;
    $('cmd').addEventListener('input', function () { clearTimeout(t); t = setTimeout(tryCommand, 150); });
    ['cwd', 'node', 'shell'].forEach(function (id) { $(id).addEventListener('change', tryCommand); });
    $('failon').addEventListener('change', renderPolicy);
    renderAll();
    renderPolicy();
    renderHow();
  }
  init();
})();
