import type { MissionMode } from './launch-vehicles.js';

export const EARTH_MU_KM3_PER_S2 = 398_600.4418;
export const LEO_PARKING_RADIUS_KM = 6_578.137;
export const STATIONKEEPING_DV_KMPS = 0.150;
export const DV_MARGIN_FRACTION = 0.10;

export interface DeltaVStackBreakdown {
  readonly injectionKmps: number;
  readonly rendezvousKmps: number;
  readonly departureKmps: number;
  readonly stationkeepingKmps: number;
  readonly subtotalKmps: number;
  readonly marginKmps: number;
  readonly totalKmps: number;
}

export function injectionDvFromC3(
  c3Km2PerS2: number,
  muKm3PerS2 = EARTH_MU_KM3_PER_S2,
  parkingRadiusKm = LEO_PARKING_RADIUS_KM,
): number {
  const circularVelocityKmps = Math.sqrt(muKm3PerS2 / parkingRadiusKm);
  const hyperbolicPerigeeVelocityKmps = Math.sqrt(c3Km2PerS2 + (2 * muKm3PerS2) / parkingRadiusKm);
  return hyperbolicPerigeeVelocityKmps - circularVelocityKmps;
}

export function rendezvousDvFromVInf(vInfArrKmps: number): number {
  return vInfArrKmps;
}

export function departureDvFromVInf(vInfArrKmps: number): number {
  return vInfArrKmps;
}

export function buildDeltaVStack(
  c3Km2PerS2: number,
  vInfArrKmps: number,
  missionMode: MissionMode,
): DeltaVStackBreakdown {
  const injectionKmps = injectionDvFromC3(c3Km2PerS2);
  const rendezvousKmps = rendezvousDvFromVInf(vInfArrKmps);
  // A one-way rendezvous ends at the target; only sample return pays the
  // symmetric-return departure burn (the screening assumption is vInf_arr).
  const departureKmps = missionMode === 'sample-return' ? departureDvFromVInf(vInfArrKmps) : 0;
  const stationkeepingKmps = STATIONKEEPING_DV_KMPS;
  const subtotalKmps = injectionKmps + rendezvousKmps + departureKmps + stationkeepingKmps;
  const marginKmps = subtotalKmps * DV_MARGIN_FRACTION;
  return {
    injectionKmps,
    rendezvousKmps,
    departureKmps,
    stationkeepingKmps,
    subtotalKmps,
    marginKmps,
    totalKmps: subtotalKmps + marginKmps,
  };
}
