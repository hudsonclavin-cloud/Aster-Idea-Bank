#!/usr/bin/env node
// Said vs Derived: scan an Aster checkout for display strings that type a value the code already
// owns (DEC-17-5, DEC-19.5-8), code literals that retype a constant, dates typed in several files,
// and quantities with two homes. Node built-ins only; reads the checkout, never writes to it.
//
//   node said-vs-derived.mjs [<aster-checkout>] [options]        (default checkout: .)
//
// Exit: 0 no failing finding after the allow-list; 1 failing findings; 2 usage error, not an
// Aster checkout, unreadable allow-list, or an allow-list entry without a reason.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SD = createRequire(import.meta.url)(path.join(here, 'said-derived.js'));

const HELP = `Usage: node said-vs-derived.mjs [<aster-checkout>] [options]

Scans src/v2/**/*.ts (not tests, not src/v2/prototypes/), mcp/src/**/*.ts and v2/**/*.html,
index.html of an Aster checkout (default: the current directory).

Canon (what the code owns): depth-0 \`const NAME = <number|'YYYY-MM-DD'>\`, first-level fields of
depth-0 \`const NAME = { ... }\`, and the \`metadata\` object at the head of the screening cache.

Classes (failing unless allow-listed): LITERAL-MATCHES-CONSTANT, LITERAL-DATE-SPAN,
RETYPED-CONSTANT, DUPLICATE-DATE, TWO-HOMES. Informational: LITERAL-WITH-UNITS (fails with --strict).

Options:
  --format md|json        report format on stdout (default md)
  --out FILE              also write the report to FILE
  --allowlist FILE        JSON {"entries":[{"id":"<class>|<path>:<line>|<literal>","reason":"..."}]}
                          (every entry needs a reason of 8+ characters, or the run exits 2)
  --strict                LITERAL-WITH-UNITS fails too
  --min-sig N             significant figures a code literal needs for RETYPED-CONSTANT (default 4)
  --cache PATH            JSON whose leading "metadata" object is canon
                          (default tests/fixtures/v2/lambert-screen-cache.json, then docs/…)
  --no-cache              do not read the cache metadata
  --list-canon            print the harvested canon and exit 0
  --emit-page-data FILE   write the run as a classic script for index.html
  -h, --help              this text
`;

function parseArgs(argv) {
  const o = { root: null, format: 'md', out: null, allowlist: null, strict: false, minSig: 4, cache: null, noCache: false, listCanon: false, pageData: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--format') o.format = need();
    else if (a === '--out') o.out = need();
    else if (a === '--allowlist') o.allowlist = need();
    else if (a === '--strict') o.strict = true;
    else if (a === '--min-sig') o.minSig = Number(need());
    else if (a === '--cache') o.cache = need();
    else if (a === '--no-cache') o.noCache = true;
    else if (a === '--list-canon') o.listCanon = true;
    else if (a === '--emit-page-data') o.pageData = need();
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (o.root === null) o.root = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!['md', 'json'].includes(o.format)) throw new Error('--format must be md or json');
  if (!Number.isInteger(o.minSig) || o.minSig < 1) throw new Error('--min-sig must be a positive integer');
  return o;
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function walk(root, rel, out) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) walk(root, r, out);
    else out.push(r);
  }
  return out;
}

const isTs = (f) => /^(src\/v2|mcp\/src)\/.+\.ts$/.test(f) && !/\.test\.ts$|\.d\.ts$/.test(f) && !/^src\/v2\/prototypes\//.test(f);
const isHtml = (f) => /^v2\/.+\.html$/.test(f) || f === 'index.html';

function listFiles(root) {
  let files = null;
  let source = 'walk';
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top !== null && path.resolve(top) === root) {
    const out = git(root, ['ls-files', 'src/v2', 'mcp/src', 'v2', 'index.html']);
    if (out !== null) {
      files = out.split('\n').filter(Boolean);
      source = 'git ls-files';
    }
  }
  if (!files) files = ['src/v2', 'mcp/src', 'v2'].flatMap((r) => walk(root, r, [])).concat(fs.existsSync(path.join(root, 'index.html')) ? ['index.html'] : []);
  files = files.filter((f) => fs.existsSync(path.join(root, f)));
  return { ts: files.filter(isTs).sort(), html: files.filter(isHtml).sort(), source };
}

// Read only the head of a (34 MB) cache file and pull its "metadata" object out.
function readCacheMetadata(root, rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return { refusal: `${rel} is absent` };
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(65536);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const head = buf.subarray(0, n).toString('utf8');
  let found;
  try {
    found = SD.jsonObjectAfterKey(head, 'metadata');
  } catch (e) {
    return { refusal: `${rel}: the metadata object did not parse (${e.message})` };
  }
  if (!found) return { refusal: `no complete "metadata" object in the first ${n} bytes of ${rel}` };
  const starts = [0];
  for (let i = 0; i < head.length; i++) if (head.charCodeAt(i) === 10) starts.push(i + 1);
  const lineAt = (off) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= off) k++;
    return k + 1;
  };
  const lineOfKey = (key) => {
    const at = head.indexOf(`"${key}"`, found.offset);
    return at < 0 ? null : lineAt(at);
  };
  return { metadata: found.object, homes: SD.harvestJson(rel, found.object, 'metadata', lineOfKey) };
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`said-vs-derived: ${e.message}\n\n${HELP}`);
    return 2;
  }
  if (o.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const root = path.resolve(o.root || '.');
  if (!fs.existsSync(path.join(root, 'src', 'v2'))) {
    console.error(`said-vs-derived: ${root} is not an Aster checkout (no src/v2/). Nothing was scanned.`);
    return 2;
  }

  let allowlist = null;
  if (o.allowlist) {
    try {
      allowlist = JSON.parse(fs.readFileSync(path.resolve(o.allowlist), 'utf8'));
    } catch (e) {
      console.error(`said-vs-derived: cannot read allow-list ${o.allowlist}: ${e.message}`);
      return 2;
    }
  }

  const files = listFiles(root);
  const sources = new Map(files.ts.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

  // Canon
  const canon = [];
  for (const [f, src] of sources) canon.push(...SD.harvestTs(f, src));
  let cacheRefusal = null;
  let jsonFrom = null;
  if (!o.noCache) {
    const candidates = o.cache ? [o.cache] : ['tests/fixtures/v2/lambert-screen-cache.json', 'docs/lambert-screen-cache.json'];
    const tried = [];
    for (const c of candidates) {
      const r = readCacheMetadata(root, c);
      if (r.homes) {
        canon.push(...r.homes);
        jsonFrom = c;
        cacheRefusal = null;
        break;
      }
      tried.push(r.refusal);
      cacheRefusal = `${tried.join('; ')}. Labels that restate the cache's values (the 25 km²/s² threshold, the screening window) cannot be matched; pass --cache PATH.`;
    }
  } else cacheRefusal = 'skipped (--no-cache)';

  if (o.listCanon) {
    for (const h of canon) console.log(`${h.name}\t${h.text}\t${h.dim}\t${h.path}${h.line ? `:${h.line}` : ''}${h.exported ? '\texported' : ''}`);
    return 0;
  }

  const canonNames = new Set();
  for (const h of canon) canonNames.add(h.name);
  const jsonNames = new Set(canon.filter((h) => h.source === 'json').map((h) => h.name));
  const scans = [];
  const lexErrors = [];
  let literals = 0;
  let displayLiterals = 0;
  for (const [f, src] of sources) {
    const s = SD.scanSource(f, src, { canonNames, jsonNames });
    for (const e of s.errors) lexErrors.push(`${f}: ${e}`);
    literals += s.counts.literals;
    displayLiterals += s.counts.display;
    scans.push(s);
  }
  for (const f of files.html) {
    const s = SD.scanHtml(f, fs.readFileSync(path.join(root, f), 'utf8'));
    literals += s.counts.literals;
    displayLiterals += s.counts.display;
    scans.push(s);
  }

  const report = SD.buildReport(scans, canon, { minSig: o.minSig, allowlist, strict: o.strict });
  // Only a checkout whose own top level is <root> has a commit to report; a tree inside another
  // repository (this deposit's snapshots/aster) does not borrow that repository's HEAD.
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const ownRepo = top !== null && path.resolve(top) === root;
  const commit = ownRepo ? git(root, ['rev-parse', '--short', 'HEAD']) : null;
  const status = commit ? git(root, ['status', '--porcelain', '--', 'src/v2', 'mcp/src', 'v2', 'index.html']) : null;
  const meta = {
    tool: 'said-vs-derived',
    root: o.root || '.',
    commit,
    dirty: !!status,
    fileSource: files.source,
    scanned: { ts: files.ts.length, display: files.ts.length, html: files.html.length, literals, displayLiterals },
    canon: { total: canon.length, ts: canon.filter((h) => h.source === 'ts').length, json: canon.filter((h) => h.source === 'json').length, jsonFrom },
    cacheRefusal,
    minSig: o.minSig,
    allowlistFile: o.allowlist ? path.basename(o.allowlist) : null,
    lexErrors,
  };

  const text = o.format === 'json' ? `${JSON.stringify(SD.toJson(report, meta), null, 1)}\n` : `${SD.formatMarkdown(report, meta)}\n`;
  process.stdout.write(text);
  if (o.out) fs.writeFileSync(path.resolve(o.out), text);
  if (o.pageData) {
    const data = SD.toJson(report, meta);
    // the page needs neither allow-list ids nor grouping keys nor the matched words
    data.findings = data.findings.map(({ id, group, ...f }) => Object.assign(f, { homes: f.homes.map(({ words, ...h }) => h) }));
    // rows as arrays under one header keep the page's data small
    data.canonFields = ['name', 'value', 'dim', 'toBase', 'sig', 'path', 'line', 'exported', 'source'];
    data.canon = canon.map((h) => {
      const r = SD.homeToRow(h);
      return data.canonFields.map((f) => r[f]);
    });
    fs.writeFileSync(path.resolve(o.pageData), `// Written by said-vs-derived.mjs --emit-page-data; the page computes nothing from this but the filters.\nwindow.SAID_DERIVED_RUN = ${JSON.stringify(data)};\n`);
  }
  if (report.allow.errors.length) return 2;
  return report.failing.length ? 1 : 0;
}

process.exitCode = main();
