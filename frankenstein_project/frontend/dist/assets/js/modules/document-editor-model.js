const PARTNER_COLUMNS = Object.freeze([
  ['location_on_pallet', 'Pallet #', 0.075],
  ['invoice_po_number', 'Invoice / PO #', 0.105],
  ['item_number', 'Item #', 0.085],
  ['lot', 'Lot #', 0.075],
  ['color', 'Color', 0.075],
  ['description', 'Description', 0.180],
  ['product_size', 'Product Size', 0.090],
  ['quantity_per_case', 'Quantity Per Case', 0.090],
  ['qty_on_pallet', '# of Cases', 0.075],
  ['units_on_pallet', 'Units on This Pallet', 0.095],
  ['balance_owed', 'Balance Owed', 0.055],
]);

const STANDARD_COLUMNS = Object.freeze([
  ['item_number', 'Item Number', 0.17],
  ['description', 'Pallet Weight & Item Description', 0.39],
  ['uom', 'UOM', 0.10],
  ['qty_on_pallet', 'Qty On Pallet', 0.11],
  ['total_ordered', 'Total Ordered', 0.11],
  ['total_shipped', 'Total Shipped', 0.12],
]);

export function normalizePalletId(value) {
  return String(value ?? '').trim();
}

export function shouldDefaultToPalletOne(mpl) {
  if (!mpl || mpl.manual_mpl) return false;
  const source = String(mpl.palletization_source || '').trim().toLowerCase();
  const note = String(mpl.palletization_note || '').trim().toLowerCase();
  return source === 'unassigned' || note.includes('no item-to-pallet assignment found in xml');
}

export function ensurePalletState(mpl) {
  if (!mpl) return mpl;
  mpl.items = Array.isArray(mpl.items) ? mpl.items : [];
  mpl.items.forEach((item, index) => {
    item.line = item.line || index + 1;
    item.location_on_pallet = normalizePalletId(item.location_on_pallet);
  });
  const assignedIds = [];
  mpl.items.forEach(item => {
    const id = normalizePalletId(item.location_on_pallet);
    if (id && !assignedIds.includes(id)) assignedIds.push(id);
  });
  if (!assignedIds.length && mpl.items.length && shouldDefaultToPalletOne(mpl)) {
    mpl.items.forEach(item => {
      item.location_on_pallet = '1';
      if (!String(item.pallet_weight || '').trim() && mpl._pallet_weights?.['1']) item.pallet_weight = mpl._pallet_weights['1'];
    });
    assignedIds.push('1');
    mpl.palletization_source = 'XML';
    mpl.palletization_note = 'XML did not include item-to-pallet assignment, so all line items were placed on Pallet 1 by default.';
  }
  if (!Array.isArray(mpl._pallet_ids)) mpl._pallet_ids = assignedIds.length ? [...assignedIds] : ['1'];
  mpl._pallet_ids = mpl._pallet_ids.map(normalizePalletId).filter(Boolean)
    .filter((id, index, values) => values.indexOf(id) === index);
  assignedIds.forEach(id => {
    if (!mpl._pallet_ids.includes(id)) mpl._pallet_ids.push(id);
  });
  if (!mpl._pallet_weights || typeof mpl._pallet_weights !== 'object') mpl._pallet_weights = {};
  if (!mpl._pallet_dimensions || typeof mpl._pallet_dimensions !== 'object') mpl._pallet_dimensions = {};
  if (!mpl._pallet_tihi || typeof mpl._pallet_tihi !== 'object') mpl._pallet_tihi = {};
  mpl._pallet_ids.forEach(id => {
    const weightedItem = mpl.items.find(item => normalizePalletId(item.location_on_pallet) === id && String(item.pallet_weight || '').trim());
    if (weightedItem && !mpl._pallet_weights[id]) mpl._pallet_weights[id] = weightedItem.pallet_weight;
    if (!Object.hasOwn(mpl._pallet_dimensions, id)) mpl._pallet_dimensions[id] = '48 x 40 in';
    if (!Object.hasOwn(mpl._pallet_tihi, id)) mpl._pallet_tihi[id] = '';
  });
  mpl.total_pallets = String(mpl._pallet_ids.length || assignedIds.length || 1);
  return mpl;
}

export function itemUnits(item) {
  if (String(item?.units_on_pallet || '').trim()) return item.units_on_pallet;
  const cases = Number(item?.qty_on_pallet ?? item?.total_shipped);
  const unitsPerCase = Number(item?.quantity_per_case);
  return Number.isFinite(cases) && Number.isFinite(unitsPerCase) ? String(cases * unitsPerCase) : '';
}

export function defaultColumns(templateId) {
  return ['decopac', 'dutch_bros', 'fancy'].includes(String(templateId || '')) ? PARTNER_COLUMNS : STANDARD_COLUMNS;
}

export function ensureColumns(mpl, templateId) {
  const saved = Array.isArray(mpl?.column_config) ? mpl.column_config : [];
  const savedByKey = new Map(saved.filter(column => column?.key).map(column => [String(column.key), column]));
  const defaults = defaultColumns(templateId).map(([key, label, width]) => ({
    key,
    label: String(savedByKey.get(key)?.label || label),
    width,
    visible: savedByKey.get(key)?.visible !== false,
    custom: false,
  }));
  const custom = saved.filter(column => column?.custom && column?.key).map(column => ({
    key: String(column.key),
    label: String(column.label || 'Custom Column'),
    width: Number(column.width) || 0.09,
    visible: column.visible !== false,
    custom: true,
  }));
  const byKey = new Map([...defaults, ...custom].map(column => [column.key, column]));
  const orderedKeys = [...new Set([
    ...saved.map(column => String(column?.key || '')).filter(key => byKey.has(key)),
    ...defaults.map(column => column.key),
    ...custom.map(column => column.key),
  ])];
  mpl.column_config = orderedKeys.map(key => byKey.get(key)).filter(Boolean);
  return mpl.column_config;
}

export function columnValue(item, mpl, column) {
  if (column.key === 'units_on_pallet') return itemUnits(item);
  if (column.key === 'invoice_po_number') return item.invoice_po_number || mpl.customer_po_number || '';
  if (column.key === 'item_number') return item.item_number || item.sku || '';
  if (column.key === 'qty_on_pallet') return item.qty_on_pallet || item.total_shipped || '';
  return item[column.key] || '';
}

export function collectPalletIds(mpl) {
  ensurePalletState(mpl);
  const ids = [];
  [...(mpl.items || []).map(item => item.location_on_pallet), ...(mpl._pallet_ids || [])].forEach(value => {
    const id = normalizePalletId(value);
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids.sort((left, right) => Number(left) - Number(right));
}

export function poNumbersForPallet(mpl, palletId) {
  const values = [];
  (mpl.items || []).forEach(item => {
    if (normalizePalletId(item.location_on_pallet) !== palletId) return;
    const raw = item.customer_po_number || item.po || mpl.customer_po_number || '';
    String(raw).split(/[;,\n]/).map(value => value.trim()).filter(Boolean).forEach(value => {
      if (!values.includes(value)) values.push(value);
    });
  });
  if (!values.length && mpl.customer_po_number) values.push(mpl.customer_po_number);
  return values.join('\n');
}

export function buildPalletLabelDraft(mplDraft, sourceLabel = 'MPL') {
  const pallets = [];
  const warnings = [];
  const lists = mplDraft?.packing_lists || [];
  lists.forEach((mpl, mplIndex) => {
    const ids = collectPalletIds(mpl);
    const total = String(ids.length || 1);
    ids.forEach(id => pallets.push({
      id: `PALLET-${pallets.length + 1}`,
      status: mpl.status || 'Ready',
      dc: mpl.dc || '',
      title: 'PALLET PLACARD',
      date: mpl.est_ship_date || '',
      ship_from: mpl.supplier_info || '',
      ship_to: mpl.ship_to || '',
      billing: mpl.bill_to || '',
      customer_po_numbers: poNumbersForPallet(mpl, id),
      bol_number: mpl.bol_number || '',
      pro_number: mpl.pro_number || '',
      carrier: mpl.ship_via || '',
      pallet_number: id,
      total_pallets: total,
      carton_count: '',
      placement_note: 'Place one placard on the front and one placard on the back of the pallet.',
      copies: 2,
      source_files: mpl.source_files || [],
      source_mpl: mpl.id || `MPL-${mplIndex + 1}`,
      warnings: [],
    }));
  });
  if (!pallets.length) warnings.push('No MPL palletization found. Use Auto Palletize or generate MPL first.');
  return {
    document_type: 'kehe_pallet_label',
    version: 3,
    summary: { groups: pallets.length, from_mpl: true },
    warnings,
    palletization_source: sourceLabel,
    source_note: pallets.length
      ? `Using palletization from Master Packing List preview. Source: ${sourceLabel}.`
      : 'No MPL palletization found. Use Auto Palletize or generate MPL first.',
    pallets,
  };
}

export const documentEditorModel = Object.freeze({
  normalizePalletId,
  shouldDefaultToPalletOne,
  ensurePalletState,
  itemUnits,
  defaultColumns,
  ensureColumns,
  columnValue,
  collectPalletIds,
  poNumbersForPallet,
  buildPalletLabelDraft,
});

globalThis.LabelKitDocumentEditor = documentEditorModel;
