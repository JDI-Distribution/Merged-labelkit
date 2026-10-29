export function orderedUnits(item = {}) {
  return Number(item.quantity_ordered_eaches ?? item.quantity_ordered);
}

export function unitNetLbs(item = {}) {
  if (/^LBS?$|^POUNDS?$/i.test(String(item.quantity_uom || '').trim())) return 1;
  const match = `${item.sku || ''} ${item.description || ''}`.match(/(\d+(?:\.\d+)?)\s*LBS?\b/i);
  if (match) return Number(match[1]);
  const grams = Number(item.product?.each_net_weight_g);
  return grams > 0 ? grams / 453.59237 : null;
}

export function boxGroups({ totalUnits, unitLbs, mode, value }) {
  if (!(Number.isFinite(totalUnits) && totalUnits > 0 && Number.isFinite(value) && value > 0)) {
    throw new Error('Enter a positive packing quantity.');
  }
  let groups;
  if (mode === 'boxes') {
    if (!Number.isInteger(value) || value > Math.ceil(totalUnits)) throw new Error('Total boxes must be a whole number no greater than the ordered units.');
    if (Number.isInteger(totalUnits)) {
      const small = Math.floor(totalUnits / value), largeCount = totalUnits % value;
      groups = [{ count: largeCount, units: small + 1 }, { count: value - largeCount, units: small }];
    } else {
      groups = [{ count: value, units: totalUnits / value }];
    }
  } else {
    if (mode === 'lbs' && !(Number.isFinite(unitLbs) && unitLbs > 0)) throw new Error('Enter pounds per ordered unit before packing by weight.');
    const units = mode === 'lbs' ? value / unitLbs : value;
    const full = Math.floor(totalUnits / units + 1e-9);
    const remainder = totalUnits - full * units;
    groups = [{ count: full, units }, { count: remainder > 1e-7 ? 1 : 0, units: remainder }];
  }
  return groups.filter(group => group.count > 0).map((group, index) => ({
    ...group, key: String(index), netLbs: unitLbs > 0 ? group.units * unitLbs : null,
  }));
}

window.LabelKitOrderPackingModel = Object.freeze({ orderedUnits, unitNetLbs, boxGroups });
