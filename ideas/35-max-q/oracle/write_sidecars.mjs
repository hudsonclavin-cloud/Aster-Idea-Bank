#!/usr/bin/env node
// Writes the provenance sidecars of this module's two hand-made snapshots (fetched primary sources, not repo files,
// so tools/snapshot.mjs cannot write them): the AS-512 trajectory transcription and the Saturn V axial-force
// digitization. Re-run after editing either file so writtenSha256 stays true. Run from the bank root:
//   node ideas/35-max-q/oracle/write_sidecars.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const snaps = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'snapshots');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const RETRIEVED = '2026-10-31';
const SIDES = {
  'as512-trajectory.js': {
    repo: 'https://ntrs.nasa.gov', commit: 'retrieved ' + RETRIEVED, retrieved: RETRIEVED,
    sourceUrl: 'https://ntrs.nasa.gov/api/citations/19730025089/downloads/19730025089.pdf',
    sourceSha256: '8e543894efef0d9a3862ded599001d1d9c83b0e5684f85dbe85abd981f2eaa42',
    license: 'NASA technical memorandum (MPR-SAT-FE-73-1 / NASA-TM-X-69534), a US-government work: public domain in the US',
    path: 'NTRS 19730025089, MPR-SAT-FE-73-1: Table 2-2 items 10-22 (PDF page 37), section 4.1 (PDF page 56), section 4.2.1 (PDF page 57), Table 4-1 (PDF page 60), Table 4-2 (PDF page 61), Table 4-4 (PDF page 63), Appendix A.4.1 and A.4.3 (PDF page 278)',
    note: 'Hand-transcribed from the pages rendered at 300 and 500 dpi with pdftoppm (the tables have no legible text layer); prose from the text layer. ACTUAL columns only; four smudged ACTUAL entries reconstructed as NOMINAL + ACT-NOM and marked in the file. ascent.test.mjs checks every m/s against its ft/s and every km against its n mi.',
  },
  'saturn-v-axial-force.js': {
    repo: 'https://ntrs.nasa.gov', commit: 'retrieved ' + RETRIEVED, retrieved: RETRIEVED,
    sourceUrl: 'https://ntrs.nasa.gov/api/citations/19690009748/downloads/19690009748.pdf',
    sourceSha256: 'f60fed99deaf8228fa2490e4eb68097f752d871ddbb77e9841700ec9c3670a9d',
    license: 'NASA technical memorandum (TM X-53770), a US-government work: public domain in the US',
    path: 'NTRS 19690009748, C. E. Walker, NASA TM X-53770 (21 Aug 1968): Figure 28 (printed page 147, PDF page 157), Definition of Symbols (PDF page 9)',
    note: 'Digitized by hand from the 300 dpi 1-bit scan: affine grid calibration (largest residual 1.6 px), dark-run listing at each station, solid fairing picked on zoomed crops (oracle/digitize_fig28.py; its overlay of this table on the figure was inspected). Reading uncertainty +-0.01 above Mach 1.5, +-0.02 below. Independent review (2026-10-31): the figure\'s third curve, the base coefficient C_Ab, read at seven stations clear of data symbols from Mach 2.25 to 7.0 with the reviewer\'s own grid calibration (the `base` table), equals C_AT - C_Af from the two tables to 0.003; the reviewer\'s overlay of both tables on the figure was inspected too.',
  },
};
for (const [f, meta] of Object.entries(SIDES)) {
  const buf = fs.readFileSync(path.join(snaps, f));
  const out = Object.assign({}, meta, { writtenSha256: sha(buf), writtenBytes: buf.length });
  fs.writeFileSync(path.join(snaps, f + '.provenance.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote', f + '.provenance.json', out.writtenSha256.slice(0, 12));
}
