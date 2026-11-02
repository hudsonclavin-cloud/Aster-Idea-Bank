/* corpus.js — the PartForge texts bundled under snapshots/, as one list, each with what the
   app's gate is recorded to have said about it. Used by the CLI (--corpus), the tests and the page.

   Every entry comes from a wrapper build-data.mjs wrote (one per PartForge source file, each with
   its provenance sidecar). The recorded verdict is read from PartForge's own records, never typed:
     tests/dryrun/*.scad     -> tests/dryrun/cases.json  expect.fails (the gate's failure lines)
     tests/templates/*.scad  -> tests/flight-templates-cases.json  expect.fails (all empty)
     docs/runs/<run>/*.scad  -> the line of docs/runs/<run>/README.md that states its verdict
     index.html TEMPLATES / TEMPLATES_FLIGHT -> none recorded, unless the text is byte-identical
                                to a tests/templates fixture (then that fixture's verdict)
   Pure: no DOM, no I/O. Classic script (window.ColdReadCorpusList) and require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ColdReadCorpusList = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The README line that gives a run file's verdict, or null. Table rows ("| 3 | PASS on attempt
  // 2 ... |") are matched by the ring number in the file name; elsewhere the verdict is the nearest
  // bold "**PASS ...**" / "**FAIL ...**" line above the line that links the file.
  function runVerdict(readme, file) {
    const lines = readme.text.split('\n');
    const ring = /^ring(\d+)/.exec(file);
    if (ring) {
      const re = new RegExp('^\\|\\s*' + ring[1] + '\\s*\\|\\s*(.*?)\\s*\\|');
      for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (m) return { text: m[1].replace(/\*\*/g, ''), line: i + 1, path: readme.path };
      }
      return null;
    }
    const link = lines.findIndex((l) => l.includes('(' + file + ')'));
    for (let i = link - 1; i >= 0 && i >= link - 6; i--) {
      const m = /^\*\*((?:PASS|FAIL)[^*]*)\*\*/.exec(lines[i]);
      if (m) return { text: m[1], line: i + 1, path: readme.path };
    }
    return null;
  }

  // entries: the objects the wrappers export (Node: require each; browser: window.ColdReadCorpus).
  function build(entries) {
    const by = (pred) => entries.filter(pred);
    const one = (pred) => entries.find(pred) || null;
    const dry = one((e) => e.kind === 'cases' && e.id === 'dryrun-cases');
    const tpl = one((e) => e.kind === 'cases' && e.id === 'template-cases');
    const T = one((e) => e.kind === 'templates');
    const readmes = by((e) => e.kind === 'doc');
    const list = [];
    const scads = by((e) => e.kind === 'scad').sort((a, b) => (a.group + a.path).localeCompare(b.group + b.path));
    const order = { dryrun: 0, runs: 1, templates: 2 };
    scads.sort((a, b) => order[a.group] - order[b.group] || a.path.localeCompare(b.path));
    for (const e of scads) {
      const file = e.path.split('/').pop();
      let gate = null;
      if (e.group === 'dryrun' && dry) {
        const k = dry.cases.find((c) => c.file === file);
        if (k) gate = { fails: k.expect.fails.slice(), source: 'tests/dryrun/cases.json', note: k.what_happened };
      } else if (e.group === 'templates' && tpl) {
        const k = tpl.cases.find((c) => c.file === 'templates/' + file);
        if (k) gate = { fails: k.expect.fails.slice(), source: 'tests/flight-templates-cases.json' };
      } else if (e.group === 'runs') {
        const dir = e.path.split('/').slice(0, -1).join('/');
        const readme = readmes.find((r) => r.path === dir + '/README.md');
        const v = readme ? runVerdict(readme, file) : null;
        if (v) gate = { verdict: v.text, passed: /^PASS\b/.test(v.text), source: v.path + ':' + v.line };
      }
      list.push({ id: e.path, label: e.path, group: e.group, text: e.text, sha256: e.sha256, gate });
    }
    if (T) {
      T.flight.forEach((t, i) => {
        const same = t.sameAs ? list.find((x) => x.id === t.sameAs) : null;
        list.push({ id: 'index.html#TEMPLATES_FLIGHT[' + i + ']', label: 'index.html TEMPLATES_FLIGHT[' + i + '] ' + t.name, group: 'shipped-flight',
          text: t.code || (same && same.text) || '', sha256: t.sha256, sameAs: t.sameAs || null, gate: same ? same.gate : null });
      });
      T.hobby.forEach((t, i) => list.push({ id: 'index.html#TEMPLATES[' + i + ']', label: 'index.html TEMPLATES[' + i + '] ' + t.name,
        group: 'shipped-hobby', text: t.code, sha256: t.sha256, sameAs: null, gate: null }));
    }
    return list;
  }

  return { build, runVerdict };
});
