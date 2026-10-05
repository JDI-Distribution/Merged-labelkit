export const PALLET_DEFAULTS = Object.freeze({
  max_length_in: 48,
  max_width_in: 40,
  max_height_in: 70,
  max_gross_lbs: 2000,
});

export const PALLET_TARE_LBS = 50;
export const PALLET_BUFFER_FACTOR = 1.05;

export const SKU_COLORS = Object.freeze([
  '#d99a4b', '#7db3ff', '#8fd19e', '#f5a3a3',
  '#b7a0ff', '#7fd8d0', '#f2cf63', '#f0b27a',
  '#6cc4a1', '#b6d36f', '#f28bb3', '#86a9f4',
  '#c89ee8', '#70c7e8', '#e2b66f', '#9fc0a0',
]);

export function defaultConstraints() {
  return { ...PALLET_DEFAULTS };
}

export function normalizeConstraints(raw = {}) {
  const readPositive = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  return {
    max_length_in: readPositive(raw.max_length_in, PALLET_DEFAULTS.max_length_in),
    max_width_in: readPositive(raw.max_width_in, PALLET_DEFAULTS.max_width_in),
    max_height_in: readPositive(raw.max_height_in, PALLET_DEFAULTS.max_height_in),
    max_gross_lbs: readPositive(raw.max_gross_lbs, PALLET_DEFAULTS.max_gross_lbs),
  };
}

export function bestOrientation(dimensions, constraints = PALLET_DEFAULTS) {
  if (!dimensions) return null;
  const seen = new Set();
  const candidates = [
    [dimensions.l, dimensions.w],
    [dimensions.w, dimensions.l],
  ].map(([caseLength, caseWidth]) => {
    const key = `${caseLength}x${caseWidth}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const columns = Math.floor(constraints.max_length_in / caseLength);
    const rows = Math.floor(constraints.max_width_in / caseWidth);
    const ti = columns * rows;
    if (ti < 1) return null;
    const fillRatio = (columns * caseLength * rows * caseWidth)
      / (constraints.max_length_in * constraints.max_width_in);
    return { caseLength, caseWidth, caseHeight: dimensions.h, columns, rows, ti, fillRatio };
  }).filter(Boolean);
  return candidates.sort((left, right) =>
    (right.ti - left.ti) || (right.fillRatio - left.fillRatio) || (left.caseWidth - right.caseWidth)
  )[0] || null;
}

export function colorForIndex(index) {
  return SKU_COLORS[index % SKU_COLORS.length];
}

export function colorToRgb(color) {
  const raw = String(color || '').trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) return [0.85, 0.60, 0.29];
  return [0, 2, 4].map(offset => parseInt(raw.slice(offset, offset + 2), 16) / 255);
}

export function intersectionArea(left, right) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.length, right.x + right.length);
  const y2 = Math.min(left.y + left.width, right.y + right.width);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

export function topZ(placement) {
  return Number(placement.z || 0) + Number(placement.height ?? placement.case_height ?? 0);
}

export const packingModel = Object.freeze({
  PALLET_DEFAULTS,
  PALLET_TARE_LBS,
  PALLET_BUFFER_FACTOR,
  SKU_COLORS,
  defaultConstraints,
  normalizeConstraints,
  bestOrientation,
  colorForIndex,
  colorToRgb,
  intersectionArea,
  topZ,
});

globalThis.LabelKitPackingModel = packingModel;
