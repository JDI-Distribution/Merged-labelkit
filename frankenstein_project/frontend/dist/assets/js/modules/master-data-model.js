const PACKAGING_LEVELS = Object.freeze(['Each', 'Inner Pack', 'Case', 'Master Case', 'Pallet', 'Shipper Contents', 'Other']);
const VERIFICATION_STATUSES = Object.freeze(['DRAFT', 'NEEDS_REVIEW', 'VERIFIED', 'BLOCKED']);
const DIRECTORY_RECORD_TYPES = Object.freeze(['CUSTOMER_DEFAULT', 'DESTINATION', 'DISTRIBUTION_CENTER', 'SHIP_FROM', 'SHIP_TO', 'BILL_TO']);
const DIRECTORY_ROLES = Object.freeze(['SHIP_FROM', 'SHIP_TO', 'BILL_TO']);

export function normalizePackagingLevel(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const compact = raw.replace(/\s+/g, '');
  if (['master case', 'master carton'].includes(raw) || ['mastercase', 'mastercarton'].includes(compact)) return 'Master Case';
  if (['pallet', 'plt'].includes(raw)) return 'Pallet';
  if (['case', 'cases', 'master pack', 'master packs', 'mp'].includes(raw) || compact === 'casepack') return 'Case';
  if (['inner pack', 'inner packs', 'inner', 'ip'].includes(raw) || ['innerpack', 'innerpacks'].includes(compact)) return 'Inner Pack';
  if (['each', 'ea'].includes(raw)) return 'Each';
  if (['shipper contents', 'shipper content', 'shipper'].includes(raw) || compact === 'shippercontents') return 'Shipper Contents';
  return 'Other';
}

export function parseBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return defaultValue;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'y', 'on', 'checked', '✅', 'x'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'unchecked', 'barcode on product'].includes(raw)) return false;
  if (raw.includes('barcode') && raw.includes('product')) return false;
  return defaultValue;
}

export function normalizeStorefront(value) {
  return String(value ?? '').trim() || 'KeHE';
}

export function normalizeVerificationStatus(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (['APPROVED', 'READY'].includes(raw)) return 'VERIFIED';
  if (VERIFICATION_STATUSES.includes(raw)) return raw;
  return raw ? 'NEEDS_REVIEW' : 'DRAFT';
}

export function normalizeDirectoryRecordType(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  return DIRECTORY_RECORD_TYPES.includes(raw) ? raw : 'DESTINATION';
}

export function positiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function numberString(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)));
}

export function parseDimensions(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const cleaned = raw
    .replace(/¼/g, '.25').replace(/½/g, '.5').replace(/¾/g, '.75')
    .replace(/⅛/g, '.125').replace(/⅜/g, '.375').replace(/⅝/g, '.625').replace(/⅞/g, '.875')
    .replace(/×/g, 'x').replace(/\((l|w|b|h)\)/g, '');
  const values = cleaned.match(/-?\d+(?:\.\d+)?/g) || [];
  if (values.length < 3) return null;
  const [length, width, height] = values.map(positiveNumber);
  return length && width && height ? { length, width, height } : null;
}

function defaultCaseQuantity(level) {
  return normalizePackagingLevel(level) === 'Each' ? '1' : '';
}

function normalizeQuantity(value, level) {
  const raw = String(value ?? '').trim();
  if (!raw) return defaultCaseQuantity(level);
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : defaultCaseQuantity(level);
}

function normalizeCopies(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : '';
}

export function normalizeProduct(row = {}) {
  const level = normalizePackagingLevel(row.packaging_level ?? row.packging_level ?? row['PACKGING LEVEL'] ?? row['PACKAGING LEVEL']);
  const legacyDimensions = String(row.dimensions_in ?? row['L X W X H (in)'] ?? row.lwh_in ?? '').trim();
  const parsedDimensions = parseDimensions(legacyDimensions);
  const length = positiveNumber(row.length_in ?? row.LENGTH_IN ?? row.length) ?? parsedDimensions?.length ?? null;
  const width = positiveNumber(row.width_in ?? row.WIDTH_IN ?? row.breadth_in ?? row.BREADTH_IN ?? row.breadth) ?? parsedDimensions?.width ?? null;
  const height = positiveNumber(row.height_in ?? row.HEIGHT_IN ?? row.height) ?? parsedDimensions?.height ?? null;
  const activeValue = row.is_active ?? row.IS_ACTIVE;
  const labelValue = row.label_enabled ?? row.LABEL_ENABLED;
  return {
    storefront: normalizeStorefront(row.storefront ?? row.STOREFRONT ?? row.Storefront),
    in_packing_list: level === 'Case' && parseBoolean(activeValue, true),
    gtin: String(row.gtin ?? row.GTIN ?? row.case_upc ?? row.upc ?? '').trim(),
    description: String(row.description ?? row.DESCRIPTION ?? '').trim(),
    packaging_level: level,
    dimensions_display: length && width && height
      ? `${numberString(length)} x ${numberString(width)} x ${numberString(height)}`
      : legacyDimensions,
    length_in: numberString(length),
    width_in: numberString(width),
    height_in: numberString(height),
    each_net_weight_g: numberString(positiveNumber(row.each_net_weight_g ?? row.EACH_NET_WEIGHT_G)),
    package_net_weight_g: numberString(positiveNumber(row.package_net_weight_g ?? row.PACKAGE_NET_WEIGHT_G)),
    gross_weight_lbs: numberString(positiveNumber(row.gross_weight_lbs ?? row.GROSS_WEIGHT_LBS) ?? positiveNumber(row.weight_lbs ?? row.WEIGHT_LBS)),
    case_qty: normalizeQuantity(
      row.case_qty ?? row['Case Qty'] ?? row['Eaches / Package'] ?? row.eaches_per_package
        ?? row.eaches_per_case ?? row.eaches_per_inner_pack ?? row.case_quantity ?? row.units_per_case,
      level,
    ),
    sku: String(row.sku ?? row.SKU ?? row.item_number ?? '').trim(),
    display_sku: String(row.display_sku ?? row.DISPLAY_SKU ?? row.display_item_number ?? '').trim(),
    display_sku_uom: ['Each', 'Inner Pack', 'Case'].includes(normalizePackagingLevel(row.display_sku_uom ?? row.DISPLAY_SKU_UOM ?? row.display_sku_represents ?? 'Each'))
      ? normalizePackagingLevel(row.display_sku_uom ?? row.DISPLAY_SKU_UOM ?? row.display_sku_represents ?? 'Each')
      : 'Each',
    inner_packs_per_case: numberString(positiveNumber(row.inner_packs_per_case ?? row.INNER_PACKS_PER_CASE ?? row.inners_per_case)),
    config_id: String(row.config_id ?? row.CONFIG_ID ?? '').trim(),
    customer_item_number: String(row.customer_item_number ?? row.CUSTOMER_ITEM_NUMBER ?? '').trim(),
    label_template_id: String(row.label_template_id ?? row.LABEL_TEMPLATE_ID ?? '').trim(),
    barcode_type: String(row.barcode_type ?? row.BARCODE_TYPE ?? '').trim(),
    default_copies: normalizeCopies(row.default_copies ?? row.DEFAULT_COPIES ?? row.labels_per_unit ?? row['Labels / Unit']),
    verification_status: normalizeVerificationStatus(row.verification_status ?? row.VERIFICATION_STATUS),
    label_enabled: labelValue === undefined ? false : parseBoolean(labelValue, false),
    is_active: activeValue === undefined ? true : parseBoolean(activeValue, true),
  };
}

export function parseMatchValues(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
  } catch (_error) {}
  return raw.split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
}

export function normalizeDirectoryRoles(value, fallback = '') {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,;|]+/);
  const selected = new Set(values.map(item => String(item || '').trim().toUpperCase().replace(/\s+/g, '_')));
  const fallbackType = normalizeDirectoryRecordType(fallback);
  if (!DIRECTORY_ROLES.some(role => selected.has(role)) && DIRECTORY_ROLES.includes(fallbackType)) selected.add(fallbackType);
  return DIRECTORY_ROLES.filter(role => selected.has(role));
}

export function directoryHasRole(row, role) {
  const roles = normalizeDirectoryRoles(
    row?.address_roles ?? row?.ADDRESS_ROLES ?? row?.record_type ?? row?.RECORD_TYPE,
    row?.address_type ?? row?.ADDRESS_TYPE,
  );
  return roles.includes(String(role || '').trim().toUpperCase());
}

export function directoryRoleLabel(roles = []) {
  const labels = { SHIP_FROM: 'Ship From', SHIP_TO: 'Ship To', BILL_TO: 'Bill To' };
  return normalizeDirectoryRoles(roles).map(role => labels[role]).filter(Boolean).join(' + ') || 'Address';
}

export function deriveMatchValues(row = {}) {
  const values = [];
  const seen = new Set();
  const add = value => {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key) || ['usa', 'us', 'united states', 'canada'].includes(key)) return;
    seen.add(key);
    values.push(text);
  };
  parseMatchValues(row.match_values ?? row.MATCH_VALUES ?? []).forEach(add);
  add(row.dc ?? row.DC);
  add(row.name ?? row.NAME);
  const address = String(row.address ?? row.ADDRESS ?? '').trim();
  if (address) {
    add(address);
    address.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(line => {
      add(line);
      const city = line.split(',')[0]?.trim();
      if (city && city.length > 2 && !/^\d/.test(city)) add(city);
    });
    (address.match(/\b\d{5}(?:-\d{4})?\b|\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/gi) || []).forEach(add);
    (address.match(/\b\d{8,14}\b/g) || []).forEach(add);
  }
  return values;
}

export function normalizeDirectory(row = {}, { defaultShipFrom = '' } = {}) {
  const rawType = row.record_type ?? row.RECORD_TYPE ?? row.address_type ?? row.ADDRESS_TYPE;
  const legacyType = normalizeDirectoryRecordType(rawType);
  const roles = normalizeDirectoryRoles(row.address_roles ?? row.ADDRESS_ROLES ?? rawType, legacyType);
  const recordType = roles.length ? roles.join(',') : legacyType;
  let shipFrom = String(row.ship_from ?? row.SHIP_FROM ?? row['SHIP FROM'] ?? '').trim();
  let deliveryAddress = String(row.delivery_address ?? row.DELIVERY_ADDRESS ?? '').trim();
  let billingAddress = String(row.billing_address ?? row.BILLING_ADDRESS ?? '').trim();
  let address = String(row.address ?? row.ADDRESS ?? '').trim();
  if (!address) {
    if (roles.includes('SHIP_FROM')) address = shipFrom;
    else if (roles.includes('BILL_TO')) address = billingAddress;
    else address = deliveryAddress;
  }
  if (roles.length) {
    shipFrom = roles.includes('SHIP_FROM') ? address : '';
    deliveryAddress = roles.includes('SHIP_TO') ? address : '';
    billingAddress = roles.includes('BILL_TO') ? address : '';
  } else {
    shipFrom ||= defaultShipFrom;
  }
  const dc = String(row.dc ?? row.DC ?? '').trim();
  const name = String(row.name ?? row.NAME ?? '').trim();
  return {
    storefront: normalizeStorefront(row.storefront ?? row.STOREFRONT ?? row.Storefront),
    dc,
    name,
    ship_from: shipFrom,
    delivery_address: deliveryAddress,
    billing_address: billingAddress,
    address_type: roles[0] || legacyType,
    address_roles: roles,
    address,
    match_values: deriveMatchValues({ ...row, dc, name, address }),
    record_type: recordType,
    default_label_template_id: String(row.default_label_template_id ?? row.DEFAULT_LABEL_TEMPLATE_ID ?? '').trim(),
    verification_status: normalizeVerificationStatus(row.verification_status ?? row.VERIFICATION_STATUS),
    is_active: parseBoolean(row.is_active ?? row.IS_ACTIVE, true),
  };
}

export const masterDataModel = Object.freeze({
  PACKAGING_LEVELS,
  DIRECTORY_ROLES,
  normalizePackagingLevel,
  parseBoolean,
  normalizeStorefront,
  normalizeVerificationStatus,
  normalizeDirectoryRecordType,
  positiveNumber,
  numberString,
  parseDimensions,
  normalizeProduct,
  parseMatchValues,
  normalizeDirectoryRoles,
  directoryHasRole,
  directoryRoleLabel,
  deriveMatchValues,
  normalizeDirectory,
});

globalThis.LabelKitMasterData = masterDataModel;
