#!/usr/bin/env node
// Build-time oracle (not imported by the page or the tests): parses the workflow files in the
// packs, plus edge cases of the YAML subset census.js claims to read, with PyYAML's BaseLoader
// (every scalar stays a string, `on:` stays "on"), and records the result. census.test.mjs
// compares census.js's parseYaml against it.
//
//   node oracle/yaml-oracle.mjs > oracle/yaml-behaviour.json      (needs python3 with PyYAML)
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const docs = [];
for (const k of ['aster', 'partforge', 'skyhook', 'aster-a697963']) {
  const p = require(path.join(HERE, '..', 'snapshots', `pack-${k}.js`));
  for (const [f, t] of Object.entries(p.contents)) if (/^\.github\/workflows\/.+\.ya?ml$/.test(f)) docs.push({ name: `${k}:${f}`, text: t });
}
export const EDGE = [
  ['literal block, keep indentation', 'a:\n  run: |\n    one \\\n      two\n    three\n'],
  ['folded block, strip', 'a:\n  run: >-\n    one\n    two\n\n    three\n'],
  ['literal block, keep trailing', 'a:\n  run: |+\n    one\n\n'],
  ['dash-line mapping with nested sequence', 'steps:\n  - name: x\n    with:\n      node-version: 24\n  - run: echo hi\n'],
  ['flow sequence and flow mapping', 'on: { push: { branches: [main, dev] } }\nb: [ "a,b", \'c\' ]\n'],
  ['quotes and comments', "a: 'it''s'  # c\nb: \"x # y\"\nc: x#y\nd: ~\ne:\n"],
  ['sequence of scalars at key indent', 'branches:\n- main\n- "dev"\n'],
  ['block scalar in a sequence item', 'steps:\n  - |\n    echo a\n    echo b\n'],
];
for (const [name, text] of EDGE) docs.push({ name, text });
const py = `
import json, sys, yaml
out = []
for d in json.load(sys.stdin):
    out.append({"name": d["name"], "text": d["text"], "value": yaml.load(d["text"], Loader=yaml.BaseLoader)})
v = yaml.__version__
print(json.dumps({"pyyaml": v, "docs": out}, indent=1))
`;
const r = spawnSync('python3', ['-c', py], { input: JSON.stringify(docs), encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const rec = JSON.parse(r.stdout);
rec.about = 'PyYAML BaseLoader parse of each document (all scalars strings). Written by oracle/yaml-oracle.mjs.';
rec.recorded = new Date().toISOString().slice(0, 10);
process.stdout.write(JSON.stringify(rec, null, 1) + '\n');
