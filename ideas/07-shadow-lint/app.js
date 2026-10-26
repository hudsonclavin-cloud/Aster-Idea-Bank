/* The page: renders findings.js (precomputed over the fixtures by build-data.mjs) and runs the same
   ShadowLint logic live on pasted text. No network, no storage. */
(function () {
  'use strict';
  const S = window.ShadowLint, F = window.ShadowFindings, SD = window.ShadowData || {};
  const data = { metric: SD.fasteners_metric, un: SD.fasteners_un, motors: SD.motor_perf };
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (v) => (typeof v === 'number' && isFinite(v)) ? String(+v.toFixed(4)) : String(v);

  function badge(cls) { return el('span', 'badge ' + cls, cls); }

  function renderResult(container, L) {
    container.textContent = '';
    if (L.refusal) {
      const r = el('div', 'refusal');
      r.setAttribute('role', 'status');
      r.appendChild(el('strong', null, 'Refused (' + L.refusal.code + '): ' + L.refusal.reason));
      r.appendChild(el('span', null, 'What would help: ' + L.refusal.what_would_help));
      container.appendChild(r);
      return;
    }
    const r = L.result, d = r.declared;
    container.appendChild(el('p', 'other', (L.label ? L.label + ' — ' : '') + (r.material || 'no material') + ', ' + (r.process || 'no process') + '; declared ' + d.critical + ' critical, ' + d.od + ' od, ' + d.bores + ' bores, ' + d.holes + ' holes, ' + d.revolve + ' revolve, ' + d.gauges + ' gauges, ' + r.rows.length + ' loads' + (r.dropped ? '; ' + r.dropped + ' malformed entries dropped' : '') + (r.demoted ? '; ' + r.demoted + ' source claim' + (r.demoted === 1 ? '' : 's') + ' without a reference demoted to default' : '')));
    const sum = el('div', 'summary');
    sum.appendChild(el('span', 'chip W', r.totals.WITNESSED + ' witnessed'));
    sum.appendChild(el('span', 'chip D', r.totals.DERIVABLE + ' derivable'));
    sum.appendChild(el('span', 'chip U', r.totals.UNWITNESSED + ' unwitnessed'));
    sum.appendChild(el('span', 'chip P', r.totals.POLICY + ' policy'));
    sum.appendChild(el('span', 'chip', 'invention surface ' + r.inventionSurface.length));
    container.appendChild(sum);
    for (const row of r.rows) {
      const h = el('div', 'row-head');
      h.appendChild(el('span', null, row.check + ' "' + row.name + '"'));
      h.appendChild(el('span', 'src', 'inputs_src ' + row.inputs_src + (row.inputs_ref ? ' (' + row.inputs_ref + ')' : '')));
      container.appendChild(h);
      for (const i of row.inputs) {
        const g = el('div', 'input');
        g.appendChild(el('span', 'k', i.key));
        g.appendChild(el('span', 'v', fmt(i.value)));
        const c = el('span', 'c'); c.appendChild(badge(i.class)); g.appendChild(c);
        const w = i.witness.length ? i.witness.join('; also ') + (i.note ? ' — ' + i.note : '') : i.note;
        g.appendChild(el('span', 'w', w));
        container.appendChild(g);
      }
      for (const k of row.missing) {
        const g = el('div', 'input');
        g.appendChild(el('span', 'k', k)); g.appendChild(el('span', 'v', '(missing)')); g.appendChild(el('span', 'c', '—'));
        g.appendChild(el('span', 'w', 'the evaluator refuses this row without it'));
        container.appendChild(g);
      }
      const others = Object.entries(row.other).filter(([k]) => k !== 'inputs_src' && k !== 'inputs_ref');
      if (others.length) container.appendChild(el('p', 'other', 'other keys: ' + others.map(([k, v]) => k + '=' + JSON.stringify(v)).join(', ')));
    }
    if (r.inventionSurface.length) container.appendChild(el('p', 'other', 'Invention surface — inputs no declared geometry can see: ' + r.inventionSurface.join(', ')));
  }

  function renderDiff(container, D) {
    container.textContent = '';
    if (D.refusal) { renderResult(container, D); return; }
    const g = D.geometry;
    const dl = el('dl', 'kv');
    const kv = (k, v) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); };
    kv('files', D.labels[0] + ' → ' + D.labels[1]);
    kv('geometry', g.identicalFiles ? 'the two files are byte-identical' : g.identical ? 'IDENTICAL — code outside comments is byte-identical; only comments changed' : 'changed: ' + g.removed + ' line' + (g.removed === 1 ? '' : 's') + ' removed, ' + g.added + ' added');
    kv('contract floor', Object.keys(D.floor.was).map((k) => k + ' ' + D.floor.was[k] + (D.floor.now[k] === D.floor.was[k] ? '' : '→' + D.floor.now[k])).join(', ') + (D.floor.lost.length ? ' — LOST: ' + D.floor.lost.map((l) => l.category).join(', ') : ' — held'));
    kv('declarations', D.declarations.length ? D.declarations.length + ' change' + (D.declarations.length === 1 ? '' : 's') + ' (information: the CMM re-measures these against the mesh)' : 'unchanged');
    container.appendChild(dl);
    const mv = el('div', 'moved');
    mv.appendChild(el('strong', null, 'loads inputs: ' + (D.moved.length ? D.moved.length + ' change' + (D.moved.length === 1 ? '' : 's') : 'unchanged')));
    for (const m of D.moved) {
      const line = el('div');
      line.appendChild(el('span', null, m.check + ' "' + m.row + '" ' + m.key + ': ' + fmt(m.from) + ' → ' + fmt(m.to) + ' '));
      if (m.before) line.appendChild(badge(m.before));
      if (m.before || m.after) line.appendChild(el('span', null, ' → '));
      if (m.after) line.appendChild(badge(m.after));
      mv.appendChild(line);
    }
    container.appendChild(mv);
    if (D.findings.length) {
      for (const f of D.findings) {
        const fd = el('div', 'finding');
        fd.setAttribute('role', 'status');
        fd.appendChild(badge('FINDING')); fd.appendChild(el('span', null, ' ' + f.code + ': ' + f.text));
        container.appendChild(fd);
      }
    } else {
      const ok = el('div', 'ok');
      ok.appendChild(badge('OK')); ok.appendChild(el('span', null, ' no findings: ' + (g.identical ? 'nothing moved' : 'the geometry changed, the inputs did not, and the floor held')));
      container.appendChild(ok);
    }
    if (D.declarations.length) {
      const pre = el('pre', null, D.declarations.slice(0, 40).map((d) => d.kind + ' "' + d.name + '" ' + d.key + ': ' + fmt(d.from) + ' → ' + fmt(d.to)).join('\n') + (D.declarations.length > 40 ? '\n… ' + (D.declarations.length - 40) + ' more' : ''));
      container.appendChild(pre);
    }
  }

  // --- fixtures
  const fixtureNames = Object.keys(F.fixtures).sort();
  const sel = $('fixture');
  for (const n of fixtureNames) { const o = el('option', null, n); o.value = n; sel.appendChild(o); }
  sel.value = fixtureNames.includes('bulkhead.scad') ? 'bulkhead.scad' : fixtureNames[0];
  const showFixture = () => renderResult($('lint'), F.fixtures[sel.value]);
  sel.addEventListener('change', showFixture);
  showFixture();
  $('commit').textContent = String(F.generated.commit || '').slice(0, 7);

  // --- pairs
  const psel = $('pair');
  F.pairs.forEach((p, i) => { const o = el('option', null, p.refusal ? 'refused pair' : p.labels[0] + ' → ' + p.labels[1]); o.value = String(i); psel.appendChild(o); });
  const showPair = () => renderDiff($('diff'), F.pairs[+psel.value]);
  psel.addEventListener('change', showPair);
  showPair();

  // --- own text
  const run = () => {
    const a = $('own-a').value, b = $('own-b').value;
    const out = $('own');
    if (!a.trim()) { renderResult(out, { refusal: { code: 'insufficient_data', reason: 'nothing pasted', what_would_help: 'the text of a flight-grade .scad file with a FLIGHT block' } }); return; }
    if (b.trim()) renderDiff(out, S.diffAttempts(a, b, data, ['first', 'second']));
    else renderResult(out, S.lint(a, data, 'pasted file'));
  };
  $('run').addEventListener('click', run);
  $('load-sample').addEventListener('click', () => {
    // The synthetic pair is kept as .scad snapshots, which a file:// page cannot fetch; the page
    // carries a minimal declaration instead that reproduces the same shape of edit.
    const A = ['// FLIGHT-BEGIN', '// {"material":"6061-T6","process":"cnc_lathe",', '//  "critical":[{"name":"plate thickness","module":"plate","axis":"z","nominal_mm":10.00,"tol_mm":0.05}],',
      '//  "od":[{"name":"plate OD","d_mm":149.50,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":10}],',
      '//  "bores":[{"name":"case bore","d_mm":98.60,"tol_mm":0.05,"at_mm":[0,0],"axis":"z","from_mm":10,"to_mm":4}],',
      '//  "holes":[{"name":"M6 retention bolts","d_mm":6.40,"tol_mm":0.10,"pattern":"circle","n":8,"bc_d_mm":132.00,"axis":"z","from_mm":10,"to_mm":0}],',
      '//  "loads":[{"check":"bolt_shear","name":"thrust bolts","size":"M6","grade":"8.8","n":8,"force_N":20000,"plate_t_mm":10,"sf_min":2.0}]}', '// FLIGHT-END',
      'tess_tol = 0.01;', 'module plate(){ difference(){ cylinder(d=149.5, h=10); translate([0,0,4]) cylinder(d=98.6, h=7); } }', 'plate();'].join('\n');
    $('own-a').value = A;
    $('own-b').value = A.replace('"force_N":20000', '"force_N":12000').replace('// FLIGHT-BEGIN', '// retry: corrected the inputs\n// FLIGHT-BEGIN');
    run();
  });

  $('foot').textContent = 'Fixtures and fastener rows are snapshots of the PartForge checkout at ' + String(F.generated.commit || '').slice(0, 7) + ' (sidecars under snapshots/). "Witnessed" means a DECLARED dimension matches; nothing on this page measures a mesh. An idea-bank prototype: it has not been through PartForge\'s geometry gate, data-provenance pipeline or skeptic review.';
})();
