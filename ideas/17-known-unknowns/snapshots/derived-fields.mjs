export function eccentricityBandForBody(eccentricity) {
  if (eccentricity < 0.1) return 'A';
  if (eccentricity < 0.2) return 'B';
  if (eccentricity < 0.3) return 'C';
  return 'D';
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function qualityRankForRecord(record) {
  const conditionScore =
    record.conditionCode === null ? 0 : clamp01(1 - record.conditionCode / 9);
  const dataArcScore =
    record.dataArcDays === null
      ? 0
      : clamp01(Math.log10(1 + record.dataArcDays) / Math.log10(1001));
  return round6(0.6 * conditionScore + 0.4 * dataArcScore);
}

function deriveAsteroidDiameterKmFromAbsoluteMagnitude(absoluteMagnitude, albedo = 0.14) {
  return (1329 / Math.sqrt(albedo)) * 10 ** (-absoluteMagnitude / 5);
}

export function deriveAsteroidRadiusMFromAbsoluteMagnitude(absoluteMagnitude, albedo = 0.14) {
  return deriveAsteroidDiameterKmFromAbsoluteMagnitude(absoluteMagnitude, albedo) * 500;
}

export function recomputeDerivedFields(record) {
  record.eccentricityBand = eccentricityBandForBody(record.elements.e);
  record.qualityRank = qualityRankForRecord(record);
  record.estimatedRadiusM =
    record.H === null ? null : deriveAsteroidRadiusMFromAbsoluteMagnitude(record.H);
  return record;
}
