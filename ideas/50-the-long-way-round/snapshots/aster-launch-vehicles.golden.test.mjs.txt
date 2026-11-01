// Golden-numbers gate — Slice 14 Phase A2 (DEC-14-5: minimal CI, golden-numbers test).
//
// WHAT THIS GUARDS: the `df3225f` class — a launch-vehicle DATA LITERAL changing a
// PRODUCTION OUTPUT silently. df3225f added a New Glenn `{ c3: 5, payloadKg: 6360 }`
// anchor that re-sloped payloadAtC3 across C3 (0,10); it was reverted in bcf1738
// ("provenance fails INV-022"). This test pins the production outputs of
// `payloadAtC3` and `deliveredMassKg` so that class cannot ship unnoticed again.
//
// It pins PRODUCTION OUTPUTS, not validation error bounds. Values below are the
// production truth captured at the Slice-14-founding-doc HEAD (6f42cdd) via the
// overnight probe (/tmp/golden-probe-out.txt).
//
// THE df3225f CATCHER: `New Glenn / Standard / C3=5 -> 6055`. With no C3=5 anchor,
// production interpolates (0,7180)->(10,4930) to 6055 kg. Re-adding the reverted
// 6360 literal flips this row RED — by design. A LEGITIMATE future re-land of that
// anchor (per §7 of the founding doc: manual elvperf screenshot + oracle row +
// tracked DEC-13-1 amendment) MUST update this row in the SAME commit as the data
// change — never edit production to make this test pass; the test follows the data.
//
// Governing decisions (committed LOCKED founding doc, SLICE_14_FOUNDING.md):
//   - DEC-14-5 (LOCKED): minimal CI = tsc --noEmit + this golden-numbers test.
//   - OQ-14-9: golden-set contents (this file is that set).
//   - DEC-13-1 (Slice 13): launch vehicles are sourced DATA, not code — the module
//     and the New Glenn anchor this test pins.
// Motivating invariant: INV-026 (trust-surface provenance, SLICE_14_FOUNDING.md §3) —
//   "the df3225f lesson"; extends INV-022 to the rendering layer. (This test is not
//   itself a trust surface; DEC-14-5 / OQ-14-9 / DEC-13-1 are the operative citations.)
//
// Loads production TypeScript directly via Node's native type-stripping (no tsc
// spawn, no `.bin/tsc` shim — the shim returns status:null under Windows spawnSync,
// INVARIANTS.md §5). Requires Node >= 22.18 / 24; the CI job pins Node 24.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAUNCH_VEHICLES,
  payloadAtC3,
  deliveredMassKg,
  isBeyondCurve,
} from '../../src/v2/porkchop/launch-vehicles.ts';

function vehicle(name, config) {
  const found = LAUNCH_VEHICLES.find((v) => v.name === name && v.config === config);
  assert.ok(found, `vehicle not found in LAUNCH_VEHICLES: ${name} / ${config}`);
  return found;
}

// [name, config, C3 (km^2/s^2), expected payloadKg] — exact production values.
const PAYLOAD_GOLDEN = [
  ['New Glenn', 'Standard', 0, 7180],
  ['New Glenn', 'Standard', 5, 6055], // <- df3225f catcher (interpolated; 6360 re-add flips it)
  ['New Glenn', 'Standard', 20, 2365],
  ['Falcon Heavy', 'Expendable', 0, 15010],
  ['Falcon Heavy', 'Expendable', 5, 13677.5],
  ['Falcon Heavy', 'Expendable', 20, 10115],
  ['Vulcan', 'VC6', 0, 10850],
  ['Vulcan', 'VC6', 5, 9990],
  ['Vulcan', 'VC6', 20, 7630],
];

for (const [name, config, c3, expected] of PAYLOAD_GOLDEN) {
  test(`payloadAtC3 ${name}/${config} C3=${c3} === ${expected} kg`, () => {
    const got = payloadAtC3(vehicle(name, config), c3);
    assert.equal(
      isBeyondCurve(got),
      false,
      `${name}/${config} C3=${c3} unexpectedly returned BEYOND_CURVE`,
    );
    assert.equal(got, expected, `${name}/${config} C3=${c3}: expected ${expected}, got ${got}`);
  });
}

// End-to-end delivered-mass golden case: New Glenn / Standard, C3=5, one-way.
// Inputs and output captured verbatim from /tmp/golden-probe-out.txt (mirrors the
// main.ts one-way budget assembly: marginMps = 5% of rendezvous, DEC-13-6).
//   budget = { rendezvousMps: 1500, stationkeepingMps: 150, marginMps: 75 }
//   ISP 320 s, g0 9.80665 m/s^2, payloadAtC3 6055 kg
test('deliveredMassKg New Glenn/Standard C3=5 one-way === 3494.511538898568 kg', () => {
  const budget = { rendezvousMps: 1500, stationkeepingMps: 150, marginMps: 75 };
  const got = deliveredMassKg(vehicle('New Glenn', 'Standard'), 5, budget, 'one-way');
  assert.equal(isBeyondCurve(got), false, 'delivered-mass case unexpectedly BEYOND_CURVE');
  assert.equal(got, 3494.511538898568, `expected 3494.511538898568, got ${got}`);
});

test('every launch-vehicle anchor carries a source-derived basis', () => {
  const anchors = LAUNCH_VEHICLES.flatMap((item) => item.curve);
  assert.equal(anchors.length, 38);
  assert.ok(anchors.every((anchor) => anchor.basis === 'official'));
});
