/* B2B label configuration, editing, validation, and rendering workflow. */
  async function loadB2BLabelTemplates() {
    try {
      const res = await fetchWithTimeout('/api/b2b/label-templates', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load templates.');
      b2bLabelTemplates = Array.isArray(payload.templates)
        ? payload.templates.filter(template => template && template.template_id)
        : [];
      return b2bLabelTemplates;
    } catch (err) {
      b2bLabelTemplates = [];
      setStatus(`Could not load B2B templates: ${err.message || 'unknown error'}`, 'error');
      return [];
    }
  }

  function getB2BProductEntries(customer = b2bSelectedCustomer) {
    const rawCustomer = String(customer || '').trim();
    const normalizedCustomer = rawCustomer ? normalizeStorefront(rawCustomer).toLowerCase() : '';
    const savedEntries = mplProductMasterRows
      .map((raw, index) => ({ row: normalizeProductRow(raw), index }))
      .filter(({ row }) => !isKeheStorefront(row.storefront))
      .filter(({ row }) => hasPermission('table_crud') || (
        row.is_active
        && row.label_enabled
        && row.verification_status !== 'BLOCKED'
      ))
      .filter(({ row }) => !normalizedCustomer || normalizeStorefront(row.storefront).toLowerCase() === normalizedCustomer)
      .filter(({ row }) => row.config_id || row.sku || row.customer_item_number || row.description || row.label_template_id);
    const fallbackEntries = b2bOrderFallbackProducts
      .map((raw, index) => ({ row: normalizeProductRow(raw), index: -1000 - index }))
      .filter(({ row }) => !normalizedCustomer || normalizeStorefront(row.storefront).toLowerCase() === normalizedCustomer);
    return [...savedEntries, ...fallbackEntries];
  }

  function getB2BProductGroups(customer = b2bSelectedCustomer) {
    const groups = new Map();
    getB2BProductEntries(customer).forEach(entry => {
      const key = mplProductGroupKey(entry.row, entry.index);
      if (!groups.has(key)) groups.set(key, { key, entries: [] });
      groups.get(key).entries.push(entry);
    });
    return [...groups.values()].sort((left, right) => {
      const a = left.entries[0]?.row || {};
      const b = right.entries[0]?.row || {};
      return `${a.description}|${a.config_id}`.localeCompare(`${b.description}|${b.config_id}`, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  function getB2BDirectoryEntries(customer = b2bSelectedCustomer) {
    const normalizedCustomer = normalizeStorefront(customer).toLowerCase();
    return mplDirectoryRows
      .map((raw, index) => ({ row: normalizeDcDirectoryRow(raw), index }))
      .filter(({ row }) => normalizeStorefront(row.storefront).toLowerCase() === normalizedCustomer)
      .filter(({ row }) => directoryHasRole(row, 'SHIP_TO'))
      .filter(({ row }) => hasPermission('table_crud') || row.is_active);
  }

  function getSelectedB2BProduct() {
    if (b2bSelectedProductIndex >= 0) {
      return normalizeProductRow(mplProductMasterRows[b2bSelectedProductIndex] || {});
    }
    if (b2bSelectedProductIndex <= -1000) {
      return normalizeProductRow(b2bOrderFallbackProducts[-1000 - b2bSelectedProductIndex] || {});
    }
    return null;
  }

  async function openMplVersionHistory() {
    const draftId = activeKeheDocumentDraft?._saved_draft_id;
    if (!draftId) {
      setStatus('Save the MPL once before opening version history.', 'error');
      return;
    }
    const modal = document.getElementById('mpl-version-modal');
    const list = document.getElementById('mpl-version-list');
    if (list) list.innerHTML = '<div class="empty-row">Loading versions…</div>';
    modal?.classList.add('visible');
    try {
      const res = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}/versions`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not load version history.');
      mplVersionHistory = Array.isArray(data.versions) ? data.versions : [];
      if (!list) return;
      list.innerHTML = mplVersionHistory.length ? mplVersionHistory.map(version => `
        <div class="mpl-version-row">
          <strong>Version ${escapeHtml(String(version.revision || '—'))}</strong>
          <div>${escapeHtml(version.reason || 'Explicit save')}<small>${escapeHtml(formatDateTime(version.updated_at))} · ${escapeHtml(version.updated_by || 'Unknown user')}</small></div>
          <button class="btn-secondary" type="button" onclick="compareMplVersion('${jsString(version.id)}')">Compare</button>
          <button class="btn-secondary" type="button" onclick="restoreMplVersion('${jsString(version.id)}')">Restore</button>
        </div>`).join('') : '<div class="empty-row">No explicit versions have been saved yet.</div>';
    } catch (err) {
      if (list) list.innerHTML = `<div class="empty-row">${escapeHtml(err.message || 'Could not load version history.')}</div>`;
    }
  }

  function closeMplVersionHistory() {
    document.getElementById('mpl-version-modal')?.classList.remove('visible');
  }

  async function restoreMplVersion(versionId) {
    const draftId = activeKeheDocumentDraft?._saved_draft_id;
    if (!draftId) return;
    try {
      const res = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}/versions/${encodeURIComponent(versionId)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: Number(activeKeheDocumentDraft._saved_draft_revision || 0) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not restore this MPL version.');
      const record = data.draft || {};
      activeKeheDocumentDraft = record.draft || activeKeheDocumentDraft;
      activeKeheDocumentDraft._saved_draft_id = record.id;
      activeKeheDocumentDraft._saved_draft_name = record.name;
      activeKeheDocumentDraft._saved_draft_revision = Number(record.revision || 0);
      activeKeheDocumentDraft.product_master = getActiveAllProductMasterRows();
      closeMplVersionHistory();
      renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
      mplDraftSync?.markSaved();
      setStatus('Saved MPL version restored.', 'success');
    } catch (err) {
      setStatus(`Error: ${err.message || 'Could not restore this MPL version.'}`, 'error');
    }
  }

  function getSelectedB2BDirectory() {
    return b2bSelectedDirectoryIndex >= 0
      ? normalizeDcDirectoryRow(mplDirectoryRows[b2bSelectedDirectoryIndex] || {})
      : normalizeDcDirectoryRow(b2bResolvedDirectoryFallback || {});
  }

  function getSelectedB2BShipFrom() {
    const selected = getSelectedB2BDirectory();
    const wantedCustomer = normalizeStorefront(selected.storefront || b2bSelectedCustomer).toLowerCase();
    const origins = mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.is_active !== false && directoryHasRole(row, 'SHIP_FROM'));
    return origins.find(row => normalizeStorefront(row.storefront).toLowerCase() === wantedCustomer)
      || origins.find(row => String(row.dc || '').trim().toUpperCase() === 'DEFAULT-SHIP-FROM')
      || origins[0]
      || {};
  }

  function getSelectedB2BTemplate() {
    return b2bLabelTemplates.find(template => String(template.template_id || '') === b2bSelectedTemplateId) || null;
  }

  function setNativeSelectOptions(select, options, selectedValue, blankLabel = '') {
    if (!select) return;
    select.innerHTML = selectOptionsHtml(options, selectedValue, blankLabel);
    select.value = selectedValue || '';
  }

  function b2bPreviewValue(product, directory, runFields, ...fields) {
    for (const source of [runFields || b2bRunFields, product || {}, directory || {}]) {
      for (const field of fields) {
        const value = String(source?.[field] ?? '').trim();
        if (value) return value.replace(/\\n/g, '\n');
      }
    }
    return '';
  }

  function b2bBarcodeConfigured(product = getSelectedB2BProduct()) {
    return !!String(product?.gtin || '').trim()
      && !['', 'NONE'].includes(String(product?.barcode_type || '').trim().toUpperCase());
  }

  function b2bPrintBarcodeEnabled(product = getSelectedB2BProduct(), runFields = b2bRunFields) {
    return parseBooleanLike(runFields?.print_barcode, false) && b2bBarcodeConfigured(product);
  }

  function b2bBarcodePreviewHtml(product, context = {}) {
    if (!b2bPrintBarcodeEnabled(product, context.runFields || b2bRunFields)) return '';
    return `<div class="b2b-label-barcode"><div class="b2b-label-bars"></div>${b2bEditableValue(product, 'gtin', 'GTIN / UPC', 'b2b-edit-barcode', context)}</div>`;
  }

  function b2bProductSettingMap() {
    return {
      description: 'b2b-product-description',
      sku: 'b2b-product-sku',
      customer_item_number: 'b2b-product-customer-item',
      gtin: 'b2b-product-gtin',
      case_qty: 'b2b-product-case-qty',
      each_net_weight_g: 'b2b-product-each-net',
      package_net_weight_g: 'b2b-product-package-net',
      gross_weight_lbs: 'b2b-product-gross',
      length_in: 'b2b-product-length',
      width_in: 'b2b-product-width',
      height_in: 'b2b-product-height',
    };
  }

  const B2B_FINAL_PRODUCT_FIELDS = new Set([
    'each_net_weight_g', 'package_net_weight_g', 'gross_weight_lbs',
    'length_in', 'width_in', 'height_in',
  ]);

  const B2B_RENDERER_PRODUCT_FIELDS = {
    decopac_case_4x6: ['customer_item_number', 'description', 'case_qty', 'each_net_weight_g', 'package_net_weight_g', 'length_in', 'width_in', 'height_in'],
    disney_case_3x3: ['customer_item_number', 'description'],
    compact_case_3x3: ['description', 'sku', 'customer_item_number', 'case_qty'],
    fancy_pallet_3x3: ['sku', 'customer_item_number', 'description'],
    mixed_case_3x1_5: ['description', 'sku', 'customer_item_number', 'case_qty'],
    standard_case_4x6: ['description', 'case_qty', 'sku', 'customer_item_number'],
    standard_case_vertical_4x6: ['description', 'case_qty', 'sku', 'customer_item_number'],
    bulk_further_processing_4x6: ['description', 'gross_weight_lbs', 'package_net_weight_g'],
  };

  function organizeB2BProductSettings(template, product) {
    const panel = document.getElementById('b2b-product-settings');
    const current = document.getElementById('b2b-product-settings-current');
    const additional = document.getElementById('b2b-product-settings-additional');
    if (!panel || !current || !additional) return;
    const required = new Set((template?.required_product_fields || []).map(String));
    const renderer = String(template?.renderer_key || '');
    const visible = new Set([...(B2B_RENDERER_PRODUCT_FIELDS[renderer] || []), ...required]);
    if (String(product?.sku || '').trim()) visible.delete('customer_item_number');
    else visible.delete('sku');
    const barcodePolicy = String(template?.barcode_policy || 'NONE').trim().toUpperCase();
    const barcodeRunRequested = parseBooleanLike(b2bRunFields.print_barcode, false);
    if (barcodePolicy === 'REQUIRED' || barcodeRunRequested || template?.renderer_options?.show_barcode) {
      visible.add('gtin');
      visible.add('barcode_type');
    }
    panel.querySelectorAll('[data-b2b-setting-field]').forEach(label => {
      const field = label.dataset.b2bSettingField;
      const target = visible.has(field) ? current : additional;
      target.appendChild(label);
      label.classList.toggle('b2b-setting-required-field', required.has(field));
      let role = label.querySelector('.b2b-setting-role');
      if (required.has(field)) {
        if (!role) {
          role = document.createElement('small');
          role.className = 'b2b-setting-role';
          label.appendChild(role);
        }
        role.textContent = 'Required for this label';
      } else if (role) {
        role.remove();
      }
      if (!label.dataset.b2bBaseLabel) {
        const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (textNode) label.dataset.b2bBaseLabel = textNode.textContent.trim();
      }
      const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
      if (textNode && label.dataset.b2bBaseLabel) {
        textNode.textContent = `${label.dataset.b2bBaseLabel}${required.has(field) ? ' · REQUIRED' : ''} `;
      }
    });
    const note = document.getElementById('b2b-settings-note');
    if (note) note.textContent = `${template?.name || 'This label'} uses the fields shown first. GTIN/barcode is optional unless enabled in the print run; other product data is kept for different labels and TI-HI.`;
  }

  function getSelectedB2BFinalCaseEntry() {
    const entries = getB2BProductEntries().filter(entry => (
      mplProductGroupKey(entry.row, entry.index) === b2bSelectedGroupKey
    ));
    return mplProductOutermostEntry(entries) || null;
  }

  function getB2BOutputProduct(product = getSelectedB2BProduct()) {
    if (!product) return product;
    const finalCaseProduct = getSelectedB2BFinalCaseEntry()?.row;
    if (!finalCaseProduct) return product;
    const output = { ...product };
    B2B_FINAL_PRODUCT_FIELDS.forEach(field => {
      if (String(finalCaseProduct[field] ?? '').trim()) output[field] = finalCaseProduct[field];
    });
    return output;
  }

  function renderB2BProductSettings(product = getSelectedB2BProduct(), template = getSelectedB2BTemplate()) {
    const panel = document.getElementById('b2b-product-settings');
    const status = document.getElementById('b2b-settings-status');
    if (!panel) return;
    panel.classList.toggle('hidden', !product);
    if (!product) {
      panel.open = false;
      b2bSettingsProductIndex = -1;
      return;
    }

    const isOrderFallback = b2bSelectedProductIndex <= -1000;
    const canEdit = isOrderFallback || hasPermission('table_crud');
    const finalCaseProduct = getSelectedB2BFinalCaseEntry()?.row || product;
    Object.entries(b2bProductSettingMap()).forEach(([field, id]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const source = B2B_FINAL_PRODUCT_FIELDS.has(field) ? finalCaseProduct : product;
      input.value = source[field] ?? '';
      input.disabled = !canEdit;
    });
    setNativeSelectOptions(document.getElementById('b2b-product-barcode-type'), B2B_BARCODE_TYPES, product.barcode_type || '', 'Select type');
    setNativeSelectOptions(document.getElementById('b2b-product-verification'), B2B_VERIFICATION_STATUSES, product.verification_status || '', 'Select status');
    ['b2b-product-barcode-type', 'b2b-product-verification'].forEach(id => {
      const select = document.getElementById(id);
      if (select) select.disabled = !canEdit;
    });
    const enabled = document.getElementById('b2b-product-enabled');
    if (enabled) {
      enabled.checked = !!product.label_enabled;
      enabled.disabled = !canEdit;
    }

    organizeB2BProductSettings(template, product);

    const requiredMissing = uniqueTextValues((template?.required_product_fields || []).map(String))
      .filter(field => !String(product[field] ?? '').trim());
    const barcodePolicy = String(template?.barcode_policy || 'NONE').toUpperCase();
    const barcodeConfigured = !!String(product.gtin || '').trim()
      && !['', 'NONE'].includes(String(product.barcode_type || '').toUpperCase());
    const barcodeRequested = parseBooleanLike(b2bRunFields.print_barcode, false);
    const needsAttention = requiredMissing.length > 0 || (barcodeRequested && !barcodeConfigured);
    if (status) {
      if (isOrderFallback && requiredMissing.length) status.textContent = `Order data loaded · ${requiredMissing.length} field${requiredMissing.length === 1 ? '' : 's'} to review`;
      else if (isOrderFallback) status.textContent = 'Order data loaded for this label';
      else if (requiredMissing.length) status.textContent = `${requiredMissing.length} required field${requiredMissing.length === 1 ? '' : 's'} missing`;
      else if (!barcodeRequested) status.textContent = 'Barcode is optional and currently off';
      else if (!barcodeConfigured) status.textContent = 'Barcode selected but not configured';
      else status.textContent = 'Setup complete';
      status.className = `b2b-settings-status ${needsAttention ? 'review' : barcodeRequested ? 'ready' : 'neutral'}`;
    }
    if (b2bSettingsProductIndex !== b2bSelectedProductIndex) {
      panel.open = needsAttention;
      b2bSettingsProductIndex = b2bSelectedProductIndex;
    }
  }

  function b2bEditableValue(product, field, placeholder, className = '', context = {}) {
    const value = String(product?.[field] ?? '').trim();
    const isPartnerEditor = Number.isInteger(context.partnerIndex);
    const editable = !!product && (isPartnerEditor || b2bSelectedProductIndex <= -1000 || hasPermission('table_crud'));
    const fieldAttribute = isPartnerEditor ? 'data-partner-product-edit' : 'data-b2b-product-edit';
    const partnerAttribute = isPartnerEditor ? `data-partner-label-index="${context.partnerIndex}"` : '';
    const commitHandler = isPartnerEditor ? 'commitPartnerProductLabelEdit(this)' : 'commitB2BLabelEdit(this)';
    return `<span class="b2b-label-editable ${className} ${value ? '' : 'is-empty'} ${editable ? '' : 'is-readonly'}"
      ${fieldAttribute}="${escapeHtml(field)}"
      ${partnerAttribute}
      data-placeholder="${escapeHtml(placeholder)}"
      contenteditable="${editable ? 'true' : 'false'}"
      role="textbox"
      aria-label="Edit ${escapeHtml(field.replace(/_/g, ' '))}"
      spellcheck="false"
      onkeydown="handleB2BEditorKeydown(event)"
      onfocus="this.classList.remove('is-empty')"
      onblur="${commitHandler}">${escapeHtml(value)}</span>`;
  }

  function b2bEditableRunValue(field, placeholder, className = '', context = {}) {
    const runFields = context.runFields || b2bRunFields;
    const value = String(runFields?.[field] ?? '').trim();
    const isPartnerEditor = Number.isInteger(context.partnerIndex);
    const fieldAttribute = isPartnerEditor ? 'data-partner-run-edit' : 'data-b2b-run-edit';
    const partnerAttribute = isPartnerEditor ? `data-partner-label-index="${context.partnerIndex}"` : '';
    const commitHandler = isPartnerEditor ? 'commitPartnerRunLabelEdit(this)' : 'commitB2BRunLabelEdit(this)';
    return `<span class="b2b-label-editable b2b-label-run-editable ${className} ${value ? '' : 'is-empty'}"
      ${fieldAttribute}="${escapeHtml(field)}"
      ${partnerAttribute}
      data-placeholder="${escapeHtml(placeholder)}"
      contenteditable="true"
      role="textbox"
      aria-label="Edit ${escapeHtml(field.replace(/_/g, ' '))} for this print run"
      spellcheck="false"
      onkeydown="handleB2BEditorKeydown(event)"
      onfocus="this.classList.remove('is-empty')"
      onblur="${commitHandler}">${escapeHtml(value)}</span>`;
  }

  function b2bLabelEditorHtml(template, product, directory, context = {}) {
    const renderer = String(template?.renderer_key || '');
    const runFields = context.runFields || b2bRunFields;
    const runValue = (...fields) => escapeHtml(b2bPreviewValue(product, directory, runFields, ...fields));
    const edit = (field, placeholder, className = '') => b2bEditableValue(product, field, placeholder, className, context);
    const runEdit = (field, placeholder, className = '') => b2bEditableRunValue(field, placeholder, className, context);
    const skuField = String(product?.sku || '').trim() ? 'sku' : 'customer_item_number';
    const customer = runValue('name', 'storefront') || escapeHtml(template?.customer || 'Customer');
    const carton = runValue('carton_start') || '1';
    const total = runValue('carton_total') || '1';
    const box = `Box ${carton} of ${total}`;
    const dimensions = [
      edit('length_in', 'Length'),
      edit('width_in', 'Width'),
      edit('height_in', 'Height'),
    ].join('<span class="b2b-label-dimension-times">×</span>');
    const options = template?.renderer_options || {};
    const barcodeVisible = b2bPrintBarcodeEnabled(product, runFields);
    const barcodeHtml = b2bBarcodePreviewHtml(product, context);

    if (renderer === 'decopac_case_4x6') {
      const manufacturer = runValue('manufacturer_name', 'name') || 'DECOPAC, INC';
      const destination = runValue('delivery_address') || 'ANOKA, MN USA';
      const common = `<div class="b2b-label-topline"><strong>${manufacturer.toUpperCase()}</strong><span>${destination.replace(/\n/g, ' ')}</span></div><div class="b2b-label-rule"></div><div class="b2b-label-row"><b>ITEM #:</b>${edit('customer_item_number', 'Customer item number')}</div><div class="b2b-label-row b2b-label-description"><b>DESCRIPTION:</b>${edit('description', 'Product description', 'b2b-edit-wide')}</div><div class="b2b-label-row"><b>QTY:</b><span>Master Carton of ${edit('case_qty', 'Quantity')}</span></div>`;
      return `<div class="b2b-label-sheet b2b-label-dual b2b-label-dual-stacked ${barcodeVisible ? 'has-barcode' : ''}">
        <div class="b2b-label-panel b2b-label-decocpac">${common}<div class="b2b-label-split"><div><b>PO #:</b> ${runEdit('po_number', 'Enter PO number')}</div><div><b>LOT #:</b> ${runEdit('lot_number', 'Enter lot number')}</div><strong>${box}</strong></div><strong class="b2b-label-origin">MADE IN USA</strong></div>
        <div class="b2b-label-panel b2b-label-decocpac">${common}<div class="b2b-label-details"><div><b>NET ITEM:</b> ${edit('each_net_weight_g', 'Weight')} g</div><div><b>NET CASE:</b> ${edit('package_net_weight_g', 'Weight')} g</div><div><b>DIMENSIONS:</b> <span class="b2b-label-dimensions">${dimensions}</span> in</div></div><strong class="b2b-label-box-count">${box}</strong></div>
      </div>`;
    }

    if (renderer === 'disney_case_3x3') {
      return `<div class="b2b-label-sheet b2b-label-square b2b-label-disney ${barcodeVisible ? 'has-barcode' : ''}">
        <strong class="b2b-label-customer">${customer.toUpperCase()}</strong>
        <div class="b2b-label-rule"></div>
        <div class="b2b-label-hero-description">${edit('customer_item_number', 'Customer item')}<span>—</span>${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-center-row"><b>PO #</b> ${runEdit('po_number', 'Enter PO number')}</div>
        <strong class="b2b-label-box-count">${box}</strong>
        <div class="b2b-label-date-caption">EXPECTED DELIVERY BY</div>
        <strong class="b2b-label-date">${runEdit('expected_delivery_date', 'YYYY-MM-DD')}</strong>
        ${barcodeHtml}
      </div>`;
    }

    if (renderer === 'compact_case_3x3') {
      const showInvoice = !!options.show_invoice;
      const showBarcode = !!options.show_barcode || barcodeVisible;
      const panel = `<div class="b2b-label-panel b2b-label-square b2b-label-compact ${showBarcode ? 'has-barcode' : ''}">
        <strong class="b2b-label-customer">${customer.toUpperCase()}</strong>
        <div class="b2b-label-rule"></div>
        <div class="b2b-label-hero-description">${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-row"><b>SKU:</b>${edit(skuField, 'SKU')}</div>
        <div class="b2b-label-row"><b>PO:</b>${runEdit('po_number', 'Enter PO number')}</div>
        ${showInvoice ? `<div class="b2b-label-row"><b>INV:</b>${runEdit('invoice_number', 'Enter invoice number')}</div>` : ''}
        <div class="b2b-label-row"><b>PACK:</b>${edit('case_qty', 'Pack quantity')}</div>
        <strong class="b2b-label-box-count">${box}</strong>
        ${showBarcode ? barcodeHtml : ''}
      </div>`;
      return `<div class="b2b-label-sheet b2b-label-dual b2b-label-dual-side">${panel}${panel}</div>`;
    }

    if (renderer === 'fancy_pallet_3x3') {
      return `<div class="b2b-label-sheet b2b-label-square b2b-label-fancy-pallet">
        <strong class="b2b-label-customer">FANCY SPRINKLES</strong>
        <div class="b2b-label-rule"></div>
        <div class="b2b-label-row"><b>DATE:</b>${runEdit('ship_date', 'YYYY-MM-DD')}</div>
        <div class="b2b-label-row"><b>SKU:</b>${edit(skuField, 'SKU')}</div>
        <div class="b2b-label-row b2b-label-description"><b>NAME:</b>${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-row"><b>QUANTITY:</b>${runEdit('quantity_label', 'Quantity')}</div>
        <div class="b2b-label-row"><b>LOT CODE:</b>${runEdit('lot_number', 'Lot code')}</div>
        <div class="b2b-label-row"><b>BB DATE:</b>${runEdit('best_before', 'Best-before date')}</div>
        <strong class="b2b-label-box-count">Pallet ${carton} of ${total}</strong>
      </div>`;
    }

    if (renderer === 'mixed_case_3x1_5') {
      return `<div class="b2b-label-sheet b2b-label-strip ${barcodeVisible ? 'has-barcode' : ''}">
        <div class="b2b-label-topline"><strong>${customer.toUpperCase()}</strong><strong>${box}</strong></div>
        <div class="b2b-label-hero-description">${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-strip-footer"><span>SKU: ${edit(skuField, 'SKU')}</span><span>${edit('case_qty', 'Qty')} units</span></div>
        <div class="b2b-label-strip-po">PO: ${runEdit('po_number', 'Enter PO number')}</div>
        ${barcodeHtml}
      </div>`;
    }

    if (renderer === 'standard_case_4x6') {
      const panel = `<div class="b2b-label-panel b2b-label-standard ${barcodeVisible ? 'has-barcode' : ''}">
        <strong class="b2b-label-box-count">${box}</strong>
        <div class="b2b-label-rule"></div>
        <strong class="b2b-label-standard-po">PO # ${runEdit('po_number', 'Enter PO number')}</strong>
        <div class="b2b-label-standard-description">${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <strong class="b2b-label-standard-pack">${edit('case_qty', 'Quantity')} units per case</strong>
        <div class="b2b-label-standard-sku">SKU: ${edit(skuField, 'SKU')}</div>
        ${barcodeHtml}
      </div>`;
      return `<div class="b2b-label-sheet b2b-label-dual b2b-label-dual-side">${panel}${panel}</div>`;
    }

    if (renderer === 'standard_case_vertical_4x6') {
      const panel = `<div class="b2b-label-panel b2b-label-standard ${barcodeVisible ? 'has-barcode' : ''}"><strong class="b2b-label-box-count">${box}</strong><div class="b2b-label-rule"></div><strong class="b2b-label-standard-po">PO # ${runEdit('po_number', 'Enter PO number')}</strong><div class="b2b-label-standard-description">${edit('description', 'Product description', 'b2b-edit-wide')}</div><strong class="b2b-label-standard-pack">${edit('case_qty', 'Quantity')} units per case</strong><div class="b2b-label-standard-sku">SKU: ${edit(skuField, 'SKU')}</div>${barcodeHtml}</div>`;
      return `<div class="b2b-label-sheet b2b-label-dual b2b-label-dual-stacked">${panel}${panel}</div>`;
    }

    if (renderer === 'bulk_further_processing_4x6') {
      const manufacturer = [runValue('ship_from_name'), runValue('ship_from')].filter(Boolean).join('<br>') || 'Ship From details';
      const weightField = String(product?.gross_weight_lbs || '').trim() ? 'gross_weight_lbs' : 'package_net_weight_g';
      const weightUnit = weightField === 'gross_weight_lbs' ? 'lb' : 'g';
      return `<div class="b2b-label-sheet b2b-label-bulk ${barcodeVisible ? 'has-barcode' : ''}">
        <strong class="b2b-label-customer">${runEdit('project_name', runValue('name') || 'BULK PACKAGED ITEM', 'b2b-run-project')}</strong>
        <div class="b2b-label-row"><b>ORDER #:</b>${runEdit('order_number', 'Enter order number')}</div>
        <div class="b2b-label-row"><b>PO #:</b>${runEdit('po_number', 'Enter PO number')}</div>
        <div class="b2b-label-row"><b>LOT #:</b>${runEdit('lot_number', 'Enter lot number')}</div>
        <div class="b2b-label-row b2b-label-description"><b>DESCRIPTION:</b>${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-row"><b>ALLERGENS:</b>${runEdit('allergens', 'NONE')}</div>
        <div class="b2b-label-row"><b>NET WT:</b><span>${edit(weightField, 'Weight')} ${weightUnit}</span></div>
        <div class="b2b-label-manufacturer"><b>MANUFACTURED BY:</b><span>${manufacturer}</span></div>
        <div class="b2b-label-statement">${runEdit('required_statement', 'Bulk Packaged Item – Further Processing and / or Labeling Needed for Retail Sale', 'b2b-edit-wide')}</div>
        <strong class="b2b-label-box-count">${box}</strong>
        ${barcodeHtml}
      </div>`;
    }

    return '<div class="b2b-section-empty">This label renderer does not have an editable canvas yet.</div>';
  }

  function fitB2BLabelPreview(canvas) {
    const sheet = canvas?.querySelector('.b2b-label-sheet');
    if (!sheet) return;
    sheet.style.removeProperty('font-size');
    let sheetSize = Number.parseFloat(window.getComputedStyle(sheet).fontSize) || 14;
    while ((sheet.scrollHeight > sheet.clientHeight + 1 || sheet.scrollWidth > sheet.clientWidth + 1) && sheetSize > 8) {
      sheetSize -= 0.5;
      sheet.style.fontSize = `${sheetSize}px`;
    }
    sheet.querySelectorAll('.b2b-label-editable, .b2b-label-topline > *, .b2b-label-customer, .b2b-label-standard-po, .b2b-label-box-count, .b2b-label-date').forEach(element => {
      element.style.removeProperty('font-size');
      let size = Number.parseFloat(window.getComputedStyle(element).fontSize) || sheetSize;
      const availableWidth = Math.max(24, element.parentElement?.clientWidth || element.clientWidth || 24);
      while (element.scrollWidth > availableWidth + 1 && size > 7) {
        size -= 0.5;
        element.style.fontSize = `${size}px`;
      }
    });
  }

  function renderB2BLabelEditor(product = getSelectedB2BProduct(), template = getSelectedB2BTemplate()) {
    const canvas = document.getElementById('b2b-label-editor-canvas');
    const stage = document.getElementById('b2b-label-editor-stage');
    const empty = document.getElementById('b2b-label-editor-empty');
    const meta = document.getElementById('b2b-label-editor-meta');
    if (!canvas || !stage || !empty) return;
    const ready = !!product && !!template;
    stage.classList.toggle('hidden', !ready);
    empty.classList.toggle('hidden', ready);
    if (!ready) {
      canvas.innerHTML = '';
      if (meta) meta.textContent = 'Select a packaging level to load its print layout.';
      return;
    }
    const width = Number(template.physical_width_in || 4);
    const height = Number(template.physical_height_in || 6);
    const sheetWidth = width <= 3 && height >= 3 ? 440 : width <= 3 ? 640 : 720;
    canvas.style.setProperty('--b2b-label-ratio', `${width} / ${height}`);
    canvas.style.setProperty('--b2b-label-max-width', `${sheetWidth}px`);
    canvas.innerHTML = b2bLabelEditorHtml(template, getB2BOutputProduct(product), getSelectedB2BDirectory());
    window.requestAnimationFrame(() => fitB2BLabelPreview(canvas));
    if (meta) {
      const productNote = b2bSelectedProductIndex <= -1000
        ? 'Order-derived product text stays with this job'
        : 'Product text saves automatically';
      meta.innerHTML = `<span>${escapeHtml(template.name || template.template_id)}</span><span>${width} × ${height} in</span><span class="b2b-meta-product">${escapeHtml(productNote)}</span><span class="b2b-meta-run">Print-run text stays with this job</span>`;
    }
  }

  function handleB2BEditorKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function commitB2BLabelEdit(element) {
    const field = String(element?.dataset?.b2bProductEdit || '');
    if (!field || (b2bSelectedProductIndex > -1000 && !hasPermission('table_crud'))) return;
    const value = String(element.innerText || '').replace(/\s+/g, ' ').trim();
    element.classList.toggle('is-empty', !value);
    updateB2BProductField(field, value, false);
    window.requestAnimationFrame(() => fitB2BLabelPreview(document.getElementById('b2b-label-editor-canvas')));
  }

  function commitB2BRunLabelEdit(element) {
    const field = String(element?.dataset?.b2bRunEdit || '');
    if (!field) return;
    const value = String(element.innerText || '').replace(/\s+/g, ' ').trim();
    element.classList.toggle('is-empty', !value);
    updateB2BRunField(field, value, false);
    window.requestAnimationFrame(() => fitB2BLabelPreview(document.getElementById('b2b-label-editor-canvas')));
  }

  function b2bRunFieldNames(template) {
    if (!template) return [];
    return uniqueTextValues([
      ...((template.required_run_fields || []).map(String)),
      ...((template.optional_run_fields || []).map(String)),
      'copies',
      'print_barcode',
    ]);
  }

  function setB2BSelectorVisibility(name, visible) {
    const wrapper = document.querySelector(`[data-b2b-selector-wrap="${name}"]`);
    if (wrapper) wrapper.classList.toggle('hidden', !visible);
  }

  function visibleB2BRunFields(template) {
    const visible = new Set(b2bRunFieldNames(template));
    const required = new Set((template?.required_run_fields || []).map(String));
    document.querySelectorAll('[data-b2b-run-wrap]').forEach(wrapper => {
      const field = wrapper.dataset.b2bRunWrap;
      const isVisible = visible.has(field);
      wrapper.classList.toggle('hidden', !isVisible);
      wrapper.classList.toggle('b2b-run-required', isVisible && required.has(field));
      wrapper.classList.toggle('b2b-run-optional', isVisible && field !== 'copies' && !required.has(field));
      const input = wrapper.querySelector('[data-b2b-run-field]');
      if (input) {
        input.disabled = !isVisible;
        input.required = isVisible && required.has(field);
      }
    });
    const empty = document.getElementById('b2b-run-fields-empty');
    if (empty) empty.classList.toggle('hidden', !!template);
  }

  function showB2BOrderInstancePicker(orderNumber, orderInstances = []) {
    const picker = document.getElementById('b2b-order-instance-picker');
    const count = document.getElementById('b2b-order-instance-count');
    const button = document.getElementById('btn-load-selected-b2b-order');
    const body = document.getElementById('b2b-order-instance-body');
    if (!picker || !body) return;
    body.innerHTML = '';
    orderInstances.forEach(instance => {
      const row = document.createElement('tr');
      const values = [
        String(instance?.ecomdash_id || '').trim(),
        String(instance?.storefront || '').trim(),
        String(instance?.billing_customer_name || '').trim(),
        String(instance?.invoice_date || '').trim(),
        String(Number(instance?.sku_count || 0))
      ];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value || '—';
        if (index === 0) cell.className = 'mpl-order-instance-id';
        row.appendChild(cell);
      });
      const selectCell = document.createElement('td');
      selectCell.className = 'mpl-order-instance-select-column';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'mpl-order-instance-checkbox';
      checkbox.value = String(instance?.ecomdash_id || '').trim();
      checkbox.disabled = !checkbox.value;
      checkbox.setAttribute('aria-label', `Select ECOMDASH ID ${checkbox.value || 'missing'}`);
      checkbox.addEventListener('change', () => selectB2BOrderInstance(checkbox));
      selectCell.appendChild(checkbox);
      row.appendChild(selectCell);
      body.appendChild(row);
    });
    picker.dataset.salesOrderNumber = String(orderNumber || '').trim();
    delete picker.dataset.ecomdashId;
    if (count) count.textContent = `${orderInstances.length} unique order${orderInstances.length === 1 ? '' : 's'}`;
    if (button) button.disabled = true;
    picker.classList.remove('hidden');
  }

  function hideB2BOrderInstancePicker() {
    const picker = document.getElementById('b2b-order-instance-picker');
    if (picker) picker.classList.add('hidden');
  }

  function selectB2BOrderInstance(selectedCheckbox) {
    const picker = document.getElementById('b2b-order-instance-picker');
    const button = document.getElementById('btn-load-selected-b2b-order');
    const help = document.getElementById('b2b-order-instance-selection-help');
    if (!picker || !selectedCheckbox) return;
    picker.querySelectorAll('.mpl-order-instance-checkbox').forEach(checkbox => {
      if (checkbox !== selectedCheckbox) checkbox.checked = false;
    });
    const ecomdashId = selectedCheckbox.checked ? String(selectedCheckbox.value || '').trim() : '';
    if (ecomdashId) picker.dataset.ecomdashId = ecomdashId;
    else delete picker.dataset.ecomdashId;
    if (button) button.disabled = !ecomdashId;
    if (help) help.textContent = ecomdashId ? `ECOMDASH ID ${ecomdashId} selected.` : 'Check one order to continue.';
  }

  function loadSelectedB2BOrderInstance() {
    const picker = document.getElementById('b2b-order-instance-picker');
    const orderNumber = String(picker?.dataset.salesOrderNumber || '').trim();
    const ecomdashId = String(picker?.dataset.ecomdashId || '').trim();
    if (!orderNumber || !ecomdashId) {
      setStatus('Select an ECOMDASH ID before loading the order.', 'error');
      return;
    }
    loadB2BOrderFromAnalytics(null, ecomdashId, orderNumber);
  }

  function completeB2BOrderLoad(payload, orderNumber) {
    const orderDetails = payload?.order_details || {};
    const analyticsItems = Array.isArray(payload?.items) ? payload.items : [];
    const summary = payload?.summary || {};
    const matchedProducts = Number(summary.matched_products || 0);
    const unmatchedProducts = Number(summary.unmatched_products || 0);
    const ambiguousProducts = Number(summary.ambiguous_products || 0);
    const firstMatched = analyticsItems.find(item => item?.product && item.match_status === 'matched');
    const matchedProduct = firstMatched?.product ? normalizeProductRow(firstMatched.product) : null;
    const preliminaryCustomer = String(
      matchedProduct?.storefront
      || orderDetails?.billing_customer_name
      || orderDetails?.storefront
      || ''
    ).trim() || 'Order Customer';
    b2bResolvedOrderContext = resolveOrderContext(payload, { customer: preliminaryCustomer });
    const orderCustomer = b2bResolvedOrderContext.customer || preliminaryCustomer;
    const normalizedOrderCustomer = normalizeStorefront(orderCustomer).toLowerCase();
    const compactOrderCustomer = normalizedOrderCustomer.replace(/[^a-z0-9]+/g, '');
    const customerTemplate = b2bLabelTemplates.find(template => {
      const compactTemplateCustomer = normalizeStorefront(template?.customer || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      return compactTemplateCustomer && (
        compactTemplateCustomer === compactOrderCustomer
        || compactOrderCustomer.includes(compactTemplateCustomer)
        || compactTemplateCustomer.includes(compactOrderCustomer)
      );
    });
    const fallbackTemplateId = String(customerTemplate?.template_id || 'STANDARD_CASE_PACK_4X6');

    b2bOrderFallbackProducts = analyticsItems
      .filter(item => !item?.product || item.match_status !== 'matched')
      .map((item, index) => ({
        storefront: orderCustomer,
        config_id: `ORDER-${String(orderNumber || 'SO').trim()}-${String(item?.sku || index + 1).trim()}`,
        packaging_level: 'Case',
        sku: String(item?.sku || '').trim(),
        customer_item_number: String(item?.customer_item_number || item?.item_number || item?.sku || '').trim(),
        description: String(item?.description || item?.sku || 'Order item').trim(),
        gtin: String(item?.gtin || '').trim(),
        gross_weight_lbs: String(item?.unit_weight_lbs || '').trim(),
        case_qty: '',
        label_template_id: fallbackTemplateId,
        barcode_type: item?.gtin ? 'GTIN_14' : 'NONE',
        verification_status: 'NEEDS_REVIEW',
        label_enabled: true,
        is_active: true,
      }));

    b2bSelectedCustomer = orderCustomer;
    b2bSelectedDirectoryIndex = b2bResolvedOrderContext.directoryShipTo?.index ?? -1;
    const resolvedShipToRow = b2bResolvedOrderContext.directoryShipTo?.row || {};
    b2bResolvedDirectoryFallback = {
      ...resolvedShipToRow,
      storefront: orderCustomer,
      name: resolvedShipToRow.name || orderDetails.ship_to_name || orderDetails.billing_customer_name || orderCustomer,
      dc: resolvedShipToRow.dc || '',
      address: b2bResolvedOrderContext.shipTo?.address || '',
      delivery_address: b2bResolvedOrderContext.shipTo?.address || '',
      billing_address: b2bResolvedOrderContext.billTo?.address || '',
      record_type: 'SHIP_TO',
      address_roles: ['SHIP_TO'],
      default_label_template_id: resolvedShipToRow.default_label_template_id || '',
      is_active: true,
    };
    if (matchedProduct) {
      const productIndex = mplProductMasterRows.findIndex(row => {
        const candidate = normalizeProductRow(row);
        return normalizeStorefront(candidate.storefront).toLowerCase() === normalizeStorefront(matchedProduct.storefront).toLowerCase()
          && normalizePackagingLevel(candidate.packaging_level) === normalizePackagingLevel(matchedProduct.packaging_level)
          && String(candidate.config_id || candidate.sku || '').trim().toLowerCase() === String(matchedProduct.config_id || matchedProduct.sku || '').trim().toLowerCase();
      });
      b2bSelectedGroupKey = mplProductGroupKey(matchedProduct, productIndex);
      b2bSelectedProductIndex = productIndex;
      b2bSelectedTemplateId = String(firstMatched?.label_template_id || matchedProduct.label_template_id || '');
    } else if (b2bOrderFallbackProducts.length) {
      const fallbackProduct = normalizeProductRow(b2bOrderFallbackProducts[0]);
      b2bSelectedProductIndex = -1000;
      b2bSelectedGroupKey = mplProductGroupKey(fallbackProduct, b2bSelectedProductIndex);
      b2bSelectedTemplateId = fallbackProduct.label_template_id || fallbackTemplateId;
    }
    b2bRunFields.order_number = String(orderNumber || '');
    b2bRunFields.po_number = String(orderDetails?.purchase_order_number || orderDetails?.po_number || '');
    b2bRunFields.invoice_number = String(orderDetails?.invoice_number || '');
    b2bRunFields.ship_date = String(orderDetails?.ship_date || orderDetails?.expected_delivery_date || '');
    b2bRunFields.expected_delivery_date = String(orderDetails?.expected_delivery_date || orderDetails?.ship_date || '');
    b2bRunFields.quantity_label = String(analyticsItems.reduce((sum, item) => sum + (Number(item?.quantity_ordered) || 0), 0) || '');
    const selectedOrderItem = firstMatched || analyticsItems[0] || {};
    const selectedOrderProduct = matchedProduct || selectedOrderItem?.product || b2bOrderFallbackProducts[0] || {};
    const orderCartons = resolvedOrderUnitCount(selectedOrderItem, selectedOrderProduct);
    b2bRunFields.carton_total = String(orderCartons);
    b2bRunFields.carton_start = '1';
    b2bRunFields.carton_end = String(orderCartons);
    b2bOrderLabelJobs = buildB2BOrderLabelJobs(analyticsItems, fallbackTemplateId);
    const selectedSku = String(selectedOrderProduct?.sku || selectedOrderItem?.sku || '').trim().toLowerCase();
    b2bSelectedOrderJobIndex = Math.max(0, b2bOrderLabelJobs.findIndex(job => String(job.product?.sku || '').trim().toLowerCase() === selectedSku));
    clearB2BPreview();
    renderB2BCreator();
    const overridePanel = document.getElementById('b2b-selection-overrides');
    if (overridePanel) {
      overridePanel.open = false;
      delete overridePanel.dataset.userOpened;
    }
    setStatus(
      `Sales Order ${orderNumber} loaded · ${analyticsItems.length} line item(s) · ${b2bOrderLabelJobs.length} label job(s) calculated · ${matchedProducts} matched${unmatchedProducts || ambiguousProducts ? ` · ${unmatchedProducts + ambiguousProducts} need review` : ''}. Review the batch, then generate all labels.`,
      unmatchedProducts || ambiguousProducts ? 'info' : 'success'
    );
  }

  function buildB2BOrderLabelJobs(orderItems, fallbackTemplateId) {
    const destination = { ...(b2bResolvedDirectoryFallback || {}) };
    const shipFrom = getSelectedB2BShipFrom();
    destination.ship_from_name = String(shipFrom.name || '').trim();
    destination.ship_from = String(shipFrom.address || shipFrom.ship_from || '').replace(/\\n/g, '\n').trim();
    return (orderItems || []).map((source, index) => {
      const sourceProduct = source?.product || b2bOrderFallbackProducts.find(product => (
        String(product.sku || '').trim().toLowerCase() === String(source?.sku || '').trim().toLowerCase()
      )) || {
        storefront: b2bSelectedCustomer,
        packaging_level: 'Case',
        sku: source?.sku || '',
        customer_item_number: source?.customer_item_number || source?.item_number || source?.sku || '',
        description: source?.description || source?.sku || `Order line ${index + 1}`,
        gtin: source?.gtin || '',
        unit_weight_lbs: source?.unit_weight_lbs || '',
        case_qty: '',
        verification_status: 'NEEDS_REVIEW',
      };
      const product = normalizeProductRow(sourceProduct);
      const configuredTemplateId = String(source?.label_template_id || product.label_template_id || fallbackTemplateId || '').trim();
      const template = b2bLabelTemplates.find(candidate => candidate.template_id === configuredTemplateId)
        || b2bLabelTemplates.find(candidate => candidate.template_id === fallbackTemplateId)
        || b2bLabelTemplates[0]
        || {};
      const templateId = String(template.template_id || configuredTemplateId);
      const groupEntries = mplProductMasterRows
        .map((row, rowIndex) => ({ row: normalizeProductRow(row), index: rowIndex }))
        .filter(entry => mplProductGroupKey(entry.row, entry.index) === mplProductGroupKey(product, index));
      const outermost = mplProductOutermostEntry(groupEntries)?.row;
      const outputProduct = { ...product, label_template_id: templateId };
      ['each_net_weight_g', 'package_net_weight_g', 'gross_weight_lbs', 'length_in', 'width_in', 'height_in'].forEach(field => {
        if (String(outermost?.[field] ?? '').trim()) outputProduct[field] = outermost[field];
      });
      const cartonCount = resolvedOrderUnitCount(source || {}, outputProduct);
      const barcodeDigits = String(outputProduct.gtin || '').replace(/\D/g, '');
      let barcodeType = String(outputProduct.barcode_type || '').trim().toUpperCase().replace(/-/g, '_');
      if (!barcodeType || barcodeType === 'NONE') {
        barcodeType = barcodeDigits.length === 12 ? 'UPC_A'
          : barcodeDigits.length === 13 ? 'EAN_13'
            : barcodeDigits.length === 14 ? 'GTIN_14'
              : barcodeDigits ? 'CODE128' : 'NONE';
        outputProduct.barcode_type = barcodeType;
      }
      const hasBarcode = !!String(outputProduct.gtin || '').trim() && !['', 'NONE'].includes(barcodeType);
      return {
        print_selected: true,
        template_id: templateId,
        product: outputProduct,
        directory: { ...destination },
        run: {
          ...b2bRunFields,
          order_number: String(b2bRunFields.order_number || ''),
          quantity_label: String(source?.quantity_ordered_eaches ?? source?.quantity_ordered ?? ''),
          carton_total: String(cartonCount),
          carton_start: '1',
          carton_end: String(cartonCount),
          copies: String(outputProduct.default_copies || template.default_copies || 1),
          print_barcode: hasBarcode,
        },
        source_quantity: source?.quantity_ordered ?? '',
        match_status: source?.match_status || 'unmatched',
        line_index: index,
      };
    }).filter(job => job.template_id);
  }

  function renderB2BAutomaticResolution() {
    const container = document.getElementById('b2b-auto-resolution');
    const details = document.getElementById('b2b-selection-overrides');
    if (!container) return;
    const product = getSelectedB2BProduct();
    const directory = getSelectedB2BDirectory();
    const template = getSelectedB2BTemplate();
    const loadedOrder = String(b2bRunFields.order_number || '').trim();
    if (!loadedOrder) {
      container.innerHTML = '<div><span>Manual setup</span><strong>Choose a customer and product below</strong><small>Loading a sales order will make these selections automatically.</small></div>';
      container.classList.remove('is-resolved');
      if (details) details.open = true;
      return;
    }
    const destination = directory.name || directory.dc || b2bResolvedOrderContext?.shipTo?.row?.name || 'Order address';
    const values = [
      ['Customer', b2bSelectedCustomer || 'Needs review'],
      ['Product', product?.description || product?.sku || 'Needs review'],
      ['Level', product?.packaging_level || 'Needs review'],
      ['Destination', destination],
      ['Template', template?.name || b2bSelectedTemplateId || 'Needs review'],
      ['Cartons', b2bRunFields.carton_total || '1'],
      ['Order label lines', String(b2bOrderLabelJobs.length || 1)],
    ];
    const orderLinePicker = b2bOrderLabelJobs.length > 1 ? `
      <label class="b2b-order-line-picker"><span>Order line to review</span><select id="b2b-order-line-select" onchange="selectB2BOrderJob(this.value)">${b2bOrderLabelJobs.map((job, index) => {
        const jobProduct = job.product || {};
        const jobTemplate = b2bLabelTemplates.find(candidate => candidate.template_id === job.template_id)?.name || job.template_id;
        const label = `Line ${index + 1} · ${jobProduct.sku || jobProduct.customer_item_number || 'SKU not set'} · ${jobTemplate} · ${job.run?.carton_total || 1} carton(s)`;
        return `<option value="${index}" ${index === b2bSelectedOrderJobIndex ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('')}</select></label>` : '';
    container.innerHTML = `<div class="b2b-resolution-heading"><span>Loaded Sales Order ${escapeHtml(loadedOrder)}</span><strong>LabelKit calculated ${b2bOrderLabelJobs.length || 1} order-line label job(s)</strong><small>Review each line with the selector. The batch is generated only when you choose Generate All.</small></div>${orderLinePicker}<div class="b2b-resolution-grid">${values.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`;
    container.classList.add('is-resolved');
    if (details && !details.dataset.userOpened) details.open = false;
  }

  function selectB2BOrderJob(value) {
    const index = Number(value);
    const job = b2bOrderLabelJobs[index];
    if (!Number.isInteger(index) || !job) return;
    const product = normalizeProductRow(job.product || {});
    const wantedStorefront = normalizeStorefront(product.storefront).toLowerCase();
    const wantedConfig = String(product.config_id || '').trim().toLowerCase();
    const wantedSku = String(product.sku || '').trim().toLowerCase();
    const wantedLevel = normalizePackagingLevel(product.packaging_level);
    const matchedIndex = mplProductMasterRows.findIndex(raw => {
      const row = normalizeProductRow(raw);
      return normalizeStorefront(row.storefront).toLowerCase() === wantedStorefront
        && normalizePackagingLevel(row.packaging_level) === wantedLevel
        && ((wantedConfig && String(row.config_id || '').trim().toLowerCase() === wantedConfig)
          || (!wantedConfig && String(row.sku || '').trim().toLowerCase() === wantedSku));
    });
    let fallbackIndex = -1;
    if (matchedIndex >= 0 && job.match_status === 'matched') {
      b2bSelectedProductIndex = matchedIndex;
      b2bSelectedGroupKey = mplProductGroupKey(mplProductMasterRows[matchedIndex], matchedIndex);
    } else {
      fallbackIndex = b2bOrderFallbackProducts.findIndex(row => String(row.sku || '').trim().toLowerCase() === wantedSku);
      if (fallbackIndex < 0) {
        b2bOrderFallbackProducts.push(product);
        fallbackIndex = b2bOrderFallbackProducts.length - 1;
      }
      b2bSelectedProductIndex = -1000 - fallbackIndex;
      b2bSelectedGroupKey = mplProductGroupKey(product, b2bSelectedProductIndex);
    }
    b2bSelectedCustomer = product.storefront || b2bSelectedCustomer;
    b2bSelectedTemplateId = job.template_id;
    b2bSelectedOrderJobIndex = index;
    b2bResolvedDirectoryFallback = { ...(job.directory || b2bResolvedDirectoryFallback) };
    Object.assign(b2bRunFields, job.run || {});
    b2bSettingsProductIndex = -1;
    clearB2BPreview();
    renderB2BCreator();
  }

  function rememberB2BOverrideState(details) {
    if (!details) return;
    details.dataset.userOpened = details.open ? 'true' : '';
  }

  async function loadB2BOrderFromAnalytics(event, selectedEcomdashId = '', selectedOrderNumber = '') {
    if (event) event.preventDefault();
    const input = document.getElementById('b2b-sales-order-number');
    const orderNumber = String(selectedOrderNumber || input?.value || '').trim();
    const ecomdashId = String(selectedEcomdashId || '').trim();
    if (!orderNumber) {
      setStatus('Enter a Sales Order Number.', 'error');
      if (input) input.focus();
      return;
    }

    setStatus(`Searching order data for Sales Order ${orderNumber}…`, 'info');
    try {
      const response = await fetch('/api/b2b/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_order_number: orderNumber, ecomdash_id: ecomdashId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'The sales order could not be loaded.');
      if (payload.requires_order_selection) {
        showB2BOrderInstancePicker(orderNumber, payload.order_instances || []);
        setStatus(`Sales Order ${orderNumber} matches multiple ECOMDASH IDs. Select the correct storefront/customer order.`, 'info');
        return;
      }
      hideB2BOrderInstancePicker();
      completeB2BOrderLoad(payload, orderNumber);
    } catch (err) {
      setStatus('Error: ' + (err?.message || 'The sales order could not be loaded.'), 'error');
    }
  }

  function renderB2BLabelCoverage() {
    const body = document.getElementById('b2b-label-coverage-body');
    const summary = document.getElementById('b2b-coverage-summary');
    if (!body) return;
    const entries = getB2BProductEntries('');
    const allRows = b2bLabelTemplates.map(template => {
      const templateEntries = entries.filter(entry => entry.row.label_template_id === template.template_id);
      const configurations = new Set(templateEntries.map(entry => mplProductGroupKey(entry.row, entry.index)));
      const levels = uniqueTextValues(templateEntries.map(entry => entry.row.packaging_level));
      const customers = uniqueTextValues(templateEntries.map(entry => entry.row.storefront));
      return {
        template,
        configurations: configurations.size,
        levels,
        customer: customers.join(', ') || template.customer || 'Generic B2B',
      };
    });
    const search = String(document.getElementById('b2b-coverage-search')?.value || '').trim().toLowerCase();
    const status = String(document.getElementById('b2b-coverage-status-filter')?.value || '').trim().toLowerCase();
    const rows = allRows.filter(({ template, configurations, levels, customer }) => {
      const haystack = [customer, template.name, template.template_id, template.physical_width_in, template.physical_height_in, levels].join(' ').toLowerCase();
      return (!search || haystack.includes(search))
        && (!status || (status === 'configured' ? configurations > 0 : configurations === 0));
    });
    body.innerHTML = rows.length
      ? rows.map(({ template, configurations, levels, customer }) => `
          <tr>
            <td><strong>${escapeHtml(customer)}</strong></td>
            <td>${escapeHtml(template.name || template.template_id)}<br><small>${escapeHtml(template.template_id)}</small></td>
            <td>${escapeHtml(`${template.physical_width_in} × ${template.physical_height_in} in`)}</td>
            <td><span class="b2b-coverage-count">${configurations}</span></td>
            <td>${escapeHtml(levels.join(', ') || 'No SKU configured yet')}</td>
          </tr>`).join('')
      : `<tr><td colspan="5">${allRows.length ? 'No label templates match these filters.' : 'No B2B label templates are configured.'}</td></tr>`;
    const count = document.getElementById('b2b-coverage-filter-count');
    if (count) count.textContent = `${rows.length} of ${allRows.length} labels`;
    if (summary) {
      const configured = allRows.filter(row => row.configurations > 0).length;
      const configurationCount = allRows.reduce((total, row) => total + row.configurations, 0);
      summary.textContent = `${allRows.length} label types · ${configured} with product data · ${configurationCount} SKU configurations`;
    }
  }

  function renderB2BCreator() {
    if (selectedKit !== 'b2b') return;
    renderB2BLabelCoverage();
    const customers = uniqueTextValues([
      ...b2bLabelTemplates.map(template => template?.customer),
      ...getB2BProductEntries('').map(entry => entry.row.storefront),
      ...mplDirectoryRows.map(row => normalizeDcDirectoryRow(row).storefront).filter(storefront => !isKeheStorefront(storefront)),
    ]);
    if (!customers.includes(b2bSelectedCustomer)) {
      b2bSelectedCustomer = '';
      b2bSelectedGroupKey = '';
      b2bSelectedProductIndex = -1;
      b2bSelectedDirectoryIndex = -1;
      b2bSelectedTemplateId = '';
    }
    setNativeSelectOptions(document.getElementById('b2b-customer-select'), customers, b2bSelectedCustomer, customers.length ? 'Select customer' : 'No customers available');

    const hasCustomer = !!b2bSelectedCustomer;
    const groups = hasCustomer ? getB2BProductGroups() : [];
    if (!groups.some(group => group.key === b2bSelectedGroupKey)) {
      b2bSelectedGroupKey = '';
      b2bSelectedProductIndex = -1;
      b2bSelectedTemplateId = '';
    }
    const productSelect = document.getElementById('b2b-product-select');
    if (productSelect) {
      productSelect.innerHTML = groups.length
        ? `<option value="">Select product / configuration</option>${groups.map(group => {
            const primary = group.entries.find(entry => entry.row.packaging_level === 'Case')?.row || group.entries[0]?.row || {};
            const label = [primary.description || primary.sku || primary.customer_item_number || 'Unnamed product', primary.config_id || primary.sku || 'No Config ID'].join(' — ');
            return `<option value="${escapeHtml(group.key)}" ${group.key === b2bSelectedGroupKey ? 'selected' : ''}>${escapeHtml(label)}</option>`;
          }).join('')}`
        : '<option value="">No configurations for this customer</option>';
      productSelect.value = b2bSelectedGroupKey;
    }
    setB2BSelectorVisibility('product', hasCustomer);

    const selectedGroup = groups.find(group => group.key === b2bSelectedGroupKey);
    const groupEntries = selectedGroup?.entries || [];
    if (!groupEntries.some(entry => entry.index === b2bSelectedProductIndex)) {
      b2bSelectedProductIndex = -1;
      b2bSelectedTemplateId = '';
    }
    const product = getSelectedB2BProduct();
    const levels = uniqueTextValues(groupEntries.map(entry => entry.row.packaging_level));
    setNativeSelectOptions(document.getElementById('b2b-level-select'), levels, product?.packaging_level || '', levels.length ? 'Select packaging level' : 'No levels');
    setB2BSelectorVisibility('level', !!selectedGroup);

    const directoryEntries = product ? getB2BDirectoryEntries() : [];
    if (!directoryEntries.some(entry => entry.index === b2bSelectedDirectoryIndex)) {
      b2bSelectedDirectoryIndex = b2bResolvedOrderContext
        ? -1
        : ((directoryEntries.find(entry => entry.row.record_type === 'CUSTOMER_DEFAULT') || directoryEntries[0])?.index ?? -1);
    }
    const directorySelect = document.getElementById('b2b-directory-select');
    if (directorySelect) {
      const orderAddressOption = b2bResolvedDirectoryFallback?.delivery_address
        ? `<option value="" ${b2bSelectedDirectoryIndex < 0 ? 'selected' : ''}>Order address — ${escapeHtml(firstLine(b2bResolvedDirectoryFallback.delivery_address))}</option>`
        : '';
      directorySelect.innerHTML = directoryEntries.length
        ? `${orderAddressOption}${directoryEntries.map(entry => `<option value="${entry.index}" ${entry.index === b2bSelectedDirectoryIndex ? 'selected' : ''}>${escapeHtml(`${entry.row.name || entry.row.storefront} — ${entry.row.dc || entry.row.record_type}`)}</option>`).join('')}`
        : '<option value="">No directory record; label values remain editable</option>';
    }
    setB2BSelectorVisibility('directory', !!product && (directoryEntries.length > 0 || !!b2bResolvedDirectoryFallback?.delivery_address));

    const directory = getSelectedB2BDirectory();
    const customerTemplates = product ? b2bLabelTemplates.filter(template => {
      const templateCustomer = normalizeStorefront(template.customer || '').toLowerCase();
      return !templateCustomer || templateCustomer === normalizeStorefront(b2bSelectedCustomer).toLowerCase() || template.template_id === product?.label_template_id;
    }) : [];
    const templateChoices = product?.label_template_id
      ? [product.label_template_id]
      : uniqueTextValues([directory.default_label_template_id, ...customerTemplates.map(template => template.template_id)]);
    if (!templateChoices.includes(b2bSelectedTemplateId)) {
      b2bSelectedTemplateId = templateChoices.length === 1 ? templateChoices[0] : '';
    }
    setNativeSelectOptions(document.getElementById('b2b-template-select'), templateChoices, b2bSelectedTemplateId, 'Select template');
    setB2BSelectorVisibility('template', !!product && templateChoices.length !== 1);

    const template = getSelectedB2BTemplate();
    if (template && b2bCopiesTemplateId !== template.template_id) {
      b2bRunFields.copies = String(template.default_copies || 1);
      b2bRunFields.print_barcode = String(b2bBarcodeConfigured(product));
      b2bCopiesTemplateId = template.template_id;
    }
    if (!template) b2bCopiesTemplateId = '';
    document.querySelectorAll('[data-b2b-run-field]').forEach(input => {
      const value = b2bRunFields[input.dataset.b2bRunField] ?? '';
      if (input.type === 'checkbox') input.checked = parseBooleanLike(value, false);
      else input.value = value;
    });
    visibleB2BRunFields(template);
    renderB2BProductSettings(product, template);
    renderB2BLabelEditor(product, template);

    const summary = document.getElementById('b2b-template-summary');
    if (summary) {
      if (!hasCustomer) summary.textContent = 'Start by selecting a customer.';
      else if (!selectedGroup) summary.textContent = 'Now select the product or configuration for this customer.';
      else if (!product) summary.textContent = 'Choose the packaging level to load its exact product data and label requirements.';
      else if (!template) summary.textContent = 'Choose the label template for this packaging level.';
      else summary.textContent = `${template.name || template.template_id} · ${template.physical_width_in} × ${template.physical_height_in} in · ${template.default_copies || 1} default cop${Number(template.default_copies || 1) === 1 ? 'y' : 'ies'} per carton. Only applicable print-run fields are shown below.`;
    }
    renderB2BAutomaticResolution();
    const title = document.getElementById('b2b-preview-title');
    if (title) title.textContent = template ? `Generate ${template.name || 'label'}` : 'Generate print-ready PDF';
    renderB2BValidation();
  }

  function selectB2BCustomer(value) {
    b2bSelectedCustomer = String(value || '');
    b2bSelectedGroupKey = '';
    b2bSelectedProductIndex = -1;
    b2bSelectedDirectoryIndex = -1;
    b2bSelectedTemplateId = '';
    b2bResolvedOrderContext = null;
    b2bResolvedDirectoryFallback = {};
    clearB2BPreview();
    renderB2BCreator();
  }

  function selectB2BProduct(value) {
    b2bSelectedGroupKey = String(value || '');
    b2bSelectedProductIndex = -1;
    b2bSelectedTemplateId = '';
    clearB2BPreview();
    renderB2BCreator();
  }

  function selectB2BLevel(value) {
    const entry = getB2BProductEntries().find(candidate => (
      mplProductGroupKey(candidate.row, candidate.index) === b2bSelectedGroupKey
      && normalizePackagingLevel(candidate.row.packaging_level) === normalizePackagingLevel(value)
    ));
    b2bSelectedProductIndex = entry?.index ?? -1;
    b2bSelectedTemplateId = entry?.row?.label_template_id || b2bSelectedTemplateId;
    clearB2BPreview();
    renderB2BCreator();
  }

  function selectB2BTemplate(value) {
    b2bSelectedTemplateId = String(value || '');
    const template = getSelectedB2BTemplate();
    b2bRunFields.copies = String(template?.default_copies || 1);
    b2bRunFields.print_barcode = String(b2bBarcodeConfigured());
    clearB2BPreview();
    renderB2BCreator();
  }

  function selectB2BDirectory(value) {
    const parsed = String(value || '').trim() ? Number(value) : -1;
    b2bSelectedDirectoryIndex = Number.isInteger(parsed) ? parsed : -1;
    clearB2BPreview();
    renderB2BLabelEditor();
    renderB2BValidation();
  }

  function updateB2BProductField(field, value, rerenderEditor = true) {
    const fallbackIndex = b2bSelectedProductIndex <= -1000 ? -1000 - b2bSelectedProductIndex : -1;
    if (fallbackIndex >= 0) {
      if (!b2bOrderFallbackProducts[fallbackIndex]) return;
      b2bOrderFallbackProducts[fallbackIndex][field] = value;
    } else {
      if (b2bSelectedProductIndex < 0 || !hasPermission('table_crud')) return;
      const targetIndex = B2B_FINAL_PRODUCT_FIELDS.has(field)
        ? (getSelectedB2BFinalCaseEntry()?.index ?? b2bSelectedProductIndex)
        : b2bSelectedProductIndex;
      updateMplProductRow(targetIndex, field, value);
    }
    const state = document.getElementById('b2b-product-save-state');
    if (state) state.textContent = fallbackIndex >= 0 ? 'Updated for this label job' : 'Saving to Product Master…';
    clearB2BPreview();
    renderB2BProductSettings(getSelectedB2BProduct(), getSelectedB2BTemplate());
    if (rerenderEditor) renderB2BLabelEditor();
    renderB2BValidation();
    window.setTimeout(() => {
      if (state) state.textContent = fallbackIndex >= 0 ? 'Order-only values · not saved to Product Master' : 'Saved automatically';
    }, 750);
  }

  function updateB2BRunField(field, value, rerenderEditor = true) {
    b2bRunFields[field] = String(value ?? '');
    clearB2BPreview();
    if (rerenderEditor) renderB2BLabelEditor();
    renderB2BValidation();
  }

  function buildB2BPayload() {
    const product = getB2BOutputProduct();
    const template = getSelectedB2BTemplate();
    const directory = Object.fromEntries(Object.entries(getSelectedB2BDirectory()).map(([field, value]) => [
      field,
      typeof value === 'string' ? value.replace(/\\n/g, '\n') : value,
    ]));
    const shipFrom = getSelectedB2BShipFrom();
    directory.ship_from_name = String(shipFrom.name || '').trim();
    directory.ship_from = String(shipFrom.address || shipFrom.ship_from || '').replace(/\\n/g, '\n').trim();
    const run = {};
    b2bRunFieldNames(template).forEach(field => {
      run[field] = b2bRunFields[field] ?? '';
    });
    return {
      template_id: b2bSelectedTemplateId,
      product: product || {},
      directory,
      run,
    };
  }

  function b2bJobValue(payload, field) {
    for (const source of [payload.run || {}, payload.product || {}, payload.directory || {}]) {
      const value = source[field];
      if (String(value ?? '').trim()) return String(value).trim();
    }
    return '';
  }

  function getB2BValidationWarnings() {
    const payload = buildB2BPayload();
    const template = getSelectedB2BTemplate();
    const product = getSelectedB2BProduct();
    const warnings = [];
    if (!b2bSelectedCustomer) return ['Select a customer.'];
    if (!b2bSelectedGroupKey) return ['Select a product configuration.'];
    if (!product) return ['Select a packaging level.'];
    if (!template) warnings.push('Select a supported label template.');
    (template?.required_product_fields || []).forEach(field => {
      if (!b2bJobValue(payload, field)) warnings.push(`${String(field).replace(/_/g, ' ')} is blank for this template.`);
    });
    (template?.required_run_fields || []).forEach(field => {
      if (!b2bJobValue(payload, field)) warnings.push(`${String(field).replace(/_/g, ' ')} is blank for this print run.`);
    });
    if (['carton_start', 'carton_end', 'carton_total'].every(field => b2bRunFieldNames(template).includes(field))) {
      const start = Number(payload.run.carton_start || 0);
      const end = Number(payload.run.carton_end || 0);
      const total = Number(payload.run.carton_total || 0);
      if (!(start >= 1 && end >= start && total >= end)) warnings.push('Carton range must be Start ≥ 1, End ≥ Start, and Total ≥ End.');
    }
    if (product && String(product.verification_status || '').toUpperCase() !== 'VERIFIED') {
      warnings.push(`Data status is ${product.verification_status || 'not set'}. Admin preview and printing remain available.`);
    }
    if (product && !product.label_enabled) {
      warnings.push('Available in Label Creator is off. You can still preview or print this row as an Admin.');
    }
    return uniqueTextValues(warnings);
  }

  function renderB2BValidation() {
    const warnings = getB2BValidationWarnings();
    const hasTechnicalSelection = !!getSelectedB2BProduct() && !!getSelectedB2BTemplate();
    const selectionPrompt = !b2bSelectedCustomer
      ? 'Select customer'
      : !b2bSelectedGroupKey
        ? 'Select product'
        : !getSelectedB2BProduct()
          ? 'Select level'
          : !getSelectedB2BTemplate()
            ? 'Select template'
            : '';
    const validation = document.getElementById('b2b-validation');
    if (validation) {
      validation.innerHTML = warnings.length
        ? warnings.map(warning => `<div class="warning">${escapeHtml(warning)}</div>`).join('')
        : '<div class="ready">Configuration is ready to print.</div>';
      if (!b2bPreviewUrl && hasTechnicalSelection) {
        validation.insertAdjacentHTML('beforeend', '<div class="preview-stale-warning">Preview has changed or has not been rendered. Generate the PDF before printing.</div>');
      }
    }
    const badge = document.getElementById('b2b-configuration-status');
    if (badge) {
      badge.textContent = selectionPrompt || (warnings.length ? `${warnings.length} review item${warnings.length === 1 ? '' : 's'}` : 'Ready to print');
      badge.className = `b2b-state-badge ${selectionPrompt ? '' : warnings.length ? 'review' : 'ready'}`;
    }
    const renderButton = document.getElementById('b2b-render-button');
    if (renderButton) {
      renderButton.disabled = !hasTechnicalSelection;
      renderButton.textContent = b2bOrderLabelJobs.length && b2bRunFields.order_number
        ? `Generate All ${b2bOrderLabelJobs.length} Labels & Open PDF`
        : 'Generate & Open PDF';
    }
  }

  function clearB2BPreview() {
    if (b2bPreviewUrl) {
      if (blobUrl === b2bPreviewUrl) blobUrl = null;
      URL.revokeObjectURL(b2bPreviewUrl);
    }
    b2bPreviewUrl = null;
    setDownloadReady(false);
    renderB2BValidation();
  }

  async function generateB2BPreview(openFullPreview = false) {
    const orderBatch = b2bOrderLabelJobs.length > 0 && !!String(b2bRunFields.order_number || '').trim();
    const product = getSelectedB2BProduct();
    const template = getSelectedB2BTemplate();
    if (!orderBatch && (!product || !template)) {
      setStatus('Select a product configuration and label template first.', 'error');
      return false;
    }
    if (!(await confirmDocumentReadiness('b2b'))) return false;
    const job = orderBatch ? null : buildB2BPayload();
    const jobs = orderBatch ? b2bOrderLabelJobs.map(row => JSON.parse(JSON.stringify(row))) : [];
    if (orderBatch) {
      const selectedSku = String(product?.sku || '').trim().toLowerCase();
      const currentJob = buildB2BPayload();
      const selectedLevel = normalizePackagingLevel(product?.packaging_level);
      const selectedBatchJob = jobs.find(row => (
        String(row.product?.sku || '').trim().toLowerCase() === selectedSku
        && normalizePackagingLevel(row.product?.packaging_level) === selectedLevel
      ));
      if (selectedBatchJob && selectedSku) {
        selectedBatchJob.product = { ...currentJob.product, label_template_id: b2bSelectedTemplateId };
        selectedBatchJob.template_id = b2bSelectedTemplateId;
        selectedBatchJob.directory = currentJob.directory;
        selectedBatchJob.run = { ...selectedBatchJob.run, ...currentJob.run };
      }
    }
    const button = document.getElementById('b2b-render-button');
    if (button) button.disabled = true;
    setStatus(orderBatch ? 'Rendering labels for every order line…' : 'Rendering B2B label PDF…', 'info');
    showWorkflowProgress(3, orderBatch ? `Preparing ${jobs.length} order-line label jobs…` : 'Preparing the selected label job…');
    try {
      const response = await fetch(orderBatch ? '/api/b2b/render-batch' : '/api/b2b/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBatch ? { jobs } : job),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || 'Could not render B2B labels.');
      }
      const pdf = await response.blob();
      clearB2BPreview();
      b2bPreviewUrl = URL.createObjectURL(pdf);
      blobUrl = b2bPreviewUrl;
      const filename = orderBatch
        ? `${String(b2bRunFields.order_number || 'order').replace(/[^a-z0-9_-]+/gi, '_')}_case_labels.pdf`
        : `${b2bSelectedTemplateId.toLowerCase()}.pdf`;
      document.getElementById('btn-download').download = filename;
      document.getElementById('btn-download-label').textContent = 'Save PDF';
      setDownloadReady(true, b2bPreviewUrl);
      setActivePreviewFormat('rollo');
      const pages = response.headers.get('X-B2B-Page-Count') || '';
      await recordGeneratedOutput('b2b-labels', {
        scope: 'b2b',
        name: filename,
        labelType: orderBatch ? 'All B2B order-line labels' : (template.name || b2bSelectedTemplateId),
        labels: orderBatch
          ? jobs.reduce((total, row) => total + Math.max(1, Number(row.run?.copies || 1)) * Math.max(1, Number(row.run?.carton_total || 1)), 0)
          : Math.max(1, Number(job.run?.copies || 1)) * Math.max(1, Number(job.run?.carton_total || 1)),
        pages,
        blob: pdf,
      });
      updateWorkflowProgress('Opening preview', 'Opening the completed label preview…');
      renderB2BValidation();
      setStatus(`${orderBatch ? `All ${jobs.length} order line(s) included. ` : ''}B2B label PDF ready${pages ? ` · ${pages} page${pages === '1' ? '' : 's'}` : ''}. Review warnings are advisory for Admin printing.`, 'success');
      if (openFullPreview) {
        resetPreviewSurface();
        await openPreview();
      }
      closeWorkflowProgress();
      if (!options.automatic) showPrintSummary('b2b');
      return true;
    } catch (err) {
      closeWorkflowProgress();
      setStatus(`B2B label generation failed: ${err.message || 'unknown error'}`, 'error');
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function downloadB2BLabels() {
    if (!b2bPreviewUrl && !(await generateB2BPreview(false))) return;
    const link = document.createElement('a');
    link.href = b2bPreviewUrl;
    link.download = `${(b2bSelectedTemplateId || 'b2b_case_pack').toLowerCase()}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function printB2BLabels() {
    if (!b2bPreviewUrl && !(await generateB2BPreview(false))) return;
    printActivePreview();
  }
