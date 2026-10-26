import { isAsteroidBodyId, type AsteroidBodyId, type BodyClass } from './asteroids.js';

export type BodyId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'phobos'
  | 'deimos'
  | 'jupiter'
  | 'io'
  | 'europa'
  | 'ganymede'
  | 'callisto'
  | 'saturn'
  | 'titan'
  | 'rhea'
  | 'iapetus'
  | 'tethys'
  | 'dione'
  | 'mimas'
  | 'enceladus';

export interface TriaxialRadiiM {
  a: number;
  b: number;
  c: number;
}

export type InterpolationInvariantId = 'INV-008' | 'INV-009' | 'INV-010' | 'INV-011';

export interface BodyConstants {
  naifId: number;
  radiusM: number;
  radiiM?: TriaxialRadiiM;
  vizColor: number;  // render/ layer reads this; core/ must not use it for physics
}

export const BODY_CONSTANTS: Record<BodyId, BodyConstants> = {
  sun:       { naifId: 10,  radiusM: 696_000_000.0, vizColor: 0xFFF5E0 },
  mercury:   { naifId: 199, radiusM:   2_439_700.0, vizColor: 0xB5B5B5 },
  venus:     { naifId: 299, radiusM:   6_051_800.0, vizColor: 0xE8C98A },
  earth:     { naifId: 399, radiusM:   6_378_136.6, vizColor: 0x2255AA },
  moon:      { naifId: 301, radiusM:   1_737_400.0, vizColor: 0xB0B0B0 },
  mars:      {
    naifId: 499,
    radiusM:   3_396_190.0,
    radiiM: { a: 3_396_190.0, b: 3_396_190.0, c: 3_376_200.0 },
    vizColor: 0xC1440E,
  },
  // Slice 6 renders both Mars moons as spheres using the PCK a-axis radius by
  // deliberate policy; b/c are retained here for future triaxial polish.
  phobos:    {
    naifId: 401,
    radiusM:      13_000.0,
    radiiM: { a: 13_000.0, b: 11_400.0, c: 9_100.0 },
    vizColor: 0x8A7B69,
  },
  deimos:    {
    naifId: 402,
    radiusM:       7_800.0,
    radiiM: { a: 7_800.0, b: 6_000.0, c: 5_100.0 },
    vizColor: 0x9EA3A8,
  },
  jupiter:   {
    naifId: 599,
    radiusM: 71_492_000.0,
    radiiM: { a: 71_492_000.0, b: 71_492_000.0, c: 66_854_000.0 },
    vizColor: 0xC4A878,
  },
  // Io and Europa are mildly triaxial in pck00010, but Slice 3 renders all
  // Galileans as spheres using their a-axis radius by deliberate policy.
  io:        { naifId: 501, radiusM:    1_829_400.0, vizColor: 0xC9A15A },
  europa:    { naifId: 502, radiusM:    1_562_600.0, vizColor: 0xD8D3C5 },
  ganymede:  { naifId: 503, radiusM:    2_631_200.0, vizColor: 0x9A8F7A },
  callisto:  { naifId: 504, radiusM:    2_410_300.0, vizColor: 0x5E5851 },
  saturn:    {
    naifId: 699,
    radiusM: 60_268_000.0,
    radiiM: { a: 60_268_000.0, b: 60_268_000.0, c: 54_364_000.0 },
    vizColor: 0xD8C3A5,
  },
  titan:     { naifId: 606, radiusM:    2_575_150.0, vizColor: 0x9E8562 },
  rhea:      { naifId: 605, radiusM:      765_000.0, vizColor: 0xCFCFD3 },
  iapetus:   { naifId: 608, radiusM:      745_700.0, vizColor: 0xA79884 },
  tethys:    { naifId: 603, radiusM:      538_400.0, vizColor: 0xF0ECE2 },
  dione:     { naifId: 604, radiusM:      563_400.0, vizColor: 0xE8E0D3 },
  mimas:     { naifId: 601, radiusM:      207_800.0, vizColor: 0x9F9B96 },
  enceladus: { naifId: 602, radiusM:      256_600.0, vizColor: 0xF6F6F2 },
};

// INV-008 cutover bars in meters (km values from founding doc × 1000)
export const INV008_BARS_M: Record<
  'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars',
  number
> = {
  sun:      0.02,      // 0.00002 km
  mercury: 100_000,    // 100 km
  venus:    1_000,     // 1 km
  earth:      500,     // 0.5 km
  moon:    20_000,     // 20 km
  mars:        50,     // 0.05 km
};

// INV-010 cutover bars in meters (km values from founding doc × 1000)
export const INV010_BARS_M: Record<
  'saturn' | 'titan' | 'rhea' | 'iapetus' | 'tethys' | 'dione' | 'mimas' | 'enceladus',
  number
> = {
  saturn:      1_000,  // 1 km
  titan:      20_000,  // 20 km
  rhea:        5_000,  // 5 km
  iapetus:     2_000,  // 2 km
  tethys:      1_000,  // 1 km
  dione:      50_000,  // 50 km
  mimas:      20_000,  // 20 km
  enceladus:   5_000,  // 5 km
};

// INV-011 cutover bars in meters (km values from founding doc × 1000)
export const INV011_BARS_M: Record<'phobos' | 'deimos', number> = {
  phobos: 5_000,  // 5 km
  deimos:   500,  // 0.5 km
};

export const SATURN_D_RING_INNER_RADIUS_M = 66_900_000;
export const SATURN_C_RING_INNER_RADIUS_M = 74_491_000;
export const SATURN_A_RING_OUTER_RADIUS_M = 136_770_000;
export const SATURN_CASSINI_DIVISION_INNER_RADIUS_M = 117_500_000;
export const SATURN_CASSINI_DIVISION_OUTER_RADIUS_M = 122_050_000;

// Slice 5 Saturn ring substructure constants per tools/slice5-research/ring-substructure.json.
export const SATURN_HUYGENS_GAP_INNER_RADIUS_M = 117_500_000;
export const SATURN_HUYGENS_GAP_OUTER_RADIUS_M = 117_930_000;
export const SATURN_HUYGENS_RINGLET_INNER_RADIUS_M = 117_806_000;
export const SATURN_HUYGENS_RINGLET_OUTER_RADIUS_M = 117_824_000;
export const SATURN_LAPLACE_GAP_INNER_RADIUS_M = 119_845_000;
export const SATURN_LAPLACE_GAP_OUTER_RADIUS_M = 120_086_000;
export const SATURN_LAPLACE_RINGLET_INNER_RADIUS_M = 120_037_000;
export const SATURN_LAPLACE_RINGLET_OUTER_RADIUS_M = 120_078_000;
export const SATURN_ENCKE_GAP_INNER_RADIUS_M = 133_423_000;
export const SATURN_ENCKE_GAP_OUTER_RADIUS_M = 133_745_000;
export const SATURN_KEELER_GAP_INNER_RADIUS_M = 136_487_000;
export const SATURN_KEELER_GAP_OUTER_RADIUS_M = 136_522_000;
export const SATURN_ROCHE_DIVISION_INNER_RADIUS_M = 136_770_000;
export const SATURN_ROCHE_DIVISION_OUTER_RADIUS_M = 139_380_000;

// Unified interpolation bars across Slice 2 (INV-008), Slice 3 (INV-009),
// Slice 4 (INV-010), and Slice 6 (INV-011).
export const INTERPOLATION_ERROR_BARS_M: Record<BodyId, number> = {
  ...INV008_BARS_M,
  ...INV011_BARS_M,
  jupiter:   50_000,  // 50 km
  io:         5_000,  // 5 km
  europa:    20_000,  // 20 km
  ganymede:  20_000,  // 20 km
  callisto:  50_000,  // 50 km
  ...INV010_BARS_M,
};

export const BODY_CADENCE_SECONDS: Record<BodyId, number> = {
  sun:      86_400,
  mercury:  86_400,
  venus:    86_400,
  earth:    86_400,
  moon:     86_400,
  mars:     86_400,
  phobos:    1_800,
  deimos:    3_600,
  jupiter:  86_400,
  io:        3_600,
  europa:   10_800,
  ganymede: 21_600,
  callisto: 43_200,
  saturn:   86_400,
  titan:    43_200,
  rhea:     10_800,
  iapetus:  86_400,
  tethys:    3_600,
  dione:    10_800,
  mimas:     3_600,
  enceladus: 3_600,
};

export const BODY_INTERPOLATION_INVARIANTS: Record<BodyId, InterpolationInvariantId> = {
  sun: 'INV-008',
  mercury: 'INV-008',
  venus: 'INV-008',
  earth: 'INV-008',
  moon: 'INV-008',
  mars: 'INV-008',
  phobos: 'INV-011',
  deimos: 'INV-011',
  jupiter: 'INV-009',
  io: 'INV-009',
  europa: 'INV-009',
  ganymede: 'INV-009',
  callisto: 'INV-009',
  saturn: 'INV-010',
  titan: 'INV-010',
  rhea: 'INV-010',
  iapetus: 'INV-010',
  tethys: 'INV-010',
  dione: 'INV-010',
  mimas: 'INV-010',
  enceladus: 'INV-010',
};

export const BODY_CLASSES: Record<BodyId, Exclude<BodyClass, 'asteroid'>> = {
  sun: 'star',
  mercury: 'planet',
  venus: 'planet',
  earth: 'planet',
  moon: 'moon',
  mars: 'planet',
  phobos: 'moon',
  deimos: 'moon',
  jupiter: 'planet',
  io: 'moon',
  europa: 'moon',
  ganymede: 'moon',
  callisto: 'moon',
  saturn: 'planet',
  titan: 'moon',
  rhea: 'moon',
  iapetus: 'moon',
  tethys: 'moon',
  dione: 'moon',
  mimas: 'moon',
  enceladus: 'moon',
};

export function getBodyCadence(bodyId: BodyId): number {
  return BODY_CADENCE_SECONDS[bodyId];
}

export function getInterpolationErrorBarM(bodyId: BodyId): number {
  return INTERPOLATION_ERROR_BARS_M[bodyId];
}

export function getInterpolationInvariantId(bodyId: BodyId): InterpolationInvariantId {
  return BODY_INTERPOLATION_INVARIANTS[bodyId];
}

export function getBodyClass(bodyId: BodyId | AsteroidBodyId): BodyClass {
  if (isAsteroidBodyId(bodyId)) {
    return 'asteroid';
  }
  return BODY_CLASSES[bodyId];
}
