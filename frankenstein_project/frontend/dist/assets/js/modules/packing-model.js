const PALLET_DEFAULTS = {};
export function configurePalletDefaults(defaults) {
  if (!defaults || !Number(defaults.max_length_in)) throw new Error('Pallet defaults could not be loaded from the server.');
  Object.assign(PALLET_DEFAULTS, defaults);
}

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
    cases_per_layer: Math.floor(readPositive(raw.cases_per_layer, 0)),
    max_layers: Math.floor(readPositive(raw.max_layers, 0)),
    pallet_base_height_in: readPositive(raw.pallet_base_height_in, PALLET_DEFAULTS.pallet_base_height_in),
  };
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
  SKU_COLORS,
  defaultConstraints,
  normalizeConstraints,
  configurePalletDefaults,
  colorForIndex,
  colorToRgb,
  intersectionArea,
  topZ,
});

globalThis.LabelKitPackingModel = packingModel;
