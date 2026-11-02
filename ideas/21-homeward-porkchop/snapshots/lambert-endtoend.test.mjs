import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTsc } from '../helpers/run-tsc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const tempOutDir = path.join(repoRoot, '.tmp-tests', 'v2-lambert-endtoend');
fs.rmSync(tempOutDir, { recursive: true, force: true });
fs.mkdirSync(tempOutDir, { recursive: true });

const tscResult = runTsc(
[
        '--pretty', 'false',
        '--outDir', tempOutDir,
        '--rootDir', path.join(repoRoot, 'src', 'v2'),
        '--module', 'NodeNext',
        '--target', 'ES2020',
        '--moduleResolution', 'NodeNext',
        '--isolatedModules', 'true',
        path.join(repoRoot, 'src', 'v2', 'core', 'lambert', 'izzo.ts'),
        path.join(repoRoot, 'src', 'v2', 'core', 'lambert', 'householder.ts'),
        path.join(repoRoot, 'src', 'v2', 'core', 'lambert', 'tof.ts'),
        path.join(repoRoot, 'src', 'v2', 'core', 'lambert', 'hyp2f1b.ts'),
        path.join(repoRoot, 'src', 'v2', 'core', 'lambert', 'initial-guess.ts'),
        path.join(repoRoot, 'src', 'v2', 'core', 'lambert', 'vec3.ts'),
    ],
    { cwd: repoRoot, encoding: 'utf8' }
);
assert.equal(tscResult.status, 0, tscResult.stderr || tscResult.stdout || 'tsc failed');

const { lambert } = await import(
    pathToFileURL(path.join(tempOutDir, 'core', 'lambert', 'izzo.js')).href
);

const MU_EARTH = 398600.0;
const MU_SUN = 1.32712440018e11;
const AU = 1.495978707e8;

const TOL = 1e-8;

{
    const k = MU_EARTH;
    const r1 = [5000.0, 10000.0, 2100.0];
    const r2 = [-14600.0, 2500.0, 7000.0];
    const tof = 3600.0;

    const result = lambert(k, r1, r2, tof);
    assert.ok(result.ok, `Case 1 (Curtis 5.2): lambert failed: ${result.reason}`);

    const expected_v1 = [-5.99249464, 1.92536342, 3.24563653];
    const expected_v2 = [-3.31246031, -4.19661731, -0.38528762];

    if (!result.ok) {
        throw new Error('unreachable');
    }

    for (let i = 0; i < 3; i++) {
        const err1 = Math.abs(result.v1[i] - expected_v1[i]);
        const err2 = Math.abs(result.v2[i] - expected_v2[i]);
        assert.ok(
            err1 < TOL * Math.max(1, Math.abs(expected_v1[i])),
            `Case 1 v1[${i}]: got ${result.v1[i]}, expected ${expected_v1[i]}, diff ${err1}`
        );
        assert.ok(
            err2 < TOL * Math.max(1, Math.abs(expected_v2[i])),
            `Case 1 v2[${i}]: got ${result.v2[i]}, expected ${expected_v2[i]}, diff ${err2}`
        );
    }

    assert.ok(
        Math.abs(result.x - 0.6194523920450226) < 1e-10,
        `Case 1 x: got ${result.x}, expected 0.6194523920450226`
    );

    assert.ok(result.iterations <= 6, `Case 1 iterations: ${result.iterations} (expected <= 6)`);
}

{
    const k = MU_EARTH;
    const r1 = [15945.34, 0.0, 0.0];
    const r2 = [12214.83399, 10249.46731, 0.0];
    const tof = 76 * 60.0;

    const result = lambert(k, r1, r2, tof);
    assert.ok(result.ok, `Case 2 (Curtis 5.3): lambert failed: ${result.reason}`);

    const expected_v1 = [2.05890996, 2.915964, 0.0];
    const expected_v2 = [-3.45156412, 0.91031477, 0.0];

    if (!result.ok) {
        throw new Error('unreachable');
    }

    for (let i = 0; i < 3; i++) {
        const err1 = Math.abs(result.v1[i] - expected_v1[i]);
        const err2 = Math.abs(result.v2[i] - expected_v2[i]);
        assert.ok(
            err1 < TOL * Math.max(1, Math.abs(expected_v1[i])),
            `Case 2 v1[${i}]: got ${result.v1[i]}, expected ${expected_v1[i]}, diff ${err1}`
        );
        assert.ok(
            err2 < TOL * Math.max(1, Math.abs(expected_v2[i])),
            `Case 2 v2[${i}]: got ${result.v2[i]}, expected ${expected_v2[i]}, diff ${err2}`
        );
    }

    assert.equal(result.v1[2], 0, `Case 2 v1[z] should be 0, got ${result.v1[2]}`);
    assert.equal(result.v2[2], 0, `Case 2 v2[z] should be 0, got ${result.v2[2]}`);
}

{
    const k = MU_SUN;
    const r1 = [AU, 0.0, 0.0];
    const r2 = [0.0, 1.5 * AU, 0.0];
    const tof = 200 * 86400.0;

    const result = lambert(k, r1, r2, tof);
    assert.ok(result.ok, `Case 3 (heliocentric): lambert failed: ${result.reason}`);

    const expected_v1 = [14.72687548, 27.06897838, 0.0];
    const expected_v2 = [-18.04598558, -5.70388269, 0.0];

    if (!result.ok) {
        throw new Error('unreachable');
    }

    for (let i = 0; i < 3; i++) {
        const err1 = Math.abs(result.v1[i] - expected_v1[i]);
        const err2 = Math.abs(result.v2[i] - expected_v2[i]);
        assert.ok(
            err1 < TOL * Math.max(1, Math.abs(expected_v1[i])),
            `Case 3 v1[${i}]: got ${result.v1[i]}, expected ${expected_v1[i]}, diff ${err1}`
        );
        assert.ok(
            err2 < TOL * Math.max(1, Math.abs(expected_v2[i])),
            `Case 3 v2[${i}]: got ${result.v2[i]}, expected ${expected_v2[i]}, diff ${err2}`
        );
    }
}

{
    const result = lambert(MU_EARTH, [10000, 0, 0], [20000, 0, 0], 3600);
    assert.equal(result.ok, false, 'Collinear r1, r2 should fail');
    if (!result.ok) {
        assert.equal(result.reason, 'invalid_geometry');
    }
}

{
    const result = lambert(MU_EARTH, [0, 0, 0], [10000, 0, 0], 3600);
    assert.equal(result.ok, false, 'Zero r1 should fail');
}

console.log('lambert-endtoend.test: PASS');
