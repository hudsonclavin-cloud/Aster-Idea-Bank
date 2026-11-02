import { h, render } from 'preact';
import { loadSlice9NeaCatalogFixture } from '../solar-system/loader.js';
import { ingestSlice2Fixture, type HorizonsFixture } from '../../boundary/horizons.js';
import { createPorkchopClient } from '../../porkchop/porkchop-client.js';
import { PorkchopView } from '../../porkchop/porkchop-view.js';
import { J2000_TDB_JULIAN_DATE, SECONDS_PER_DAY } from '../../core/units.js';

const mount = document.getElementById('app');

if (!(mount instanceof HTMLElement)) {
  throw new Error('Porkchop smoke mount point "#app" was not found');
}

const BODY_ID = 'asteroid-99942';
const BODY_LABEL = '99942 Apophis';
const VALIDATED_TARGET = {
  depJD: 2461175.5,
  tofDays: 1095.75,
  expectedC3: 1781.29,
} as const;
const HORIZONS_FIXTURE_URL = new URL(
  '../../data/horizons-inner-solar-system-2026-2040.json',
  import.meta.url,
);

function utcMidnightToJdTdb(utcDate: string): number {
  const utcMillis = Date.parse(`${utcDate}T00:00:00Z`);
  if (!Number.isFinite(utcMillis)) {
    throw new Error(`Invalid UTC date '${utcDate}'`);
  }
  const utcSecondsSinceUnix = utcMillis / 1000;
  const unixToJ2000Seconds = 946_728_000;
  const tdbMinusUtcSeconds = 69.184;
  const tdbSecondsSinceJ2000 = utcSecondsSinceUnix - unixToJ2000Seconds + tdbMinusUtcSeconds;
  return J2000_TDB_JULIAN_DATE + tdbSecondsSinceJ2000 / SECONDS_PER_DAY;
}

async function loadLongWindowEarthSeries() {
  const response = await fetch(HORIZONS_FIXTURE_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load long-window Horizons fixture: ${response.status} ${response.statusText}`,
    );
  }

  const fixture = (await response.json()) as HorizonsFixture;
  const horizonsStates = ingestSlice2Fixture(fixture);
  return horizonsStates.earth.map((sample) => sample.state);
}

async function mountPorkchopSmoke(): Promise<void> {
  const [earthStateSeries, catalog] = await Promise.all([
    loadLongWindowEarthSeries(),
    loadSlice9NeaCatalogFixture(),
  ]);

  const apophis = catalog.asteroids[BODY_ID];
  if (!apophis) {
    throw new Error(`Missing ${BODY_ID} in Slice 9 NEA catalog fixture`);
  }

  const client = await createPorkchopClient(earthStateSeries);

  const gridParams = {
    depStartJD: utcMidnightToJdTdb('2026-01-01'),
    depEndJD: utcMidnightToJdTdb('2040-01-01'),
    tofMinDays: 182.5,
    tofMaxDays: 1826.25,
    nDep: 200,
    nTof: 100,
  } as const;

  window.addEventListener('beforeunload', () => {
    client.dispose();
  }, { once: true });

  render(
    h(PorkchopView, {
      client,
      bodyId: BODY_ID,
      bodyLabel: BODY_LABEL,
      bodyElements: apophis.elements,
      gridParams,
      M: 1,
      validatedTarget: VALIDATED_TARGET,
    }),
    mount,
  );
}

void mountPorkchopSmoke().catch((error: Error) => {
  const message = error instanceof Error ? error.message : String(error);
  mount.textContent = `Porkchop smoke failed: ${message}`;
  console.error(error);
});
