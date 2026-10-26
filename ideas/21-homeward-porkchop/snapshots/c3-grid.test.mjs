import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const tempOutDir = path.join(repoRoot, '.tmp-tests', 'v2-c3-grid');

async function loadModule() {
  fs.rmSync(tempOutDir, { recursive: true, force: true });
  fs.mkdirSync(tempOutDir, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--pretty', 'false',
      '--outDir', tempOutDir,
      '--rootDir', path.join(repoRoot, 'src', 'v2'),
      '--module', 'NodeNext',
      '--target', 'ES2020',
      '--moduleResolution', 'NodeNext',
      '--isolatedModules', 'true',
      path.join(repoRoot, 'src', 'v2', 'boundary', 'c3-grid.ts'),
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout || 'tsc failed');
  return import(pathToFileURL(path.join(tempOutDir, 'boundary', 'c3-grid.js')).href);
}

test('cached C3 grid descriptor and short label derive from cache metadata', async () => {
  const grid = await loadModule();
  const metadata = {
    screeningWindow: { startUtc: '2026-01-01', endUtc: '2040-12-31' },
    departureGridSpacingDays: 7,
    tofGridSpacingDays: 30,
    tofMinDays: 182,
    tofMaxDays: 1826,
  };
  const descriptor = grid.cachedC3GridFromMetadata(metadata);
  assert.deepEqual(descriptor, {
    kind: 'screen-cache',
    departureStepDays: 7,
    tofStepDays: 30,
    tofMinDays: 182,
    tofMaxDays: 1826,
    departureSpan: { startUtc: '2026-01-01', endUtc: '2040-12-31' },
  });
  assert.equal(grid.formatCachedC3GridShort(descriptor), 'cached screen: 7 d \u00D7 30 d steps');

  const changed = grid.cachedC3GridFromMetadata({
    ...metadata,
    departureGridSpacingDays: 5,
    tofGridSpacingDays: 11,
  });
  assert.equal(grid.formatCachedC3GridShort(changed), 'cached screen: 5 d \u00D7 11 d steps');
});

test('requested C3 grid descriptor changes with the scan arguments', async () => {
  const grid = await loadModule();
  const descriptor = grid.requestedC3GridFromArgs({
    departureStartUtc: '2026-01-01',
    departureEndUtc: '2040-01-01',
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 80,
    nTof: 50,
    M: 0,
  });
  assert.deepEqual(descriptor, {
    kind: 'requested-grid',
    departureStartUtc: '2026-01-01',
    departureEndUtc: '2040-01-01',
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 80,
    nTof: 50,
    M: 0,
  });
  const changed = grid.requestedC3GridFromArgs({ ...descriptor, nDep: 731, nTof: 100, M: 1 });
  assert.deepEqual(changed, { ...descriptor, nDep: 731, nTof: 100, M: 1 });
  assert.notEqual(grid.formatRequestedC3GridLabel(descriptor), grid.formatRequestedC3GridLabel(changed));
});

test('porkchop grid dimension wording is derived rather than literal', async () => {
  const grid = await loadModule();
  assert.equal(grid.formatGridDimensions({ nDep: 200, nTof: 100 }), '200×100 grid');
  assert.equal(grid.formatGridDimensions({ nDep: 731, nTof: 100 }), '731×100 grid');
});

test('T5 formatter output changes with its grid parameters', async () => {
  const grid = await loadModule();
  const compareLabel = grid.formatRequestedC3GridLabel({
    kind: 'requested-grid',
    departureStartUtc: '2026-01-01',
    departureEndUtc: '2040-01-01',
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 731,
    nTof: 100,
    M: 0,
  });
  const changedCompareLabel = grid.formatRequestedC3GridLabel({
    kind: 'requested-grid',
    departureStartUtc: '2026-01-01',
    departureEndUtc: '2040-01-01',
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 200,
    nTof: 100,
    M: 0,
  });
  assert.notEqual(compareLabel, changedCompareLabel);

  const porkchopLabel = grid.formatJdC3GridLabel({
    depStartJD: 2461041.500800741,
    depEndJD: 2466154.500800741,
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 731,
    nTof: 100,
  });
  const changedPorkchopLabel = grid.formatJdC3GridLabel({
    depStartJD: 2461041.500800741,
    depEndJD: 2466154.500800741,
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 200,
    nTof: 100,
  });
  assert.match(compareLabel, /grid/);
  assert.match(porkchopLabel, /grid/);
  assert.notEqual(porkchopLabel, changedPorkchopLabel);
});

test('shared C3 grid label derives common step units from axis parameters', async () => {
  const grid = await loadModule();
  const label = grid.formatJdC3GridLabel({
    depStartJD: 2461041.500800741,
    depEndJD: 2466154.500800741,
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 731,
    nTof: 100,
  });
  assert.equal(label, '731×100 grid · 7.0 d × 16.6 d steps');
  const changed = grid.formatJdC3GridLabel({
    depStartJD: 2461041.500800741,
    depEndJD: 2466154.500800741,
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 200,
    nTof: 100,
  });
  assert.equal(changed, '200×100 grid · 25.7 d × 16.6 d steps');
});
