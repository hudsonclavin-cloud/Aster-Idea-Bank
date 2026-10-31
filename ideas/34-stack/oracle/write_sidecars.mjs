#!/usr/bin/env node
// Writes the hand-made provenance sidecars of this module's NTRS-derived snapshots (the bank's snapshot.mjs reads
// local git checkouts; these come from a fetched PDF). Re-run after editing as512-flight.js or regenerating
// as512-sources.txt: node ideas/34-stack/oracle/write_sidecars.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const snap = path.join(here, '..', 'snapshots');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const PDF = { url: 'https://ntrs.nasa.gov/api/citations/19730025089/downloads/19730025089.pdf', sha256: '8e543894efef0d9a3862ded599001d1d9c83b0e5684f85dbe85abd981f2eaa42' };
const common = {
  repo: 'https://ntrs.nasa.gov',
  commit: 'retrieved 2026-10-31',
  retrieved: '2026-10-31',
  sourceUrl: PDF.url,
  sourceSha256: PDF.sha256,
  license: 'NASA technical memorandum (MPR-SAT-FE-73-1 / NASA-TM-X-69534), a US-government work: public domain in the US',
};
const files = {
  'as512-flight.js': {
    path: 'NTRS 19730025089, MPR-SAT-FE-73-1 (NASA-TM-X-69534), Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17 Mission (28 Feb 1973): Table 16-9 (PDF pages 235-236), Tables 16-1, 16-3, 16-5, 16-7 (PDF pages 227, 229, 231, 233), Table 2-2 (PDF pages 37-39), Tables 4-1, 4-2, 4-4 (PDF pages 60, 61, 63), Table 5-2 (PDF page 71), section 6.3 (PDF page 84), section 7.1 and Tables 7-1, 7-2 (PDF pages 98, 103, 111)',
    note: 'Hand-transcribed from the pages rendered at 170-400 dpi with pdftoppm (the tables have no legible text layer). Actual (reconstructed) columns only. Checked three ways by stack.test.mjs: kg against the report\'s own lbm column, every running total against the rows above it, and the stage tables against Table 16-9.',
  },
  'as512-sources.txt': {
    path: 'pdftotext -layout of NTRS 19730025089, PDF pages 66, 72, 84, 98, 103, 111 (windows listed in oracle/build_sources.py)',
    note: 'Verbatim text-layer lines (OCR errors kept), written by oracle/build_sources.py, so the tests can find the prose numbers in what the PDF itself says.',
  },
};
for (const [f, extra] of Object.entries(files)) {
  const p = path.join(snap, f);
  const side = Object.assign({}, common, extra, { writtenSha256: sha(p), writtenBytes: fs.statSync(p).size });
  fs.writeFileSync(p + '.provenance.json', JSON.stringify(side, null, 1) + '\n');
  console.log('wrote', f + '.provenance.json');
}
