// Aster Physics — Global constants
// Heliocentric Ecliptic J2000, positions in AU, velocities in km/s

export const GM_sun = 1.327124400e20; // m³/s²
export const AU = 1.496e11;           // m per AU
export const AU_m = AU;               // alias used by renderer modules
export const J2000 = 2451545.0;       // JD of J2000 epoch
export const TWO_PI = 2 * Math.PI;
export const DEG = Math.PI / 180;
export const GM_AU3_S2 = GM_sun / (AU * AU * AU); // ~3.964e-14 AU³/s²
export const GM_earth  = 3.986004418e14;          // m³/s²
export const R_earth   = 6.3781e6;               // m
export const GM_mars   = 42828.375214;           // km³/s²
export const R_mars    = 3389.5;                 // km
export const GM_moon   = 4902.0;                 // km³/s²
export const R_moon    = 1737.4;                 // km
export const R_cap     = R_moon + 5000;          // km — 5000 km altitude lunar capture orbit
export const AU_KM     = AU / 1000;
export const MOON_A_AU = 384400 / AU_KM;
export const MOON_PERIOD_DAYS = 27.321661;
export const MOON_INCLINATION = 5.145 * DEG;
export const MOON_NODE_J2000 = 125.08 * DEG;
export const MOON_NODE_PERIOD_DAYS = 6798.38;
export const EM_L1_RADIUS_KM = 326000;
export const EM_L2_RADIUS_KM = 444000;

// Standish 1992 planet elements at J2000 + secular rates
// Format: [a0, da, e0, de, i0, di, Om0, dOm, L0, dL, wb0, dwb]
// L = mean longitude (= Om + w + M), wb = longitude of perihelion (= Om + w)
// All angles in degrees; rates per Julian century
export const PLANETS: number[][] = [
  // Mercury
  [0.38709927, 0.00000037, 0.20563593, 0.00001906,
   7.00497902, -0.00594749, 48.33076593, -0.12534081,
   252.25032350, 149472.67411175, 77.45779628, 0.16047689],
  // Venus
  [0.72333566, 0.00000390, 0.00677672, -0.00004107,
   3.39467605, -0.00078890, 76.67984255, -0.27769418,
   181.97909950, 58517.81538729, 131.60246718, 0.00268329],
  // Earth
  [1.00000261, 0.00000562, 0.01671123, -0.00004392,
   -0.00001531, -0.01294668, 0.0, 0.0,
   100.46457166, 35999.37244981, 102.93768193, 0.32327364],
  // Mars
  [1.52371034, 0.00001847, 0.09339410, 0.00007882,
   1.84969142, -0.00813131, 49.55953891, -0.29257343,
   -4.55343205, 19140.30268499, -23.94362959, 0.44441088],
  // Jupiter
  [5.20288700, -0.00011607, 0.04838624, -0.00013253,
   1.30439695, -0.00183714, 100.47390909, 0.20469106,
   34.39644051, 3034.74612775, 14.72847983, 0.21252668],
  // Saturn
  [9.53667594, -0.00125060, 0.05386179, -0.00050991,
   2.48599187, 0.00193609, 113.66242448, -0.28867794,
   49.95424423, 1222.49362201, 92.59887831, -0.41897216],
  // Uranus
  [19.18916464, -0.00196176, 0.04725744, -0.00004397,
   0.77263783, -0.00242939, 74.01692503, 0.04240589,
   313.23810451, 428.48202785, 170.95427630, 0.40805281],
  // Neptune
  [30.06992276, 0.00026291, 0.00859048, 0.00005105,
   1.77004347, 0.00035372, 131.78422574, -0.00508664,
   -55.12002969, 218.45945325, 44.96476227, -0.32241464],
];

export let asteroids: any[] = [];

export const MISSION_GATE_DEP_KMS = 10.0;
export const MISSION_GATE_TOTAL_KMS = 25.0;
export const MISSION_HIGH_DV_KMS = 12.0;
export const NHATS_DEFAULTS = { dv: '12', dur: '450', stay: '8' };
export const DEFAULT_PROXY_BASE = 'https://aster-proxy.hudsonclavin.workers.dev';
export let API_BASE_URL = DEFAULT_PROXY_BASE;
export const DEFAULT_REDIRECT_CAPTURE = { key: 'lunar_orbit', label: 'Lunar Orbit', orbitRadiusKm: 6737, captureExtraDv: 1.7 };
export const DEFAULT_REDIRECT_DELIVERY = { key: 'leo', label: 'Low Earth Orbit (LEO)', captureExtraDv: 0.0, deliveryExtraDv: 0.0, marketMultiplier: 1.0 };
export const DEFAULT_REDIRECT_SPACECRAFT = { name: 'Medium Miner', dry_kg: 5000, payload_kg: 2000, isp: 320, cost_usd: 180e6 };
export const DEFAULT_REDIRECT_LAUNCH = { name: 'Falcon 9', cost_per_kg: 2700, max_kg: 22800, label: 'Falcon 9' };

export function setApiBaseUrl(url: string): void {
  API_BASE_URL = url;
}

export function setAsteroids(arr: any[]): void {
  asteroids = arr;
}
