/* Line Drift page: renders the saved run in report-data.js and runs linedrift.js on pasted text.
 * Everything is set as text (never as HTML). No network, no storage. */
(function () {
  'use strict';
  const L = window.LineDrift;
  const D = window.LINE_DRIFT_DATA;
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const fmt = (n) => Number(n).toLocaleString('en-US');

  // What a hand check found, grouped for the chart.
  const GROUPS = [
    { id: 'fix', label: 'needs a fix', classes: ['stale-line', 'stale-claim', 'off-when-written', 'misquote'] },
    { id: 'expected', label: 'true, nothing to fix', classes: ['acknowledged', 'history', 'plan', 'not-in-repo'] },
    { id: 'limit', label: 'tool limit', classes: ['tool-error', 'shorthand'] },
  ];
  const groupOf = (cls) => (GROUPS.find((g) => g.classes.includes(cls)) || { id: 'none', label: 'not adjudicated' });
  const CLASS_LABEL = {
    'stale-line': 'stale line number', 'stale-claim': 'stale claim', 'off-when-written': 'off when written', misquote: 'misquote',
    acknowledged: 'acknowledged by the document', history: 'history, right at its commit', plan: 'a plan or proposal', 'not-in-repo': 'not in this repository',
    'tool-error': 'tool error (mispaired snippet)', shorthand: 'shorthand file name',
  };
  const STATUS_TONE = {
    OK: 's-ok', PARTIAL: 's-warn', MOVED: 's-warn', 'IN-RANGE': 's-na', GONE: 's-bad', 'PAST-EOF': 's-bad', 'MISSING-PATH': 's-bad',
    IGNORED: 's-bad', UNTRACKED: 's-bad', 'UNREACHABLE-COMMIT': 's-bad', 'NOT-A-COMMIT': 's-na', UNCHECKABLE: 's-na',
  };
  const badge = (s) => el('span', { class: `badge ${STATUS_TONE[s] || 's-na'}`, text: s });

  const F = D.findings;
  const C = D.checkout;
  const FULL = D.full;
  const DRIFT = [...L.DRIFT];

  // ------------------------------------------------------------------------------------------
  // Headline

  function tiles() {
    const by = C.counts.byStatus;
    const kinds = ['line', 'path', 'commit'].map((k) => Object.values(C.counts.byKind[k]).reduce((a, b) => a + b, 0));
    const drift = DRIFT.reduce((a, s) => a + (by[s] || 0), 0);
    const g = (id) => F.filter((f) => groupOf(f.cls).id === id);
    const cnt = (list, cls) => list.filter((f) => f.cls === cls).length;
    const fix = g('fix');
    const exp = g('expected');
    const lim = g('limit');
    const commitsTotal = kinds[2] - C.findings_hashLike;
    const tiles = [
      { id: 't-refs', big: fmt(C.counts.total), lbl: `references in ${C.docs.length} documents`, det: `${fmt(kinds[0])} line citations · ${fmt(kinds[1])} paths · ${fmt(kinds[2])} commit-shaped tokens` },
      { id: 't-drift', big: fmt(drift), lbl: 'drift findings', det: `${DRIFT.filter((s) => by[s]).map((s) => `${s} ${by[s]}`).join(' · ')}; plus PARTIAL ${by.PARTIAL || 0}` },
      { id: 't-fix', big: fmt(fix.length), lbl: 'need a fix (hand check)', det: ['stale-line', 'stale-claim', 'off-when-written', 'misquote'].map((c) => `${CLASS_LABEL[c]} ${cnt(fix, c)}`).join(' · ') },
      { id: 't-exp', big: fmt(exp.length), lbl: 'true at HEAD, nothing to fix', det: ['acknowledged', 'history', 'plan', 'not-in-repo'].map((c) => `${c.replace(/-/g, ' ')} ${cnt(exp, c)}`).join(' · ') },
      { id: 't-lim', big: fmt(lim.length), lbl: 'tool limits (false alarms)', det: `mispaired snippet ${cnt(lim, 'tool-error')} · shorthand name ${cnt(lim, 'shorthand')}` },
    ];
    if (FULL) {
      const fc = FULL.counts.byKind.commit;
      tiles.push({ id: 't-commits', big: `${fmt(fc.OK || 0)} of ${fmt(commitsTotal)}`, lbl: 'commit references resolve', det: `in a full-history clone (${fmt(FULL.git.commits)} commits); the shallow checkout can check ${fmt(C.counts.byKind.commit.OK || 0)}` });
    }
    $('tiles').replaceChildren(...tiles.map((t) => el('li', { class: 'tile', id: t.id }, el('div', { class: 'big', text: t.big }), el('div', { class: 'lbl', text: t.lbl }), el('div', { class: 'det', text: t.det }))));
    const b = C.git.boundary && C.git.boundary[0];
    $('run-note').textContent = `Saved run of line-drift.mjs on Aster at ${D.commit.slice(0, 7)} (${C.git.date.slice(0, 10)})${C.git.shallow ? `, a shallow clone of ${fmt(C.git.commits)} commits whose history starts at ${b ? `${b.commit.slice(0, 7)}, ${b.date.slice(0, 10)}` : 'its boundary'}` : ''}. ${FULL ? `History and commit checks come from a full-history clone at the same commit (${fmt(FULL.git.commits)} commits); its ${F.length} drift and PARTIAL findings are the same.` : ''} Hand verdicts: adjudication.json.`;
  }

  // ------------------------------------------------------------------------------------------
  // Chart: findings per document, stacked by group

  const state = { status: 'all', group: 'all', doc: 'all', text: '' };

  function chart() {
    const docs = new Map();
    for (const f of F) {
      const d = docs.get(f.doc) || { doc: f.doc, total: 0, fix: 0, expected: 0, limit: 0 };
      d.total++;
      d[groupOf(f.cls).id]++;
      docs.set(f.doc, d);
    }
    const rows = [...docs.values()].sort((a, b) => b.total - a.total || a.doc.localeCompare(b.doc));
    const max = Math.max(...rows.map((r) => r.total));
    $('legend').replaceChildren(...GROUPS.map((g) => el('li', {}, el('span', { class: `sw g-${g.id}`, 'aria-hidden': 'true' }), `${g.label} (${F.filter((f) => groupOf(f.cls).id === g.id).length})`)));
    const tip = $('tip');
    const show = (e, text) => {
      tip.textContent = text;
      tip.hidden = false;
      const r = (e.currentTarget || e.target).getBoundingClientRect();
      const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left));
      tip.style.left = `${x}px`;
      tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
    };
    const hide = () => { tip.hidden = true; };
    $('chart').replaceChildren(...rows.map((r) => {
      const track = el('div', { class: 'track', style: `width:${(100 * r.total / max).toFixed(2)}%` });
      for (const g of GROUPS) {
        if (!r[g.id]) continue;
        const label = `${r.doc}: ${r[g.id]} ${g.label}`;
        track.append(el('button', {
          type: 'button', class: `seg g-${g.id}`, style: `flex:${r[g.id]} 1 0`, 'aria-label': label, 'data-doc': r.doc, 'data-group': g.id,
          onpointerenter: (e) => show(e, label), onpointerleave: hide, onfocus: (e) => show(e, label), onblur: hide,
          onclick: () => {
            Object.assign(state, { status: 'all', group: g.id, doc: r.doc, text: '' });
            syncControls();
            render();
            hide();
            $('h-find').scrollIntoView({ block: 'start' });
          },
        }));
      }
      return el('div', { class: 'bar-row' }, el('span', { class: 'doc', text: r.doc }), track, el('span', { class: 'n', text: r.total }));
    }));
  }

  // ------------------------------------------------------------------------------------------
  // Findings list

  function controls() {
    const statuses = ['all', ...DRIFT.filter((s) => C.counts.byStatus[s]), 'PARTIAL'];
    $('chips').replaceChildren(...statuses.map((s) => el('button', {
      type: 'button', class: 'chip', 'data-status': s, 'aria-pressed': String(state.status === s),
      text: s === 'all' ? `all ${F.length}` : `${s} ${F.filter((f) => f.status === s).length}`,
      onclick: () => { state.status = s; syncControls(); render(); },
    })));
    const gsel = $('f-group');
    gsel.replaceChildren(el('option', { value: 'all', text: 'everything' }));
    for (const g of GROUPS) {
      gsel.append(el('option', { value: g.id, text: `${g.label} (all)` }));
      const og = el('optgroup', { label: g.label });
      for (const c of g.classes) og.append(el('option', { value: `c:${c}`, text: `${CLASS_LABEL[c]} (${F.filter((f) => f.cls === c).length})` }));
      gsel.append(og);
    }
    gsel.addEventListener('change', () => { state.group = gsel.value; render(); });
    const dsel = $('f-doc');
    dsel.replaceChildren(el('option', { value: 'all', text: 'all documents' }), ...[...new Set(F.map((f) => f.doc))].sort().map((d) => el('option', { value: d, text: d })));
    dsel.addEventListener('change', () => { state.doc = dsel.value; render(); });
    $('f-text').addEventListener('input', (e) => { state.text = e.target.value; render(); });
  }

  function syncControls() {
    for (const b of document.querySelectorAll('#chips .chip')) b.setAttribute('aria-pressed', String(b.dataset.status === state.status));
    $('f-group').value = state.group;
    $('f-doc').value = state.doc;
    $('f-text').value = state.text;
    for (const s of document.querySelectorAll('.seg')) s.classList.toggle('sel', s.dataset.doc === state.doc && s.dataset.group === state.group);
  }

  function matches(f) {
    if (state.status !== 'all' && f.status !== state.status) return false;
    if (state.group !== 'all') {
      if (state.group.startsWith('c:')) { if (f.cls !== state.group.slice(2)) return false; }
      else if (groupOf(f.cls).id !== state.group) return false;
    }
    if (state.doc !== 'all' && f.doc !== state.doc) return false;
    if (state.text) {
      const q = state.text.toLowerCase();
      const hay = [f.doc, f.raw, f.note, f.sentence, f.why, f.history, f.target].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function card(f) {
    const g = groupOf(f.cls);
    const kids = [
      el('div', { class: 'head' }, badge(f.status), el('span', { class: 'ref', text: f.raw }), el('span', { class: 'where', text: `${f.doc}:${f.line}` })),
    ];
    const detail = [f.target ? `resolves to ${f.target}` : '', f.note].filter(Boolean).join('; ');
    if (detail) kids.push(el('p', {}, el('span', { class: 'lab', text: 'tool' }), detail));
    if (f.snippet) kids.push(el('p', {}, el('span', { class: 'lab', text: 'snippet' }), el('code', { text: f.snippet.form === 'quote' ? `"${f.snippet.text}"` : f.snippet.text })));
    if (f.history) kids.push(el('p', {}, el('span', { class: 'lab', text: 'history' }), f.history));
    if (f.context) kids.push(el('p', {}, el('span', { class: 'lab', text: 'context' }), f.context));
    kids.push(el('p', { class: 'verdict' },
      el('span', { class: 'cls' }, el('span', { class: `sw g-${g.id}`, 'aria-hidden': 'true' }), el('strong', { text: CLASS_LABEL[f.cls] || 'not adjudicated' })),
      ` (${g.label}). ${f.why || ''}${f.mispaired ? ' The verdict is right; its evidence is not.' : ''}`));
    kids.push(el('details', {}, el('summary', { text: 'the sentence' }), el('p', { text: f.sentence })));
    return el('li', { class: `card k-${g.id}`, 'data-key': f.key, 'data-status': f.status, 'data-cls': f.cls || '' }, ...kids);
  }

  function render() {
    const list = F.filter(matches);
    $('count').textContent = list.length === F.length ? `All ${F.length} findings.` : `${list.length} of ${F.length} findings.`;
    $('cards').replaceChildren(...(list.length ? list.map(card) : [el('li', { class: 'card', text: 'No finding matches these filters.' })]));
    for (const s of document.querySelectorAll('.seg')) s.classList.toggle('sel', s.dataset.doc === state.doc && s.dataset.group === state.group);
  }

  // ------------------------------------------------------------------------------------------
  // Tables

  function tables() {
    const runs = [['the checkout', C], ...(FULL ? [['full history', FULL]] : [])];
    $('counts-sub').textContent = `${fmt(C.counts.total)} references in the checkout run. The two runs differ only in what needs history: commits and the history column.${FULL ? '' : ''}`;
    const head = el('tr', {}, el('th', { text: 'status' }), el('th', { class: 'n', text: 'line' }), el('th', { class: 'n', text: 'path' }), el('th', { class: 'n', text: 'commit' }), el('th', { class: 'n', text: 'total' }), ...(FULL ? [el('th', { class: 'n', text: 'total, full history' })] : []));
    const rows = L.STATUSES.filter((s) => C.counts.byStatus[s] || (FULL && FULL.counts.byStatus[s])).map((s) => el('tr', { 'data-status': s },
      el('td', {}, badge(s)),
      ...['line', 'path', 'commit'].map((k) => el('td', { class: 'n', text: fmt(C.counts.byKind[k][s] || 0) })),
      el('td', { class: 'n', text: fmt(C.counts.byStatus[s] || 0) }),
      ...(FULL ? [el('td', { class: 'n', text: fmt(FULL.counts.byStatus[s] || 0) })] : [])));
    const tot = (r, k) => Object.values(r.counts.byKind[k]).reduce((a, b) => a + b, 0);
    rows.push(el('tr', { class: 'total' }, el('td', { text: 'all' }), ...['line', 'path', 'commit'].map((k) => el('td', { class: 'n', text: fmt(tot(C, k)) })), el('td', { class: 'n', text: fmt(C.counts.total) }), ...(FULL ? [el('td', { class: 'n', text: fmt(FULL.counts.total) })] : [])));
    $('t-status').replaceChildren(el('thead', {}, head), el('tbody', {}, ...rows));

    const dh = el('tr', {}, el('th', { text: 'document' }), ...['refs', 'drift', 'PARTIAL', 'OK', 'IN-RANGE', 'UNCHECKABLE'].map((t) => el('th', { class: 'n', text: t })));
    const drows = C.docs.map((d) => {
      const c = d.counts || {};
      const drift = DRIFT.reduce((a, s) => a + (c[s] || 0), 0);
      return el('tr', {}, el('td', { class: 'doc', text: d.doc }), ...[d.refs, drift, c.PARTIAL || 0, c.OK || 0, c['IN-RANGE'] || 0, (c.UNCHECKABLE || 0) + (c['NOT-A-COMMIT'] || 0)].map((v) => el('td', { class: 'n', text: fmt(v) })));
    });
    $('t-docs').replaceChildren(el('thead', {}, dh), el('tbody', {}, ...drows));

    const reasons = new Map();
    for (const [i, [, r]] of runs.entries()) for (const u of r.unchecked) {
      const row = reasons.get(u.reason) || [0, 0];
      row[i] = u.n;
      reasons.set(u.reason, row);
    }
    const uh = el('tr', {}, el('th', { text: 'reason' }), ...runs.map(([name]) => el('th', { class: 'n', text: name })));
    $('t-unch').replaceChildren(el('thead', {}, uh), el('tbody', {}, ...[...reasons].map(([k, v]) => el('tr', {}, el('td', { text: k }), ...runs.map((_, i) => el('td', { class: 'n', text: fmt(v[i] || 0) }))))));
  }

  // ------------------------------------------------------------------------------------------
  // Try it

  function tryReset() {
    $('try-doc').value = D.tryIt.docText;
    $('try-doc-path').value = D.tryIt.doc;
    $('try-from').value = D.tryIt.from;
    $('try-file').value = D.tryIt.targetText;
    $('try-file-path').value = D.tryIt.targetPath;
    tryRun();
  }

  function refusal(title, text) {
    return el('div', { class: 'refusal', role: 'status' }, el('strong', { text: title }), ' ', text);
  }

  function tryRun() {
    const out = $('try-out');
    const docText = $('try-doc').value;
    const docPath = $('try-doc-path').value.trim() || 'PASSAGE.md';
    const from = Math.max(1, parseInt($('try-from').value, 10) || 1);
    const filePath = $('try-file-path').value.trim().replace(/^\.\//, '');
    const fileText = $('try-file').value;
    if (!docText.trim()) { out.replaceChildren(refusal('Nothing to check.', 'Paste a Markdown passage that cites a file.')); return; }
    const ex = L.extract(docText, docPath);
    if (!ex.refs.length) {
      out.replaceChildren(refusal('No reference found.', 'Line Drift looks for a backticked or plain path:line citation (a bare :N after one), a backticked path with an extension or ending in /, and 7-12 or 40 hex digits with a digit and a letter. This passage has none.'));
      return;
    }
    const env = {
      files: () => (filePath ? [filePath] : []),
      exists: (p) => (filePath && p === filePath ? 'file' : null),
      read: (p) => (p === filePath ? fileText : null),
      tracked: () => null,
      ignored: () => undefined,
      forceAdded: () => undefined,
    };
    const rows = ex.refs.map((r) => {
      const unitText = ex.units[r.unit].text;
      let status;
      let note;
      if (r.kind === 'commit') {
        status = 'UNCHECKABLE';
        note = r.hashLike ? 'reads as a content hash, not a commit' : 'a browser has no git to look the commit up in';
      } else {
        const res = L.resolvePath(r.path, docPath, env, unitText);
        if (res.status !== 'FOUND') {
          status = 'UNCHECKABLE';
          note = r.path ? `not checked: only ${filePath || 'no file'} is loaded here` : res.reason || 'no path';
        } else {
          const j = L.judge(r, env, unitText);
          status = j.status;
          note = r.kind === 'path' ? 'present in the loaded file name; tracking and ignore rules need git' : (j.note || '').replace(/; exists; tracking not checkable without git$/, '');
          if (r.kind === 'line' && j.status === 'UNCHECKABLE') note = j.note;
        }
      }
      return { r, status, note };
    });
    const items = rows.map(({ r, status, note }) => {
      const snip = (r.snippets || [])[0];
      return el('li', { 'data-ref': r.raw, 'data-status': status, 'data-line': String(r.line + from - 1) },
        el('div', { class: 'head' }, badge(status), el('code', { class: 'ref', text: r.raw }), el('span', { class: 'where', text: `line ${r.line + from - 1}` })),
        note ? el('p', { text: note }) : null,
        snip ? el('p', {}, el('span', { class: 'lab', text: 'snippet' }), el('code', { text: snip.form === 'quote' ? `"${snip.text}"` : snip.text })) : null);
    });
    const moved = rows.filter((x) => x.status === 'MOVED').length;
    out.replaceChildren(
      el('p', { class: 'count', text: `${rows.length} reference${rows.length === 1 ? '' : 's'} found; ${rows.filter((x) => x.status !== 'UNCHECKABLE').length} checked against ${filePath || 'no file'}${moved ? `, ${moved} moved` : ''}.` }),
      el('ol', { class: 'tryres', id: 'try-list' }, ...items),
    );
  }

  // ------------------------------------------------------------------------------------------

  C.findings_hashLike = (C.unchecked.find((u) => /content hash/.test(u.reason)) || { n: 0 }).n;
  tiles();
  chart();
  controls();
  syncControls();
  render();
  tables();
  $('try-run').addEventListener('click', tryRun);
  $('try-reset').addEventListener('click', tryReset);
  tryReset();
})();
