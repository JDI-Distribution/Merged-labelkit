/* Product Master and Customer Directory workspace logic. */
  function toggleKeheProductMasterPanel(isVisible) {
    const actions = document.getElementById('kehe-reference-actions');
    if (!actions) return;
    actions.classList.toggle('visible', !!isVisible);
  }

  function showKeheProductMasterView() {
    renderKeheProductMasterTable();
    document.getElementById('kehe-product-master-modal').classList.add('visible');
  }

  function openKeheProductMasterModal() {
    navigateToRoute('kehe/product-master');
  }

  function hideKeheProductMasterView() {
    document.getElementById('kehe-product-master-modal').classList.remove('visible');
  }

  function closeKeheProductMasterModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView('kehe');
    } else {
      hideKeheProductMasterView();
    }
  }

  function loadKeheProductMasterFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(KEHE_PRODUCT_MASTER_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeProductRow);
    } catch (_err) {
      return [];
    }
  }

  function saveKeheProductMasterToStorage() {
    if (!allowBrowserLocalCache()) return;
    try {
      localStorage.setItem(
        KEHE_PRODUCT_MASTER_STORAGE_KEY,
        JSON.stringify(getKeheProductMasterRows())
      );
    } catch (_err) {}
  }


  async function loadKeheProductMasterFromBackend() {
    try {
      const res = await fetchWithTimeout('/api/kehe/product-master', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load product master.');
      if (Array.isArray(payload.rows)) {
        keheProductMasterRows = payload.rows.map(normalizeProductRow);
        saveKeheProductMasterToStorage();
        renderKeheProductMasterTable();
      }
      return payload;
    } catch (_err) {
      keheProductMasterRows = allowLocalFallback() ? loadKeheProductMasterFromStorage() : [];
      renderKeheProductMasterTable();
      return { rows: keheProductMasterRows, source: allowLocalFallback() ? 'localStorage' : 'unavailable' };
    }
  }

  function normalizePackagingLevel(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const compact = raw.replace(/\s+/g, '');
    if (raw === 'master case' || raw === 'master carton' || compact === 'mastercase' || compact === 'mastercarton') return 'Master Case';
    if (raw === 'pallet' || raw === 'plt') return 'Pallet';
    if (raw === 'case' || raw === 'cases' || raw === 'master pack' || raw === 'master packs' || raw === 'mp' || compact === 'casepack') return 'Case';
    if (raw === 'inner pack' || raw === 'inner packs' || raw === 'inner' || raw === 'ip' || compact === 'innerpack' || compact === 'innerpacks') return 'Inner Pack';
    if (raw === 'each' || raw === 'ea') return 'Each';
    if (raw === 'shipper contents' || raw === 'shipper content' || raw === 'shipper' || compact === 'shippercontents') return 'Shipper Contents';
    return 'Other';
  }

  function isCasePackagingLevel(value) {
    return normalizePackagingLevel(value) === 'Case';
  }

  function parseBooleanLike(value, defaultValue = false) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return defaultValue;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return defaultValue;
    if (['1', 'true', 'yes', 'y', 'on', 'checked', '✅', 'x'].includes(raw)) return true;
    if (['0', 'false', 'no', 'n', 'off', 'unchecked', 'barcode on product'].includes(raw)) return false;
    if (raw.includes('barcode') && raw.includes('product')) return false;
    return defaultValue;
  }

  function normalizeStorefront(value) {
    const clean = String(value ?? '').trim();
    return clean || 'KeHE';
  }

  function isKeheStorefront(value) {
    return normalizeStorefront(value).toLowerCase() === 'kehe';
  }

  function normalizeInPackingList(row, packagingLevel) {
    return isCasePackagingLevel(packagingLevel) && parseBooleanLike(row?.is_active ?? row?.IS_ACTIVE, true);
  }

  function isProductInPackingList(row) {
    return !!row && row.is_active !== false && !!row.in_packing_list;
  }

  function defaultCopiesForLevel(level) {
    const normalized = normalizePackagingLevel(level);
    if (normalized === 'Inner Pack') return '6';
    if (normalized === 'Case') return '2';
    return '';
  }

  function defaultCaseQtyForLevel(level) {
    return normalizePackagingLevel(level) === 'Each' ? '1' : '';
  }

  function normalizeDefaultCopies(value, level) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(parsed);
  }

  function normalizeB2BVerificationStatus(value) {
    const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (['APPROVED', 'READY'].includes(raw)) return 'VERIFIED';
    if (B2B_VERIFICATION_STATUSES.includes(raw)) return raw;
    return raw ? 'NEEDS_REVIEW' : 'DRAFT';
  }

  function normalizeB2BDirectoryRecordType(value) {
    const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
    return B2B_DIRECTORY_RECORD_TYPES.includes(raw) ? raw : 'DESTINATION';
  }

  function normalizeCaseQty(value, level) {
    const raw = String(value ?? '').trim();
    if (!raw) return defaultCaseQtyForLevel(level);
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : defaultCaseQtyForLevel(level);
  }

  function parsePositiveNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function formatNumberString(value) {
    if (value === null || value === undefined) return '';
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
  }

  function parseLegacyDimensions(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    const cleaned = raw
      .replace(/¼/g, '.25')
      .replace(/½/g, '.5')
      .replace(/¾/g, '.75')
      .replace(/⅛/g, '.125')
      .replace(/⅜/g, '.375')
      .replace(/⅝/g, '.625')
      .replace(/⅞/g, '.875')
      .replace(/×/g, 'x')
      .replace(/\((l|w|b|h)\)/g, '');
    const values = cleaned.match(/-?\d+(?:\.\d+)?/g) || [];
    if (values.length < 3) return null;
    const length = parsePositiveNumber(values[0]);
    const width = parsePositiveNumber(values[1]);
    const height = parsePositiveNumber(values[2]);
    if (!length || !width || !height) return null;
    return { length, width, height };
  }

  function normalizeProductRow(row = {}) {
    const packagingLevel = normalizePackagingLevel(row.packaging_level ?? row.packging_level ?? row['PACKGING LEVEL'] ?? row['PACKAGING LEVEL']);
    const inPackingList = normalizeInPackingList(row, packagingLevel);
    const legacyDimensions = String(row.dimensions_in ?? row['L X W X H (in)'] ?? row.lwh_in ?? '').trim();
    const parsedLegacy = parseLegacyDimensions(legacyDimensions);
    const lengthIn = parsePositiveNumber(row.length_in ?? row.LENGTH_IN ?? row.length) ?? parsedLegacy?.length ?? null;
    const widthIn = parsePositiveNumber(row.width_in ?? row.WIDTH_IN ?? row.breadth_in ?? row.BREADTH_IN ?? row.breadth) ?? parsedLegacy?.width ?? null;
    const heightIn = parsePositiveNumber(row.height_in ?? row.HEIGHT_IN ?? row.height) ?? parsedLegacy?.height ?? null;
    const dimensionsDisplay = (lengthIn && widthIn && heightIn)
      ? `${formatNumberString(lengthIn)} x ${formatNumberString(widthIn)} x ${formatNumberString(heightIn)}`
      : legacyDimensions;
    const configId = String(row.config_id ?? row.CONFIG_ID ?? '').trim();
    const labelEnabledRaw = row.label_enabled ?? row.LABEL_ENABLED;
    const isActiveRaw = row.is_active ?? row.IS_ACTIVE;
    return {
      storefront: normalizeStorefront(row.storefront ?? row.STOREFRONT ?? row['Storefront']),
      in_packing_list: inPackingList,
      gtin: String(row.gtin ?? row.GTIN ?? row.case_upc ?? row.upc ?? '').trim(),
      description: String(row.description ?? row.DESCRIPTION ?? '').trim(),
      packaging_level: packagingLevel,
      dimensions_display: dimensionsDisplay,
      length_in: formatNumberString(lengthIn),
      width_in: formatNumberString(widthIn),
      height_in: formatNumberString(heightIn),
      each_net_weight_g: formatNumberString(parsePositiveNumber(row.each_net_weight_g ?? row.EACH_NET_WEIGHT_G)),
      package_net_weight_g: formatNumberString(parsePositiveNumber(row.package_net_weight_g ?? row.PACKAGE_NET_WEIGHT_G)),
      gross_weight_lbs: formatNumberString(parsePositiveNumber(row.gross_weight_lbs ?? row.GROSS_WEIGHT_LBS) ?? parsePositiveNumber(row.weight_lbs ?? row.WEIGHT_LBS)),
      case_qty: normalizeCaseQty(
        row.case_qty
          ?? row['Case Qty']
          ?? row['Eaches / Package']
          ?? row.eaches_per_package
          ?? row.eaches_per_case
          ?? row.eaches_per_inner_pack
          ?? row.case_quantity
          ?? row.units_per_case,
        packagingLevel
      ),
      sku: String(row.sku ?? row.SKU ?? row.item_number ?? '').trim(),
      display_sku: String(row.display_sku ?? row.DISPLAY_SKU ?? row.display_item_number ?? '').trim(),
      display_sku_uom: ['Each', 'Inner Pack', 'Case'].includes(normalizePackagingLevel(row.display_sku_uom ?? row.DISPLAY_SKU_UOM ?? row.display_sku_represents ?? 'Each'))
        ? normalizePackagingLevel(row.display_sku_uom ?? row.DISPLAY_SKU_UOM ?? row.display_sku_represents ?? 'Each')
        : 'Each',
      inner_packs_per_case: formatNumberString(parsePositiveNumber(row.inner_packs_per_case ?? row.INNER_PACKS_PER_CASE ?? row.inners_per_case)),
      config_id: configId,
      customer_item_number: String(row.customer_item_number ?? row.CUSTOMER_ITEM_NUMBER ?? '').trim(),
      label_template_id: String(row.label_template_id ?? row.LABEL_TEMPLATE_ID ?? '').trim(),
      barcode_type: String(row.barcode_type ?? row.BARCODE_TYPE ?? '').trim(),
      barcode_level: String(row.barcode_level ?? row.BARCODE_LEVEL ?? '').trim(),
      default_copies: normalizeDefaultCopies(row.default_copies ?? row.DEFAULT_COPIES ?? row.labels_per_unit ?? row['Labels / Unit'], packagingLevel),
      verification_status: normalizeB2BVerificationStatus(row.verification_status ?? row.VERIFICATION_STATUS),
      source_note: String(row.source_note ?? row.SOURCE_NOTE ?? '').trim(),
      label_enabled: labelEnabledRaw === undefined ? false : parseBooleanLike(labelEnabledRaw, false),
      is_active: isActiveRaw === undefined ? true : parseBooleanLike(isActiveRaw, true)
    };
  }

  function isPackLabelLevel(row) {
    const level = normalizePackagingLevel(row?.packaging_level);
    return level === 'Case' || level === 'Inner Pack';
  }

  function canPrintProductMasterLabel(row) {
    return !!row && isPackLabelLevel(row) && !!String(row.gtin || '').trim();
  }

  function getKeheProductMasterRows() {
    return keheProductMasterRows
      .map(normalizeProductRow)
      .filter(row => isKeheStorefront(row.storefront))
      .filter(row => row.in_packing_list || row.gtin || row.description || row.length_in || row.width_in || row.height_in || row.gross_weight_lbs || row.case_qty || row.default_copies || row.sku);
  }

  function getMplProductMasterRows() {
    const groups = new Map();
    mplProductMasterRows.map(normalizeProductRow).forEach((row, index) => {
      if (row.is_active === false) return;
      const key = mplProductGroupKey(row, index);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ row, index });
    });
    return [...groups.values()].map(entries => {
      const outermost = mplProductOutermostEntry(entries)?.row || entries[0]?.row;
      return outermost ? { ...outermost, in_packing_list: true } : null;
    }).filter(Boolean);
  }

  function getAllMplProductMasterRows() {
    return mplProductMasterRows
      .map(normalizeProductRow)
      .filter(row => row.gtin || row.description || row.length_in || row.width_in || row.height_in || row.gross_weight_lbs || row.case_qty || row.default_copies || row.sku || row.config_id || row.customer_item_number || row.label_template_id);
  }

  function isStandaloneMplReferenceMode() {
    return selectedKit === 'mpl' || selectedKit === 'b2b' || selectedKit === 'partners' || !!activeKeheDocumentDraft?.standalone_mpl;
  }

  function mplTemplateId(mpl) {
    if (!isStandaloneMplReferenceMode()) {
      if (mpl) {
        mpl.template_id = 'kehe';
        mpl.title = MPL_TEMPLATE_CONFIG.kehe.title;
      }
      return 'kehe';
    }
    const requested = String(mpl?.template_id || activeKeheDocumentDraft?.template_id || 'standard').trim().toLowerCase();
    const templateId = MPL_STANDALONE_TEMPLATE_IDS.includes(requested) ? requested : 'standard';
    if (mpl) {
      mpl.template_id = templateId;
      const currentTitle = String(mpl.title || '').trim().toUpperCase();
      if (!currentTitle || ['PACKING LIST', 'COMPACT PACKING LIST'].includes(currentTitle)) {
        mpl.title = MPL_TEMPLATE_CONFIG[templateId].title;
      }
    }
    if (activeKeheDocumentDraft) activeKeheDocumentDraft.template_id = templateId;
    return templateId;
  }

  function inferMplBrandId(value = '') {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    if (/brew\s*glitter/.test(normalized)) return 'brew_glitter';
    if (/bakell/.test(normalized)) return 'bakell';
    if (/(^|\s)pfg($|\s)|precision\s+food\s+group/.test(normalized)) return 'pfg';
    if (/jdi/.test(normalized)) return 'jdi_distribution';
    return '';
  }

  function mplBrandId(mpl) {
    const requested = String(mpl?.brand_id || activeKeheDocumentDraft?.brand_id || '').trim().toLowerCase();
    const inferred = inferMplBrandId(`${mpl?.supplier_info || ''} ${mpl?.storefront || activeKeheDocumentDraft?.storefront || ''}`);
    const templateDefault = ['decopac', 'dutch_bros', 'fancy'].includes(mplTemplateId(mpl)) ? 'bakell' : MPL_DEFAULT_BRAND_ID;
    const brandId = MPL_BRAND_IDS.includes(requested)
      ? requested
      : (templateDefault === 'bakell' ? 'bakell' : (inferred || templateDefault));
    if (mpl) mpl.brand_id = brandId;
    if (activeKeheDocumentDraft) activeKeheDocumentDraft.brand_id = brandId;
    return brandId;
  }

  function mplBrandSupplierInfo(brandId, currentValue = '') {
    const brand = MPL_BRAND_CONFIG[brandId] || MPL_BRAND_CONFIG[MPL_DEFAULT_BRAND_ID];
    const currentLines = String(currentValue || '').replace(/\\n/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    const addressLines = currentLines.length > 1 ? currentLines.slice(1) : MPL_DEFAULT_ADDRESS_LINES;
    return [brand.supplierName, ...addressLines].join('\n');
  }

  function mplBrandCssVars(brandId) {
    const brand = MPL_BRAND_CONFIG[brandId] || MPL_BRAND_CONFIG[MPL_DEFAULT_BRAND_ID];
    return [
      `--mpl-primary:${brand.primary}`,
      `--mpl-accent:${brand.accent}`,
      `--mpl-soft:${brand.soft}`,
      `--mpl-pale:${brand.pale}`,
      `--mpl-on-primary:${brand.onPrimary}`
    ].join(';');
  }

  function setMplTemplate(mplIndex, templateId) {
    if (!isStandaloneMplReferenceMode()) return;
    const mpl = getMpl(mplIndex);
    const normalized = String(templateId || '').trim().toLowerCase();
    if (!mpl || !MPL_STANDALONE_TEMPLATE_IDS.includes(normalized)) return;
    mpl.template_id = normalized;
    mpl.title = MPL_TEMPLATE_CONFIG[normalized].title;
    if (['decopac', 'dutch_bros', 'fancy'].includes(normalized)) {
      const customerName = MPL_TEMPLATE_CONFIG[normalized].label;
      mpl.storefront = customerName;
      mpl.brand_id = 'bakell';
      mpl.supplier_info = mplBrandSupplierInfo('bakell', mpl.supplier_info);
      mpl.delivery_from_name = MPL_BRAND_CONFIG.bakell.supplierName;
      activeKeheDocumentDraft.storefront = customerName;
      activeKeheDocumentDraft.brand_id = 'bakell';
    }
    activeKeheDocumentDraft.template_id = normalized;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    setStatus(`${MPL_TEMPLATE_CONFIG[normalized].label} template selected.`, 'info');
  }

  function setMplBrand(mplIndex, brandId) {
    if (!isStandaloneMplReferenceMode()) return;
    const mpl = getMpl(mplIndex);
    const normalized = String(brandId || '').trim().toLowerCase();
    if (!mpl || !MPL_BRAND_IDS.includes(normalized)) return;
    mpl.brand_id = normalized;
    mpl.supplier_info = mplBrandSupplierInfo(normalized, mpl.supplier_info);
    mpl.delivery_from_name = MPL_BRAND_CONFIG[normalized].supplierName;
    activeKeheDocumentDraft.brand_id = normalized;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    setStatus(`${MPL_BRAND_CONFIG[normalized].label} branding applied. Supplier information remains editable.`, 'info');
  }

  function renderMplTemplateSelector(mpl, mplIndex) {
    const templateId = mplTemplateId(mpl);
    if (!isStandaloneMplReferenceMode()) {
      const cfg = MPL_TEMPLATE_CONFIG.kehe;
      return `
        <div class="mpl-template-picker locked">
          <div>
            <div class="mpl-template-picker-kicker">MPL Template</div>
            <div class="mpl-template-picker-title">${escapeHtml(cfg.label)}</div>
          </div>
          <div class="mpl-template-picker-description">${escapeHtml(cfg.description)}</div>
          <span class="mpl-template-lock">KeHE only</span>
        </div>`;
    }
    if (selectedKit === 'partners') {
      return `
        <div class="mpl-template-picker partner-customer-template-picker">
          <div>
            <div class="mpl-template-picker-kicker">Customer layout</div>
            <div class="mpl-template-picker-title">DecoPac / Dutch Bros / Fancy</div>
          </div>
          <div class="mpl-template-picker-description">The editor and document engine stay shared; only the selected customer's layout rules are applied.</div>
          <div class="mpl-template-options" role="radiogroup" aria-label="Customer packing-list layout">
            ${PARTNER_CUSTOMER_IDS.map(id => {
              const cfg = PARTNER_WORKFLOW_CONFIG[id];
              const selected = cfg.mplTemplateId === templateId;
              return `
                <button class="mpl-template-option partner-customer-option customer-${escapeHtml(id)}${selected ? ' selected' : ''}" type="button" role="radio" aria-checked="${selected ? 'true' : 'false'}" onclick="selectPartnerCustomer('${id}', { fromEditor: true })">
                  <span>${escapeHtml(cfg.label)}</span>
                  <small>Customer-specific packing list and labels</small>
                </button>`;
            }).join('')}
          </div>
        </div>`;
    }
    const generalTemplateIds = ['kehe', 'standard'];
    const partnerTemplateSelected = PARTNER_CUSTOMER_IDS.some(id => PARTNER_WORKFLOW_CONFIG[id].mplTemplateId === templateId);
    return `
      <div class="mpl-template-picker">
        <div>
          <div class="mpl-template-picker-kicker">MPL Template</div>
          <div class="mpl-template-picker-title">Choose a layout</div>
        </div>
        <div class="mpl-template-options" role="radiogroup" aria-label="MPL template">
          ${generalTemplateIds.map(id => {
            const cfg = MPL_TEMPLATE_CONFIG[id];
            const selected = id === templateId;
            return `
              <button class="mpl-template-option${selected ? ' selected' : ''}" type="button" role="radio" aria-checked="${selected ? 'true' : 'false'}" onclick="setMplTemplate(${mplIndex}, '${id}')">
                <span>${escapeHtml(cfg.label)}</span>
                <small>${escapeHtml(cfg.description)}</small>
              </button>`;
          }).join('')}
          <div class="mpl-template-family-group${partnerTemplateSelected ? ' selected' : ''}" role="group" aria-label="Customer-specific manual MPL layouts">
            <div class="mpl-template-family-copy">
              <span>DecoPac / Dutch Bros / Fancy</span>
              <small>Create a manual packing list here without loading an order.</small>
            </div>
            <div class="mpl-template-family-choices">
              ${PARTNER_CUSTOMER_IDS.map(id => {
                const cfg = PARTNER_WORKFLOW_CONFIG[id];
                const selected = cfg.mplTemplateId === templateId;
                return `<button class="mpl-template-family-choice${selected ? ' selected' : ''}" type="button" role="radio" aria-checked="${selected ? 'true' : 'false'}" onclick="setMplTemplate(${mplIndex}, '${cfg.mplTemplateId}')">${escapeHtml(cfg.label)}</button>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderMplBrandSelector(mpl, mplIndex) {
    if (!isStandaloneMplReferenceMode()) return '';
    if (mplTemplateId(mpl) === 'kehe') {
      return `
        <div class="mpl-brand-picker locked">
          <div>
            <div class="mpl-template-picker-kicker">Supplier Brand</div>
            <div class="mpl-template-picker-title">Original KeHE MPL</div>
            <div class="mpl-template-picker-description">KeHE keeps its original fixed black-and-cream packing-list format. Supplier logos apply to DecoPac, Dutch Brothers, and Standard.</div>
          </div>
          <span class="mpl-template-lock">KeHE fixed</span>
        </div>`;
    }
    const brandId = mplBrandId(mpl);
    return `
      <div class="mpl-brand-picker">
        <div>
          <div class="mpl-template-picker-kicker">Supplier Brand</div>
          <div class="mpl-template-picker-title">Choose the MPL color scheme</div>
          <div class="mpl-template-picker-description">Branding and ship-from text are separate from the customer layout and can be changed at any time.</div>
        </div>
        <div class="mpl-brand-options" role="radiogroup" aria-label="MPL supplier brand">
          ${MPL_BRAND_IDS.map(id => {
            const brand = MPL_BRAND_CONFIG[id];
            const selected = id === brandId;
            return `
              <button class="mpl-brand-option${selected ? ' selected' : ''}" style="--brand-primary:${brand.primary};--brand-accent:${brand.accent};--brand-soft:${brand.soft}" type="button" role="radio" aria-checked="${selected ? 'true' : 'false'}" onclick="setMplBrand(${mplIndex}, '${id}')">
                <span class="mpl-brand-option-logo"><img class="${escapeHtml(brand.logoClass || '')}" src="${escapeHtml(brand.logo)}" alt="" aria-hidden="true"></span>
                <strong>${escapeHtml(brand.label)}</strong>
              </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  function getActiveProductMasterRows() {
    return isStandaloneMplReferenceMode() ? getMplProductMasterRows() : getKeheProductMasterRows();
  }

  function getActiveAllProductMasterRows() {
    return isStandaloneMplReferenceMode() ? getAllMplProductMasterRows() : getKeheProductMasterRows();
  }

  function loadMplProductMasterFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(MPL_PRODUCT_MASTER_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeProductRow);
    } catch (_err) {
      return [];
    }
  }

  function saveMplProductMasterToStorage() {
    if (!allowBrowserLocalCache()) return;
    try {
      localStorage.setItem(MPL_PRODUCT_MASTER_STORAGE_KEY, JSON.stringify(getAllMplProductMasterRows()));
    } catch (_err) {}
  }

  function ensureMplProductEachRows() {
    const groups = new Map();
    mplProductMasterRows.forEach((raw, index) => {
      const row = normalizeProductRow(raw);
      const key = mplProductGroupKey(row, index);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ row, index });
    });
    let changed = false;
    groups.forEach(entries => {
      const existingConfigId = entries
        .map(entry => String(entry.row.config_id || '').trim())
        .find(Boolean);
      const primaryForId = mplProductOutermostEntry(entries)?.row || entries[0]?.row || {};
      const generatedConfigId = existingConfigId || `CFG-${[
        normalizeStorefront(primaryForId.storefront) || 'PRODUCT',
        primaryForId.display_sku || primaryForId.sku || primaryForId.customer_item_number || 'ITEM',
      ]
        .join('-')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 72)}`;
      entries.forEach(({ index }) => {
        if (String(mplProductMasterRows[index].config_id || '').trim() !== generatedConfigId) {
          mplProductMasterRows[index].config_id = generatedConfigId;
          changed = true;
        }
      });
      if (mplProductLevelEntry(entries, 'Each')) return;
      const primary = mplProductOutermostEntry(entries)?.row || entries[0]?.row;
      if (!primary) return;
      mplProductMasterRows.push(normalizeProductRow({
        ...primary,
        config_id: generatedConfigId,
        packaging_level: 'Each',
        sku: primary.display_sku || primary.sku,
        gtin: '',
        barcode_level: 'EACH',
        case_qty: '1',
        inner_packs_per_case: '',
        length_in: '',
        width_in: '',
        height_in: '',
        package_net_weight_g: '',
        gross_weight_lbs: '',
        default_copies: '',
        label_template_id: '',
        label_enabled: false,
      }));
      changed = true;
    });
    return changed;
  }

  async function loadMplProductMasterFromBackend() {
    const localRows = allowLocalFallback() ? loadMplProductMasterFromStorage() : [];
    try {
      const res = await fetchWithTimeout('/api/mpl/product-master', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load MPL product master.');
      const backendRows = Array.isArray(payload.rows) ? payload.rows.map(normalizeProductRow) : [];
      if (backendRows.length) {
        mplProductMasterRows = backendRows;
        const addedEachRows = ensureMplProductEachRows();
        saveMplProductMasterToStorage();
        if (addedEachRows && hasPermission('table_crud')) saveMplProductMasterToBackendDebounced();
      } else if (allowLocalFallback() && localRows.length) {
        mplProductMasterRows = localRows;
        ensureMplProductEachRows();
        await saveMplProductMasterToBackend();
      } else {
        mplProductMasterRows = [];
      }
      renderMplProductMasterTable();
      return payload;
    } catch (_err) {
      mplProductMasterRows = allowLocalFallback() ? localRows : [];
      ensureMplProductEachRows();
      renderMplProductMasterTable();
      return { rows: mplProductMasterRows, source: allowLocalFallback() ? 'localStorage' : 'unavailable' };
    }
  }

  function saveMplProductMasterToBackendDebounced() {
    clearTimeout(mplProductMasterSaveTimer);
    mplProductMasterSaveTimer = setTimeout(saveMplProductMasterToBackend, 500);
  }

  async function saveMplProductMasterToBackend() {
    if (!hasPermission('table_crud')) return;
    const rows = getAllMplProductMasterRows();
    try {
      const res = await fetch('/api/mpl/product-master', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not save Product Master.');
      if (Array.isArray(payload.rows)) {
        const savedRows = payload.rows.map(normalizeProductRow);
        const wasMerged = savedRows.length < rows.length;
        if (wasMerged) {
          mplProductMasterRows = savedRows;
          saveMplProductMasterToStorage();
          renderMplProductMasterTable();
          setStatus('Product Master duplicate key merged. Unique key is Storefront + Config ID + Packaging Level (or legacy Storefront + Packaging Level + SKU).', 'info');
        } else {
          saveMplProductMasterToStorage();
        }
      } else {
        saveMplProductMasterToStorage();
      }
    } catch (_err) {
      // Browser cache remains available if backend persistence is temporarily unavailable.
      saveMplProductMasterToStorage();
    }
  }

  function showMplProductMasterView() {
    renderMplProductMasterTable();
    document.getElementById('mpl-product-master-modal').classList.add('visible');
  }

  function openMplProductMasterModal() {
    navigateToRoute('mpl/product-master');
  }

  function hideMplProductMasterView() {
    document.getElementById('mpl-product-master-modal').classList.remove('visible');
  }

  function closeMplProductMasterModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView(getCurrentPage());
    } else {
      hideMplProductMasterView();
    }
  }

  function mplProductGroupKey(row, index = 0) {
    const normalized = normalizeProductRow(row || {});
    const storefront = normalizeStorefront(normalized.storefront).toLowerCase() || 'no-storefront';
    const productIdentity = String(normalized.config_id || normalized.sku || normalized.customer_item_number || normalized.gtin || `row-${index}`).trim().toLowerCase();
    return `${storefront}|${productIdentity}`;
  }

  function mplPositivePackageQuantity(value) {
    const quantity = Number(String(value ?? '').trim());
    return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
  }

  function mplFormatPackageQuantity(value) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity)) return '';
    return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(6)));
  }

  function mplProductPackageBreakdown(rawRow, groupEntries = []) {
    const row = normalizeProductRow(rawRow || {});
    const level = normalizePackagingLevel(row.packaging_level);
    const packageQuantity = mplPositivePackageQuantity(row.case_qty);
    const normalizedGroupRows = groupEntries.map(entry => normalizeProductRow(entry?.row || entry || {}));

    if (level === 'Each') return '1 each';
    if (level === 'Inner Pack') {
      return packageQuantity
        ? `${mplFormatPackageQuantity(packageQuantity)} eaches / inner pack`
        : 'Enter eaches / inner pack';
    }
    if (level === 'Case') {
      if (!packageQuantity || packageQuantity <= 1) return 'Required for Analytics conversion';
      const wantedStorefront = normalizeStorefront(row.storefront).toLowerCase();
      const innerPackRow = normalizedGroupRows.find(candidate => (
        normalizePackagingLevel(candidate.packaging_level) === 'Inner Pack'
        && normalizeStorefront(candidate.storefront).toLowerCase() === wantedStorefront
      ));
      const innerPackQuantity = mplPositivePackageQuantity(innerPackRow?.case_qty);
      if (innerPackQuantity && innerPackQuantity > 1) {
        const innerPacksPerCase = mplPositivePackageQuantity(row.inner_packs_per_case) || (packageQuantity / innerPackQuantity);
        return `${mplFormatPackageQuantity(innerPackQuantity)} eaches / inner × ${mplFormatPackageQuantity(innerPacksPerCase)} inner packs = ${mplFormatPackageQuantity(packageQuantity)} eaches / case`;
      }
      return `${mplFormatPackageQuantity(packageQuantity)} eaches / case`;
    }
    if (level === 'Shipper Contents') {
      return packageQuantity
        ? `${mplFormatPackageQuantity(packageQuantity)} eaches / shipper`
        : 'Optional shipper quantity';
    }
    return packageQuantity ? `${mplFormatPackageQuantity(packageQuantity)} eaches / package` : 'Optional';
  }

  function mplProductEntriesForGroup(groupKey) {
    return mplProductMasterRows
      .map((row, index) => ({ row: normalizeProductRow(row), index }))
      .filter(entry => mplProductGroupKey(entry.row, entry.index) === groupKey);
  }

  function mplProductLevelEntry(entries, level) {
    return entries.find(entry => normalizePackagingLevel(entry?.row?.packaging_level) === level) || null;
  }

  function mplProductOutermostEntry(entries) {
    return mplProductLevelEntry(entries, 'Case')
      || mplProductLevelEntry(entries, 'Inner Pack')
      || mplProductLevelEntry(entries, 'Each')
      || entries[0]
      || null;
  }

  function mplProductEachesPerOutermost(entries) {
    const outermost = mplProductOutermostEntry(entries);
    if (!outermost) return 1;
    const level = normalizePackagingLevel(outermost.row.packaging_level);
    if (level === 'Each') return 1;
    const quantity = mplPositivePackageQuantity(outermost.row.case_qty);
    return quantity || 1;
  }

  function mplCalculatedProductWeight(entries) {
    const eachEntry = mplProductLevelEntry(entries, 'Each');
    const source = eachEntry?.row || entries[0]?.row || {};
    const eachWeight = parsePositiveNumber(source.each_net_weight_g);
    if (!eachWeight) return '';
    return formatNumberString(eachWeight * mplProductEachesPerOutermost(entries));
  }

  function updateMplProductGroupField(groupKey, key, value) {
    if (!hasPermission('table_crud')) return;
    const entries = mplProductEntriesForGroup(groupKey);
    if (!entries.length) return;
    let normalizedValue = value;
    if (key === 'storefront') normalizedValue = normalizeStorefront(value);
    if (key === 'verification_status') normalizedValue = normalizeB2BVerificationStatus(value);
    if (key === 'display_sku_uom') {
      const level = normalizePackagingLevel(value);
      normalizedValue = ['Each', 'Inner Pack', 'Case'].includes(level) ? level : 'Each';
    }
    entries.forEach(({ index }) => { mplProductMasterRows[index][key] = normalizedValue; });
    const nextKey = mplProductGroupKey(mplProductMasterRows[entries[0].index], entries[0].index);
    if (mplProductEditorGroupKey === groupKey) mplProductEditorGroupKey = nextKey;
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    renderMplProductEditor();
  }

  function updateMplProductFinalField(groupKey, key, value) {
    if (!hasPermission('table_crud')) return;
    const entries = mplProductEntriesForGroup(groupKey);
    if (!entries.length) return;
    if (key === 'each_net_weight_g') {
      entries.forEach(({ index }) => { mplProductMasterRows[index][key] = value; });
    } else {
      const outermost = mplProductOutermostEntry(entries);
      if (!outermost) return;
      mplProductMasterRows[outermost.index][key] = value;
    }
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    renderMplProductEditor();
  }

  function updateMplProductLevelQuantity(index, value) {
    if (!hasPermission('table_crud') || !mplProductMasterRows[index]) return;
    const level = normalizePackagingLevel(mplProductMasterRows[index].packaging_level);
    const groupKey = mplProductGroupKey(mplProductMasterRows[index], index);
    const entries = mplProductEntriesForGroup(groupKey);
    const normalizedValue = normalizeCaseQty(value, level);
    if (level === 'Case' && mplProductLevelEntry(entries, 'Inner Pack')) {
      mplProductMasterRows[index].inner_packs_per_case = normalizedValue;
      const eachesPerInner = mplPositivePackageQuantity(mplProductLevelEntry(entries, 'Inner Pack')?.row?.case_qty);
      const innersPerCase = mplPositivePackageQuantity(normalizedValue);
      mplProductMasterRows[index].case_qty = eachesPerInner && innersPerCase
        ? mplFormatPackageQuantity(eachesPerInner * innersPerCase)
        : '';
    } else {
      mplProductMasterRows[index].case_qty = normalizedValue;
      if (level === 'Inner Pack') {
        const caseEntry = mplProductLevelEntry(entries, 'Case');
        const innersPerCase = mplPositivePackageQuantity(caseEntry?.row?.inner_packs_per_case);
        if (caseEntry && innersPerCase && mplPositivePackageQuantity(normalizedValue)) {
          mplProductMasterRows[caseEntry.index].case_qty = mplFormatPackageQuantity(Number(normalizedValue) * innersPerCase);
        }
      }
    }
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    renderMplProductEditor();
  }

  function mplProductEditorLevelCard({ row, index }, groupEntries, canEdit) {
    const editDisabled = canEdit ? '' : 'disabled';
    const printable = canPrintProductMasterLabel(row);
    const hasInner = !!mplProductLevelEntry(groupEntries, 'Inner Pack');
    const isCaseWithInner = row.packaging_level === 'Case' && hasInner;
    const quantityValue = isCaseWithInner ? row.inner_packs_per_case : row.case_qty;
    const quantityLabel = isCaseWithInner ? 'Inner Packs per Case' : (row.packaging_level === 'Inner Pack' ? 'Eaches per Inner Pack' : 'Eaches per Case');
    return `<article class="mpl-packaging-level-card" data-product-row-index="${index}">
      <header class="mpl-packaging-level-header">
        <div><strong>${escapeHtml(row.packaging_level)}</strong><span>${escapeHtml(mplProductPackageBreakdown({ ...row, case_qty: quantityValue }, groupEntries))}</span></div>
        <div class="mpl-packaging-level-actions">
          ${printable ? `<button class="btn-table-preview" type="button" onclick="openManualMplProductPackLabel(${index})">Preview label</button>` : ''}
          ${canEdit ? `<button class="btn-mini-danger" type="button" onclick="deleteMplProductRow(${index})">Remove level</button>` : ''}
        </div>
      </header>
      <div class="mpl-packaging-primary-grid">
        <label>${escapeHtml(row.packaging_level)} SKU <input ${editDisabled} value="${escapeHtml(row.sku)}" placeholder="Order SKU for this unit" onchange="updateMplProductRow(${index}, 'sku', this.value)"></label>
        <label>GTIN <input ${editDisabled} value="${escapeHtml(row.gtin)}" onchange="updateMplProductRow(${index}, 'gtin', this.value)"></label>
        <label>${escapeHtml(quantityLabel)} <input ${editDisabled} type="number" min="1" step="1" value="${escapeHtml(quantityValue)}" onchange="validateProductNumericInput(this, true); updateMplProductLevelQuantity(${index}, this.value)"></label>
        <label class="mpl-toggle-field">Label enabled <input ${editDisabled} type="checkbox" ${row.label_enabled ? 'checked' : ''} onchange="updateMplProductRow(${index}, 'label_enabled', this.checked)"></label>
      </div>
      <details class="mpl-packaging-advanced">
        <summary>Label settings</summary>
        <div class="mpl-unified-fields-grid">
          <label>Template <select ${editDisabled} onchange="updateMplProductRow(${index}, 'label_template_id', this.value)">${selectOptionsHtml(b2bTemplateIdOptions(row.label_template_id), row.label_template_id, 'No template')}</select></label>
          <label>Barcode Type <select ${editDisabled} onchange="updateMplProductRow(${index}, 'barcode_type', this.value)">${selectOptionsHtml(B2B_BARCODE_TYPES, row.barcode_type, 'Select type')}</select></label>
          <label>Barcode Level <select ${editDisabled} onchange="updateMplProductRow(${index}, 'barcode_level', this.value)">${selectOptionsHtml(B2B_BARCODE_LEVELS, row.barcode_level, 'Select level')}</select></label>
          <label>Default Copies <input ${editDisabled} type="number" min="1" step="1" value="${escapeHtml(row.default_copies || '')}" onchange="updateMplProductRow(${index}, 'default_copies', this.value)"></label>
          <label class="mpl-toggle-field">Level active <input ${editDisabled} type="checkbox" ${row.is_active ? 'checked' : ''} onchange="updateMplProductRow(${index}, 'is_active', this.checked)"></label>
        </div>
      </details>
    </article>`;
  }

  function openMplProductEditor(groupKey) {
    if (!groupKey) return;
    mplProductEditorGroupKey = groupKey;
    renderMplProductEditor();
    document.getElementById('mpl-product-editor-modal')?.classList.add('visible');
  }

  function closeMplProductEditor() {
    document.getElementById('mpl-product-editor-modal')?.classList.remove('visible');
    mplProductEditorGroupKey = '';
    renderMplProductMasterTable();
  }

  function deleteMplProductConfiguration() {
    if (!hasPermission('table_crud') || !mplProductEditorGroupKey) return;
    const indexes = mplProductEntriesForGroup(mplProductEditorGroupKey).map(entry => entry.index).sort((a, b) => b - a);
    indexes.forEach(index => mplProductMasterRows.splice(index, 1));
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    closeMplProductEditor();
    setStatus('Product configuration deleted.', 'success');
  }

  function renderMplProductEditor() {
    const body = document.getElementById('mpl-product-editor-body');
    if (!body || !mplProductEditorGroupKey) return;
    const entries = mplProductEntriesForGroup(mplProductEditorGroupKey);
    if (!entries.length) {
      closeMplProductEditor();
      return;
    }
    const canEdit = hasPermission('table_crud');
    const editDisabled = canEdit ? '' : 'disabled';
    const eachEntry = mplProductLevelEntry(entries, 'Each') || entries[0];
    const outermost = mplProductOutermostEntry(entries) || eachEntry;
    const shared = eachEntry.row;
    const outer = outermost.row;
    const levels = [...new Set(entries.map(entry => normalizePackagingLevel(entry.row.packaging_level)))];
    const optionalEntries = entries
      .filter(entry => ['Inner Pack', 'Case'].includes(normalizePackagingLevel(entry.row.packaging_level)))
      .sort((left, right) => ['Inner Pack', 'Case'].indexOf(left.row.packaging_level) - ['Inner Pack', 'Case'].indexOf(right.row.packaging_level));
    const calculatedProductWeight = mplCalculatedProductWeight(entries);
    const title = document.getElementById('mpl-product-editor-title');
    if (title) title.textContent = `${shared.display_sku || shared.sku || 'New product'} · Product configuration`;
    const displayUomOptions = ['Each', 'Inner Pack', 'Case']
      .filter(level => level === 'Each' || levels.includes(level) || level === shared.display_sku_uom)
      .map(level => `<option value="${level}" ${shared.display_sku_uom === level ? 'selected' : ''}>${level}</option>`)
      .join('');
    body.innerHTML = `<div class="master-record-form-stack">
      <section class="mpl-product-shared-card">
        <header><div><span>Shared product details</span><h3>${escapeHtml(shared.display_sku || shared.sku || 'New configuration')}</h3></div><span class="directory-autosave-badge">Auto-save on</span></header>
        <div class="mpl-product-shared-grid master-product-shared-grid">
          <label>Customer <select ${editDisabled} onchange="updateMplProductGroupField('${jsString(mplProductEditorGroupKey)}', 'storefront', this.value)">${selectOptionsHtml(b2bCustomerOptions(outer.storefront), outer.storefront, 'Select customer')}</select></label>
          <label>Display / Alternate SKU <input ${editDisabled} value="${escapeHtml(shared.display_sku || '')}" placeholder="Optional SKU accepted from orders" onchange="updateMplProductGroupField('${jsString(mplProductEditorGroupKey)}', 'display_sku', this.value)"></label>
          <label>Display SKU represents <select ${editDisabled} onchange="updateMplProductGroupField('${jsString(mplProductEditorGroupKey)}', 'display_sku_uom', this.value)">${displayUomOptions}</select><small>Defines how Quantity Ordered is converted when this alternate SKU matches.</small></label>
          <label>Each SKU <input ${editDisabled} value="${escapeHtml(shared.sku || '')}" placeholder="Order SKU for one each" onchange="updateMplProductRow(${eachEntry.index}, 'sku', this.value)"></label>
          <label>Each GTIN <input ${editDisabled} value="${escapeHtml(shared.gtin || '')}" placeholder="Barcode for one each" onchange="updateMplProductRow(${eachEntry.index}, 'gtin', this.value)"></label>
          <label class="mpl-product-description-field">Description <input ${editDisabled} value="${escapeHtml(shared.description || '')}" onchange="updateMplProductGroupField('${jsString(mplProductEditorGroupKey)}', 'description', this.value)"></label>
          <label>Each Weight (g) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(shared.each_net_weight_g || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(mplProductEditorGroupKey)}', 'each_net_weight_g', this.value)"></label>
          <label>Customer Item Number <input ${editDisabled} value="${escapeHtml(outer.customer_item_number || '')}" onchange="updateMplProductGroupField('${jsString(mplProductEditorGroupKey)}', 'customer_item_number', this.value)"></label>
          <label>Status <select ${editDisabled} onchange="updateMplProductGroupField('${jsString(mplProductEditorGroupKey)}', 'verification_status', this.value)">${selectOptionsHtml(B2B_VERIFICATION_STATUSES, outer.verification_status, 'Select status')}</select></label>
        </div>
        <details class="mpl-packaging-advanced master-each-label-settings" ${shared.label_enabled ? 'open' : ''}>
          <summary>Each label settings</summary>
          <div class="mpl-unified-fields-grid">
            <label class="mpl-toggle-field">Label enabled <input ${editDisabled} type="checkbox" ${shared.label_enabled ? 'checked' : ''} onchange="updateMplProductRow(${eachEntry.index}, 'label_enabled', this.checked)"></label>
            <label>Template <select ${editDisabled} onchange="updateMplProductRow(${eachEntry.index}, 'label_template_id', this.value)">${selectOptionsHtml(b2bTemplateIdOptions(shared.label_template_id), shared.label_template_id, 'No template')}</select></label>
            <label>Barcode Type <select ${editDisabled} onchange="updateMplProductRow(${eachEntry.index}, 'barcode_type', this.value)">${selectOptionsHtml(B2B_BARCODE_TYPES, shared.barcode_type, 'Select type')}</select></label>
            <label>Default Copies <input ${editDisabled} type="number" min="1" step="1" value="${escapeHtml(shared.default_copies || '')}" onchange="updateMplProductRow(${eachEntry.index}, 'default_copies', this.value)"></label>
          </div>
        </details>
        <div class="mpl-product-final-details">
          <div class="mpl-product-final-heading"><span>Outermost shipping unit · ${escapeHtml(outer.packaging_level || 'Each')}</span><strong>Packaged weight and dimensions are stored once</strong></div>
          <div class="mpl-product-final-grid">
            <label>Calculated Product Weight (g) <input readonly value="${escapeHtml(calculatedProductWeight)}" placeholder="Calculated from Each weight"></label>
            <label>Total Weight with Packaging (lb) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(outer.gross_weight_lbs || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(mplProductEditorGroupKey)}', 'gross_weight_lbs', this.value)"></label>
            <label>Length (in) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(outer.length_in || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(mplProductEditorGroupKey)}', 'length_in', this.value)"></label>
            <label>Width (in) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(outer.width_in || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(mplProductEditorGroupKey)}', 'width_in', this.value)"></label>
            <label>Height (in) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(outer.height_in || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(mplProductEditorGroupKey)}', 'height_in', this.value)"></label>
          </div>
        </div>
      </section>
      <section class="mpl-product-levels-card">
        <header><div><span>Packaging levels</span><strong>Each is always present. Add Inner Pack or Case only when required.</strong></div>${canEdit ? `<select class="mpl-product-level-add" data-no-search onchange="addMplProductLevel('${jsString(mplProductEditorGroupKey)}', this.value); this.value=''"><option value="">+ Add level</option>${['Inner Pack', 'Case'].filter(level => !levels.includes(level)).map(level => `<option value="${level}">${level}</option>`).join('')}</select>` : ''}</header>
        <div class="mpl-packaging-level-list">${optionalEntries.length ? optionalEntries.map(entry => mplProductEditorLevelCard(entry, entries, canEdit)).join('') : '<div class="mpl-product-no-levels"><strong>Each is the outermost shipping unit.</strong><span>Add another level only if orders or labels use it.</span></div>'}</div>
      </section>
      ${canEdit ? '<div class="master-record-danger-zone"><div><strong>Delete configuration</strong><span>Removes the Each, Inner Pack, and Case records for this product.</span></div><button class="btn-mini-danger" type="button" onclick="deleteMplProductConfiguration()">Delete product</button></div>' : ''}
    </div>`;
    applyPermissionUi();
    enhanceSearchableSelects(body);
  }

  function renderMplProductMasterTable() {
    const body = document.getElementById('mpl-product-master-body');
    if (!body) return;
    const quality = window.LabelKitWorkflow?.productQualitySnapshot?.();
    const rows = mplProductMasterRows
      .map((raw, index) => ({ row: normalizeProductRow(raw), index }));
    if (!rows.length) {
      const countEl = document.getElementById('mpl-product-filter-count');
      if (countEl) countEl.textContent = '0 configurations';
      body.innerHTML = '<tr><td class="empty-row" colspan="2">No product rows yet. Add manually or upload data.</td></tr>';
      return;
    }
    const levelOptions = ['Inner Pack', 'Case'];
    const levelOrder = new Map(levelOptions.map((level, index) => [level, index]));
    const groupsByKey = new Map();
    rows.forEach(entry => {
      const key = mplProductGroupKey(entry.row, entry.index);
      if (!groupsByKey.has(key)) groupsByKey.set(key, { key, entries: [] });
      groupsByKey.get(key).entries.push(entry);
    });
    let groups = [...groupsByKey.values()].sort((left, right) => {
      const leftRow = left.entries[0]?.row || {};
      const rightRow = right.entries[0]?.row || {};
      return `${leftRow.storefront}|${leftRow.sku}|${leftRow.description}`.localeCompare(
        `${rightRow.storefront}|${rightRow.sku}|${rightRow.description}`,
        undefined,
        { sensitivity: 'base', numeric: true }
      );
    });
    syncTableFilterOptions(
      'mpl-product-storefront-filter',
      groups.map(group => group.entries[0]?.row?.storefront),
      'All customers'
    );
    const search = String(document.getElementById('mpl-product-search')?.value || '').trim();
    const storefrontFilter = String(document.getElementById('mpl-product-storefront-filter')?.value || '').trim().toLowerCase();
    const qualityFilter = String(document.getElementById('mpl-product-quality-filter')?.value || 'all');
    if (storefrontFilter) {
      groups = groups.filter(group => group.entries.some(entry => String(entry.row.storefront || '').trim().toLowerCase() === storefrontFilter));
    }
    if (quality) {
      groups = groups.filter(group => window.LabelKitWorkflow.productGroupPassesFilter(group, qualityFilter, search));
      window.LabelKitWorkflow.renderProductQualitySummary(quality, groups.length);
    } else if (search) {
      const needle = search.toLowerCase();
      groups = groups.filter(group => group.entries.some(entry => Object.values(entry.row || {}).some(value => String(value || '').toLowerCase().includes(needle))));
    }
    const countEl = document.getElementById('mpl-product-filter-count');
    if (countEl) countEl.textContent = `${groups.length} of ${groupsByKey.size} configurations`;
    if (!groups.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="2">No configurations match the selected Product Master filters.</td></tr>';
      return;
    }

    body.innerHTML = groups.map(group => {
      group.entries.sort((left, right) => {
        const leftOrder = levelOrder.get(left.row.packaging_level) ?? levelOptions.length;
        const rightOrder = levelOrder.get(right.row.packaging_level) ?? levelOptions.length;
        return leftOrder - rightOrder || left.index - right.index;
      });
      const eachEntry = mplProductLevelEntry(group.entries, 'Each');
      const primaryEntry = mplProductOutermostEntry(group.entries);
      const primaryRow = primaryEntry?.row || {};
      const sharedRow = eachEntry?.row || primaryRow;
      const groupSummary = mplProductPackageBreakdown(primaryRow, group.entries);
      const verification = primaryRow.verification_status || 'UNSET';
      const outermostLabel = primaryRow.packaging_level || 'Each';
      const groupQuality = quality?.groups?.get(group.key) || { score: 0, issues: [] };
      const qualityState = groupQuality.score === 100 ? 'ready' : groupQuality.issues?.some(issue => issue.severity === 'invalid') ? 'invalid' : 'review';
      return `
        <tr class="mpl-product-group-row">
          <td colspan="2">
            <div class="mpl-product-group-shell">
              <button class="mpl-product-group-toggle" type="button" data-group-key="${escapeHtml(group.key)}" onclick="openMplProductEditor('${jsString(group.key)}')">
                <span class="mpl-product-group-chevron" aria-hidden="true">›</span>
                <span class="mpl-product-group-identity">
                  <strong>${escapeHtml(sharedRow.display_sku || sharedRow.sku || primaryRow.sku || primaryRow.customer_item_number || 'SKU not set')}</strong>
                  <span>${escapeHtml(sharedRow.description || primaryRow.description || 'Description not set')}</span>
                </span>
                <span class="mpl-product-group-meta">${escapeHtml(primaryRow.storefront || 'No storefront')} · Outermost: ${escapeHtml(outermostLabel)} · ${escapeHtml(verification)} <span class="product-quality-badge ${qualityState}" title="${escapeHtml((groupQuality.issues || []).map(issue => issue.message).join(' · ') || 'Complete')}">${groupQuality.score}% complete</span></span>
                <span class="mpl-product-group-summary">${escapeHtml(groupSummary)}</span>
                <span class="mpl-product-group-action">Review &amp; edit</span>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
    applyPermissionUi();
    enhanceSearchableSelects(body);
  }

  function addMplProductRow(seed = {}) {
    if (!hasPermission('table_crud')) return;
    const defaultStorefront = selectedKit === 'b2b' && b2bSelectedCustomer ? b2bSelectedCustomer : 'KeHE';
    const configId = String(seed.config_id || `DRAFT-${Date.now()}`).trim();
    const newRow = normalizeProductRow({
      storefront: defaultStorefront,
      config_id: configId,
      packaging_level: 'Each',
      case_qty: '1',
      in_packing_list: true,
      ...seed,
    });
    mplProductMasterRows.push(newRow);
    const newIndex = mplProductMasterRows.length - 1;
    const groupKey = mplProductGroupKey(newRow, newIndex);
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    openMplProductEditor(groupKey);
  }

  function addMplProductLevel(groupKey, packagingLevel) {
    if (!hasPermission('table_crud')) return;
    const level = normalizePackagingLevel(packagingLevel);
    if (!groupKey || !B2B_PACKAGING_LEVELS.includes(level)) return;
    const entries = mplProductMasterRows
      .map((row, index) => ({ row: normalizeProductRow(row), index }))
      .filter(entry => mplProductGroupKey(entry.row, entry.index) === groupKey);
    if (!entries.length) return;
    if (entries.some(entry => normalizePackagingLevel(entry.row.packaging_level) === level)) {
      setStatus(`${level} already exists for this configuration.`, 'error');
      return;
    }

    const primary = mplProductOutermostEntry(entries)?.row || entries[0].row;
    const previousOutermost = mplProductOutermostEntry(entries);
    const inheritedBarcodeLevel = level.toUpperCase().replace(/\s+/g, '_');
    const newRow = normalizeProductRow({
      ...primary,
      packaging_level: level,
      sku: '',
      gtin: '',
      barcode_level: inheritedBarcodeLevel,
      length_in: primary.length_in || '',
      width_in: primary.width_in || '',
      height_in: primary.height_in || '',
      each_net_weight_g: '',
      package_net_weight_g: primary.package_net_weight_g || '',
      gross_weight_lbs: primary.gross_weight_lbs || '',
      case_qty: level === 'Each' ? '1' : '',
      inner_packs_per_case: '',
      default_copies: '',
      verification_status: 'DRAFT',
      source_note: '',
      label_enabled: false,
      is_active: true,
    });
    if (previousOutermost) {
      ['length_in', 'width_in', 'height_in', 'package_net_weight_g', 'gross_weight_lbs'].forEach(key => {
        mplProductMasterRows[previousOutermost.index][key] = '';
      });
    }
    mplProductMasterRows.push(newRow);
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    renderMplProductEditor();
    setStatus(`${level} added to ${primary.config_id || primary.sku || 'the configuration'}.`, 'success');
  }

  function deleteMplProductRow(index) {
    if (!hasPermission('table_crud')) return;
    const current = mplProductMasterRows[index];
    if (!current) return;
    if (normalizePackagingLevel(current.packaging_level) === 'Each') {
      setStatus('Each is required as the shared base product and cannot be removed.', 'error');
      return;
    }
    const groupKey = mplProductGroupKey(current, index);
    const entries = mplProductEntriesForGroup(groupKey);
    const removedDisplayUom = normalizePackagingLevel(current.packaging_level) === normalizePackagingLevel(entries[0]?.row?.display_sku_uom || 'Each');
    const outermost = mplProductOutermostEntry(entries);
    const finalFields = ['length_in', 'width_in', 'height_in', 'package_net_weight_g', 'gross_weight_lbs'];
    const finalValues = outermost?.index === index
      ? Object.fromEntries(finalFields.map(key => [key, current[key] || '']))
      : null;
    mplProductMasterRows.splice(index, 1);
    if (finalValues) {
      const remainingEntries = mplProductEntriesForGroup(groupKey);
      const nextOutermost = mplProductOutermostEntry(remainingEntries);
      if (nextOutermost) Object.assign(mplProductMasterRows[nextOutermost.index], finalValues);
    }
    if (removedDisplayUom) {
      mplProductEntriesForGroup(groupKey).forEach(entry => { mplProductMasterRows[entry.index].display_sku_uom = 'Each'; });
    }
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    renderMplProductEditor();
  }

  function updateMplProductRow(index, key, value) {
    if (!hasPermission('table_crud')) return;
    if (!mplProductMasterRows[index]) mplProductMasterRows[index] = normalizeProductRow({ storefront: 'KeHE' });
    if (key === 'packaging_level') {
      const nextLevel = normalizePackagingLevel(value);
      mplProductMasterRows[index][key] = nextLevel;
      mplProductMasterRows[index].in_packing_list = isCasePackagingLevel(nextLevel) && mplProductMasterRows[index].is_active !== false;
      if (!String(mplProductMasterRows[index].case_qty || '').trim()) {
        mplProductMasterRows[index].case_qty = defaultCaseQtyForLevel(nextLevel);
      }
    } else if (key === 'default_copies') {
      mplProductMasterRows[index][key] = normalizeDefaultCopies(value, mplProductMasterRows[index].packaging_level);
    } else if (key === 'case_qty') {
      mplProductMasterRows[index][key] = normalizeCaseQty(value, mplProductMasterRows[index].packaging_level);
    } else if (key === 'storefront') {
      mplProductMasterRows[index][key] = normalizeStorefront(value);
    } else if (key === 'label_enabled' || key === 'is_active') {
      mplProductMasterRows[index][key] = !!value;
    } else if (['length_in', 'width_in', 'height_in', 'each_net_weight_g', 'package_net_weight_g', 'gross_weight_lbs'].includes(key)) {
      const normalizedValue = formatNumberString(parsePositiveNumber(value));
      mplProductMasterRows[index][key] = normalizedValue;
      const length = parsePositiveNumber(mplProductMasterRows[index].length_in);
      const width = parsePositiveNumber(mplProductMasterRows[index].width_in);
      const height = parsePositiveNumber(mplProductMasterRows[index].height_in);
      if (length && width && height) {
        mplProductMasterRows[index].dimensions_display = `${formatNumberString(length)} x ${formatNumberString(width)} x ${formatNumberString(height)}`;
      }
    } else {
      mplProductMasterRows[index][key] = value;
    }
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    if (key === 'packaging_level' || key === 'is_active') {
      renderMplProductMasterTable();
      renderMplProductEditor();
    }
  }

  function renderKeheProductMasterTable() {
    const body = document.getElementById('kehe-product-master-body');
    if (!body) return;
    const allRows = keheProductMasterRows
      .map((raw, index) => ({ row: normalizeProductRow(raw), index }))
      .filter(entry => isKeheStorefront(entry.row.storefront));
    syncTableFilterOptions('kehe-product-level-filter', allRows.map(entry => entry.row.packaging_level), 'All levels');
    const search = String(document.getElementById('kehe-product-search')?.value || '').trim().toLowerCase();
    const level = String(document.getElementById('kehe-product-level-filter')?.value || '').trim().toLowerCase();
    const status = String(document.getElementById('kehe-product-status-filter')?.value || '').trim();
    const rows = allRows.filter(({ row }) => {
      const printable = canPrintProductMasterLabel(row);
      const haystack = [row.storefront, row.gtin, row.description, row.packaging_level, row.dimensions_display, row.sku, row.config_id].join(' ').toLowerCase();
      return (!search || haystack.includes(search))
        && (!level || String(row.packaging_level || '').trim().toLowerCase() === level)
        && (!status || (status === 'ready' ? printable : !printable));
    });
    const countEl = document.getElementById('kehe-product-filter-count');
    if (countEl) countEl.textContent = `${rows.length} of ${allRows.length} rows`;
    if (!allRows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="11">No KeHE rows yet. Add Storefront = KeHE rows from Packing List & Ti-Hi.</td></tr>';
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="11">No KeHE products match these filters.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(({ row, index }) => {
      const printable = canPrintProductMasterLabel(row);
      const disabledReason = !isPackLabelLevel(row) ? 'Only Case/MP and Inner Pack/IP labels can be printed here.' : 'GTIN is required.';
      return `
      <tr>
        <td>${escapeHtml(row.storefront || '—')}</td>
        <td>${escapeHtml(row.gtin || '—')}</td>
        <td>${escapeHtml(row.description || '—')}</td>
        <td>${escapeHtml(row.packaging_level || '—')}</td>
        <td>${escapeHtml(row.dimensions_display || '—')}</td>
        <td>${escapeHtml(row.gross_weight_lbs || '—')}</td>
        <td>${escapeHtml(row.case_qty || '—')}</td>
        <td class="mpl-product-pack-breakdown">${escapeHtml(mplProductPackageBreakdown(row, rows))}</td>
        <td>${escapeHtml(row.default_copies || '—')}</td>
        <td>${escapeHtml(row.sku || '—')}</td>
        <td><button class="btn-table-preview" type="button" ${printable ? '' : 'disabled'} title="${escapeHtml(printable ? 'Open editable pack-label preview.' : disabledReason)}" onclick="openManualProductPackLabel(${index})">Preview</button></td>
      </tr>`;
    }).join('');
  }

  function normalizeManualCopies(value) {
    const parsed = parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.max(2, parsed) : 2;
  }

  function openManualProductPackLabelFromRow(rawRow, productRows, closeModal) {
    const row = normalizeProductRow(rawRow || {});
    if (!canPrintProductMasterLabel(row)) {
      alert('Only Case/MP and Inner Pack/IP rows with a GTIN can be printed from this table.');
      return;
    }

    const defaultCopies = normalizeManualCopies(normalizeDefaultCopies(row.default_copies || defaultCopiesForLevel(row.packaging_level) || '2', row.packaging_level));
    const caseQty = normalizeCaseQty(row.case_qty || defaultCaseQtyForLevel(row.packaging_level), row.packaging_level);
    const prefix = packLevelPrefix(row.packaging_level);

    if (typeof closeModal === 'function') closeModal();
    activeKeheDocumentType = 'packLabels';
    activeKeheDocumentDraft = {
      document_type: 'kehe_pack_labels',
      version: 2,
      table_preview: true,
      summary: { labels: 1, selected_labels: 1, manual_labels: 1 },
      warnings: [],
      product_master: productRows,
      extracted_headers: [],
      extracted_items: [],
      pack_labels: [{
        id: `MANUAL-${prefix}-1`,
        status: 'Ready',
        print_selected: true,
        matched_in_xml: false,
        manual_label: true,
        gtin: row.gtin,
        description: row.description,
        brand: '',
        packaging_level: row.packaging_level,
        pack_prefix: prefix,
        length_in: row.length_in,
        width_in: row.width_in,
        height_in: row.height_in,
        dimensions_in: row.dimensions_display,
        gross_weight_lbs: row.gross_weight_lbs,
        case_qty: String(caseQty),
        default_copies: defaultCopies,
        sku: row.sku,
        lot: '',
        best_before: '',
        copies: defaultCopies,
        warnings: []
      }]
    };
    renderDocumentEditor('packLabels', activeKeheDocumentDraft);
    openDocumentEditor();
    setStatus('Pack Label preview ready. Minimum 2 copies are printed for two-side case placement.', 'info');
  }

  function openManualProductPackLabel(index) {
    openManualProductPackLabelFromRow(
      keheProductMasterRows[index],
      getKeheProductMasterRows(),
      () => closeKeheProductMasterModal(false)
    );
  }

  function openManualMplProductPackLabel(index) {
    openManualProductPackLabelFromRow(
      mplProductMasterRows[index],
      getAllMplProductMasterRows(),
      () => closeMplProductMasterModal(false)
    );
  }

  function showKeheDcDirectoryView() {
    renderKeheDcDirectoryTable();
    document.getElementById('kehe-dc-directory-modal').classList.add('visible');
  }

  function openKeheDcDirectoryModal() {
    navigateToRoute('kehe/dc-directory');
  }

  function hideKeheDcDirectoryView() {
    document.getElementById('kehe-dc-directory-modal').classList.remove('visible');
  }

  function closeKeheDcDirectoryModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView('kehe');
    } else {
      hideKeheDcDirectoryView();
    }
  }

  function hideSavedMplView() {
    document.getElementById('saved-mpl-modal').classList.remove('visible');
  }

  function closeSavedMplModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView('mpl');
    } else {
      hideSavedMplView();
    }
  }

  function showExcelImportView() {
    if (!activeExcelImportPreview) return;
    renderExcelImportPreview();
    document.getElementById('excel-import-modal').classList.add('visible');
  }

  function hideExcelImportView(options = {}) {
    if (options.clearPreview !== false) {
      activeExcelImportPreview = null;
    }
    document.getElementById('excel-import-modal').classList.remove('visible');
  }

  function closeExcelImportModal(useHistory = true) {
    if (useHistory) {
      activeExcelImportPreview = null;
      closeCurrentRouteView('mpl');
      return;
    }
    hideExcelImportView();
  }

  function hideKeheAuditView() {
    document.getElementById('audit-history-modal').classList.remove('visible');
  }

  function closeKeheAuditModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView(getCurrentPage());
    } else {
      hideKeheAuditView();
    }
  }

  function parseDcMatchValues(value) {
    if (Array.isArray(value)) {
      return value.map(v => String(v || '').trim()).filter(Boolean);
    }

    const raw = String(value || '').trim();
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v || '').trim()).filter(Boolean);
      }
    } catch (_err) {}

    return raw.split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
  }

  const DIRECTORY_ADDRESS_ROLES = ['SHIP_FROM', 'SHIP_TO', 'BILL_TO'];

  function normalizeDirectoryRoles(value, fallback = '') {
    const values = Array.isArray(value) ? value : String(value || '').split(/[,;|]+/);
    const selected = new Set(values.map(item => String(item || '').trim().toUpperCase().replace(/\s+/g, '_')));
    const fallbackType = normalizeB2BDirectoryRecordType(fallback);
    if (!DIRECTORY_ADDRESS_ROLES.some(role => selected.has(role)) && DIRECTORY_ADDRESS_ROLES.includes(fallbackType)) {
      selected.add(fallbackType);
    }
    return DIRECTORY_ADDRESS_ROLES.filter(role => selected.has(role));
  }

  function directoryHasRole(row, role) {
    const wanted = String(role || '').trim().toUpperCase();
    const roles = normalizeDirectoryRoles(
      row?.address_roles ?? row?.ADDRESS_ROLES ?? row?.record_type ?? row?.RECORD_TYPE,
      row?.address_type ?? row?.ADDRESS_TYPE
    );
    return roles.includes(wanted);
  }

  function directoryRoleLabel(roles = []) {
    const labels = { SHIP_FROM: 'Ship From', SHIP_TO: 'Ship To', BILL_TO: 'Bill To' };
    return normalizeDirectoryRoles(roles).map(role => labels[role]).filter(Boolean).join(' + ') || 'Address';
  }

  function normalizeDcDirectoryRow(row = {}) {
    const rawRecordType = row.record_type ?? row.RECORD_TYPE ?? row.address_type ?? row.ADDRESS_TYPE;
    const legacyRecordType = normalizeB2BDirectoryRecordType(rawRecordType);
    const addressRoles = normalizeDirectoryRoles(row.address_roles ?? row.ADDRESS_ROLES ?? rawRecordType, legacyRecordType);
    const recordType = addressRoles.length ? addressRoles.join(',') : legacyRecordType;
    let shipFrom = String(row.ship_from ?? row.SHIP_FROM ?? row['SHIP FROM'] ?? '').trim();
    let deliveryAddress = String(row.delivery_address ?? row.DELIVERY_ADDRESS ?? '').trim();
    let billingAddress = String(row.billing_address ?? row.BILLING_ADDRESS ?? '').trim();
    let address = String(row.address ?? row.ADDRESS ?? '').trim();
    if (!address) {
      if (addressRoles.includes('SHIP_FROM')) address = shipFrom;
      else if (addressRoles.includes('BILL_TO')) address = billingAddress;
      else address = deliveryAddress;
    }
    if (addressRoles.length) {
      shipFrom = addressRoles.includes('SHIP_FROM') ? address : '';
      deliveryAddress = addressRoles.includes('SHIP_TO') ? address : '';
      billingAddress = addressRoles.includes('BILL_TO') ? address : '';
    } else {
      shipFrom ||= DEFAULT_KEHE_SHIP_FROM;
    }
    return {
      storefront: normalizeStorefront(row.storefront ?? row.STOREFRONT ?? row['Storefront']),
      dc: String(row.dc ?? row.DC ?? '').trim(),
      name: String(row.name ?? row.NAME ?? '').trim(),
      ship_from: shipFrom,
      delivery_address: deliveryAddress,
      billing_address: billingAddress,
      address_type: addressRoles[0] || legacyRecordType,
      address_roles: addressRoles,
      address,
      match_values: parseDcMatchValues(row.match_values ?? row.MATCH_VALUES ?? []),
      record_type: recordType,
      default_label_template_id: String(row.default_label_template_id ?? row.DEFAULT_LABEL_TEMPLATE_ID ?? '').trim(),
      manufacturer_name: String(row.manufacturer_name ?? row.MANUFACTURER_NAME ?? '').trim(),
      manufacturer_address: String(row.manufacturer_address ?? row.MANUFACTURER_ADDRESS ?? '').trim(),
      receiving_email: String(row.receiving_email ?? row.RECEIVING_EMAIL ?? '').trim(),
      docking_instructions: String(row.docking_instructions ?? row.DOCKING_INSTRUCTIONS ?? '').trim(),
      verification_status: normalizeB2BVerificationStatus(row.verification_status ?? row.VERIFICATION_STATUS),
      source_note: String(row.source_note ?? row.SOURCE_NOTE ?? '').trim(),
      is_active: parseBooleanLike(row.is_active ?? row.IS_ACTIVE, true),
    };
  }

  function expandLegacyMplDirectoryRows(rawRows = []) {
    const expanded = [];
    rawRows.map(normalizeDcDirectoryRow).forEach(row => {
      if (row.address_roles.length) {
        expanded.push(row);
        return;
      }
      const common = { ...row, ship_from: '', delivery_address: '', billing_address: '', address: '' };
      if (row.delivery_address) expanded.push(normalizeDcDirectoryRow({ ...common, record_type: 'SHIP_TO', address_type: 'SHIP_TO', address: row.delivery_address }));
      if (row.billing_address) expanded.push(normalizeDcDirectoryRow({ ...common, record_type: 'BILL_TO', address_type: 'BILL_TO', address: row.billing_address }));
      const origin = String(row.ship_from || '').trim();
      if (origin && origin !== DEFAULT_KEHE_SHIP_FROM) expanded.push(normalizeDcDirectoryRow({ ...common, record_type: 'SHIP_FROM', address_type: 'SHIP_FROM', address: origin }));
      if (!row.delivery_address && !row.billing_address && !origin) expanded.push(normalizeDcDirectoryRow({ ...common, record_type: 'SHIP_TO', address_type: 'SHIP_TO' }));
    });
    return expanded;
  }

  function mplDirectoryBundles(rows = mplDirectoryRows) {
    const bundles = new Map();
    rows.map(normalizeDcDirectoryRow).forEach((row, index) => {
      const key = [row.storefront, row.dc, row.name].map(value => String(value || '').trim().toLowerCase()).join('|') || `row-${index}`;
      if (!bundles.has(key)) bundles.set(key, { ...row, ship_from: '', delivery_address: '', billing_address: '', _source_rows: [] });
      const bundle = bundles.get(key);
      bundle._source_rows.push(index);
      if (row.address_roles.length) {
        if (directoryHasRole(row, 'SHIP_FROM')) bundle.ship_from ||= row.address;
        if (directoryHasRole(row, 'SHIP_TO')) bundle.delivery_address ||= row.address;
        if (directoryHasRole(row, 'BILL_TO')) bundle.billing_address ||= row.address;
      } else {
        bundle.ship_from ||= row.ship_from;
        bundle.delivery_address ||= row.delivery_address;
        bundle.billing_address ||= row.billing_address;
      }
    });
    return [...bundles.values()].map(bundle => ({
      ...bundle,
      ship_from: bundle.ship_from || getSharedMplDirectoryShipFrom(),
      address: '',
      address_roles: [],
      address_type: 'DISTRIBUTION_CENTER',
      record_type: 'DISTRIBUTION_CENTER',
    }));
  }

  function getKeheDcDirectoryRows() {
    return mplDirectoryBundles(keheDcDirectoryRows)
      .map(normalizeDcDirectoryRow)
      .filter(row => isKeheStorefront(row.storefront))
      .filter(row => row.dc || row.name || row.delivery_address || row.billing_address || row.match_values.length);
  }

  function getMplDirectoryRows() {
    return mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.dc || row.name || row.address || row.default_label_template_id || row.receiving_email || row.manufacturer_name || row.source_note);
  }

  function getActiveDcDirectoryRows() {
    return isStandaloneMplReferenceMode() ? mplDirectoryBundles(getMplDirectoryRows()) : getKeheDcDirectoryRows();
  }

  function getSavedMplShipFromAddresses() {
    const sharedOrigin = getSharedMplDirectoryShipFrom();
    const savedOrigins = mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.is_active !== false)
      .filter(row => directoryHasRole(row, 'SHIP_FROM'))
      .map(row => String(row.address || row.ship_from || '').trim());
    return uniqueTextValues([sharedOrigin, ...savedOrigins]);
  }

  function loadMplDirectoryFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(MPL_DIRECTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return expandLegacyMplDirectoryRows(parsed);
    } catch (_err) {
      return [];
    }
  }

  function saveMplDirectoryToStorage() {
    if (!allowBrowserLocalCache()) return;
    try {
      localStorage.setItem(MPL_DIRECTORY_STORAGE_KEY, JSON.stringify(getMplDirectoryRows()));
    } catch (_err) {}
  }

  async function loadMplDirectoryFromBackend() {
    const localRows = allowLocalFallback() ? loadMplDirectoryFromStorage() : [];
    try {
      const res = await fetchWithTimeout('/api/mpl/directory', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load MPL directory.');
      const backendRows = Array.isArray(payload.rows) ? expandLegacyMplDirectoryRows(payload.rows) : [];
      if (backendRows.length) {
        mplDirectoryRows = backendRows;
        saveMplDirectoryToStorage();
      } else if (allowLocalFallback() && localRows.length) {
        mplDirectoryRows = localRows;
        await saveMplDirectoryToBackend();
      } else {
        mplDirectoryRows = [];
      }
      renderMplDirectoryTable();
      return payload;
    } catch (_err) {
      mplDirectoryRows = allowLocalFallback() ? localRows : [];
      renderMplDirectoryTable();
      return { rows: mplDirectoryRows, source: allowLocalFallback() ? 'localStorage' : 'unavailable' };
    }
  }

  function saveMplDirectoryToBackendDebounced() {
    clearTimeout(mplDirectorySaveTimer);
    mplDirectorySaveTimer = setTimeout(saveMplDirectoryToBackend, 500);
  }

  async function saveMplDirectoryToBackend() {
    if (!hasPermission('table_crud')) return;
    const rows = getMplDirectoryRows();
    try {
      const res = await fetch('/api/mpl/directory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not save Directory.');
      if (Array.isArray(payload.rows)) {
        const savedRows = payload.rows.map(normalizeDcDirectoryRow);
        const wasMerged = savedRows.length < rows.length;
        if (wasMerged) {
          mplDirectoryRows = savedRows;
          saveMplDirectoryToStorage();
          renderMplDirectoryTable();
          setStatus('Directory duplicate key merged. Unique key is Storefront + Code.', 'info');
        } else {
          saveMplDirectoryToStorage();
        }
      } else {
        saveMplDirectoryToStorage();
      }
    } catch (_err) {
      // Browser cache remains available if backend persistence is temporarily unavailable.
      saveMplDirectoryToStorage();
    }
  }

  function showMplDirectoryView() {
    renderMplDirectoryTable();
    document.getElementById('mpl-directory-modal').classList.add('visible');
  }

  function openMplDirectoryModal() {
    navigateToRoute('mpl/directory');
  }

  function hideMplDirectoryView() {
    document.getElementById('mpl-directory-modal').classList.remove('visible');
  }

  function closeMplDirectoryModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView(getCurrentPage());
    } else {
      hideMplDirectoryView();
    }
  }

  function getSharedMplDirectoryShipFrom() {
    const savedOrigins = mplDirectoryRows
      .map(row => String(row?.ship_from ?? row?.SHIP_FROM ?? row?.['SHIP FROM'] ?? '').trim())
      .filter(Boolean);
    if (!savedOrigins.length) return mplDirectorySharedShipFrom || DEFAULT_KEHE_SHIP_FROM;

    const counts = new Map();
    savedOrigins.forEach(origin => counts.set(origin, (counts.get(origin) || 0) + 1));
    const currentOrigin = String(mplDirectorySharedShipFrom || '').trim();
    const savedOrigin = [...counts.entries()]
      .sort((left, right) => {
        const countDifference = right[1] - left[1];
        if (countDifference) return countDifference;
        if (left[0] === currentOrigin) return -1;
        if (right[0] === currentOrigin) return 1;
        return 0;
      })[0]?.[0];
    if (savedOrigin) mplDirectorySharedShipFrom = savedOrigin;
    return mplDirectorySharedShipFrom || DEFAULT_KEHE_SHIP_FROM;
  }

  function renderSharedDirectoryOrigin() {
    const origin = getSharedMplDirectoryShipFrom();
    const lines = origin.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const name = document.getElementById('directory-shared-origin-name');
    const address = document.getElementById('directory-shared-origin-address');
    const editor = document.getElementById('directory-shared-origin-editor');
    const input = document.getElementById('directory-shared-origin-input');
    const editButton = document.getElementById('btn-edit-directory-origin');
    if (name) name.textContent = lines[0] || 'Ship From';
    if (address) address.textContent = lines.slice(1).join(', ') || 'Address not set';
    if (input && editor?.classList.contains('hidden')) input.value = origin;
    if (editButton) {
      const canEdit = hasPermission('table_crud');
      editButton.classList.toggle('hidden', !canEdit);
      editButton.disabled = !canEdit;
    }
  }

  function toggleSharedDirectoryOriginEditor() {
    if (!hasPermission('table_crud')) return;
    const editor = document.getElementById('directory-shared-origin-editor');
    const input = document.getElementById('directory-shared-origin-input');
    if (!editor || !input) return;
    const opening = editor.classList.contains('hidden');
    editor.classList.toggle('hidden', !opening);
    if (opening) {
      input.value = getSharedMplDirectoryShipFrom();
      window.requestAnimationFrame(() => input.focus());
    }
  }

  function cancelSharedDirectoryOriginEdit() {
    document.getElementById('directory-shared-origin-editor')?.classList.add('hidden');
    renderSharedDirectoryOrigin();
  }

  function saveSharedDirectoryOrigin() {
    if (!hasPermission('table_crud')) return;
    const input = document.getElementById('directory-shared-origin-input');
    const origin = String(input?.value || '').trim();
    if (!origin) {
      setStatus('Enter a Ship From address before applying it.', 'error');
      input?.focus();
      return;
    }
    mplDirectorySharedShipFrom = origin;
    const defaultOriginIndex = mplDirectoryRows.findIndex(row => (
      directoryHasRole(normalizeDcDirectoryRow(row), 'SHIP_FROM')
      && String(row.name || '').trim().toLowerCase() === 'default ship from'
    ));
    const originRow = normalizeDcDirectoryRow({
      storefront: 'Bakell',
      dc: 'DEFAULT-SHIP-FROM',
      name: 'Default Ship From',
      address_type: 'SHIP_FROM',
      record_type: 'SHIP_FROM',
      address: origin,
      verification_status: 'VERIFIED',
      is_active: true,
    });
    if (defaultOriginIndex >= 0) mplDirectoryRows[defaultOriginIndex] = originRow;
    else mplDirectoryRows.unshift(originRow);
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    document.getElementById('directory-shared-origin-editor')?.classList.add('hidden');
    renderSharedDirectoryOrigin();
    setStatus('Default Ship From updated. Other saved origins were preserved.', 'success');
  }

  function openMplDirectoryEditor(index, mode = 'view') {
    if (!Number.isInteger(index) || !mplDirectoryRows[index]) return;
    mplDirectoryEditorIndex = index;
    mplDirectoryEditorMode = mode === 'edit' && hasPermission('table_crud') ? 'edit' : 'view';
    renderMplDirectoryEditor();
    document.getElementById('mpl-directory-editor-modal')?.classList.add('visible');
  }

  function closeMplDirectoryEditor() {
    if (mplDirectoryEditorIsNew && mplDirectoryEditorIndex >= 0) {
      const row = normalizeDcDirectoryRow(mplDirectoryRows[mplDirectoryEditorIndex] || {});
      if (!row.address && !row.name) mplDirectoryRows.splice(mplDirectoryEditorIndex, 1);
    }
    document.getElementById('mpl-directory-editor-modal')?.classList.remove('visible');
    mplDirectoryEditorIndex = -1;
    mplDirectoryEditorMode = 'view';
    mplDirectoryEditorIsNew = false;
    saveMplDirectoryToStorage();
    renderMplDirectoryTable();
  }

  function editMplDirectoryRecord() {
    if (!hasPermission('table_crud') || mplDirectoryEditorIndex < 0) return;
    mplDirectoryEditorMode = 'edit';
    renderMplDirectoryEditor();
  }

  function viewMplDirectoryRecord() {
    if (mplDirectoryEditorIndex < 0) return;
    mplDirectoryEditorMode = 'view';
    mplDirectoryEditorIsNew = false;
    renderMplDirectoryEditor();
  }

  function directoryRecordInitials(row) {
    const words = String(row.name || row.storefront || 'Address').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'AD';
  }

  function renderMplDirectoryRecordView(row, index, canEdit, isDefaultOrigin) {
    const roleBadges = row.address_roles.map(role => `<span class="directory-record-role">${escapeHtml(directoryRoleLabel([role]))}</span>`).join('');
    const operationalDetails = [
      ['Default label template', row.default_label_template_id],
      ['Receiving email', row.receiving_email],
      ['Manufacturer', row.manufacturer_name],
      ['Manufacturer address', row.manufacturer_address],
      ['Docking instructions', row.docking_instructions],
      ['Source note', row.source_note],
    ].filter(([, value]) => String(value || '').trim());
    const footer = document.getElementById('mpl-directory-editor-footer');
    if (footer) footer.innerHTML = `
      <div class="directory-record-footer-actions">
        ${selectedKit === 'b2b' && directoryHasRole(row, 'SHIP_TO') ? `<button class="btn-secondary" type="button" onclick="useMplDirectoryForB2B(${index})">Use in Label Creator</button>` : ''}
        ${selectedKit !== 'b2b' && directoryHasRole(row, 'SHIP_TO') ? `<button class="btn-secondary" type="button" onclick="openManualMplDcPalletLabel(${index})">Preview label</button>` : ''}
        ${canEdit ? `<button class="btn-generate" type="button" onclick="editMplDirectoryRecord()">Edit address</button>` : ''}
      </div>`;
    return `<div class="directory-record-view">
      <section class="directory-record-hero">
        <span class="directory-record-avatar">${escapeHtml(directoryRecordInitials(row))}</span>
        <div class="directory-record-hero-copy">
          <span>${escapeHtml(row.storefront || 'No customer')}</span>
          <h2>${escapeHtml(row.name || 'Unnamed address')}</h2>
          <p>${escapeHtml(row.dc || 'No location code')}</p>
        </div>
        <span class="directory-record-status ${row.is_active ? 'is-active' : 'is-inactive'}">${row.is_active ? 'Active' : 'Inactive'}</span>
      </section>
      <section class="directory-record-address-card">
        <div class="directory-record-section-heading"><span>Saved address</span><strong>${row.address ? 'Ready to use' : 'Address missing'}</strong></div>
        <address>${displayMultiline(row.address || 'No address has been entered.')}</address>
        <div class="directory-record-role-list">${roleBadges || '<span class="directory-record-role is-empty">No roles selected</span>'}</div>
      </section>
      <section class="directory-record-facts">
        <div><span>Customer / Storefront</span><strong>${escapeHtml(row.storefront || '—')}</strong></div>
        <div><span>Location code</span><strong>${escapeHtml(row.dc || '—')}</strong></div>
        <div><span>Data status</span><strong>${escapeHtml(String(row.verification_status || 'DRAFT').replace(/_/g, ' '))}</strong></div>
        <div><span>Dropdown availability</span><strong>${row.is_active ? 'Available' : 'Hidden'}</strong></div>
      </section>
      ${row.match_values.length ? `<section class="directory-record-detail-card"><span>Matching values</span><div class="directory-record-token-list">${row.match_values.map(value => `<small>${escapeHtml(value)}</small>`).join('')}</div></section>` : ''}
      ${operationalDetails.length ? `<section class="directory-record-detail-card"><span>Operational details</span><dl>${operationalDetails.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${displayMultiline(value)}</dd></div>`).join('')}</dl></section>` : ''}
    </div>`;
  }

  function renderMplDirectoryEditor() {
    const body = document.getElementById('mpl-directory-editor-body');
    if (!body || mplDirectoryEditorIndex < 0 || !mplDirectoryRows[mplDirectoryEditorIndex]) return;
    const index = mplDirectoryEditorIndex;
    const row = normalizeDcDirectoryRow(mplDirectoryRows[index]);
    const canEdit = hasPermission('table_crud');
    const editDisabled = canEdit ? '' : 'disabled';
    const addressTypeLabel = directoryRoleLabel(row.address_roles);
    const isDefaultOrigin = directoryHasRole(row, 'SHIP_FROM') && String(row.dc || '').trim().toUpperCase() === 'DEFAULT-SHIP-FROM';
    const title = document.getElementById('mpl-directory-editor-title');
    const subtitle = document.getElementById('mpl-directory-editor-subtitle');
    const modal = document.getElementById('mpl-directory-editor-modal');
    modal?.classList.toggle('is-view-mode', mplDirectoryEditorMode === 'view');
    modal?.classList.toggle('is-edit-mode', mplDirectoryEditorMode === 'edit');
    if (title) title.textContent = mplDirectoryEditorMode === 'view' ? (row.name || row.storefront || 'Address record') : (mplDirectoryEditorIsNew ? 'Add address' : `Edit ${row.name || 'address'}`);
    if (subtitle) subtitle.textContent = mplDirectoryEditorMode === 'view'
      ? `${addressTypeLabel} · ${row.storefront || 'Customer directory'}`
      : 'Update the address once and choose every dropdown where it should appear.';
    if (mplDirectoryEditorMode === 'view') {
      body.innerHTML = renderMplDirectoryRecordView(row, index, canEdit, isDefaultOrigin);
      applyPermissionUi();
      return;
    }
    const footer = document.getElementById('mpl-directory-editor-footer');
    if (footer) footer.innerHTML = `
      ${canEdit && !isDefaultOrigin ? `<button class="btn-mini-danger" type="button" onclick="deleteMplDirectoryRow(${index})">Delete address</button>` : '<span></span>'}
      <div class="directory-record-footer-actions">
        <button class="btn-secondary" type="button" onclick="closeMplDirectoryEditor()">Close</button>
        <button class="btn-generate" type="button" onclick="viewMplDirectoryRecord()">Done editing</button>
      </div>`;
    body.innerHTML = `<div class="master-record-form-stack">
      <section class="master-address-card">
        <div class="master-address-editor-heading">
          <div><span>Address identity</span><strong>${escapeHtml(row.name || 'New reusable address')}</strong></div>
          <span class="directory-autosave-badge">Auto-save on</span>
        </div>
        <div class="mpl-unified-fields-grid directory-identity-grid">
          <label>Customer / Storefront <select ${editDisabled} onchange="updateMplDirectoryRow(${index}, 'storefront', this.value)">${selectOptionsHtml(b2bCustomerOptions(row.storefront), row.storefront, 'Select customer')}</select></label>
          <label>Code <input ${editDisabled} value="${escapeHtml(row.dc)}" placeholder="Location or account code" oninput="updateMplDirectoryRow(${index}, 'dc', this.value)"></label>
          <label>Name <input ${editDisabled} value="${escapeHtml(row.name)}" placeholder="Warehouse, customer, or store" oninput="updateMplDirectoryRow(${index}, 'name', this.value)"></label>
          <fieldset class="directory-role-control"><legend>Use this address for</legend><div>
            ${DIRECTORY_ADDRESS_ROLES.map(role => `<label><input ${editDisabled} type="checkbox" ${row.address_roles.includes(role) ? 'checked' : ''} onchange="updateMplDirectoryRole(${index}, '${role}', this.checked)"><span>${escapeHtml(directoryRoleLabel([role]))}</span></label>`).join('')}
          </div><small>Check every document dropdown where this address should appear.</small></fieldset>
          <label>Data Status <select ${editDisabled} onchange="updateMplDirectoryRow(${index}, 'verification_status', this.value)">${selectOptionsHtml(B2B_VERIFICATION_STATUSES, row.verification_status, 'Select status')}</select></label>
          <label class="directory-active-control"><span><strong>Active address</strong><small>Available in document selectors</small></span><input ${editDisabled} type="checkbox" ${row.is_active ? 'checked' : ''} onchange="updateMplDirectoryRow(${index}, 'is_active', this.checked)"></label>
        </div>
      </section>
      <section class="directory-destination-workbench master-address-workbench">
        <div class="directory-address-heading"><div><span>${escapeHtml(addressTypeLabel)} address</span><strong>Save this address once and reuse it wherever this role is requested.</strong></div><span class="directory-completeness-badge ${row.address ? 'complete' : ''}">${row.address ? 'Complete' : 'Missing address'}</span></div>
        <label class="directory-address-field"><span>${escapeHtml(addressTypeLabel)} Address <small>Used by labels and packing lists</small></span><textarea rows="6" ${editDisabled} placeholder="Company or location&#10;Street address&#10;City, State ZIP&#10;Country" oninput="updateMplDirectoryRow(${index}, 'address', this.value)">${escapeHtml(row.address || '')}</textarea></label>
        ${directoryHasRole(row, 'SHIP_TO') && !directoryHasRole(row, 'BILL_TO') && canEdit ? `<button class="directory-copy-address" type="button" onclick="copyMplDirectoryAddress(${index}, 'delivery_address', 'billing_address')">Same as Ship To · Also use for Bill To</button>` : ''}
        <label class="directory-match-values">Matching values <small>Optional GLN, city, ZIP, address fragment, or customer reference—one per line.</small><textarea rows="3" ${editDisabled} placeholder="Example: 0569813430045&#10;Ontario&#10;91761" oninput="updateMplDirectoryRow(${index}, 'match_values', this.value)">${escapeHtml(row.match_values.join('\n'))}</textarea></label>
      </section>
      <details class="directory-optional-details" ${row.default_label_template_id || row.receiving_email || row.manufacturer_name || row.manufacturer_address || row.docking_instructions || row.source_note ? 'open' : ''}>
        <summary><span><strong>Label, receiving, and notes</strong><small>Optional operational defaults</small></span><span>Show details</span></summary>
        <div class="mpl-unified-fields-grid">
          <label>Default Template <select ${editDisabled} onchange="updateMplDirectoryRow(${index}, 'default_label_template_id', this.value)">${selectOptionsHtml(b2bTemplateIdOptions(row.default_label_template_id), row.default_label_template_id, 'No default template')}</select></label>
          <label>Receiving Email <input ${editDisabled} value="${escapeHtml(row.receiving_email || '')}" oninput="updateMplDirectoryRow(${index}, 'receiving_email', this.value)"></label>
          <label>Manufacturer Name <input ${editDisabled} value="${escapeHtml(row.manufacturer_name || '')}" oninput="updateMplDirectoryRow(${index}, 'manufacturer_name', this.value)"></label>
          <label class="mpl-field-wide">Manufacturer Address <textarea rows="2" ${editDisabled} oninput="updateMplDirectoryRow(${index}, 'manufacturer_address', this.value)">${escapeHtml(row.manufacturer_address || '')}</textarea></label>
          <label class="mpl-field-wide">Docking Instructions <textarea rows="2" ${editDisabled} oninput="updateMplDirectoryRow(${index}, 'docking_instructions', this.value)">${escapeHtml(row.docking_instructions || '')}</textarea></label>
          <label class="mpl-field-wide">Source Note <textarea rows="2" ${editDisabled} oninput="updateMplDirectoryRow(${index}, 'source_note', this.value)">${escapeHtml(row.source_note || '')}</textarea></label>
        </div>
      </details>
    </div>`;
    applyPermissionUi();
    enhanceSearchableSelects(body);
  }

  function renderMplDirectoryTable() {
    const body = document.getElementById('mpl-directory-body');
    if (!body) return;
    const rows = mplDirectoryRows.map(normalizeDcDirectoryRow);
    renderSharedDirectoryOrigin();
    syncTableFilterOptions('mpl-directory-storefront-filter', rows.map(row => row.storefront), 'All customers');
    const search = String(document.getElementById('mpl-directory-search')?.value || '').trim().toLowerCase();
    const storefront = String(document.getElementById('mpl-directory-storefront-filter')?.value || '').trim().toLowerCase();
    const addressType = String(document.getElementById('mpl-directory-type-filter')?.value || '').trim();
    const status = String(document.getElementById('mpl-directory-status-filter')?.value || '').trim().toLowerCase();
    const filtered = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const verification = String(row.verification_status || '').trim().toLowerCase();
        const statusMatches = !status
          || (status === 'active' && row.is_active !== false)
          || (status === 'inactive' && row.is_active === false)
          || (status === 'draft' && ['draft', 'needs_review', 'needs review', 'blocked'].includes(verification));
        return (!search || [
          row.storefront,
          row.dc,
          row.name,
          row.record_type,
          row.default_label_template_id,
          row.address,
          row.receiving_email,
          row.manufacturer_name,
          row.match_values,
        ].some(value => String(value || '').toLowerCase().includes(search)))
          && (!storefront || String(row.storefront || '').trim().toLowerCase() === storefront)
          && (!addressType || directoryHasRole(row, addressType))
          && statusMatches;
      });
    const countEl = document.getElementById('mpl-directory-count');
    if (countEl) countEl.textContent = `${filtered.length} of ${rows.length} records`;
    if (!filtered.length) {
      body.innerHTML = `<div class="empty-row">${rows.length ? 'No addresses match these filters.' : 'No addresses yet. Add one manually or import an address file.'}</div>`;
      return;
    }
    body.innerHTML = filtered.map(({ row, index }) => {
      const addressTypeLabel = directoryRoleLabel(row.address_roles);
      const addressSummary = row.address ? firstLine(row.address) : 'Address missing';
      return `
      <article class="mpl-directory-card mpl-directory-row" data-directory-row-index="${index}">
        <button class="mpl-directory-row-main" type="button" onclick="openMplDirectoryEditor(${index})">
          <span class="directory-card-title">${escapeHtml(row.name || row.storefront || 'Unnamed record')}<small>${escapeHtml(row.storefront || 'No customer')} · ${escapeHtml(row.dc || 'No code')}</small></span>
          <span class="directory-card-meta"><strong>${escapeHtml(addressTypeLabel)}</strong> · ${escapeHtml(addressSummary)}<small>One reusable address record</small></span>
          <span class="directory-card-status">${escapeHtml(row.verification_status || (row.is_active ? 'ACTIVE' : 'INACTIVE'))}</span>
          <span class="directory-card-toggle" aria-hidden="true">View</span>
        </button>
      </article>
    `;
    }).join('');
    applyPermissionUi();
    enhanceSearchableSelects(body);
  }

  function selectMplDirectoryCard(index, event) {
    event?.preventDefault();
    openMplDirectoryEditor(index);
  }

  function addMplDirectoryRow(seed = {}) {
    if (!hasPermission('table_crud')) return;
    const filteredStorefront = String(document.getElementById('mpl-directory-storefront-filter')?.value || '').trim();
    const newRow = normalizeDcDirectoryRow({
      storefront: filteredStorefront || (selectedKit === 'b2b' ? (b2bSelectedCustomer || 'New Customer') : 'KeHE'),
      dc: `DRAFT-${Date.now()}`,
      record_type: 'SHIP_TO',
      address_type: 'SHIP_TO',
      address: '',
      verification_status: 'DRAFT',
      is_active: true,
      ...seed,
    });
    mplDirectoryRows.push(newRow);
    const newIndex = mplDirectoryRows.length - 1;
    mplDirectoryEditorIsNew = true;
    renderMplDirectoryTable();
    openMplDirectoryEditor(newIndex, 'edit');
  }

  function copyMplDirectoryAddress(index, sourceField, targetField) {
    if (!hasPermission('table_crud') || sourceField !== 'delivery_address' || targetField !== 'billing_address') return;
    const source = normalizeDcDirectoryRow(mplDirectoryRows[index] || {});
    if (!source.address) return;
    updateMplDirectoryRole(index, 'BILL_TO', true);
    setStatus('This address will now appear in both Ship To and Bill To dropdowns.', 'success');
  }

  function saveMplDirectoryShipFromOverride(index) {
    if (!hasPermission('table_crud')) return;
    const input = document.querySelector(`#directory-origin-custom-${index} textarea`);
    const address = String(input?.value || '').trim();
    if (!address) return;
    addMplDirectoryRow({
      storefront: normalizeDcDirectoryRow(mplDirectoryRows[index] || {}).storefront,
      name: 'Saved origin',
      address_type: 'SHIP_FROM',
      record_type: 'SHIP_FROM',
      address,
      verification_status: 'DRAFT',
      is_active: true,
    });
  }

  async function useMplDirectoryForB2B(index) {
    const row = mplDirectoryRows[index];
    if (!row) return;
    b2bSelectedDirectoryIndex = index;
    b2bSelectedCustomer = normalizeStorefront(row.storefront);
    closeMplDirectoryEditor();
    closeMplDirectoryModal(false);
    await navigateToRoute('b2b', true);
  }

  function deleteMplDirectoryRow(index) {
    if (!hasPermission('table_crud')) return;
    mplDirectoryRows.splice(index, 1);
    const wasEditing = mplDirectoryEditorIndex === index;
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    if (wasEditing) closeMplDirectoryEditor();
    else renderMplDirectoryTable();
  }

  function updateMplDirectoryRow(index, key, value) {
    if (!hasPermission('table_crud')) return;
    if (!mplDirectoryRows[index]) {
      mplDirectoryRows[index] = normalizeDcDirectoryRow({ storefront: 'KeHE' });
    }
    if (key === 'address_type') {
      const type = DIRECTORY_ADDRESS_ROLES.includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : 'SHIP_TO';
      mplDirectoryRows[index].address_roles = [type];
      mplDirectoryRows[index].address_type = type;
      mplDirectoryRows[index].record_type = type;
    } else if (key === 'address') {
      const row = mplDirectoryRows[index];
      row.address = value;
      row.ship_from = directoryHasRole(row, 'SHIP_FROM') ? value : '';
      row.delivery_address = directoryHasRole(row, 'SHIP_TO') ? value : '';
      row.billing_address = directoryHasRole(row, 'BILL_TO') ? value : '';
    } else if (key === 'match_values') {
      mplDirectoryRows[index][key] = parseDcMatchValues(value);
    } else if (key === 'storefront') {
      mplDirectoryRows[index][key] = normalizeStorefront(value);
    } else if (key === 'is_active') {
      mplDirectoryRows[index][key] = !!value;
    } else {
      mplDirectoryRows[index][key] = value;
    }
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    if (key === 'address_type') renderMplDirectoryEditor();
  }

  function updateMplDirectoryRole(index, role, checked) {
    if (!hasPermission('table_crud') || !mplDirectoryRows[index]) return;
    const normalizedRole = String(role || '').trim().toUpperCase();
    if (!DIRECTORY_ADDRESS_ROLES.includes(normalizedRole)) return;
    const row = normalizeDcDirectoryRow(mplDirectoryRows[index]);
    const roles = new Set(row.address_roles);
    if (checked) roles.add(normalizedRole);
    else roles.delete(normalizedRole);
    if (!roles.size) {
      setStatus('Select at least one address role.', 'error');
      renderMplDirectoryEditor();
      return;
    }
    mplDirectoryRows[index] = normalizeDcDirectoryRow({ ...row, address_roles: [...roles], record_type: [...roles].join(',') });
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryEditor();
    renderMplDirectoryTable();
  }

  function loadKeheDcDirectoryFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(KEHE_DC_DIRECTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeDcDirectoryRow);
    } catch (_err) {
      return [];
    }
  }

  function saveKeheDcDirectoryToStorage() {
    if (!allowBrowserLocalCache()) return;
    try {
      localStorage.setItem(
        KEHE_DC_DIRECTORY_STORAGE_KEY,
        JSON.stringify(getKeheDcDirectoryRows())
      );
    } catch (_err) {}
  }

  async function loadKeheDcDirectoryFromBackend() {
    try {
      const res = await fetch('/api/kehe/dc-directory', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load DC directory.');

      if (Array.isArray(payload.rows)) {
        keheDcDirectoryRows = payload.rows.map(normalizeDcDirectoryRow);
        saveKeheDcDirectoryToStorage();
        renderKeheDcDirectoryTable();
      }

      return payload;
    } catch (_err) {
      keheDcDirectoryRows = allowLocalFallback() ? loadKeheDcDirectoryFromStorage() : [];
      renderKeheDcDirectoryTable();
      return { rows: keheDcDirectoryRows, source: allowLocalFallback() ? 'localStorage' : 'unavailable' };
    }
  }

  function renderKeheDcDirectoryTable() {
    const body = document.getElementById('kehe-dc-directory-body');
    if (!body) return;

    const allRows = keheDcDirectoryRows
      .map((raw, index) => ({ row: normalizeDcDirectoryRow(raw), index }))
      .filter(entry => isKeheStorefront(entry.row.storefront));
    const search = String(document.getElementById('kehe-directory-search')?.value || '').trim().toLowerCase();
    const status = String(document.getElementById('kehe-directory-status-filter')?.value || '').trim().toLowerCase();
    const rows = allRows.filter(({ row }) => {
      const haystack = [row.storefront, row.dc, row.name, row.ship_from, row.delivery_address, row.billing_address, row.match_values].join(' ').toLowerCase();
      return (!search || haystack.includes(search))
        && (!status || (status === 'active' ? row.is_active !== false : row.is_active === false));
    });
    const countEl = document.getElementById('kehe-directory-filter-count');
    if (countEl) countEl.textContent = `${rows.length} of ${allRows.length} records`;

    if (!allRows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="8">No KeHE directory rows yet. Add Storefront = KeHE rows from Packing List & Ti-Hi.</td></tr>';
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="8">No KeHE directory records match these filters.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(({ row, index }) => `
      <tr>
        <td>${escapeHtml(row.storefront || '—')}</td>
        <td>${escapeHtml(row.dc || '—')}</td>
        <td>${escapeHtml(row.name || '—')}</td>
        <td>${displayMultiline(row.ship_from)}</td>
        <td>${displayMultiline(row.delivery_address)}</td>
        <td>${displayMultiline(row.billing_address)}</td>
        <td>${displayMultiline(row.match_values)}</td>
        <td class="kehe-dc-print-cell">
          <button class="btn-table-preview" type="button" onclick="openManualDcPalletLabel(${index})">Preview</button>
        </td>
      </tr>
    `).join('');
  }

  function openManualDcPalletLabelFromRow(rawRow, closeModal) {
    const row = normalizeDcDirectoryRow(rawRow || {});
    const chosenAddress = row.delivery_address;
    const addressLabel = 'Delivery';

    activeKeheDocumentType = 'palletLabel';
    activeKeheDocumentDraft = {
      document_type: 'kehe_pallet_label',
      version: 2,
      table_preview: true,
      summary: { pallets: 1, manual_labels: 1 },
      warnings: [],
      extracted_headers: [],
      extracted_items: [],
      pallets: [{
        id: `${row.dc || 'DC'} ${addressLabel} Pallet Label`,
        status: chosenAddress ? 'Ready' : 'Needs Review',
        dc: row.dc || '',
        date: '',
        expected_delivery_date: '',
        ship_from: row.ship_from || DEFAULT_KEHE_SHIP_FROM,
        ship_to: chosenAddress || '',
        pallet_number: '1',
        total_pallets: '1',
        customer_po_numbers: '',
        carrier: '',
        bol_number: '',
        pro_number: '',
        copies: 2,
        address_type: addressLabel,
        warnings: chosenAddress ? [] : [`${addressLabel} address is blank. Enter Ship To before printing.`]
      }]
    };

    renderDocumentEditor('palletLabel', activeKeheDocumentDraft);
    openDocumentEditor();
    if (typeof closeModal === 'function') closeModal();
    setStatus('Pallet label preview ready. Edit fields and Copies before generating PDF.', 'info');
  }

  function openManualDcPalletLabel(index) {
    openManualDcPalletLabelFromRow(keheDcDirectoryRows[index], () => closeKeheDcDirectoryModal(false));
  }

  function openManualMplDcPalletLabel(index) {
    openManualDcPalletLabelFromRow(mplDirectoryRows[index], () => closeMplDirectoryModal(false));
  }
