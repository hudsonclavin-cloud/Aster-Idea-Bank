import { J2000 } from '../constants/index.js';

export function normalizeDesignation(raw: any): string {
  return String(raw || '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function parseFiniteOrNull(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parsePositiveOrNull(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseEpochJD(value: any): number | null {
  if (value === '' || value === null || value === undefined) return J2000;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return J2000;
  return n > 2400000 ? n : null;
}

export function getNhatsMetricValue(value: any, key: string): number | null {
  if (value && typeof value === 'object') {
    const nested = parsePositiveOrNull(value[key]);
    if (nested !== null) return nested;
    for (const candidate of Object.values(value)) {
      const parsed = parsePositiveOrNull(candidate);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  return parseFiniteOrNull(value);
}

export function normalizeNhatsRow(row: any): any {
  if (!row) return null;
  const isArr = Array.isArray(row);
  const des = normalizeDesignation(isArr ? row[0] : (row.des ?? row.pdes));
  const fullname = normalizeDesignation(isArr ? row[1] : (row.fullname ?? row.full_name));
  const minDv = getNhatsMetricValue(isArr ? row[4] : (row.min_dv ?? row.minDv), 'dv');
  const minDur = getNhatsMetricValue(isArr ? row[5] : (row.min_dur ?? row.minDur), 'dur');
  const stayTime = getNhatsMetricValue(isArr ? row[7] : (row.min_stay ?? row.stayTime), 'dur');
  const nTrajectories = parseFiniteOrNull(isArr ? row[6] : (row.n_via_traj ?? row.n_via_points ?? row.nTrajectories));
  const occRaw = isArr ? row[9] : (row.occ ?? row.obs_flag);
  return {
    des,
    fullname,
    minDv,
    minDur,
    stayTime,
    nTrajectories: nTrajectories === null ? null : Math.max(0, Math.round(nTrajectories)),
    occ: occRaw === null || occRaw === undefined || occRaw === '' ? null : occRaw,
  };
}

export function resolveDiameterKm(row: any): { value: number | null; source: string } {
  const direct = parsePositiveOrNull(row.diameter);
  if (direct !== null) return { value: direct, source: 'catalog' };
  const hVal = parsePositiveOrNull(row.H);
  if (hVal === null) return { value: null, source: 'unknown' };
  const albedo = parsePositiveOrNull(row.albedo) || 0.15;
  return {
    value: (1329 / Math.sqrt(albedo)) * Math.pow(10, -hVal / 5),
    source: 'estimated',
  };
}

export function resolveWholeBodyCatalogValueUsd(row: any): number | null {
  return parsePositiveOrNull(row.price);
}

export function estimateExtractableValueUsd({ spec, diameterKm }: { spec: any; diameterKm: any }): number | null {
  const d = parsePositiveOrNull(diameterKm);
  if (d === null) return null;
  const dM = d * 1000;
  const volume = (4 / 3) * Math.PI * Math.pow(dM / 2, 3);
  const s = String(spec || '').trim().charAt(0).toUpperCase();
  const density = (s === 'M' || s === 'E') ? 5000 : (s === 'S' || s === 'Q') ? 2700 : 1700;
  const valuePerKg = (s === 'M' || s === 'E') ? 100 : (s === 'S' || s === 'Q') ? 10 : 50;
  const wholeBodyValue = volume * density * valuePerKg;
  const extractableValue = wholeBodyValue * 0.05;
  return Number.isFinite(extractableValue) && extractableValue > 0 ? extractableValue : null;
}

export function normalizeAsterankRow(row: any): any {
  const a = parsePositiveOrNull(row.a);
  const e = parseFiniteOrNull(row.e);
  const epoch = parseEpochJD(row.epoch);
  if (a === null || e === null || e < 0 || e >= 1 || epoch === null) return null;
  const diameterInfo = resolveDiameterKm(row);
  const specRaw = String(row.spec || row.spec_T || '').trim();
  const rawPrice = resolveWholeBodyCatalogValueUsd(row);
  const rawProfit = parsePositiveOrNull(row.profit);
  const rawDv = parsePositiveOrNull(row.delta_v ?? row.dv);
  const extractableValue = estimateExtractableValueUsd({ spec: specRaw, diameterKm: diameterInfo.value });
  let astClass = String(row.class || '').trim();
  if (!astClass) {
    const q = a * (1 - e);
    const Q = a * (1 + e);
    if (Q < 0.983) astClass = 'IEO';
    else if (a < 1.0) astClass = 'ATE';
    else if (q < 1.017) astClass = 'APO';
    else astClass = 'AMO';
  }
  const moid = parseFiniteOrNull(row.moid);
  const conditionCode = parseFiniteOrNull(row.condition_code);
  return {
    a,
    e,
    i: parseFiniteOrNull(row.i) || 0,
    om: parseFiniteOrNull(row.om) || 0,
    w: parseFiniteOrNull(row.w) || 0,
    ma: parseFiniteOrNull(row.ma) || 0,
    epoch,
    per: parsePositiveOrNull(row.per) || Math.sqrt(a * a * a),
    pdes: String(row.pdes || row.full_name || '').trim(),
    full_name: String(row.full_name || row.name || row.pdes || '').trim(),
    name: String(row.name || '').trim(),
    class: astClass,
    pha: row.pha || 'N',
    H: parsePositiveOrNull(row.H),
    diameter: diameterInfo.value,
    diameter_source: diameterInfo.source,
    albedo: parsePositiveOrNull(row.albedo),
    spec: specRaw || '?',
    spec_T: String(row.spec_T || specRaw || '').trim(),
    price: rawPrice,
    profit: rawProfit,
    value_extractable_est: extractableValue,
    value_extractable_source: extractableValue !== null ? 'heuristic' : 'unknown',
    economics_source: rawPrice !== null || rawProfit !== null ? 'asterank' : (extractableValue !== null ? 'heuristic' : 'unknown'),
    moid,
    delta_v: rawDv,
    last_obs: row.last_obs || null,
    condition_code: conditionCode === null ? null : conditionCode,
    data_source: row.data_source || 'asterank',
  };
}
