// collect.mjs — the reading half of "Whose Earth" (Node built-ins only). Verifies every concordance row
// against a checkout or against this folder's snapshots, scans the checkouts for Earth constants the
// registry does not list, reads the inputs the arithmetic needs (rev_a.json, the workbook's ladder rows,
// the decision grid), and hands them to model.js. Nothing here writes: build-data.mjs does the writing.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SNAP = path.join(HERE, 'snapshots');
export const Reg = require('./registry.js');
export const Model = require('./model.js');

// Whole-file snapshots of the two files the arithmetic reads most.
export const WHOLE = {
  skyhook: { 'params/rev_a.json': 'rev_a.json' },
  aster: { 'src/v2/porkchop/delta-v.ts': 'delta-v.ts' },
};
export const WORKBOOK_PATH = 'tools/financial/skyhook_financial_model.xlsx';
export const GRID_PATH = 'finance/decision_grid.json';
export const WORKBOOK_ROWS = { retentionRow: 3, etaRow: 6, priceRow: 7, tipRow: 15 };

export function snapshotPathFor(repo, rel) {
  const whole = WHOLE[repo] && WHOLE[repo][rel];
  return whole ? path.join(SNAP, whole) : path.join(SNAP, 'excerpts', repo, `${rel}.lines.txt`);
}

// The files whose numbers feed the arithmetic or the pins are snapshotted: whole, or as line-preserving excerpts
// (every registry line in the file copied verbatim, every other line empty) named <path>.lines.txt so the bank's
// checker never mistakes an excerpt of a test file for a test. Every other row is a citation: verified against the
// checkouts on each live run, with its line text and the commits saved in data.js.
export function snapshotFiles() {
  const byId = Object.fromEntries(Reg.rows.map((r) => [r.id, r]));
  const ids = new Set();
  for (const s of Reg.EARTH_SETS) for (const k of ['mu', 'R', 'g0', 'vRot']) if (s[k]) ids.add(s[k]);
  for (const id of [...ids]) if (byId[id] && byId[id].pair) ids.add(byId[id].pair);
  ids.add(Reg.EXPECTED.mp001EnergyRow);
  for (const id of Reg.EXPECTED.asterPinRows) ids.add(id);
  const files = new Map();
  for (const [repo, f] of Object.entries(WHOLE)) for (const rel of Object.keys(f)) files.set(`${repo}:${rel}`, { repo, rel, whole: true });
  for (const id of ids) {
    const r = byId[id];
    if (r && !files.has(`${r.repo}:${r.path}`)) files.set(`${r.repo}:${r.path}`, { repo: r.repo, rel: r.path, whole: false });
  }
  return [...files.values()].sort((a, b) => (`${a.repo}:${a.rel}` < `${b.repo}:${b.rel}` ? -1 : 1));
}

// git, read-only, never taking the optional index lock
export function git(dir, args) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

export function isCheckout(dir) {
  return !!dir && fs.existsSync(path.join(dir, '.git')) && git(dir, ['rev-parse', 'HEAD']) !== null;
}

export function sourceInfo(dir) {
  return { dir, commit: git(dir, ['rev-parse', 'HEAD']), commitDate: git(dir, ['log', '-1', '--format=%cI']) };
}

// ---------------------------------------------------------------- row verification
// ok: the token is on the stated line and the literal is inside the token. moved: the token is found once,
// elsewhere. ambiguous: found more than once, none on the stated line. missing: not in the file. no-file.
// not-snapshotted: offline, and this citation's file is not in snapshots/ (data.js has the saved line).
export function verifyRow(row, text) {
  if (text === undefined) return { status: 'not-snapshotted', foundLine: null, text: null };
  if (text === null) return { status: 'no-file', foundLine: null, text: null };
  if (row.literal != null && !row.token.includes(row.literal)) return { status: 'bad-row', foundLine: null, text: null };
  const lines = text.split('\n');
  const at = lines[row.line - 1];
  if (at != null && at.includes(row.token)) return { status: 'ok', foundLine: row.line, text: at };
  const hits = [];
  lines.forEach((l, i) => l.includes(row.token) && hits.push(i + 1));
  if (hits.length === 1) return { status: 'moved', foundLine: hits[0], text: lines[hits[0] - 1] };
  if (hits.length > 1) return { status: 'ambiguous', foundLine: null, text: null, candidates: hits };
  return { status: 'missing', foundLine: null, text: null };
}

export function verifyRows(rows, readText) {
  const cache = new Map();
  return rows.map((row) => {
    const key = `${row.repo}:${row.path}`;
    if (!cache.has(key)) cache.set(key, readText(row.repo, row.path));
    return Object.assign({}, row, verifyRow(row, cache.get(key)));
  });
}

export function liveReader(dirs) {
  return (repo, rel) => {
    try {
      return fs.readFileSync(path.join(dirs[repo], rel), 'utf8');
    } catch {
      return null;
    }
  };
}

export function snapshotReader() {
  const have = new Set(snapshotFiles().map((f) => `${f.repo}:${f.rel}`));
  return (repo, rel) => {
    if (!have.has(`${repo}:${rel}`)) return undefined;
    try {
      return fs.readFileSync(snapshotPathFor(repo, rel), 'utf8');
    } catch {
      return null;
    }
  };
}

// ---------------------------------------------------------------- the scan
export function familyMatches(line) {
  const out = [];
  for (const f of Reg.SCAN.families) {
    const re = new RegExp(f.re, 'g');
    const m = line.match(re);
    if (!m) continue;
    if (f.context && !new RegExp(f.context, 'i').test(line)) continue;
    out.push({ family: f.family, covers: f.covers || [f.family], matches: m });
  }
  return out;
}

// Normalises a scanned match to the family's canonical unit, for the excluded-scope summary only.
export function normaliseMatch(family, s) {
  const v = Model.parseLiteral(s.replace(/\s+/g, ' ').trim());
  if (!Number.isFinite(v)) return null;
  if (family === 'mu') return v > 1e10 ? v / 1e9 : v;
  if (family === 'R') return /e3$/i.test(s) || v > 1e5 ? v / 1e3 : v;
  return v;
}

// files: tracked paths; read(path) -> text, or null to skip (too big, unreadable). Pure apart from `read`.
export function scanFiles(repo, files, read, rows) {
  const bin = new RegExp(Reg.SCAN.binary, 'i');
  const excl = (Reg.SCAN.exclude[repo] || []).map((e) => Object.assign({}, e, { rx: new RegExp(e.re) }));
  const registered = new Set();
  for (const r of rows) if (r.repo === repo) registered.add(`${r.path}:${r.line}:${r.family}`);
  const result = { repo, filesListed: files.length, filesScanned: 0, hits: [], unregistered: [], excluded: {}, summaries: {} };
  for (const f of files) {
    if (bin.test(f)) continue;
    const ex = excl.find((e) => e.rx.test(f));
    if (ex && !ex.summarize) {
      result.excluded[ex.why] = (result.excluded[ex.why] || 0) + 1;
      continue;
    }
    const text = read(f);
    if (text == null) continue;
    if (ex) result.excluded[ex.why] = (result.excluded[ex.why] || 0) + 1;
    else result.filesScanned++;
    text.split('\n').forEach((line, i) => {
      for (const fm of familyMatches(line)) {
        if (ex) {
          const s = (result.summaries[ex.summarize] ||= { why: ex.why, files: new Set(), byValue: {} });
          s.files.add(f);
          for (const m of fm.matches) {
            const v = normaliseMatch(fm.family, m);
            const key = `${fm.family} ${v}`;
            s.byValue[key] = (s.byValue[key] || 0) + 1;
          }
          continue;
        }
        const hit = { family: fm.family, path: f, line: i + 1, matches: fm.matches };
        result.hits.push(hit);
        if (!fm.covers.some((fam) => registered.has(`${f}:${i + 1}:${fam}`))) result.unregistered.push(Object.assign({ text: line.trim().slice(0, 200) }, hit));
      }
    });
  }
  for (const s of Object.values(result.summaries)) s.files = [...s.files].sort();
  return result;
}

export function scanRepo(repo, dir, rows) {
  const files = (git(dir, ['ls-files']) || '').split('\n').filter(Boolean);
  return scanFiles(repo, files, (f) => {
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (!st.isFile() || st.size > Reg.SCAN.maxBytes) return null;
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }, rows);
}

// ---------------------------------------------------------------- workbook (xlsx = zip of XML), Node built-ins only
export function readZipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entry === name) {
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`unsupported zip method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function xmlText(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// The ladder rows the decision grid's reboost line uses, from the 'Assumptions' sheet.
export function readWorkbook(buf) {
  const wb = readZipEntry(buf, 'xl/workbook.xml').toString('utf8');
  const sheet = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find((m) => xmlText(m[1]) === 'Assumptions');
  if (!sheet) throw new Error('no Assumptions sheet');
  const rels = readZipEntry(buf, 'xl/_rels/workbook.xml.rels').toString('utf8');
  const rel = [...rels.matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)].find((m) => m[2] === sheet[2]);
  const target = rel[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  const xml = readZipEntry(buf, target).toString('utf8');
  const cell = (ref) => {
    const m = xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
    if (!m || !m[1]) return null;
    const t = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
    if (t) return xmlText(t[1]);
    const v = m[1].match(/<v>([\s\S]*?)<\/v>/);
    return v ? Number(v[1]) : null;
  };
  const columns = [cell('B2'), cell('C2'), cell('D2')];
  const rows = {};
  for (const r of Object.values(WORKBOOK_ROWS)) rows[r] = { label: cell(`A${r}`), values: [cell(`B${r}`), cell(`C${r}`), cell(`D${r}`)], note: cell(`E${r}`) };
  return Object.assign({ sheet: 'Assumptions', sheetPart: target, columns, rows }, WORKBOOK_ROWS);
}

// The first point of every (tier, column) series: the grid's reboost and mass-ratio fields do not vary with launch price.
export const GRID_FIELDS = ['tier', 'column', 'construction_launch_per_kg', 'mass_ratio_x', 'reboost_electricity_per_kg', 'ops_wear_insurance_per_kg', 'marginal_cost_per_kg', 'delivered_total_per_kg'];
export function gridExcerpt(grid) {
  const seen = new Set();
  const points = [];
  for (const p of grid.points) {
    const k = `${p.tier}|${p.column}`;
    if (seen.has(k)) continue;
    seen.add(k);
    points.push(Object.fromEntries(GRID_FIELDS.map((f) => [f, p[f]])));
  }
  return { schema_version: grid.schema_version, git_commit: grid.git_commit, rev_a_md5: grid.rev_a_md5, workbook_md5: grid.workbook_md5, totalPoints: grid.points.length, points };
}

// ---------------------------------------------------------------- inputs
export function liveInputs(dirs) {
  const sk = dirs.skyhook;
  return {
    canon: JSON.parse(fs.readFileSync(path.join(sk, 'params/rev_a.json'), 'utf8')),
    workbook: readWorkbook(fs.readFileSync(path.join(sk, WORKBOOK_PATH))),
    grid: gridExcerpt(JSON.parse(fs.readFileSync(path.join(sk, GRID_PATH), 'utf8'))),
  };
}

export function snapshotInputs() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8'));
  return { canon: read('rev_a.json'), workbook: read('workbook-assumptions.json'), grid: read('decision-grid-excerpt.json') };
}

export function sidecar(file) {
  try {
    return JSON.parse(fs.readFileSync(`${file}.provenance.json`, 'utf8'));
  } catch {
    return null;
  }
}

// Everything the report needs, from checkouts (live) or from snapshots (offline).
export function collect(opts) {
  const offline = !!opts.offline;
  const dirs = { aster: opts.aster || Reg.REPOS.aster.dir, skyhook: opts.skyhook || Reg.REPOS.skyhook.dir };
  let sources;
  let rows;
  let inputs;
  let scans = null;
  if (offline) {
    const sc = (repo, rel) => sidecar(snapshotPathFor(repo, rel));
    sources = {
      aster: { dir: null, commit: (sc('aster', 'src/v2/porkchop/delta-v.ts') || {}).commit || null, from: 'snapshots' },
      skyhook: { dir: null, commit: (sc('skyhook', 'params/rev_a.json') || {}).commit || null, from: 'snapshots' },
    };
    rows = verifyRows(Reg.rows, snapshotReader());
    let saved = null;
    try {
      saved = require('./data.js');
    } catch {
      saved = null;
    }
    const savedById = saved ? Object.fromEntries(saved.rows.map((r) => [r.id, r])) : {};
    rows = rows.map((r) => {
      if (r.status !== 'not-snapshotted') return r;
      const s = savedById[r.id];
      return s && (s.status === 'ok' || s.status === 'moved') ? Object.assign({}, r, { status: 'saved', foundLine: s.foundLine, text: s.text }) : r;
    });
    inputs = snapshotInputs();
  } else {
    const missing = Object.entries(dirs).filter(([, d]) => !isCheckout(d));
    if (missing.length) {
      return { refused: Model.refusal('not_found', `no git checkout at ${missing.map(([k, d]) => `${k}: ${d}`).join('; ')}`,
        'pass --aster DIR and --skyhook DIR, or --offline to read the snapshots in this folder') };
    }
    sources = { aster: Object.assign(sourceInfo(dirs.aster), { from: 'checkout' }), skyhook: Object.assign(sourceInfo(dirs.skyhook), { from: 'checkout' }) };
    rows = verifyRows(Reg.rows, liveReader(dirs));
    inputs = liveInputs(dirs);
    if (!opts.noScan) scans = { aster: scanRepo('aster', dirs.aster, Reg.rows), skyhook: scanRepo('skyhook', dirs.skyhook, Reg.rows) };
  }
  const usable = rows.map((r) => (['ok', 'moved', 'saved'].includes(r.status) ? r : Object.assign({}, r, { text: null })));
  const analysis = Model.analyze(Object.assign({ rows: usable, sets: Reg.EARTH_SETS, expected: Reg.EXPECTED }, inputs));
  const drift = rows.filter((r) => r.status !== 'ok' && r.status !== 'saved');
  const unregistered = scans ? [...scans.aster.unregistered, ...scans.skyhook.unregistered] : [];
  const failedGates = analysis.gates.filter((g) => !g.ok);
  return { offline, sources, rows, scans, inputs, analysis, drift, unregistered, failedGates, ok: !drift.length && !unregistered.length && !failedGates.length };
}
