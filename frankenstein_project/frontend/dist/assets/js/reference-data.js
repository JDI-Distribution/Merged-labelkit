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
    return !!row && isCasePackagingLevel(row.packaging_level) && !!row.in_packing_list;
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
    return mplProductMasterRows
      .map(normalizeProductRow)
      .filter(isProductInPackingList);
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

  async function loadMplProductMasterFromBackend() {
    const localRows = allowLocalFallback() ? loadMplProductMasterFromStorage() : [];
    try {
      const res = await fetchWithTimeout('/api/mpl/product-master', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load MPL product master.');
      const backendRows = Array.isArray(payload.rows) ? payload.rows.map(normalizeProductRow) : [];
      if (backendRows.length) {
        mplProductMasterRows = backendRows;
        saveMplProductMasterToStorage();
      } else if (allowLocalFallback() && localRows.length) {
        mplProductMasterRows = localRows;
        await saveMplProductMasterToBackend();
      } else {
        mplProductMasterRows = [];
      }
      renderMplProductMasterTable();
      return payload;
    } catch (_err) {
      mplProductMasterRows = allowLocalFallback() ? localRows : [];
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
      const wantedSku = String(row.sku || '').trim().toLowerCase();
      const wantedStorefront = normalizeStorefront(row.storefront).toLowerCase();
      const innerPackRow = normalizedGroupRows.find(candidate => (
        normalizePackagingLevel(candidate.packaging_level) === 'Inner Pack'
        && String(candidate.sku || '').trim().toLowerCase() === wantedSku
        && normalizeStorefront(candidate.storefront).toLowerCase() === wantedStorefront
      ));
      const innerPackQuantity = mplPositivePackageQuantity(innerPackRow?.case_qty);
      if (innerPackQuantity && innerPackQuantity > 1) {
        const innerPacksPerCase = packageQuantity / innerPackQuantity;
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

  function toggleMplProductGroup(button) {
    const groupKey = String(button?.dataset?.groupKey || '');
    if (!groupKey) return;
    if (mplExpandedProductGroups.has(groupKey)) {
      mplExpandedProductGroups.delete(groupKey);
    } else {
      mplExpandedProductGroups.add(groupKey);
    }
    renderMplProductMasterTable();
  }

  function refreshMplProductGrouping(index) {
    const row = mplProductMasterRows[index];
    if (!row) return;
    mplExpandedProductGroups.add(mplProductGroupKey(row, index));
    renderMplProductMasterTable();
  }

  function mplProductEntriesForGroup(groupKey) {
    return mplProductMasterRows
      .map((row, index) => ({ row: normalizeProductRow(row), index }))
      .filter(entry => mplProductGroupKey(entry.row, entry.index) === groupKey);
  }

  function updateMplProductGroupField(groupKey, key, value) {
    if (!hasPermission('table_crud')) return;
    const entries = mplProductEntriesForGroup(groupKey);
    if (!entries.length) return;
    let normalizedValue = value;
    if (key === 'storefront') normalizedValue = normalizeStorefront(value);
    if (key === 'verification_status') normalizedValue = normalizeB2BVerificationStatus(value);
    entries.forEach(({ index }) => { mplProductMasterRows[index][key] = normalizedValue; });
    const nextKey = mplProductGroupKey(mplProductMasterRows[entries[0].index], entries[0].index);
    mplExpandedProductGroups.delete(groupKey);
    mplExpandedProductGroups.add(nextKey);
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
  }

  function updateMplProductFinalField(groupKey, key, value) {
    if (!hasPermission('table_crud')) return;
    let entries = mplProductEntriesForGroup(groupKey);
    if (!entries.length) return;
    let caseEntry = entries.find(entry => entry.row.packaging_level === 'Case');
    if (!caseEntry && String(value || '').trim()) {
      const primary = entries[0].row;
      const caseRow = normalizeProductRow({
        ...primary,
        packaging_level: 'Case',
        gtin: '',
        barcode_level: 'CASE',
        length_in: '',
        width_in: '',
        height_in: '',
        package_net_weight_g: '',
        gross_weight_lbs: '',
        case_qty: '',
        default_copies: '',
        label_template_id: '',
        verification_status: primary.verification_status || 'DRAFT',
        source_note: '',
        label_enabled: false,
        is_active: true,
      });
      mplProductMasterRows.push(caseRow);
      caseEntry = { row: caseRow, index: mplProductMasterRows.length - 1 };
      setStatus(`Case packaging level added to ${primary.config_id || primary.sku || 'the configuration'}.`, 'success');
    }
    if (!caseEntry) return;
    mplProductMasterRows[caseEntry.index][key] = value;
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
  }

  function renderMplProductMasterTable() {
    const body = document.getElementById('mpl-product-master-body');
    if (!body) return;
    const canEdit = hasPermission('table_crud');
    const quality = window.LabelKitWorkflow?.productQualitySnapshot?.();
    const rows = mplProductMasterRows
      .map((raw, index) => ({ row: normalizeProductRow(raw), index }));
    if (!rows.length) {
      const countEl = document.getElementById('mpl-product-filter-count');
      if (countEl) countEl.textContent = '0 configurations';
      body.innerHTML = '<tr><td class="empty-row" colspan="2">No product rows yet. Add manually or upload data.</td></tr>';
      return;
    }
    const levelOptions = ['Case', 'Inner Pack', 'Each', 'Master Case', 'Pallet', 'Shipper Contents', 'Other'];
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

    const renderLevelCard = ({ row, index }, groupEntries) => {
      const printable = canPrintProductMasterLabel(row);
      const editDisabled = canEdit ? '' : 'disabled';
      const packagePlaceholder = row.packaging_level === 'Case'
        ? 'e.g. 36'
        : (row.packaging_level === 'Inner Pack' ? 'e.g. 6' : (row.packaging_level === 'Each' ? '1' : 'optional'));
      const quantityValue = row.packaging_level === 'Each' ? '1' : row.case_qty;
      return `<article class="mpl-packaging-level-card" data-product-row-index="${index}">
        <header class="mpl-packaging-level-header">
          <div><strong>${escapeHtml(row.packaging_level)}</strong><span>${escapeHtml(mplProductPackageBreakdown({ ...row, case_qty: quantityValue }, groupEntries))}</span></div>
          <div class="mpl-packaging-level-actions">
            ${printable ? `<button class="btn-table-preview" type="button" title="Open editable pack-label preview." onclick="openManualMplProductPackLabel(${index})">Preview label</button>` : ''}
            ${canEdit ? `<button class="btn-mini-danger" type="button" onclick="deleteMplProductRow(${index})">Delete level</button>` : ''}
          </div>
        </header>
        <div class="mpl-packaging-primary-grid">
          <label>GTIN <input ${editDisabled} value="${escapeHtml(row.gtin)}" onchange="updateMplProductRow(${index}, 'gtin', this.value)"></label>
          <label>Eaches Contained <input ${editDisabled} type="number" min="1" step="1" value="${escapeHtml(quantityValue)}" placeholder="${escapeHtml(packagePlaceholder)}" title="Number of sellable eaches contained at this packaging level." ${row.packaging_level === 'Each' ? 'disabled' : ''} onchange="validateProductNumericInput(this, true); updateMplProductRow(${index}, 'case_qty', this.value)"></label>
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
    };

    body.innerHTML = groups.map(group => {
      group.entries.sort((left, right) => {
        const leftOrder = levelOrder.get(left.row.packaging_level) ?? levelOptions.length;
        const rightOrder = levelOrder.get(right.row.packaging_level) ?? levelOptions.length;
        return leftOrder - rightOrder || left.index - right.index;
      });
      const primaryEntry = group.entries.find(entry => entry.row.packaging_level === 'Case') || group.entries[0];
      const primaryRow = primaryEntry?.row || {};
      const expanded = mplExpandedProductGroups.has(group.key);
      const uniqueLevels = [...new Set(group.entries.map(entry => entry.row.packaging_level).filter(Boolean))];
      const groupSummary = mplProductPackageBreakdown(primaryRow, group.entries);
      const verification = primaryRow.verification_status || 'UNSET';
      const configLabel = primaryRow.config_id ? `Config ${primaryRow.config_id}` : 'No Config ID';
      const groupQuality = quality?.groups?.get(group.key) || { score: 0, issues: [] };
      const qualityState = groupQuality.score === 100 ? 'ready' : groupQuality.issues?.some(issue => issue.severity === 'invalid') ? 'invalid' : 'review';
      const editDisabled = canEdit ? '' : 'disabled';
      return `
        <tr class="mpl-product-group-row ${expanded ? 'is-expanded' : ''}">
          <td colspan="2">
            <div class="mpl-product-group-shell">
              <button class="mpl-product-group-toggle" type="button" data-group-key="${escapeHtml(group.key)}" onclick="toggleMplProductGroup(this)" aria-expanded="${expanded ? 'true' : 'false'}">
                <span class="mpl-product-group-chevron" aria-hidden="true">${expanded ? '−' : '+'}</span>
                <span class="mpl-product-group-identity">
                  <strong>${escapeHtml(primaryRow.sku || primaryRow.customer_item_number || 'SKU not set')}</strong>
                  <span>${escapeHtml(primaryRow.description || 'Description not set')}</span>
                </span>
                <span class="mpl-product-group-meta">${escapeHtml(primaryRow.storefront || 'No storefront')} · ${escapeHtml(configLabel)} · ${uniqueLevels.length} packaging level${uniqueLevels.length === 1 ? '' : 's'} · ${escapeHtml(verification)} <span class="product-quality-badge ${qualityState}" title="${escapeHtml((groupQuality.issues || []).map(issue => issue.message).join(' · ') || 'Complete')}">${groupQuality.score}% complete</span></span>
                <span class="mpl-product-group-summary">${escapeHtml(groupSummary)}</span>
                <span class="mpl-product-group-action">${expanded ? 'Hide details' : 'Review & edit'}</span>
              </button>
            </div>
          </td>
        </tr>
        ${expanded ? `<tr class="mpl-product-config-row"><td colspan="2"><div class="mpl-product-config-editor">
          <section class="mpl-product-shared-card">
            <header><div><span>Shared Product Details</span><h3>Product: ${escapeHtml(primaryRow.sku || primaryRow.config_id || 'New configuration')}</h3></div><span class="product-quality-badge ${qualityState}">${groupQuality.score}% complete</span></header>
            <div class="mpl-product-shared-grid">
              <label>Customer <select ${editDisabled} onchange="updateMplProductGroupField('${jsString(group.key)}', 'storefront', this.value)">${selectOptionsHtml(b2bCustomerOptions(primaryRow.storefront), primaryRow.storefront, 'Select customer')}</select></label>
              <label>Config ID <input ${editDisabled} value="${escapeHtml(primaryRow.config_id || '')}" placeholder="CUSTOMER-PRODUCT" onchange="updateMplProductGroupField('${jsString(group.key)}', 'config_id', this.value)"></label>
              <label>SKU <input ${editDisabled} value="${escapeHtml(primaryRow.sku || '')}" onchange="updateMplProductGroupField('${jsString(group.key)}', 'sku', this.value)"></label>
              <label class="mpl-product-description-field">Description <input ${editDisabled} value="${escapeHtml(primaryRow.description || '')}" onchange="updateMplProductGroupField('${jsString(group.key)}', 'description', this.value)"></label>
              <label title="Product weight of one sellable each, excluding final case packaging.">Each Weight (g) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(primaryRow.each_net_weight_g || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(group.key)}', 'each_net_weight_g', this.value)"></label>
              <label>Status <select ${editDisabled} onchange="updateMplProductGroupField('${jsString(group.key)}', 'verification_status', this.value)">${selectOptionsHtml(B2B_VERIFICATION_STATUSES, primaryRow.verification_status, 'Select status')}</select></label>
              <label>Customer Item Number <input ${editDisabled} value="${escapeHtml(primaryRow.customer_item_number || '')}" onchange="updateMplProductGroupField('${jsString(group.key)}', 'customer_item_number', this.value)"></label>
            </div>
            <div class="mpl-product-final-details">
              <div class="mpl-product-final-heading"><span>Final Shipping Case</span><strong>Enter the completed case measurements once</strong></div>
              <div class="mpl-product-final-grid">
                <label title="Combined product contents in the final case, excluding outer packaging.">Total Product Weight (g) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(primaryRow.package_net_weight_g || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(group.key)}', 'package_net_weight_g', this.value)"></label>
                <label title="Complete shipping weight including the product and all case packaging.">Total Weight with Packaging (lb) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(primaryRow.gross_weight_lbs || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(group.key)}', 'gross_weight_lbs', this.value)"></label>
                <label>Length (in) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(primaryRow.length_in || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(group.key)}', 'length_in', this.value)"></label>
                <label>Width (in) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(primaryRow.width_in || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(group.key)}', 'width_in', this.value)"></label>
                <label>Height (in) <input ${editDisabled} type="number" min="0" step="0.01" value="${escapeHtml(primaryRow.height_in || '')}" onchange="validateProductNumericInput(this); updateMplProductFinalField('${jsString(group.key)}', 'height_in', this.value)"></label>
              </div>
            </div>
          </section>
          <section class="mpl-product-levels-card">
            <header><div><span>Packaging Levels</span><strong>Case, inner pack, each, master case, and pallet data</strong></div>${canEdit ? `<select class="mpl-product-level-add" data-no-search data-group-key="${escapeHtml(group.key)}" aria-label="Add packaging level" onchange="addMplProductLevel(this.dataset.groupKey, this.value); this.value=''"><option value="">+ Add Level</option>${levelOptions.filter(level => level !== 'Other' && !uniqueLevels.includes(level)).map(level => `<option value="${escapeHtml(level)}">${escapeHtml(level)}</option>`).join('')}</select>` : ''}</header>
            <div class="mpl-packaging-level-list">${group.entries.map(entry => renderLevelCard(entry, group.entries)).join('')}</div>
          </section>
        </div></td></tr>` : ''}`;
    }).join('');
    applyPermissionUi();
    enhanceSearchableSelects(body);
  }

  function addMplProductRow(seed = {}) {
    if (!hasPermission('table_crud')) return;
    const defaultStorefront = selectedKit === 'b2b' && b2bSelectedCustomer ? b2bSelectedCustomer : 'KeHE';
    const newRow = normalizeProductRow({
      storefront: defaultStorefront,
      config_id: `DRAFT-${Date.now()}`,
      packaging_level: 'Case',
      in_packing_list: true,
      ...seed,
    });
    mplProductMasterRows.push(newRow);
    const newIndex = mplProductMasterRows.length - 1;
    mplExpandedProductGroups.add(mplProductGroupKey(newRow, newIndex));
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    const addedRow = document.querySelector(`#mpl-product-master-body [data-product-row-index="${newIndex}"]`);
    if (addedRow) {
      addedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      addedRow.querySelector('input')?.focus();
    }
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

    const primary = entries.find(entry => entry.row.packaging_level === 'Case')?.row || entries[0].row;
    const inheritedBarcodeLevel = level.toUpperCase().replace(/\s+/g, '_');
    const newRow = normalizeProductRow({
      ...primary,
      packaging_level: level,
      gtin: '',
      barcode_level: inheritedBarcodeLevel,
      length_in: '',
      width_in: '',
      height_in: '',
      each_net_weight_g: '',
      package_net_weight_g: '',
      gross_weight_lbs: '',
      case_qty: level === 'Each' ? '1' : '',
      default_copies: '',
      verification_status: 'DRAFT',
      source_note: '',
      label_enabled: false,
      is_active: true,
    });
    mplProductMasterRows.push(newRow);
    const newIndex = mplProductMasterRows.length - 1;
    mplExpandedProductGroups.add(groupKey);
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    document.querySelector(`#mpl-product-master-body [data-product-row-index="${newIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setStatus(`${level} added to ${primary.config_id || primary.sku || 'the configuration'}.`, 'success');
  }

  function deleteMplProductRow(index) {
    if (!hasPermission('table_crud')) return;
    mplProductMasterRows.splice(index, 1);
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
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

  function normalizeDcDirectoryRow(row = {}) {
    const shipFrom = String(row.ship_from ?? row.SHIP_FROM ?? row['SHIP FROM'] ?? '').trim() || DEFAULT_KEHE_SHIP_FROM;
    return {
      storefront: normalizeStorefront(row.storefront ?? row.STOREFRONT ?? row['Storefront']),
      dc: String(row.dc ?? row.DC ?? '').trim(),
      name: String(row.name ?? row.NAME ?? '').trim(),
      ship_from: shipFrom,
      delivery_address: String(row.delivery_address ?? row.DELIVERY_ADDRESS ?? '').trim(),
      billing_address: String(row.billing_address ?? row.BILLING_ADDRESS ?? '').trim(),
      match_values: parseDcMatchValues(row.match_values ?? row.MATCH_VALUES ?? []),
      record_type: normalizeB2BDirectoryRecordType(row.record_type ?? row.RECORD_TYPE),
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

  function getKeheDcDirectoryRows() {
    return keheDcDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => isKeheStorefront(row.storefront))
      .filter(row => row.dc || row.name || row.delivery_address || row.billing_address || row.match_values.length);
  }

  function getMplDirectoryRows() {
    return mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.dc || row.name || row.delivery_address || row.billing_address || row.default_label_template_id || row.receiving_email || row.manufacturer_name || row.source_note);
  }

  function getActiveDcDirectoryRows() {
    return isStandaloneMplReferenceMode() ? getMplDirectoryRows() : getKeheDcDirectoryRows();
  }

  function getSavedMplShipFromAddresses() {
    const sharedOrigin = getSharedMplDirectoryShipFrom();
    const savedOrigins = mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.is_active !== false)
      .map(row => String(row.ship_from || '').trim());
    return uniqueTextValues([sharedOrigin, ...savedOrigins]);
  }

  function loadMplDirectoryFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(MPL_DIRECTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeDcDirectoryRow);
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
      const backendRows = Array.isArray(payload.rows) ? payload.rows.map(normalizeDcDirectoryRow) : [];
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
    const previousOrigin = getSharedMplDirectoryShipFrom();
    mplDirectorySharedShipFrom = origin;
    mplDirectoryRows.forEach(row => {
      const currentOrigin = String(row.ship_from || '').trim();
      if (!currentOrigin || currentOrigin === previousOrigin) row.ship_from = origin;
    });
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    document.getElementById('directory-shared-origin-editor')?.classList.add('hidden');
    renderSharedDirectoryOrigin();
    setStatus('Default Ship From updated. Saved destination overrides were preserved.', 'success');
  }

  function selectMplDirectoryShipFrom(index, value) {
    if (!hasPermission('table_crud') || !mplDirectoryRows[index]) return;
    if (value === '__custom__') {
      const editor = document.getElementById(`directory-origin-custom-${index}`);
      editor?.classList.remove('hidden');
      editor?.querySelector('textarea')?.focus();
      return;
    }
    mplDirectoryRows[index].ship_from = String(value || '').trim() || getSharedMplDirectoryShipFrom();
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryTable();
    setStatus('Ship From selection saved for this destination.', 'success');
  }

  function saveMplDirectoryShipFromOverride(index) {
    if (!hasPermission('table_crud') || !mplDirectoryRows[index]) return;
    const input = document.querySelector(`#directory-origin-custom-${index} textarea`);
    const origin = String(input?.value || '').trim();
    if (!origin) {
      setStatus('Enter the alternate Ship From address.', 'error');
      input?.focus();
      return;
    }
    mplDirectoryRows[index].ship_from = origin;
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryTable();
    setStatus('Alternate Ship From saved and added to workflow address selectors.', 'success');
  }

  function resetMplDirectoryShipFrom(index) {
    if (!hasPermission('table_crud') || !mplDirectoryRows[index]) return;
    mplDirectoryRows[index].ship_from = getSharedMplDirectoryShipFrom();
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryTable();
    setStatus('This destination now uses the default Ship From.', 'success');
  }

  function renderMplDirectoryTable() {
    const body = document.getElementById('mpl-directory-body');
    if (!body) return;
    const canEdit = hasPermission('table_crud');
    const editDisabled = canEdit ? '' : 'disabled';
    const rows = mplDirectoryRows.map(normalizeDcDirectoryRow);
    renderSharedDirectoryOrigin();
    syncTableFilterOptions('mpl-directory-storefront-filter', rows.map(row => row.storefront), 'All customers');
    const search = String(document.getElementById('mpl-directory-search')?.value || '').trim().toLowerCase();
    const storefront = String(document.getElementById('mpl-directory-storefront-filter')?.value || '').trim().toLowerCase();
    const addressStatus = String(document.getElementById('mpl-directory-type-filter')?.value || '').trim();
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
          row.delivery_address,
          row.billing_address,
          row.receiving_email,
          row.manufacturer_name,
          row.match_values,
        ].some(value => String(value || '').toLowerCase().includes(search)))
          && (!storefront || String(row.storefront || '').trim().toLowerCase() === storefront)
          && (!addressStatus
            || (addressStatus === 'complete' && !!String(row.delivery_address || '').trim() && !!String(row.billing_address || '').trim())
            || (addressStatus === 'missing_ship_to' && !String(row.delivery_address || '').trim())
            || (addressStatus === 'missing_bill_to' && !String(row.billing_address || '').trim()))
          && statusMatches;
      });
    const countEl = document.getElementById('mpl-directory-count');
    if (countEl) countEl.textContent = `${filtered.length} of ${rows.length} records`;
    if (!filtered.length) {
      body.innerHTML = `<div class="empty-row">${rows.length ? 'No destinations match these filters.' : 'No destinations yet. Add one manually or import an address file.'}</div>`;
      return;
    }
    if (!filtered.some(({ index }) => index === mplDirectoryExpandedIndex)) {
      mplDirectoryExpandedIndex = filtered[0].index;
    }
    body.innerHTML = filtered.map(({ row, index }) => {
      const hasShipTo = !!String(row.delivery_address || '').trim();
      const hasBillTo = !!String(row.billing_address || '').trim();
      const addressCount = Number(hasShipTo) + Number(hasBillTo);
      const shipToSummary = hasShipTo ? String(row.delivery_address).split(/\r?\n/)[0] : 'Ship To missing';
      const sharedOrigin = getSharedMplDirectoryShipFrom();
      const selectedOrigin = String(row.ship_from || '').trim() || sharedOrigin;
      const originOptions = getSavedMplShipFromAddresses();
      const usesSharedOrigin = selectedOrigin === sharedOrigin;
      return `
      <details class="mpl-directory-card" data-directory-row-index="${index}" ${index === mplDirectoryExpandedIndex ? 'open' : ''}>
        <summary onclick="selectMplDirectoryCard(${index}, event)">
          <span class="directory-card-title">${escapeHtml(row.name || row.storefront || 'Unnamed record')}<small>${escapeHtml(row.storefront || 'No customer')} · ${escapeHtml(row.dc || 'No code')}</small></span>
          <span class="directory-card-meta">${escapeHtml(shipToSummary)}<small>${addressCount} of 2 destination addresses saved</small></span>
          <span class="directory-card-status">${escapeHtml(row.verification_status || (row.is_active ? 'ACTIVE' : 'INACTIVE'))}</span>
          <span class="directory-card-toggle" aria-hidden="true"><span class="directory-card-toggle-edit">Edit details</span><span class="directory-card-toggle-hide">Editing</span></span>
        </summary>
        <div class="directory-card-body">
          <div class="directory-card-editor-heading">
            <div><strong>Editing: ${escapeHtml(row.name || row.storefront || 'New directory record')}</strong><span>Complete the fields below. Every change saves automatically.</span></div>
            <div class="directory-card-editor-actions">
              <span class="directory-autosave-badge">Auto-save on</span>
              ${selectedKit === 'b2b' ? `<button class="btn-secondary" type="button" onclick="useMplDirectoryForB2B(${index})">Use in Label Creator</button>` : `<button class="btn-table-preview" type="button" onclick="openManualMplDcPalletLabel(${index})">Preview</button>`}
              ${canEdit ? `<button class="btn-mini-danger directory-delete-button" type="button" onclick="deleteMplDirectoryRow(${index})">Delete record</button>` : ''}
            </div>
          </div>
          <div class="mpl-unified-fields-grid directory-identity-grid">
            <div class="mpl-field-group-label">Record identity</div>
            <label>Customer / Storefront <select ${editDisabled} onchange="updateMplDirectoryRow(${index}, 'storefront', this.value)">
              ${selectOptionsHtml(b2bCustomerOptions(row.storefront), row.storefront, 'Select customer')}
            </select></label>
            <label>Code <input ${editDisabled} value="${escapeHtml(row.dc)}" placeholder="45" oninput="updateMplDirectoryRow(${index}, 'dc', this.value)"></label>
            <label>Name <input ${editDisabled} value="${escapeHtml(row.name)}" placeholder="DC / Customer / Store" oninput="updateMplDirectoryRow(${index}, 'name', this.value)"></label>
            <label title="Tracks review without changing label content; Blocked hides the configuration from general users.">Data Status <select ${editDisabled} onchange="updateMplDirectoryRow(${index}, 'verification_status', this.value)">
              ${selectOptionsHtml(B2B_VERIFICATION_STATUSES, row.verification_status, 'Select status')}
            </select></label>
            <label class="directory-active-control"><span><strong>Active destination</strong><small>Available in address selectors</small></span><input ${editDisabled} type="checkbox" ${row.is_active ? 'checked' : ''} onchange="updateMplDirectoryRow(${index}, 'is_active', this.checked)"></label>
          </div>
          <section class="directory-destination-workbench">
            <div class="directory-origin-choice">
              <div><span>Ship From for this destination</span><strong>${usesSharedOrigin ? 'Using the default origin' : 'Using a saved alternative'}</strong><small>The selected origin is available before generating packing lists and labels.</small></div>
              <label><span>Origin</span><select ${editDisabled} onchange="selectMplDirectoryShipFrom(${index}, this.value)">
                ${originOptions.map(origin => `<option value="${escapeHtml(origin)}" ${origin === selectedOrigin ? 'selected' : ''}>${escapeHtml(`${origin === sharedOrigin ? 'Default' : 'Saved'} — ${firstLine(origin) || origin}`)}</option>`).join('')}
                ${canEdit ? '<option value="__custom__">Add another Ship From…</option>' : ''}
              </select></label>
              ${!usesSharedOrigin && canEdit ? `<button class="btn-secondary" type="button" onclick="resetMplDirectoryShipFrom(${index})">Use default</button>` : ''}
            </div>
            <div class="directory-origin-custom hidden" id="directory-origin-custom-${index}">
              <label>Alternate Ship From Address<textarea rows="4" placeholder="Company&#10;Street address&#10;City, State ZIP&#10;Country">${escapeHtml(selectedOrigin)}</textarea></label>
              <div><button class="btn-secondary" type="button" onclick="renderMplDirectoryTable()">Cancel</button><button class="btn-generate" type="button" onclick="saveMplDirectoryShipFromOverride(${index})">Save alternative</button></div>
            </div>
            <div class="directory-address-heading">
              <div><span>Destination addresses</span><strong>Enter the addresses used on labels and packing lists</strong></div>
              <span class="directory-completeness-badge ${addressCount === 2 ? 'complete' : ''}">${addressCount} of 2 complete</span>
            </div>
            <div class="directory-address-grid">
              <label class="directory-address-field"><span>Ship To Address <small>Required for destination documents</small></span>
                <textarea rows="4" ${editDisabled} placeholder="Company or location&#10;Street address&#10;City, State ZIP&#10;Country" oninput="updateMplDirectoryRow(${index}, 'delivery_address', this.value)">${escapeHtml(row.delivery_address || '')}</textarea>
              </label>
              <label class="directory-address-field"><span>Bill To Address <button class="directory-copy-address" type="button" ${editDisabled} onclick="copyMplDirectoryAddress(${index}, 'delivery_address', 'billing_address')">Same as Ship To</button></span>
                <textarea rows="4" ${editDisabled} placeholder="Enter the billing address, or copy Ship To" oninput="updateMplDirectoryRow(${index}, 'billing_address', this.value)">${escapeHtml(row.billing_address || '')}</textarea>
              </label>
            </div>
            <label class="directory-match-values">Matching values <small>Optional GLN, city, ZIP, address fragment, or customer reference—one per line.</small>
              <textarea rows="3" ${editDisabled} placeholder="Example: 0569813430045&#10;Ontario&#10;91761" oninput="updateMplDirectoryRow(${index}, 'match_values', this.value)">${escapeHtml(row.match_values.join('\n'))}</textarea>
            </label>
          </section>
          <details class="directory-optional-details" ${row.default_label_template_id || row.receiving_email || row.manufacturer_name || row.manufacturer_address || row.docking_instructions || row.source_note ? 'open' : ''}>
            <summary><span><strong>Label, receiving, and notes</strong><small>Optional operational defaults for this record</small></span><span>Show details</span></summary>
            <div class="mpl-unified-fields-grid">
              <label>Default Template <select ${editDisabled} onchange="updateMplDirectoryRow(${index}, 'default_label_template_id', this.value)">
                ${selectOptionsHtml(b2bTemplateIdOptions(row.default_label_template_id), row.default_label_template_id, 'No default template')}
              </select></label>
              <label>Receiving Email <input ${editDisabled} value="${escapeHtml(row.receiving_email || '')}" oninput="updateMplDirectoryRow(${index}, 'receiving_email', this.value)"></label>
              <label>Manufacturer Name <input ${editDisabled} value="${escapeHtml(row.manufacturer_name || '')}" oninput="updateMplDirectoryRow(${index}, 'manufacturer_name', this.value)"></label>
              <label class="mpl-field-wide">Manufacturer Address <textarea rows="2" ${editDisabled} oninput="updateMplDirectoryRow(${index}, 'manufacturer_address', this.value)">${escapeHtml(row.manufacturer_address || '')}</textarea></label>
              <label class="mpl-field-wide">Docking Instructions <textarea rows="2" ${editDisabled} oninput="updateMplDirectoryRow(${index}, 'docking_instructions', this.value)">${escapeHtml(row.docking_instructions || '')}</textarea></label>
              <label class="mpl-field-wide">Source Note <textarea rows="2" ${editDisabled} oninput="updateMplDirectoryRow(${index}, 'source_note', this.value)">${escapeHtml(row.source_note || '')}</textarea></label>
            </div>
          </details>
        </div>
      </details>
    `;
    }).join('');
    applyPermissionUi();
    enhanceSearchableSelects(body);
  }

  function selectMplDirectoryCard(index, event) {
    event?.preventDefault();
    mplDirectoryExpandedIndex = index;
    renderMplDirectoryTable();
    document.querySelector(`#mpl-directory-body [data-directory-row-index="${index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function addMplDirectoryRow(seed = {}) {
    if (!hasPermission('table_crud')) return;
    const filteredStorefront = String(document.getElementById('mpl-directory-storefront-filter')?.value || '').trim();
    const newRow = normalizeDcDirectoryRow({
      storefront: filteredStorefront || (selectedKit === 'b2b' ? (b2bSelectedCustomer || 'New Customer') : 'KeHE'),
      dc: `DRAFT-${Date.now()}`,
      ship_from: getSharedMplDirectoryShipFrom(),
      record_type: selectedKit === 'b2b' ? 'CUSTOMER_DEFAULT' : 'DESTINATION',
      verification_status: 'DRAFT',
      is_active: true,
      ...seed,
    });
    mplDirectoryRows.push(newRow);
    const newIndex = mplDirectoryRows.length - 1;
    mplDirectoryExpandedIndex = newIndex;
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryTable();
    const card = document.querySelector(`#mpl-directory-body [data-directory-row-index="${newIndex}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.querySelector('input, select, textarea')?.focus();
    }
  }

  function copyMplDirectoryAddress(index, sourceField, targetField) {
    if (!hasPermission('table_crud')) return;
    if (!mplDirectoryRows[index]) return;
    const allowedFields = ['delivery_address', 'billing_address'];
    if (!allowedFields.includes(sourceField) || !allowedFields.includes(targetField)) return;
    mplDirectoryRows[index][targetField] = String(mplDirectoryRows[index][sourceField] || '').trim();
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryTable();
    setStatus('Bill To copied from Ship To.', 'success');
  }

  async function useMplDirectoryForB2B(index) {
    const row = mplDirectoryRows[index];
    if (!row) return;
    b2bSelectedDirectoryIndex = index;
    b2bSelectedCustomer = normalizeStorefront(row.storefront);
    closeMplDirectoryModal(false);
    await navigateToRoute('b2b', true);
  }

  function deleteMplDirectoryRow(index) {
    if (!hasPermission('table_crud')) return;
    mplDirectoryRows.splice(index, 1);
    if (mplDirectoryExpandedIndex === index) {
      mplDirectoryExpandedIndex = -1;
    } else if (mplDirectoryExpandedIndex > index) {
      mplDirectoryExpandedIndex -= 1;
    }
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryTable();
  }

  function updateMplDirectoryRow(index, key, value) {
    if (!hasPermission('table_crud')) return;
    if (!mplDirectoryRows[index]) {
      mplDirectoryRows[index] = normalizeDcDirectoryRow({ storefront: 'KeHE' });
    }
    if (key === 'match_values') {
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
