#!/usr/bin/env node
// Regenerates the saved outputs from real runs of line-drift.mjs:
//   example.txt               the text report on the Aster checkout (the gallery preview)
//   example-full-history.txt  the same on a full-history clone at the same commit (if given)
//   report-data.js            what index.html shows: both runs' counts, every drift and PARTIAL
//                             finding with its history and hand adjudication, and two snapshots
//                             for the page's "Try it" panel
//
//   node ideas/23-line-drift/build-report.mjs [checkout] [--full /path/to/full-clone]
//
// The checkout defaults to /home/user/asteroid-mining-planner. A full clone is made with
//   git clone https://github.com/hudsonclavin-cloud/asteroid-mining-planner /tmp/aster-full
//   git -C /tmp/aster-full checkout 62ddb17
// Its path is replaced by "<full clone>" in the saved text, so the file does not depend on where
// the clone lived.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = createRequire(import.meta.url)(path.join(here, 'linedrift.js'));
const CLI = path.join(here, 'line-drift.mjs');

const args = process.argv.slice(2);
const fi = args.indexOf('--full');
const full = fi >= 0 ? path.resolve(args[fi + 1]) : null;
const checkout = path.resolve(args.find((a, i) => !a.startsWith('--') && i !== fi + 1) || '/home/user/asteroid-mining-planner');

function run(dir, extra = []) {
  const r = spawnSync(process.execPath, [CLI, dir, ...extra], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && r.status !== 1) {
    console.error(r.stderr);
    process.exit(2);
  }
  return r.stdout;
}

const keyed = (findings) => {
  const seen = new Map();
  return findings.filter((f) => L.isDrift(f) || f.status === 'PARTIAL').map((f) => {
    const k = `${f.doc}:${f.line} ${f.raw} ${f.status}`;
    seen.set(k, (seen.get(k) || 0) + 1);
    return { key: seen.get(k) > 1 ? `${k} #${seen.get(k)}` : k, f };
  });
};

// The page needs per-document counts once (docs[].counts) and only totals for the full run.
function summary(rep, withDocs) {
  const why = new Map();
  for (const f of rep.findings.filter((x) => x.status === 'UNCHECKABLE' || x.status === 'NOT-A-COMMIT')) {
    const k = `${f.kind}: ${(f.note || 'no reason').replace(/\d+ files end in .*/, 'several files share this name').replace(/ \(history starts at .*\)$/, '')}`;
    why.set(k, (why.get(k) || 0) + 1);
  }
  const g = rep.git;
  return {
    git: g.available === false ? g : { head: g.head, date: g.date, shallow: g.shallow, boundary: g.boundary, commits: g.commits, dirty: g.dirty },
    docs: withDocs ? rep.docs.map((d) => ({ ...d, counts: rep.counts.byDoc[d.doc] })) : undefined,
    counts: { total: rep.counts.total, byStatus: rep.counts.byStatus, byKind: rep.counts.byKind },
    failing: rep.failing,
    unchecked: [...why].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
  };
}

function main() {
  const text = run(checkout);
  fs.writeFileSync(path.join(here, 'example.txt'), text);
  const rep = JSON.parse(run(checkout, ['--json']));
  let fullRep = null;
  if (full) {
    const ft = run(full).replace(/^checkout .*$/m, 'checkout <full clone> (worktree)').replace(/ from \S+;/, ';');
    fs.writeFileSync(path.join(here, 'example-full-history.txt'), ft);
    fullRep = JSON.parse(run(full, ['--json']));
  }
  const adj = JSON.parse(fs.readFileSync(path.join(here, 'adjudication.json'), 'utf8'));
  const adjBy = new Map(adj.findings.map((a) => [a.key, a]));
  const fullBy = fullRep ? new Map(keyed(fullRep.findings).map(({ key, f }) => [key, f])) : new Map();
  const findings = keyed(rep.findings).map(({ key, f }) => {
    const ff = fullBy.get(key);
    const a = adjBy.get(key);
    const snip = (f.snippetResults || []).find((s) => s.verdict === f.lineStatus) || (f.snippetResults || [])[0];
    const sentence = f.sentence.length > 240 ? `${f.sentence.slice(0, 237)}...` : f.sentence;
    return {
      doc: f.doc, line: f.line, kind: f.kind, raw: f.raw, status: f.status, note: f.note || '',
      target: f.target && f.target !== f.path ? f.target : '',
      snippet: snip ? { text: snip.text, form: snip.form } : null,
      sentence,
      history: ff ? L.describeHistory(ff) : L.describeHistory(f),
      context: L.describeContext(f),
      cls: a ? a.class : null,
      why: a ? a.why : null,
      mispaired: !!(a && a.mispaired),
    };
  });
  const snap = (n) => fs.readFileSync(path.join(here, 'snapshots', n), 'utf8');
  const ex = snap('src__v2__SLICE_9_FOUNDING.md.423-428.md');
  const data = {
    generatedBy: 'build-report.mjs',
    commit: rep.git.head,
    checkout: summary(rep, true),
    full: fullRep ? summary(fullRep, false) : null,
    findings,
    classes: adj.classes,
    tryIt: {
      doc: 'src/v2/SLICE_9_FOUNDING.md',
      from: 423,
      docText: ex.slice(ex.indexOf('\n') + 1),
      targetPath: '.gitignore',
      targetText: snap('gitignore.txt'),
    },
  };
  fs.writeFileSync(path.join(here, 'report-data.js'), `// Generated by build-report.mjs from real runs of line-drift.mjs; do not edit by hand.\nwindow.LINE_DRIFT_DATA = ${JSON.stringify(data)};\n`);
  console.log(`example.txt ${text.length} B; report-data.js ${findings.length} findings${full ? '; example-full-history.txt' : ''}`);
}

main();
