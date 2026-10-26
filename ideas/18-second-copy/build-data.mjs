#!/usr/bin/env node
// Derives every snapshot this idea reads from a PartForge checkout as a UMD module (require() for the
// CLI, a classic script for the page) and records each one's provenance with tools/snapshot.mjs
// --sidecar-only, one snapshot per source file. Read-only on the checkout (files and `git show`).
//
//   node ideas/18-second-copy/build-data.mjs [/path/to/Partforge] [--check]
//
// --check: exit 0 if current, 1 if stale; writes nothing.
//
// Writes snapshots/table-<table>.js (second-copy.js EXCERPT of data/tables/<table>.json),
// index-<commit>.js (from index.html at HEAD: the doctrine slice tests/run.mjs takes, GRADE_SY with its
// comment, dbFit() verbatim, the seven shipped TEMPLATES_FLIGHT strings), history.js (the doctrine's
// three table-number bullets at ad4d587 and 3bffbe0, from git show) and tpl-<name>.scad.js (each
// tests/templates file verbatim). A shipped template equal to its tests/templates copy is stored as
// that name and sha256; one differing on a few lines as those lines and the sha256; else in full.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SC = require(path.join(here, 'second-copy.js'));
const args = process.argv.slice(2);
const check = args.includes('--check');
const repo = path.resolve(args.find((a) => !a.startsWith('--')) || '/home/user/Partforge');
const snapshotTool = path.resolve(here, '..', '..', 'tools', 'snapshot.mjs');
const snaps = path.join(here, 'snapshots');
const HISTORY = ['ad4d587', '3bffbe0'];

if (!fs.existsSync(path.join(repo, 'index.html'))) { console.error(`no PartForge checkout at ${repo}`); process.exit(2); }
const git = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const head = git(['rev-parse', '--short=7', 'HEAD']);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function umd(group, name, obj) {
  const reg = name == null ? `ns[${JSON.stringify(group)}] = d;` : `(ns[${JSON.stringify(group)}] = ns[${JSON.stringify(group)}] || {})[${JSON.stringify(name)}] = d;`;
  return `/* derived by build-data.mjs; provenance in the sidecar */\n(function (root, factory) {\n  var d = factory();\n  if (typeof module === 'object' && module.exports) module.exports = d;\n  else { var ns = root.SecondCopyData = root.SecondCopyData || {}; ${reg} }\n})(typeof self !== 'undefined' ? self : this, function () {\n  return ${JSON.stringify(obj)};\n});\n`;
}
const lines = (t) => t.split('\n').length;

const outputs = [];   // { rel, content, source, note }
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

// 1. tables
for (const [name, file] of Object.entries(SC.TABLE_FILES)) {
  const raw = JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));
  outputs.push({ rel: `table-${name}.js`, content: umd('tables', name, SC.EXCERPT[name](raw)), source: file,
    note: `derived by build-data.mjs: second-copy.js EXCERPT.${name} applied to ${file} at ${head}, wrapped as a UMD module` });
}

// 2. the seven editable templates, verbatim
const editable = fs.readdirSync(path.join(repo, 'tests', 'templates')).filter((x) => x.endsWith('.scad')).sort()
  .map((f) => ({ f, file: `tests/templates/${f}`, text: fs.readFileSync(path.join(repo, 'tests', 'templates', f), 'utf8') }));
for (const e of editable) {
  outputs.push({ rel: `tpl-${e.f}.js`, content: umd('templates', e.f.replace(/\.scad$/, ''), { file: e.file, sha256: sha256(e.text), text: e.text }),
    source: e.file, note: `derived by build-data.mjs: ${e.file} verbatim as a string (its sha256 equals the sidecar's sourceSha256)` });
}

// 3. index.html at HEAD: doctrine, GRADE_SY, dbFit, shipped templates
{
  const d = SC.sliceDoctrine(html);
  const g = SC.sliceGradeSy(html);
  const hl = html.split('\n');
  const fa = hl.findIndex((l) => /^function dbFit\(/.test(l));
  const fb = hl.findIndex((l, i) => i > fa && /^}/.test(l));
  if (!d || !g || fa < 0 || fb < 0) throw new Error('an anchor (flightSystemPrompt, GRADE_SY, dbFit) is missing from index.html');
  const dbFit = hl.slice(fa, fb + 1).join('\n');
  const sh = SC.shippedTemplates(html);
  if (!Array.isArray(sh)) throw new Error(sh && sh.error || 'TEMPLATES_FLIGHT not found');
  const shipped = sh.map((t) => {
    const base = { name: t.name, line: t.line, sha256: sha256(t.text) };
    const same = editable.find((e) => e.text === t.text);
    if (same) return { ...base, sameAs: same.file };
    const near = editable.find((e) => e.text.split('\n')[0] === t.text.split('\n')[0]);
    if (near && lines(near.text) === lines(t.text)) {
      const a = near.text.split('\n'), b = t.text.split('\n'), replace = {};
      b.forEach((l, i) => { if (l !== a[i]) replace[i] = l; });
      if (Object.keys(replace).length <= 5) return { ...base, sameAs: near.file, replace };
    }
    return { ...base, text: t.text };
  });
  const obj = {
    commit: head, file: 'index.html',
    doctrine: { lineBase: d.lineBase, sha256: sha256(d.text), how: 'the slice tests/run.mjs:27-30 takes: from after "return `" in flightSystemPrompt() to the first "`;"', text: d.text },
    gradeSy: { lineBase: g.lineBase, sha256: sha256(g.text), text: g.text },
    dbFit: { lineBase: fa + 1, sha256: sha256(dbFit), text: dbFit },
    shipped
  };
  outputs.push({ rel: `index-${head}.js`, content: umd('texts', 'index', obj), source: 'index.html',
    note: `derived by build-data.mjs from index.html at ${head}: the flightSystemPrompt() slice (lines ${d.lineBase}-${d.lineBase + lines(d.text) - 1}), GRADE_SY with its comment (lines ${g.lineBase}-${g.lineBase + lines(g.text) - 1}), dbFit() unedited (lines ${fa + 1}-${fb + 1}), and the ${sh.length} TEMPLATES_FLIGHT code strings unescaped (${shipped.filter((t) => t.sameAs && !t.replace).length} stored as identical to their tests/templates copy, ${shipped.filter((t) => t.replace).length} as line replacements on it, each with the sha256 of the shipped text)` });
}

// 4. historical doctrines: the table bullets only
{
  const obj = {};
  const notes = [];
  for (const c of HISTORY) {
    const old = git(['show', `${c}:index.html`]);
    const blob = git(['rev-parse', `${c}:index.html`]);
    const b = SC.tableBullets(SC.sliceDoctrine(old));
    obj[c] = { commit: c, commitFull: git(['rev-parse', c]), file: 'index.html', blob, lineBase: b.lineBase, sha256: sha256(b.text), text: b.text };
    notes.push(`${c} (blob ${blob}) lines ${b.lineBase}-${b.lineBase + lines(b.text) - 1}`);
  }
  outputs.push({ rel: 'history.js', content: umd('history', null, obj), source: 'index.html',
    note: `derived by build-data.mjs from git show <commit>:index.html: the doctrine's "- Use standard sizes", "- Fits" and "- O-rings" bullets at ${notes.join('; ')}. The sidecar's commit and blob fields describe HEAD; this note names the historical sources` });
}

if (check) {
  const stale = outputs.filter((o) => { const p = path.join(snaps, o.rel); return !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== o.content; });
  const extra = fs.existsSync(snaps) ? fs.readdirSync(snaps).filter((f) => f.endsWith('.js') && !outputs.some((o) => o.rel === f)) : [];
  if (stale.length || extra.length) {
    console.log(`stale against ${repo} @ ${head}: ${stale.map((o) => o.rel).join(', ') || '—'}${extra.length ? '; not produced any more: ' + extra.join(', ') : ''}`);
    process.exit(1);
  }
  console.log(`all ${outputs.length} snapshots are current against ${repo} @ ${head}`);
  process.exit(0);
}

fs.mkdirSync(snaps, { recursive: true });
for (const o of outputs) {
  const dest = path.join(snaps, o.rel);
  fs.writeFileSync(dest, o.content);
  execFileSync('node', [snapshotTool, repo, o.source, dest, '--sidecar-only', '--note', o.note], { stdio: ['ignore', 'ignore', 'inherit'] });
}
console.log(`wrote ${outputs.length} snapshots and sidecars under ${path.relative(process.cwd(), snaps) || snaps}`);
