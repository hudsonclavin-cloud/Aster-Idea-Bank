// Tests for bluecells.js, the browser/Node twin of ladder_export.py (Node built-ins only).
// From the bank root:  node --test ideas/08-blue-cells/bluecells.test.mjs
// Pinned outside this code: md5 to decision_grid.json's workbook_md5, sha256 to the sidecar, MD5 to
// RFC 1321 and Node's crypto, CRC-32 to 0xCBF43926. Pinned to the Python twin: ladder.json and the
// example.txt report and refusal messages, so the two readers cannot drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const BC = req(path.join(here, 'bluecells.js'));
const SNAPS = path.join(here, 'snapshots');
const read = (p) => fs.readFileSync(p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const XLSX = new Uint8Array(read(path.join(SNAPS, 'skyhook_financial_model.xlsx')));
const ROWS = readJson(path.join(SNAPS, 'ladder_rows.json'));
const PROV = readJson(path.join(SNAPS, 'skyhook_financial_model.xlsx.provenance.json'));
const PY = readJson(path.join(SNAPS, 'ladder.json'));
const GRID = readJson(path.join(SNAPS, 'decision_grid.json'));
const EXAMPLE = fs.readFileSync(path.join(here, 'example.txt'), 'utf8');
const inflateRaw = (u8) => new Uint8Array(zlib.inflateRawSync(u8));
const SCN = ['Conservative', 'Baseline', 'Optimistic'];

const WB = await BC.readWorkbook(XLSX, inflateRaw, 'skyhook_financial_model.xlsx');
const RESULT = BC.analyze(WB, ROWS, PROV);

function diff(a, b, p = '') {
  const out = [];
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-12) out.push(`${p}: ${a} vs ${b}`);
    return out;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return out;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join(',') !== kb.join(',')) out.push(`${p}: keys ${ka.join(',')} vs ${kb.join(',')}`);
  for (const k of new Set([...ka, ...kb])) out.push(...diff(a[k], b[k], `${p}.${k}`));
  return out;
}

// A minimal zip writer (stored members only) for fixtures the tests build themselves.
function storedZip(members, comment = '') {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of members) {
    const nameB = Buffer.from(name, 'utf8');
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = BC.crc32(new Uint8Array(body));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(nameB.length, 26); local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(nameB.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameB]));
    parts.push(local, nameB, body);
    offset += 30 + nameB.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const commentB = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6); eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(commentB.length, 20);
  return new Uint8Array(Buffer.concat([...parts, cdBuf, eocd, commentB]));
}

// The snapshot re-packed as a stored zip, with one worksheet part rewritten.
async function repack(editSheet2) {
  const members = [];
  for (const e of BC.readZip(XLSX)) {
    let data = Buffer.from(await BC.inflateEntry(e, inflateRaw));
    if (e.name === 'xl/worksheets/sheet2.xml') data = Buffer.from(editSheet2(data.toString('utf8')), 'utf8');
    members.push([e.name, data]);
  }
  return storedZip(members);
}

test('the zip reader lists the 17 members, inflates each to its declared size and passes every CRC-32', async () => {
  const entries = BC.readZip(XLSX);
  assert.equal(entries.length, 17);
  assert.equal(entries.filter((e) => e.method === 8).length, 17, 'openpyxl deflates every member');
  const names = entries.map((e) => e.name);
  for (const n of ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet2.xml', 'xl/media/image1.png']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('xl/sharedStrings.xml'), 'the workbook has no shared-strings part');
  for (const e of entries) {
    const out = await BC.inflateEntry(e, inflateRaw);
    assert.equal(out.length, e.size, e.name);
  }
  const png = entries.find((e) => e.name === 'xl/media/image1.png');
  assert.equal(png.size, PY.workbook.media[0].bytes);
});

test('the JS reader and the Python reader produce the same JSON artefact for the snapshot', () => {
  const d = diff(RESULT, PY);
  assert.deepEqual(d, [], d.join('\n'));
  assert.equal(JSON.stringify(RESULT.ladder.rows.construction_launch_per_kg.values), JSON.stringify({ Conservative: 2500, Baseline: 1500, Optimistic: 800 }));
});

test('the JS text report equals the CLI report saved in example.txt', () => {
  const first = EXAMPLE.split('\n(exit 0)')[0];
  const pyReport = first.split('\n').slice(1).join('\n') + '\n';
  assert.ok(first.startsWith('$ python3 ideas/08-blue-cells/ladder_export.py /home/user/skyhook/'), 'example.txt opens with the live run');
  assert.equal(BC.renderReport(RESULT), pyReport);
});

test('md5 and sha256 close the provenance loop: decision_grid.json workbook_md5, the sidecar, Node crypto', () => {
  assert.equal(RESULT.workbook.md5, GRID.workbook_md5);
  assert.equal(RESULT.workbook.md5, crypto.createHash('md5').update(XLSX).digest('hex'));
  assert.equal(RESULT.workbook.sha256, PROV.sourceSha256);
  assert.equal(RESULT.workbook.bytes, PROV.sourceBytes);
  assert.equal(PROV.readMatchesCommitted, true);
  assert.equal(RESULT.provenance.commit, PROV.commit);
});

test('MD5 reproduces the RFC 1321 test vectors and Node crypto across block boundaries', () => {
  const u = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
  assert.equal(BC.md5(u('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(BC.md5(u('a')), '0cc175b9c0f1b6a831c399e269772661');
  assert.equal(BC.md5(u('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(BC.md5(u('message digest')), 'f96b697d7cb7938d525a2f31aaf161d0');
  assert.equal(BC.md5(u('12345678901234567890123456789012345678901234567890123456789012345678901234567890')), '57edf4a22be3c955ac49da2e2107b67a');
  for (const n of [55, 56, 63, 64, 65, 119, 120, 128, 1000, 65603]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 7 + 3) & 0xff;
    assert.equal(BC.md5(bytes), crypto.createHash('md5').update(bytes).digest('hex'), `n=${n}`);
  }
});

test('CRC-32 reproduces the standard check value and Node zlib', () => {
  assert.equal(BC.crc32(new Uint8Array(Buffer.from('123456789'))), 0xcbf43926);
  assert.equal(BC.crc32(XLSX), zlib.crc32(XLSX));
});

test('a stored (method 0) zip is read, and a corrupted member fails its CRC check', async () => {
  const z = storedZip([['a.txt', 'hello'], ['dir/b.bin', Buffer.from([0, 1, 2, 255])]]);
  const entries = BC.readZip(z);
  assert.deepEqual(entries.map((e) => [e.name, e.method, e.size]), [['a.txt', 0, 5], ['dir/b.bin', 0, 4]]);
  assert.equal(Buffer.from(await BC.inflateEntry(entries[0], null)).toString(), 'hello');
  const bad = new Uint8Array(z);
  bad[30 + 5] = 0x48; // 'h' -> 'H' inside a.txt's stored bytes
  await assert.rejects(BC.inflateEntry(BC.readZip(bad)[0], null), /CRC-32/);
  assert.throws(() => BC.readZip(new Uint8Array(Buffer.from('PK not really a zip'))), BC.WorkbookError);
  await assert.rejects(BC.readWorkbook(storedZip([['a.txt', 'x']]), inflateRaw, 'x.xlsx'), /no xl\/workbook\.xml/);
  // An archive comment pushes the end-of-central-directory record away from the last 22 bytes.
  const commented = BC.readZip(storedZip([['a.txt', 'hello']], 'saved by a tool that writes a 60-byte archive comment here'));
  assert.deepEqual(commented.map((e) => [e.name, e.size]), [['a.txt', 5]]);
});

// The snapshot with sheet2.xml damaged while the central directory stays intact: one byte inverted
// 50 bytes into its deflate data, or its CRC-32 changed in the local and central headers.
function corruptSheet2() {
  const entry = BC.readZip(XLSX).find((e) => e.name === 'xl/worksheets/sheet2.xml');
  const start = entry.data.byteOffset - XLSX.byteOffset;
  const flipped = new Uint8Array(XLSX);
  flipped[start + 50] ^= 0xff;
  const bad = new Uint8Array(XLSX);
  const dv = new DataView(bad.buffer);
  const eocd = bad.length - 22;
  let p = dv.getUint32(eocd + 16, true);
  while (dv.getUint32(p, true) === 0x02014b50) {
    const n = dv.getUint16(p + 28, true), x = dv.getUint16(p + 30, true), c = dv.getUint16(p + 32, true);
    if (Buffer.from(bad.subarray(p + 46, p + 46 + n)).toString() === 'xl/worksheets/sheet2.xml') {
      bad[p + 16] ^= 0x01;
      bad[dv.getUint32(p + 42, true) + 14] ^= 0x01;
    }
    p += 46 + n + x + c;
  }
  return { flipped, bad };
}

test('a corrupt member or a truncated archive is a WorkbookError naming what failed, never a raw inflate error', async () => {
  const { flipped, bad } = corruptSheet2();
  await assert.rejects(BC.readWorkbook(flipped, inflateRaw, 'flipped.xlsx'),
    (e) => e instanceof BC.WorkbookError && /^member xl\/worksheets\/sheet2\.xml could not be read: its deflate data is corrupt \(/.test(e.message));
  await assert.rejects(BC.readWorkbook(bad, inflateRaw, 'badcrc.xlsx'),
    (e) => e instanceof BC.WorkbookError && e.message === 'member xl/worksheets/sheet2.xml failed its CRC-32 check');
  assert.throws(() => BC.readZip(XLSX.subarray(0, 40000)), BC.WorkbookError);
  // An end-of-central-directory record that points past the end of the file.
  const lying = new Uint8Array(XLSX);
  new DataView(lying.buffer).setUint32(lying.length - 22 + 16, lying.length + 1000, true);
  assert.throws(() => BC.readZip(lying), (e) => e instanceof BC.WorkbookError && /truncated or damaged/.test(e.message));
});

test('any relationships prefix, prefixed elements and single-quoted attributes (the same XML as the Python test)', async () => {
  const wbxml = "<x:workbook xmlns:x='http://schemas.openxmlformats.org/spreadsheetml/2006/main' "
    + "xmlns:rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'>"
    + "<x:sheets><x:sheet name='Only' sheetId='1' rel:id='rId7'></x:sheet></x:sheets></x:workbook>";
  const rels = "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>"
    + "<Relationship Id='rId7' Type='x' Target='/xl/worksheets/one.xml'/></Relationships>";
  const sheet = "<x:worksheet xmlns:x='http://schemas.openxmlformats.org/spreadsheetml/2006/main'><x:sheetData>"
    + "<x:row r='1'><x:c r='A1' t='inlineStr'><x:is><x:t>hi</x:t></x:is></x:c><x:c r='B1'><x:v>7</x:v></x:c>"
    + '</x:row></x:sheetData></x:worksheet>';
  const wb = await BC.readWorkbook(storedZip([['xl/workbook.xml', wbxml], ['xl/_rels/workbook.xml.rels', rels], ['xl/worksheets/one.xml', sheet]]), inflateRaw, 'prefixed.xlsx');
  assert.deepEqual(wb.sheets.map((x) => [x.name, x.part]), [['Only', 'xl/worksheets/one.xml']]);
  assert.deepEqual(wb.sheets[0].cells.map((c) => [c.ref, c.kind, c.value]), [['A1', 'string', 'hi'], ['B1', 'number', 7]]);
  // A sheet whose relationship attribute is in no namespace is not silently given one.
  assert.equal(BC.parseWorkbookXml('<workbook xmlns:r="urn:other"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>').sheets[0].rId, null);
});

test('cell kinds, entities, empty <v/>, inline runs, cached values', () => {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const xml = `<worksheet ${NS}><sheetData><row r="1">`
    + '<c r="A1" t="inlineStr"><is><t>Ops &amp; wear &gt; 5 &#x2014; &quot;x&quot;</t></is></c>'
    + '<c r="B1" t="n"/>'
    + '<c r="C1"><f>1+1</f><v/></c>'
    + '<c r="D1"><f>IF(B1&gt;0,1,2)</f><v>2</v></c>'
    + '<c r="E1" t="str"><f>"a"</f><v>a</v></c>'
    + '<c r="F1" t="b"><v>1</v></c>'
    + '<c r="G1" t="e"><v>#DIV/0!</v></c>'
    + '<c r="H1"><v>0</v></c>'
    + '<c r="I1" s="3"><v> 2.5 </v></c>'
    + '<c r="J1" t="inlineStr"><is><r><t>two </t></r><r><t>runs</t></r></is></c>'
    + '</row></sheetData></worksheet>';
  const cells = Object.fromEntries(BC.parseSheet(xml, null, null).map((c) => [c.ref, c]));
  assert.equal(cells.A1.value, 'Ops & wear > 5 — "x"');
  assert.equal(cells.B1.kind, 'empty');
  assert.deepEqual([cells.C1.kind, cells.C1.formula, cells.C1.cached], ['formula', '1+1', null]);
  assert.deepEqual([cells.D1.formula, cells.D1.cached], ['IF(B1>0,1,2)', '2']);
  assert.deepEqual([cells.E1.kind, cells.E1.cached], ['formula', 'a']);
  assert.deepEqual([cells.F1.kind, cells.F1.value], ['bool', true]);
  assert.deepEqual([cells.G1.kind, cells.G1.value], ['error', '#DIV/0!']);
  assert.deepEqual([cells.H1.kind, cells.H1.value], ['number', 0]);
  assert.deepEqual([cells.I1.value, cells.I1.raw, cells.I1.s], [2.5, '2.5', 3]);
  assert.equal(cells.J1.value, 'two runs');
  assert.equal(BC.decodeEntities('&#65;&#x42;&lt;&gt;&amp;&apos;'), "AB<>&'");
});

test('shared strings resolve, and a missing shared-strings part is a WorkbookError', () => {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const sst = BC.parseSharedStrings(`<sst ${NS}><si><t>Parameter</t></si><si><r><t>Con</t></r><r><t>servative</t></r></si><si/></sst>`);
  assert.deepEqual(sst, ['Parameter', 'Conservative', '']);
  const xml = `<worksheet ${NS}><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c></row></sheetData></worksheet>`;
  const cells = BC.parseSheet(xml, sst, null);
  assert.deepEqual(cells.map((c) => c.value), ['Parameter', 'Conservative']);
  assert.throws(() => BC.parseSheet(xml, null, null), BC.WorkbookError);
  assert.throws(() => BC.parseSheet(xml, ['only one'], null), /index 1 is not in/);
});

test('styles: the legend colours come out of styles.xml as the workbook README states them', async () => {
  const stylesXml = Buffer.from(await BC.inflateEntry(BC.readZip(XLSX).find((e) => e.name === 'xl/styles.xml'), inflateRaw)).toString('utf8');
  const st = BC.parseStyles(stylesXml);
  assert.equal(st.fonts.length, 13);
  assert.equal(st.fonts[7].rgb, 'FF0000FF');
  assert.equal(st.fonts[10].rgb, 'FF008000');
  assert.equal(st.fills[3].rgb, 'FFFFFF00');
  assert.deepEqual(st.xfs[17], { fontId: 7, fillId: 0 });
  assert.deepEqual(BC.styleColours(st, 17), ['0000FF', null]);
  assert.deepEqual(BC.styleColours(st, 19), ['0000FF', 'FFFF00']);
  assert.deepEqual(BC.styleColours(st, 20), ['000000', null]);
  assert.deepEqual(BC.styleColours(st, 21), ['008000', null]);
  assert.deepEqual(BC.styleColours(st, 999), [null, null]);
  const grid = Object.fromEntries(WB.sheets.flatMap((s) => s.cells.map((c) => [`${s.name}!${c.ref}`, c])));
  assert.equal(grid['Assumptions!B3'].font_rgb, '0000FF');
  assert.equal(grid['Assumptions!B8'].fill_rgb, 'FFFF00');
  assert.equal(grid['Cash Flow & Payback!B4'].font_rgb, '008000');
  assert.equal(grid['Cash Flow & Payback!F11'].kind, 'number');
  assert.equal(grid['Design Calcs!E15'].kind, 'empty');
});

test('the census is what the Python tests pin: 81/63/2 formula cells, none cached, 63 blue cells', () => {
  const cs = RESULT.census.sheets;
  assert.deepEqual(Object.keys(cs), ['README', 'Assumptions', 'Design Calcs', 'Phase Budgets', 'Cash Flow & Payback']);
  assert.deepEqual([cs['Design Calcs'].formula_cells, cs['Cash Flow & Payback'].formula_cells, cs['Phase Budgets'].formula_cells], [81, 63, 2]);
  assert.equal(RESULT.census.totals.formula_cells, 146);
  assert.equal(RESULT.census.totals.formula_cells_with_cached_value, 0);
  assert.equal(RESULT.census.totals.literal_numbers, 81);
  assert.equal(RESULT.census.totals.blue_cells, 63);
  assert.equal(RESULT.census.totals.blue_literal_numbers, 62);
  assert.match(RESULT.finding, /146 formula cells and 0 cached results/);
  assert.deepEqual(RESULT.checks.map((c) => [c.name, c.ok]), [['ladder-blue', true], ['no-blue-formula', true], ['green-are-links', true], ['design-point', true]]);
  assert.deepEqual(RESULT.guards.map((g) => g.name), ['ladder-rows', 'ladder-literals']);
  const t = (f, c) => ({ formula_cells: f, formula_cells_with_cached_value: c, literal_numbers: 1, blue_cells: 1 });
  assert.match(BC.findingSentence(WB, t(5, 5)), /5 formula cells, all 5 with a cached result stored in the file\.$/);
  assert.match(BC.findingSentence(WB, t(5, 2)), /5 formula cells, 2 of them with a cached result stored in the file; the other 3 store none\.$/);
  for (const s of WB.sheets) for (const c of s.cells) if (c.kind === 'formula') assert.equal(c.cached, null, `${s.name}!${c.ref}`);
});

test('the shuffled fixture is refused with exactly the message the Python CLI printed', async () => {
  const fx = new Uint8Array(read(path.join(here, 'fixtures', 'shuffled_assumptions.xlsx')));
  const wb = await BC.readWorkbook(fx, inflateRaw, 'shuffled_assumptions.xlsx');
  assert.deepEqual(wb.media, []);
  let err;
  try { BC.analyze(wb, ROWS); } catch (e) { err = e; }
  assert.ok(err instanceof BC.LadderError);
  const block = EXAMPLE.split('\n\n$ ')[1];
  const stderr = block.split('\n').slice(1).join('\n').split('\n(exit 1)')[0];
  assert.equal(`ladder_export.py: REFUSED — ${err.message}`, stderr);
});

test('a formula, an empty cell, a renamed header or a missing sheet in the ladder is refused, naming the cell', async () => {
  const cases = [
    [(x) => x.replace('<c r="B5" s="17" t="n"><v>2500</v></c>', '<c r="B5" s="17"><f>D5*3</f><v/></c>'), /B5 \(construction_launch_per_kg, Conservative\) holds the formula =D5\*3/],
    [(x) => x.replace('<c r="C7" s="17" t="n"><v>0.06</v></c>', '<c r="C7" s="17" t="n"/>'), /C7 \(electricity_per_kwh, Baseline\) is empty/],
    [(x) => x.replace('<t>Baseline</t>', '<t>Nominal</t>'), /header C2 reads 'Nominal', expected the scenario column 'Baseline'/],
    [(x) => x.replace('<t>Payload per catch (kg)</t>', '<t>Mass per catch (kg)</t>'), /ladder row 12 \(payload_kg\): column A reads 'Mass per catch \(kg\)', expected a label containing 'payload per catch'/],
  ];
  for (const [edit, re] of cases) {
    const wb = await BC.readWorkbook(await repack(edit), inflateRaw, 'edited.xlsx');
    assert.throws(() => BC.analyze(wb, ROWS), re);
  }
  assert.throws(() => BC.analyze(WB, { ...ROWS, sheet: 'Inputs' }), /no sheet named 'Inputs'/);
  const changed = await BC.readWorkbook(await repack((x) => x.replace('<c r="B5" s="17" t="n"><v>2500</v></c>', '<c r="B5" s="17" t="n"><v>2600</v></c>')), inflateRaw, 'drift.xlsx');
  const r = BC.analyze(changed, ROWS);
  assert.equal(r.ladder.rows.construction_launch_per_kg.values.Conservative, 2600);
  assert.notEqual(r.workbook.md5, RESULT.workbook.md5);
});

test('the pre-fix workbook (LibreOffice-written, blob 46bc02e): 134 of 134 cached, refused on row 3 with the CLI\'s exact message', async () => {
  const pre = new Uint8Array(read(path.join(here, 'fixtures', 'pre_fix_7bb5b5f.xlsx')));
  const blob = crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${pre.length}\0`), Buffer.from(pre)])).digest('hex');
  assert.equal(blob, '46bc02ed26367805f0e920b00a52de9098e42613');
  const wb = await BC.readWorkbook(pre, inflateRaw, 'pre_fix_7bb5b5f.xlsx');
  assert.match(wb.application, /^LibreOffice\/24\.2\.7\.2/);
  const per = Object.fromEntries(wb.sheets.map((x) => [x.name, BC.census(x)]));
  const t = BC.totals(per);
  assert.deepEqual([t.formula_cells, t.formula_cells_with_cached_value], [134, 134]);
  assert.equal(per['Design Calcs'].formula_cells, 69);
  let err;
  try { BC.analyze(wb, ROWS); } catch (e) { err = e; }
  assert.ok(err instanceof BC.LadderError);
  const block = EXAMPLE.split('\n\n$ ')[2];
  assert.ok(block.startsWith('python3 ideas/08-blue-cells/ladder_export.py ideas/08-blue-cells/fixtures/pre_fix_7bb5b5f.xlsx\n'));
  const stderr = block.split('\n').slice(1).join('\n').split('\n(exit 1')[0];
  assert.equal(`ladder_export.py: REFUSED — ${err.message}`, stderr);
});

test('a copy re-saved by LibreOffice: shared strings, 146 cached results, the same ladder, "beyond Y15" as a string result', async () => {
  const lo = new Uint8Array(read(path.join(here, 'fixtures', 'recalculated_by_libreoffice.xlsx')));
  const wb = await BC.readWorkbook(lo, inflateRaw, 'recalculated_by_libreoffice.xlsx');
  const r = BC.analyze(wb, ROWS);
  assert.match(wb.application, /^LibreOffice/);
  assert.equal(wb.shared_strings, 158);
  assert.equal(r.census.totals.formula_cells, 146);
  assert.equal(r.census.totals.formula_cells_with_cached_value, 146);
  assert.match(r.finding, /146 formula cells, all 146 with a cached result/);
  assert.ok(r.checks.every((c) => c.ok));
  assert.notEqual(r.workbook.md5, RESULT.workbook.md5);
  for (const [k, row] of Object.entries(RESULT.ladder.rows)) assert.deepEqual(r.ladder.rows[k].values, row.values, k);
  const grid = Object.fromEntries(wb.sheets.flatMap((s) => s.cells.map((c) => [`${s.name}!${c.ref}`, c])));
  assert.equal(grid['Cash Flow & Payback!B2'].t, 's');
  assert.equal(grid['Cash Flow & Payback!B2'].value, 'Conservative');
  assert.deepEqual([grid['Cash Flow & Payback!B16'].t, grid['Cash Flow & Payback!B16'].cached], ['str', 'beyond Y15']);
  const revA = readJson(path.join(SNAPS, 'rev_a.json')).mass_ratio.integrated_tether_to_payload_both_arms;
  assert.ok(Math.abs(2 * Number(grid['Design Calcs!B11'].cached) - revA.conservative_30pct_derate) < 0.005, 'LibreOffice evaluates row 11 to the published 121.83');
  assert.ok(Math.abs(Number(grid['Design Calcs!B12'].cached) - revA.conservative_30pct_fiber_mass_t) < 0.05);
  assert.ok(Number(grid['Design Calcs!B31'].cached) > 1, 'the ERF audit block fails under spreadsheet precedence (README finding)');
});

// fixtures/malformed_cases.json, shared with test_ladder_export.py: the same bytes get the same verdict.
const CASES = readJson(path.join(here, 'fixtures', 'malformed_cases.json'));
async function buildCase(c) {
  const base = new Uint8Array(read(path.join(here, CASES.bases[c.base || 'snapshot'])));
  const member = c.member || 'xl/worksheets/sheet2.xml';
  const members = [];
  let hit = false;
  for (const e of BC.readZip(base)) {
    let data = Buffer.from(await BC.inflateEntry(e, inflateRaw));
    if (e.name === member) {
      hit = true;
      if (c.replace) {
        const [oldS, newS] = c.replace.map((x) => Buffer.from(x, 'utf8'));
        const i = data.indexOf(oldS);
        assert.ok(i >= 0, `${c.name}: ${c.replace[0]} is not in ${e.name}`);
        data = Buffer.concat([data.subarray(0, i), newS, data.subarray(i + oldS.length)]);
      } else if (c.truncate) {
        data = data.subarray(0, data.length - c.truncate);
      } else {
        const [after, byte] = c.insert_byte;
        const a = Buffer.from(after, 'utf8');
        const i = data.indexOf(a) + a.length;
        data = Buffer.concat([data.subarray(0, i), Buffer.from([byte]), data.subarray(i)]);
      }
    }
    members.push([e.name, data]);
  }
  assert.ok(hit, `${c.name}: no member ${member}`);
  return storedZip(members);
}

test('crafted damage gets the verdict and message the Python reader gives (fixtures/malformed_cases.json)', async () => {
  assert.ok(CASES.cases.length >= 20);
  for (const c of CASES.cases) {
    let kind, got;
    try {
      got = BC.analyze(await BC.readWorkbook(await buildCase(c), inflateRaw, 'case.xlsx'), ROWS);
      kind = 'ok';
    } catch (e) {
      if (e instanceof BC.WorkbookError) kind = 'unreadable';
      else if (e instanceof BC.LadderError) kind = 'refused';
      else throw e;
      got = e.message;
    }
    assert.equal(kind, c.expect, `${c.name}: ${typeof got === 'string' ? got : 'read without complaint'}`);
    if (kind === 'ok') {
      const [key, scn, want] = c.value;
      assert.equal(got.ladder.rows[key].values[scn], want, c.name);
      assert.deepEqual(got.checks.filter((x) => !x.ok).map((x) => x.name), c.failedCheck ? [c.failedCheck] : [], c.name);
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(got)));
    } else {
      assert.ok(got.includes(c.message), `${c.name}: ${got}`);
    }
  }
});

test('the XML check passes every part of the three workbooks and names what is wrong with a damaged one', async () => {
  for (const f of ['snapshots/skyhook_financial_model.xlsx', 'fixtures/recalculated_by_libreoffice.xlsx', 'fixtures/pre_fix_7bb5b5f.xlsx']) {
    for (const e of BC.readZip(new Uint8Array(read(path.join(here, f))))) {
      if (!e.name.endsWith('.xml') && !e.name.endsWith('.rels')) continue;
      assert.equal(BC.xmlProblem(Buffer.from(await BC.inflateEntry(e, inflateRaw)).toString('utf8')), null, `${f} ${e.name}`);
    }
  }
  assert.equal(BC.xmlProblem('<?xml version="1.0"?><a x="1 > 0"><b/><!-- c --><![CDATA[<d>]]></a>\n'), null);
  assert.match(BC.xmlProblem('<a><b></a>'), /<\/a> closes <b>/);
  assert.match(BC.xmlProblem('<a></a><a/>'), /more than one root/);
  assert.match(BC.xmlProblem('<a><b x=1/></a>'), /unmatched '<'/);
  assert.match(BC.xmlProblem('<a>x & y</a>'), /bare '&'/);
  assert.match(BC.xmlProblem('<a><b>'), /<b> is never closed/);
  assert.match(BC.xmlProblem('<a>'), /never closed/);
  assert.match(BC.xmlProblem('<a/>junk'), /text outside the root/);
  assert.match(BC.xmlProblem(''), /no root element/);
  assert.equal(BC.parseNumber('-0.5E+2', 'X1'), -50);
  for (const bad of ['NaN', 'Infinity', '-Infinity', '1e999', '0x10', '0b1', '1_0', '1,5', '.', '+', '1e', '\u0661']) {
    assert.throws(() => BC.parseNumber(bad, 'X1'), (e) => e instanceof BC.WorkbookError && e.message === `X1 is typed numeric but holds ${BC.repr(bad)}`, bad);
  }
});

test('analyze is pure: same output twice, input bytes untouched, no clock', () => {
  const a = JSON.stringify(BC.analyze(WB, ROWS, PROV));
  const b = JSON.stringify(BC.analyze(WB, ROWS, PROV));
  assert.equal(a, b);
  assert.equal(BC.md5(XLSX), RESULT.workbook.md5, 'the input bytes were not modified by reading them');
  assert.ok(!JSON.stringify(BC.analyze(WB, ROWS)).includes('copiedAt'));
});

test('LABEL_GUARD is the same table in both implementations', () => {
  const py = fs.readFileSync(path.join(here, 'ladder_export.py'), 'utf8');
  const block = /LABEL_GUARD = \{([\s\S]*?)\n\}/.exec(py)[1];
  const pairs = Object.fromEntries([...block.matchAll(/"([a-zA-Z0-9_]+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(pairs, BC.LABEL_GUARD);
  assert.deepEqual(Object.keys(BC.LABEL_GUARD).sort(), Object.keys(ROWS.rows).sort());
});

test('slug, repr and the design-point keys', () => {
  assert.equal(BC.slug('CoM altitude (km)'), 'com_altitude_km');
  assert.equal(BC.slug('Rev A reference tip speed (km/s) — GTO/high-elliptical'), 'rev_a_reference_tip_speed_km_s');
  assert.equal(BC.repr(null), 'None');
  assert.equal(BC.repr("it's"), '"it\'s"');
  assert.equal(BC.repr(5), '5');
  assert.deepEqual(Object.keys(RESULT.design_point.entries), Object.keys(PY.design_point.entries));
  assert.equal(RESULT.constants.entries.earth_radius_km.value, 6371);
});

test('page-data.js carries the same JSON as ladder.json, and the module loads as a classic script', () => {
  const js = fs.readFileSync(path.join(here, 'page-data.js'), 'utf8');
  const body = js.slice(js.indexOf('window.BLUE_CELLS_DATA = ') + 'window.BLUE_CELLS_DATA = '.length).trim().replace(/;$/, '');
  assert.deepEqual(diff(JSON.parse(body), PY), []);
  const ctx = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(here, 'bluecells.js'), 'utf8'), ctx);
  assert.equal(ctx.self.BlueCells.VERSION, BC.VERSION);
  assert.equal(typeof ctx.self.BlueCells.readWorkbook, 'function');
});
