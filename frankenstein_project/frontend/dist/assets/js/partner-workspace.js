/* DecoPac, Dutch Bros, and Fancy partner workflow. */
  function revokePartnerPreviewUrls() {
    [partnerLabelsPreviewUrl, partnerPalletLabelsPreviewUrl, partnerMplPreviewUrl].filter(Boolean).forEach(url => URL.revokeObjectURL(url));
    partnerLabelsPreviewUrl = null;
    partnerPalletLabelsPreviewUrl = null;
    partnerMplPreviewUrl = null;
    window.clearGeneratedOutputs?.('partners-packLabels', 'partners-palletLabel', 'partners-mpl');
    renderPartnerSelectionState();
  }

  async function selectPartnerWorkspace(updateHistory = true) {
    selectedKit = 'partners';
    document.body.dataset.module = 'partners';
    document.title = 'DecoPac / Dutch Bros / Fancy · LabelKit';
    document.getElementById('kit-selection').classList.add('hidden');
    document.getElementById('upload-page').classList.add('hidden');
    document.getElementById('mpl-workspace-page').classList.add('hidden');
    document.getElementById('b2b-workspace-page').classList.add('hidden');
    document.getElementById('partner-workspace-page').classList.remove('hidden');
    document.getElementById('btn-change-kit').classList.add('visible');
    document.getElementById('header-app-name').textContent = 'DecoPac / Dutch Bros / Fancy';
    document.getElementById('header-app-sub').textContent = '';
    document.getElementById('header-app-sub').classList.add('hidden');
    hideAllRouteViews();
    setStatus('', '');

    mplProductMasterRows = loadMplProductMasterFromStorage();
    mplDirectoryRows = loadMplDirectoryFromStorage();
    mplProductMasterLoadPromise = loadMplProductMasterFromBackend();
    mplDirectoryLoadPromise = loadMplDirectoryFromBackend();
    await Promise.allSettled([mplProductMasterLoadPromise, mplDirectoryLoadPromise, loadB2BLabelTemplates()]);
    renderPartnerWorkspace();

    if (updateHistory) setHistoryPage('partners');
  }

  function setPartnerOrderBusy(busy) {
    const input = document.getElementById('partner-sales-order-number');
    const button = document.getElementById('btn-load-partner-order');
    if (input) input.disabled = !!busy;
    if (button) {
      button.disabled = !!busy;
      button.textContent = busy ? 'Loading…' : 'Load Order';
    }
  }

  function partnerCustomerIdFromText(value) {
    const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const padded = ` ${normalized} `;
    const compact = normalized.replaceAll(' ', '');
    for (const customerId of PARTNER_CUSTOMER_IDS) {
      const aliases = PARTNER_WORKFLOW_CONFIG[customerId]?.detectionAliases || [];
      if (aliases.some(alias => {
        const normalizedAlias = String(alias || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const compactAlias = normalizedAlias.replaceAll(' ', '');
        return normalizedAlias && (
          padded.includes(` ${normalizedAlias} `)
          || compact.includes(compactAlias)
        );
      })) return customerId;
    }
    return '';
  }

  function detectPartnerCustomer(payload) {
    const backendCustomer = String(payload?.detected_partner_customer || '').trim();
    if (PARTNER_WORKFLOW_CONFIG[backendCustomer]) return backendCustomer;
    const candidates = [
      payload?.order_details?.email_id,
      payload?.order_details?.email,
      payload?.order_details?.storefront,
      payload?.order_details?.billing_customer_name,
      payload?.order_details?.ship_to_name,
      ...(payload?.items || []).flatMap(item => [
        item?.product?.storefront,
        ...(item?.candidate_storefronts || [])
      ])
    ].map(value => normalizeStorefront(value || '').toLowerCase()).filter(Boolean);
    return partnerCustomerIdFromText(candidates.join(' | '));
  }

  function partnerCustomerLabel(customerId = partnerCustomerId) {
    return PARTNER_WORKFLOW_CONFIG[customerId]?.label || 'Unknown';
  }

  function partnerTemplateForItem(item, customerId) {
    const configured = String(item?.product?.label_template_id || item?.label_template_id || '').trim();
    const allowed = PARTNER_WORKFLOW_CONFIG[customerId]?.labelTemplateIds || [];
    if (allowed.includes(configured)) return configured;
    const source = `${item?.product?.storefront || ''} ${item?.product?.packaging_level || ''} ${item?.description || ''}`.toLowerCase();
    if (customerId === 'dutch_bros') return source.includes('pfg') ? allowed[0] : allowed[1];
    if (customerId === 'fancy') return /master\s*(pack|case)|\bmp\b/.test(source) ? allowed[1] : allowed[0];
    return allowed[0] || '';
  }

  function calculateOrderCartonCount(item, product) {
    const ordered = Number(String(item?.quantity_ordered ?? '').replace(/,/g, ''));
    const casePack = Number(String(product?.case_qty ?? '').replace(/,/g, ''));
    if (!Number.isFinite(ordered) || ordered <= 0) return 1;
    const quantityUom = String(item?.quantity_uom || '').trim().toUpperCase().replace(/\s+/g, '_');
    const productLevel = normalizePackagingLevel(product?.packaging_level).toUpperCase().replace(/\s+/g, '_');
    if (quantityUom && quantityUom === productLevel) return Math.max(1, Math.ceil(ordered));
    if (Number.isFinite(casePack) && casePack > 0) return Math.max(1, Math.ceil(ordered / casePack));
    return Math.max(1, Math.ceil(ordered));
  }

  function partnerBarcodeType(product) {
    const configured = String(product?.barcode_type || '').trim().toUpperCase().replace(/-/g, '_');
    if (configured && configured !== 'NONE') return configured;
    const digits = String(product?.gtin || '').replace(/\D/g, '');
    if (digits.length === 12) return 'UPC_A';
    if (digits.length === 13) return 'EAN_13';
    if (digits.length === 14) return 'GTIN_14';
    return digits ? 'CODE128' : 'NONE';
  }

  function partnerFinalCaseProduct(product, customer) {
    const configId = String(product?.config_id || '').trim().toLowerCase();
    const sku = String(product?.sku || '').trim().toLowerCase();
    return mplProductMasterRows.map(normalizeProductRow).find(row => (
      normalizePackagingLevel(row.packaging_level) === 'Case'
      && normalizeStorefront(row.storefront).toLowerCase().includes(String(customer || '').toLowerCase())
      && (
        (configId && String(row.config_id || '').trim().toLowerCase() === configId)
        || (!configId && sku && String(row.sku || '').trim().toLowerCase() === sku)
      )
    )) || null;
  }

  function partnerDirectoryRows(customerId = partnerCustomerId) {
    const config = PARTNER_WORKFLOW_CONFIG[customerId] || {};
    const customerNames = [config.label, ...(config.detectionAliases || [])]
      .map(value => normalizeStorefront(value).toLowerCase())
      .filter(Boolean);
    if (!customerNames.length) return [];
    return mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.is_active !== false)
      .filter(row => {
        const storefront = normalizeStorefront(row.storefront).toLowerCase();
        if (!storefront) return false;
        return customerNames.some(name => storefront === name || storefront.includes(name) || name.includes(storefront));
      });
  }

  function partnerAddressValue(field) {
    const mpl = partnerMplDraft?.packing_lists?.[0] || {};
    if (field === 'ship_from') return String(mpl.supplier_info || '');
    if (field === 'billing_address') return String(mpl.bill_to || '');
    return String(mpl.ship_to || '');
  }

  function partnerAddressOptions(field) {
    const options = [];
    const seen = new Set();
    const wantedType = field === 'ship_from' ? 'SHIP_FROM' : (field === 'billing_address' ? 'BILL_TO' : 'SHIP_TO');
    const directoryRows = (field === 'ship_from'
      ? mplDirectoryRows.map(normalizeDcDirectoryRow).filter(row => row.is_active !== false)
      : partnerDirectoryRows())
      .filter(row => directoryHasRole(row, wantedType));
    const sharedOrigin = field === 'ship_from' ? getSharedMplDirectoryShipFrom() : '';
    directoryRows.forEach((row, index) => {
      const value = String(row.address || row[field] || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      const record = [row.name, row.dc ? `DC ${row.dc}` : ''].filter(Boolean).join(' · ') || `Directory record ${index + 1}`;
      const label = field === 'ship_from'
        ? `${value === sharedOrigin ? 'Default' : 'Saved origin'} — ${firstLine(value) || value}`
        : `${record} — ${firstLine(value) || value}`;
      options.push({ value, label, source: 'directory' });
    });
    const current = partnerAddressValue(field).trim();
    if (current && !seen.has(current)) options.unshift({ value: current, label: `Current order — ${firstLine(current) || current}`, source: 'order' });
    return options;
  }

  function renderPartnerAddressSelectors() {
    const container = document.getElementById('partner-address-selectors');
    if (!container) return;
    const fields = [
      ['ship_from', 'Ship From'],
      ['delivery_address', 'Ship To'],
      ['billing_address', 'Bill To'],
    ];
    container.innerHTML = fields.map(([field, label]) => {
      const options = partnerAddressOptions(field);
      const current = partnerAddressValue(field).trim();
      const savedCount = options.filter(option => option.source === 'directory').length;
      const select = options.length
        ? `<select onchange="selectPartnerAddress('${field}', this.value)">${options.map(option => `<option value="${escapeHtml(option.value)}" ${option.value === current ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`
        : `<select disabled><option>No ${escapeHtml(label)} addresses saved</option></select>`;
      const note = savedCount
        ? `${savedCount} saved for ${partnerCustomerLabel()}`
        : (current ? `Using the order value; no saved ${label} address` : `No ${label} address available`);
      return `<label><span>${escapeHtml(label)}</span>${select}<small>${escapeHtml(note)}</small></label>`;
    }).join('');
    enhanceSearchableSelects(container);
  }

  function selectPartnerAddress(field, value) {
    if (!['ship_from', 'delivery_address', 'billing_address'].includes(field)) return;
    const address = String(value || '').trim();
    const matchedRow = partnerDirectoryRows().find(row => String(row.address || row[field] || '').trim() === address) || {};
    partnerLabelJobs.forEach(job => {
      job.directory = { ...(job.directory || {}), [field]: address };
      if (field === 'delivery_address') {
        job.directory.name = matchedRow.name || job.directory.name || partnerCustomerLabel();
        job.directory.dc = matchedRow.dc || job.directory.dc || '';
      }
    });
    const mpl = partnerMplDraft?.packing_lists?.[0];
    if (mpl) {
      if (field === 'ship_from') mpl.supplier_info = address;
      else if (field === 'billing_address') mpl.bill_to = address;
      else {
        mpl.ship_to = address;
        mpl.dc = matchedRow.dc || mpl.dc || '';
        mpl.dc_name = matchedRow.name || mpl.dc_name || '';
      }
    }
    ['packLabels', 'palletLabel', 'masterPackingList'].forEach(markPartnerPreviewStale);
    renderPartnerWorkspace();
    setStatus(`${directoryAddressLabel(field)} updated for this order.`, 'success');
  }

  function buildPartnerLabelJobs(payload, customerId) {
    const details = payload?.order_details || {};
    const customer = partnerCustomerLabel(customerId);
    const shippingAddress = analyticsMplAddress(details, 'shipping');
    const directoryRows = partnerDirectoryRows(customerId);
    const shipToRecord = directoryRows.find(row => directoryHasRole(row, 'SHIP_TO')) || {};
    const billToRecord = directoryRows.find(row => directoryHasRole(row, 'BILL_TO')) || {};
    const shipFromRecord = mplDirectoryRows.map(normalizeDcDirectoryRow).find(row => row.is_active !== false && directoryHasRole(row, 'SHIP_FROM')) || {};
    const directory = {
      ...shipToRecord,
      ship_from: shipFromRecord.address || getSharedMplDirectoryShipFrom(),
      delivery_address: shipToRecord.address || '',
      billing_address: billToRecord.address || '',
    };
    const makeJob = (item, index, requestedTemplateId = '') => {
      const product = normalizeProductRow(item?.product || {
        storefront: customer,
        packaging_level: 'Case',
        sku: item?.sku || '',
        customer_item_number: item?.customer_item_number || item?.item_number || item?.sku || '',
        description: item?.description || item?.sku || 'Order item',
        gtin: item?.gtin || '',
        gross_weight_lbs: item?.unit_weight_lbs || '',
        case_qty: '',
        verification_status: 'NEEDS_REVIEW',
      });
      const templateId = requestedTemplateId || partnerTemplateForItem(item, customerId);
      const matchingProduct = mplProductMasterRows.map(normalizeProductRow).find(row => (
        (
          String(row.sku || '').trim().toLowerCase() === String(product.sku || '').trim().toLowerCase()
          || (String(product.config_id || '').trim() && String(row.config_id || '').trim().toLowerCase() === String(product.config_id || '').trim().toLowerCase())
        )
        && normalizeStorefront(row.storefront).toLowerCase().includes(customer.toLowerCase())
        && row.label_template_id === templateId
        && row.is_active !== false
      ));
      const resolvedProduct = { ...(matchingProduct || product) };
      const finalCaseProduct = partnerFinalCaseProduct(resolvedProduct, customer);
      ['each_net_weight_g', 'package_net_weight_g', 'gross_weight_lbs', 'length_in', 'width_in', 'height_in'].forEach(field => {
        if (String(finalCaseProduct?.[field] ?? '').trim()) resolvedProduct[field] = finalCaseProduct[field];
      });
      if (templateId === 'FANCY_PALLET_3X3') resolvedProduct.packaging_level = 'Pallet';
      const template = b2bLabelTemplates.find(candidate => candidate.template_id === templateId) || {};
      const cartons = calculateOrderCartonCount(item, resolvedProduct);
      resolvedProduct.barcode_type = partnerBarcodeType(resolvedProduct);
      return {
        print_selected: true,
        template_id: templateId,
        product: { ...resolvedProduct, storefront: customer },
        directory: {
          ...directory,
          name: directory.name || details.ship_to_name || customer,
          delivery_address: directory.delivery_address || shippingAddress,
        },
        run: {
          order_number: String(payload?.sales_order_number || ''),
          po_number: String(details.purchase_order_number || details.po_number || payload?.sales_order_number || ''),
          invoice_number: String(details.invoice_number || ''),
          lot_number: '',
          best_before: '',
          ship_date: String(details.ship_date || details.expected_delivery_date || ''),
          quantity_label: String(item?.quantity_ordered || ''),
          expected_delivery_date: String(details.expected_delivery_date || details.ship_date || ''),
          carton_total: String(cartons),
          carton_start: '1',
          carton_end: String(cartons),
          copies: String(resolvedProduct.default_copies || template.default_copies || 1),
          print_barcode: !!(resolvedProduct.gtin && resolvedProduct.barcode_type !== 'NONE'),
        },
        source_quantity: item?.quantity_ordered ?? '',
        match_status: item?.match_status || 'unmatched',
        line_index: index,
      };
    };

    const items = payload?.items || [];
    const jobs = [];
    items.forEach((item, index) => jobs.push(makeJob(item, index)));

    const palletCount = Math.max(1, Math.ceil(Number(details.total_pallets || details.pallet_count || 1) || 1));
    const firstItem = items[0] || {};
    if (customerId === 'fancy' && items.length) {
      const palletJob = makeJob(firstItem, 0, 'FANCY_PALLET_3X3');
      palletJob.product.description = firstItem?.product?.description || firstItem?.description || palletJob.product.description;
      palletJob.run.carton_total = String(palletCount);
      palletJob.run.carton_end = String(palletCount);
      palletJob.run.copies = '2';
      palletJob.run.quantity_label = String(items.reduce((sum, item) => sum + (Number(item?.quantity_ordered) || 0), 0) || '');
      palletJob.run.print_barcode = false;
      palletJob.match_status = firstItem?.match_status || 'unmatched';
      jobs.push(palletJob);
    }
    return jobs;
  }

  function buildPartnerMplDraft(payload, customerId) {
    const mplTemplateId = PARTNER_WORKFLOW_CONFIG[customerId]?.mplTemplateId || 'standard';
    const draft = buildAnalyticsOrderMplDraft(payload, mplTemplateId);
    draft.template_id = mplTemplateId;
    draft.brand_id = 'bakell';
    draft.storefront = partnerCustomerLabel(customerId);
    const mpl = draft.packing_lists?.[0];
    if (mpl) {
      const directoryRows = partnerDirectoryRows(customerId);
      const shipToRecord = directoryRows.find(row => directoryHasRole(row, 'SHIP_TO')) || {};
      const billToRecord = directoryRows.find(row => directoryHasRole(row, 'BILL_TO')) || {};
      const shipFromRecord = mplDirectoryRows.map(normalizeDcDirectoryRow).find(row => row.is_active !== false && directoryHasRole(row, 'SHIP_FROM')) || {};
      const directory = {
        ...shipToRecord,
        ship_from: shipFromRecord.address || getSharedMplDirectoryShipFrom(),
        delivery_address: shipToRecord.address || '',
        billing_address: billToRecord.address || '',
      };
      mpl.template_id = mplTemplateId;
      mpl.brand_id = 'bakell';
      mpl.storefront = partnerCustomerLabel(customerId);
      mpl.supplier_info = directory.ship_from || mpl.supplier_info || '';
      mpl.ship_to = directory.delivery_address || mpl.ship_to || '';
      mpl.bill_to = directory.billing_address || mpl.bill_to || '';
      mpl.dc = directory.dc || mpl.dc || '';
      mpl.dc_name = directory.name || mpl.dc_name || '';
      (mpl.items || []).forEach((row, index) => {
        const source = payload?.items?.[index] || {};
        const product = source?.product || {};
        const cartons = calculateOrderCartonCount(source, product);
        row.analytics_quantity_eaches = analyticsOrderQuantity(source?.quantity_ordered_eaches ?? source?.quantity_ordered);
        row.eaches_per_case = analyticsOrderQuantity(product?.case_qty);
        row.qty_on_pallet = String(cartons);
        row.total_ordered = String(cartons);
        row.total_shipped = String(cartons);
        row.quantity_per_case = String(product?.case_qty || row.quantity_per_case || '');
        row.uom = String(source?.quantity_uom || 'CASES').replace(/_/g, ' ');
      });
      ensureMplPalletState(mpl);
      syncMplLineNumbers(mpl);
    }
    return draft;
  }

  function showPartnerOrderInstances(orderNumber, instances) {
    const picker = document.getElementById('partner-order-instance-picker');
    const select = document.getElementById('partner-order-instance-select');
    if (!picker || !select) return;
    picker.dataset.salesOrderNumber = orderNumber;
    select.innerHTML = (instances || []).map(instance => `<option value="${escapeHtml(instance.ecomdash_id || '')}">${escapeHtml(`${instance.ecomdash_id || 'No ID'} · ${instance.email_id || instance.storefront || instance.billing_customer_name || 'Unknown customer'} · ${instance.invoice_date || 'No date'} · ${instance.sku_count || 0} SKU(s)`)}</option>`).join('');
    picker.classList.remove('hidden');
  }

  function loadSelectedPartnerOrder() {
    const picker = document.getElementById('partner-order-instance-picker');
    const orderNumber = String(picker?.dataset.salesOrderNumber || '').trim();
    const ecomdashId = String(document.getElementById('partner-order-instance-select')?.value || '').trim();
    loadPartnerOrder(null, ecomdashId, orderNumber);
  }

  async function loadPartnerOrder(event, selectedEcomdashId = '', selectedOrderNumber = '') {
    event?.preventDefault();
    const input = document.getElementById('partner-sales-order-number');
    const orderNumber = String(selectedOrderNumber || input?.value || '').trim();
    if (!orderNumber) {
      setStatus('Enter a Sales Order Number.', 'error');
      input?.focus();
      return;
    }
    setPartnerOrderBusy(true);
    setStatus(`Loading Sales Order ${orderNumber} and detecting the customer…`, 'info');
    showWorkflowProgress(0, `Loading Sales Order ${orderNumber}…`);
    try {
      const response = await fetch('/api/mpl/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_order_number: orderNumber, ecomdash_id: selectedEcomdashId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'The sales order could not be loaded.');
      if (payload.requires_order_selection) {
        closeWorkflowProgress();
        showPartnerOrderInstances(orderNumber, payload.order_instances || []);
        setStatus(`Sales Order ${orderNumber} has multiple records. Select the correct customer order.`, 'info');
        return;
      }
      document.getElementById('partner-order-instance-picker')?.classList.add('hidden');
      updateWorkflowProgress('Matching SKUs', 'Matching order lines to Product Master…');
      const detectedCustomerId = detectPartnerCustomer(payload);
      const customerId = detectedCustomerId || partnerCustomerOverride;
      if (!customerId) throw new Error('Customer could not be detected. Select DecoPac, Dutch Bros, or Fancy Sprinkles, then load the order again.');
      partnerOrderPayload = payload;
      partnerCustomerId = customerId;
      partnerCustomerOverride = '';
      partnerLabelJobs = buildPartnerLabelJobs(payload, customerId);
      updateWorkflowProgress('Calculating cartons', 'Calculating label quantities and pallet details…');
      partnerMplDraft = buildPartnerMplDraft(payload, customerId);
      activeKeheDocumentType = 'masterPackingList';
      activeKeheDocumentDraft = partnerMplDraft;
      revokePartnerPreviewUrls();
      renderPartnerWorkspace();
      const selectionNote = detectedCustomerId === customerId ? 'detected' : 'selected';
      setStatus(`${partnerCustomerLabel(customerId)} ${selectionNote}. Review and generate each document below.`, 'success');
      closeWorkflowProgress();
    } catch (err) {
      closeWorkflowProgress();
      setStatus(`Order load failed: ${err?.message || 'unknown error'}`, 'error');
    } finally {
      setPartnerOrderBusy(false);
    }
  }

  function isPartnerPalletLabelJob(job) {
    return String(job?.template_id || '').toUpperCase() === 'FANCY_PALLET_3X3';
  }

  function partnerJobsForKind(kind) {
    const palletLabels = kind === 'palletLabel';
    return partnerLabelJobs
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => isPartnerPalletLabelJob(job) === palletLabels);
  }

  function partnerLabelKindName(kind) {
    return kind === 'palletLabel' ? 'Pallet Labels' : 'Pack Labels';
  }

  function partnerLabelPreviewUrl(kind) {
    return kind === 'palletLabel' ? partnerPalletLabelsPreviewUrl : partnerLabelsPreviewUrl;
  }

  function setPartnerLabelPreviewUrl(kind, url) {
    const previous = partnerLabelPreviewUrl(kind);
    if (previous) URL.revokeObjectURL(previous);
    if (kind === 'palletLabel') partnerPalletLabelsPreviewUrl = url;
    else partnerLabelsPreviewUrl = url;
  }

  function partnerLabelFilename(kind) {
    const prefix = partnerCustomerId || 'customer';
    return kind === 'palletLabel' ? `${prefix}_pallet_labels.pdf` : `${prefix}_pack_labels.pdf`;
  }

  function renderPartnerLabelsEditor(kind = partnerEditingLabelKind) {
    const jobs = partnerJobsForKind(kind);
    if (!jobs.length) {
      return '<div class="partner-empty-state"><strong>No labels in this group</strong><span>This order does not require this label type.</span></div>';
    }
    const stale = partnerPreviewIsStale(kind);
    return `<div class="partner-label-batch-tools">
        <div>${stale ? '<span class="preview-stale-warning">Preview changed since the PDF was last rendered.</span>' : '<span>Choose labels and copies for this batch.</span>'}</div>
        <div class="workflow-compact-actions">
          <button class="btn-secondary" type="button" onclick="selectAllPartnerLabels(true, '${jsString(kind)}'); renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft)">Select all</button>
          <button class="btn-secondary" type="button" onclick="selectAllPartnerLabels(false, '${jsString(kind)}'); renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft)">Clear all</button>
          <button class="btn-secondary" type="button" onclick="resetPartnerLabelCopies('${jsString(kind)}'); renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft)">Reset copies</button>
        </div>
      </div><div class="partner-label-editor-stack">${jobs.map(({ job, index }, position) => {
      const template = b2bLabelTemplates.find(candidate => candidate.template_id === job.template_id) || {};
      const width = Number(template.physical_width_in || 4);
      const height = Number(template.physical_height_in || 6);
      const sheetWidth = width <= 3 && height >= 3 ? 440 : width <= 3 ? 640 : 720;
      const productStatus = job.match_status === 'matched' ? 'Product Master matched' : 'Using order data — review before printing';
      const barcodeControls = isPartnerPalletLabelJob(job) ? '' : `
        <label class="partner-editor-toggle"><input type="checkbox" ${job.run?.print_barcode ? 'checked' : ''} onchange="updatePartnerLabelJob(${index}, 'run.print_barcode', this.checked, true)"> Print barcode</label>
        <label>GTIN / UPC<input value="${escapeHtml(job.product?.gtin || '')}" oninput="updatePartnerLabelJob(${index}, 'product.gtin', this.value, false)" onchange="renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft)"></label>
        <label>Barcode type<select onchange="updatePartnerLabelJob(${index}, 'product.barcode_type', this.value, true)">${['GTIN_14', 'UPC_A', 'EAN_13', 'CODE128', 'NONE'].map(type => `<option value="${type}" ${job.product?.barcode_type === type ? 'selected' : ''}>${type.replace('_', '-')}</option>`).join('')}</select></label>`;
      return `<article class="partner-label-editor-sheet ${job.print_selected ? '' : 'disabled'}">
        <div class="partner-label-editor-toolbar">
          <div class="partner-label-editor-title"><strong>${escapeHtml(job.product?.sku || `Order line ${index + 1}`)}</strong><span>${escapeHtml(template.name || job.template_id || partnerLabelKindName(kind))}</span><small>${escapeHtml(productStatus)}</small></div>
          <div class="partner-label-editor-controls">
            <label class="partner-editor-toggle"><input type="checkbox" ${job.print_selected ? 'checked' : ''} onchange="updatePartnerLabelJob(${index}, 'print_selected', this.checked, true)"> Include</label>
            <label>Cartons<input type="number" min="1" step="1" value="${escapeHtml(job.run?.carton_total || '1')}" onchange="updatePartnerLabelJob(${index}, 'run.carton_total', this.value, true)"></label>
            <label>Copies<input type="number" min="1" step="1" value="${escapeHtml(job.run?.copies || '1')}" onchange="updatePartnerLabelJob(${index}, 'run.copies', this.value, false)"></label>
            ${barcodeControls}
            <button class="btn-secondary" type="button" onclick="regeneratePartnerLabel(${index})">Regenerate this label</button>
          </div>
        </div>
        <div class="b2b-label-editor-stage partner-label-editor-stage">
          <div class="partner-label-editor-canvas" data-partner-canvas-index="${position}" style="--b2b-label-ratio:${width} / ${height};--b2b-label-max-width:${sheetWidth}px">${b2bLabelEditorHtml(template, job.product || {}, job.directory || {}, { partnerIndex: index, runFields: job.run || {} })}</div>
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  function setPartnerInlineLabelKind(kind) {
    if (!partnerJobsForKind(kind).length) return;
    partnerInlineLabelKind = kind;
    partnerInlineLabelIndex = -1;
    renderPartnerInlineEditors();
  }

  function setPartnerInlineLabelIndex(index) {
    const parsed = Number(index);
    if (!partnerLabelJobs[parsed]) return;
    partnerInlineLabelIndex = parsed;
    partnerInlineLabelKind = isPartnerPalletLabelJob(partnerLabelJobs[parsed]) ? 'palletLabel' : 'packLabels';
    renderPartnerInlineEditors();
  }

  function renderPartnerInlineEditors() {
    const container = document.getElementById('partner-inline-label-editor');
    if (!container) return;
    const availableKinds = ['packLabels', 'palletLabel'].filter(kind => partnerJobsForKind(kind).length);
    if (!availableKinds.length) {
      container.innerHTML = '<div class="partner-empty-state"><strong>No customer labels configured</strong><span>This order has no matching label jobs.</span></div>';
      return;
    }
    if (!availableKinds.includes(partnerInlineLabelKind)) partnerInlineLabelKind = availableKinds[0];
    const entries = partnerJobsForKind(partnerInlineLabelKind);
    if (!entries.some(entry => entry.index === partnerInlineLabelIndex)) partnerInlineLabelIndex = entries[0].index;
    const entry = entries.find(candidate => candidate.index === partnerInlineLabelIndex) || entries[0];
    const { job, index } = entry;
    const template = b2bLabelTemplates.find(candidate => candidate.template_id === job.template_id) || {};
    const width = Number(template.physical_width_in || 4);
    const height = Number(template.physical_height_in || 6);
    const sheetWidth = width <= 3 && height >= 3 ? 440 : width <= 3 ? 640 : 720;
    const labelsEnabled = !!document.getElementById('partner-generate-labels')?.checked;
    const stale = partnerPreviewIsStale(partnerInlineLabelKind);
    const hasBarcode = !isPartnerPalletLabelJob(job);
    const productStatus = job.match_status === 'matched' ? 'Product Master matched' : 'Using order data — review before printing';
    const jobLabel = current => `${current.job.product?.sku || `Order line ${current.index + 1}`} — ${b2bLabelTemplates.find(candidate => candidate.template_id === current.job.template_id)?.name || current.job.template_id}`;
    container.innerHTML = `
      <div class="partner-inline-label-toolbar">
        <div class="partner-label-kind-tabs">${availableKinds.map(kind => `<button type="button" class="${kind === partnerInlineLabelKind ? 'selected' : ''}" onclick="setPartnerInlineLabelKind('${kind}')">${partnerLabelKindName(kind)}</button>`).join('')}</div>
        <label>Label to edit<select onchange="setPartnerInlineLabelIndex(this.value)">${entries.map(current => `<option value="${current.index}" ${current.index === index ? 'selected' : ''}>${escapeHtml(jobLabel(current))}</option>`).join('')}</select></label>
        <div class="workflow-compact-actions">
          <button class="btn-secondary" type="button" onclick="selectAllPartnerLabels(true, '${partnerInlineLabelKind}'); renderPartnerInlineEditors()">Select all</button>
          <button class="btn-secondary" type="button" onclick="selectAllPartnerLabels(false, '${partnerInlineLabelKind}'); renderPartnerInlineEditors()">Clear all</button>
          <button class="btn-secondary" type="button" onclick="resetPartnerLabelCopies('${partnerInlineLabelKind}'); renderPartnerInlineEditors()">Reset copies</button>
        </div>
      </div>
      <div class="partner-inline-workbench ${labelsEnabled ? '' : 'disabled'}">
        <section class="partner-inline-live-label">
          <header><div><div class="b2b-card-kicker">Live label editor</div><h4>Edit the label</h4></div><span>${escapeHtml(productStatus)}</span></header>
          <div class="b2b-label-editor-stage partner-label-editor-stage">
            <div class="partner-label-editor-canvas" style="--b2b-label-ratio:${width} / ${height};--b2b-label-max-width:${sheetWidth}px">${b2bLabelEditorHtml(template, job.product || {}, job.directory || {}, { partnerIndex: index, runFields: job.run || {} })}</div>
          </div>
        </section>
        <aside class="partner-inline-run-panel">
          <header><div class="b2b-card-kicker">This print run</div><h4>Carton range &amp; copies</h4></header>
          <div class="partner-inline-run-grid">
            <label class="partner-inline-toggle"><input type="checkbox" ${job.print_selected ? 'checked' : ''} onchange="updatePartnerLabelJob(${index}, 'print_selected', this.checked, true)"><span>Include this label</span></label>
            <label>Carton Total<input type="number" min="1" step="1" value="${escapeHtml(job.run?.carton_total || '1')}" onchange="updatePartnerLabelJob(${index}, 'run.carton_total', this.value, true)"></label>
            <label>Start Carton<input type="number" min="1" step="1" value="${escapeHtml(job.run?.carton_start || '1')}" onchange="updatePartnerLabelJob(${index}, 'run.carton_start', this.value, false)"></label>
            <label>End Carton<input type="number" min="1" step="1" value="${escapeHtml(job.run?.carton_end || job.run?.carton_total || '1')}" onchange="updatePartnerLabelJob(${index}, 'run.carton_end', this.value, false)"></label>
            <label>Copies<input type="number" min="1" step="1" value="${escapeHtml(job.run?.copies || '1')}" onchange="updatePartnerLabelJob(${index}, 'run.copies', this.value, false)"></label>
            ${hasBarcode ? `<label class="partner-inline-toggle"><input type="checkbox" ${job.run?.print_barcode ? 'checked' : ''} onchange="updatePartnerLabelJob(${index}, 'run.print_barcode', this.checked, true)"><span>Include barcode</span></label><label class="partner-inline-wide">GTIN / UPC<input value="${escapeHtml(job.product?.gtin || '')}" oninput="updatePartnerLabelJob(${index}, 'product.gtin', this.value, false)"></label><label>Barcode Type<select onchange="updatePartnerLabelJob(${index}, 'product.barcode_type', this.value, true)">${['GTIN_14', 'UPC_A', 'EAN_13', 'CODE128', 'NONE'].map(type => `<option value="${type}" ${job.product?.barcode_type === type ? 'selected' : ''}>${type.replace('_', '-')}</option>`).join('')}</select></label>` : ''}
          </div>
          <button class="btn-secondary partner-regenerate-one" type="button" onclick="regeneratePartnerLabel(${index})">Regenerate only this label</button>
          <div class="partner-inline-production">
            <div class="b2b-card-kicker">Production PDF</div>
            <strong>Generate ${escapeHtml(template.name || partnerLabelKindName(partnerInlineLabelKind))}</strong>
            <small>${stale ? 'The label has changed since the last PDF render.' : 'Creates the print-ready PDF for the selected label group.'}</small>
            <button class="btn-generate" type="button" onclick="openPartnerPreview('${partnerInlineLabelKind}')" ${labelsEnabled ? '' : 'disabled'}>${partnerLabelPreviewUrl(partnerInlineLabelKind) && !stale ? 'Open Production PDF' : 'Generate & Open PDF'}</button>
          </div>
        </aside>
      </div>`;
    window.requestAnimationFrame(() => fitB2BLabelPreview(container.querySelector('.partner-label-editor-canvas')));
    enhanceSearchableSelects(container);
  }

  function commitPartnerProductLabelEdit(element) {
    const index = Number(element?.dataset?.partnerLabelIndex);
    const field = String(element?.dataset?.partnerProductEdit || '');
    if (!Number.isInteger(index) || !field) return;
    const value = String(element.innerText || '').replace(/\s+/g, ' ').trim();
    element.classList.toggle('is-empty', !value);
    updatePartnerLabelJob(index, `product.${field}`, value, false);
    window.requestAnimationFrame(() => fitB2BLabelPreview(element.closest('.partner-label-editor-canvas')));
  }

  function commitPartnerRunLabelEdit(element) {
    const index = Number(element?.dataset?.partnerLabelIndex);
    const field = String(element?.dataset?.partnerRunEdit || '');
    if (!Number.isInteger(index) || !field) return;
    const value = String(element.innerText || '').replace(/\s+/g, ' ').trim();
    element.classList.toggle('is-empty', !value);
    updatePartnerLabelJob(index, `run.${field}`, value, false);
    window.requestAnimationFrame(() => fitB2BLabelPreview(element.closest('.partner-label-editor-canvas')));
  }

  function updatePartnerLabelJob(index, path, value, rerenderEditor = false) {
    const job = partnerLabelJobs[index];
    if (!job) return;
    const parts = String(path).split('.');
    let target = job;
    while (parts.length > 1) {
      const key = parts.shift();
      target[key] = target[key] || {};
      target = target[key];
    }
    target[parts[0]] = value;
    if (path === 'run.carton_total') {
      const total = Math.max(1, Math.ceil(Number(value) || 1));
      job.run.carton_total = String(total);
      job.run.carton_start = '1';
      job.run.carton_end = String(total);
    }
    if (path === 'template_id') {
      const template = b2bLabelTemplates.find(candidate => candidate.template_id === value);
      job.run.copies = String(template?.default_copies || job.run.copies || 1);
    }
    markPartnerPreviewStale(isPartnerPalletLabelJob(job) ? 'palletLabel' : 'packLabels');
    if (rerenderEditor) {
      if (String(activeKeheDocumentType || '').startsWith('partner') && document.getElementById('document-editor-panel')?.classList.contains('visible')) {
        renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
      }
      renderPartnerInlineEditors();
    }
    renderPartnerSelectionState();
  }

  function renderPartnerSelectionState() {
    const labelsEnabled = !!document.getElementById('partner-generate-labels')?.checked;
    const mplEnabled = !!document.getElementById('partner-generate-mpl')?.checked;
    const loaded = !!partnerOrderPayload;
    const hasPackLabels = partnerJobsForKind('packLabels').length > 0;
    const hasPalletLabels = partnerJobsForKind('palletLabel').length > 0;
    const setDisabled = (id, disabled) => {
      const element = document.getElementById(id);
      if (element) element.disabled = !!disabled;
    };
    setDisabled('btn-partner-mpl', !loaded || !mplEnabled || !partnerMplDraft);
    const mplGenerateButton = document.getElementById('btn-generate-partner-mpl');
    if (mplGenerateButton) {
      mplGenerateButton.disabled = !loaded || !mplEnabled || !partnerMplDraft;
      mplGenerateButton.textContent = partnerMplPreviewUrl && !partnerPreviewIsStale('masterPackingList') ? 'Open Production PDF' : 'Generate & Open PDF';
    }
    document.querySelector('.partner-label-workflow-section')?.classList.toggle('disabled', !labelsEnabled);
    document.querySelector('.partner-mpl-workflow-section')?.classList.toggle('disabled', !mplEnabled);
    const labelProductionButton = document.querySelector('#partner-inline-label-editor .partner-inline-production .btn-generate');
    if (labelProductionButton) labelProductionButton.disabled = !loaded || !labelsEnabled;
    renderPartnerDownloadFiles();
  }

  function renderPartnerDownloadFiles() {
    const container = document.getElementById('partner-download-files');
    if (!container) return;
    const files = [];
    if (partnerJobsForKind('packLabels').length) files.push({ kind: 'packLabels', label: 'Customer labels', filename: partnerLabelFilename('packLabels'), url: partnerLabelsPreviewUrl });
    if (partnerJobsForKind('palletLabel').length) files.push({ kind: 'palletLabel', label: 'Pallet labels', filename: partnerLabelFilename('palletLabel'), url: partnerPalletLabelsPreviewUrl });
    files.push({ kind: 'masterPackingList', label: 'Master packing list', filename: `${partnerCustomerId || 'customer'}_packing_list.pdf`, url: partnerMplPreviewUrl });
    container.innerHTML = files.map(file => {
      const stale = partnerPreviewIsStale(file.kind);
      const state = stale ? 'Changed — regenerate above' : (file.url ? 'PDF ready' : 'Generate above first');
      const action = file.url && !stale
        ? `<a class="btn-secondary" href="${escapeHtml(file.url)}" download="${escapeHtml(file.filename)}">Download PDF</a>`
        : `<button class="btn-secondary" type="button" disabled>${stale ? 'Regenerate above' : 'Not generated yet'}</button>`;
      return `<article><div><strong>${escapeHtml(file.label)}</strong><small>${escapeHtml(state)}</small></div>${action}</article>`;
    }).join('');
  }

  function renderPartnerWorkspace() {
    const config = PARTNER_WORKFLOW_CONFIG[partnerCustomerId];
    document.body.dataset.partnerCustomer = partnerCustomerId || 'unselected';
    document.querySelectorAll('[data-partner-customer]').forEach(button => {
      const selected = button.dataset.partnerCustomer === partnerCustomerId;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    const selectionHelp = document.getElementById('partner-customer-selection-help');
    if (selectionHelp) selectionHelp.textContent = config
      ? `${config.label} is selected. You can change the layout without leaving this workflow.`
      : 'Load an order for automatic detection, or select its customer now.';
    document.getElementById('partner-empty-state')?.classList.toggle('hidden', !!partnerOrderPayload);
    document.getElementById('partner-order-workspace')?.classList.toggle('hidden', !partnerOrderPayload);
    if (!partnerOrderPayload) return;
    const summary = partnerOrderPayload.summary || {};
    const reviewCount = Number(summary.unmatched_products || 0) + Number(summary.ambiguous_products || 0);
    document.getElementById('partner-detected-customer').textContent = partnerCustomerLabel();
    document.getElementById('partner-loaded-order').textContent = partnerOrderPayload.sales_order_number || '-';
    document.getElementById('partner-line-count').textContent = String(partnerOrderPayload.items?.length || 0);
    document.getElementById('partner-review-status').textContent = reviewCount ? `${reviewCount} line(s) need review` : 'Ready';
    const mpl = partnerMplDraft?.packing_lists?.[0] || {};
    const itemCount = Array.isArray(mpl.items) ? mpl.items.length : 0;
    document.getElementById('partner-mpl-item-count').textContent = String(itemCount);
    document.getElementById('partner-mpl-pallet-count').textContent = String(mpl.total_pallets || mpl._pallet_ids?.length || 1);
    document.getElementById('partner-mpl-edit-status').textContent = partnerPreviewIsStale('masterPackingList') ? 'Changes need a new PDF' : (partnerMplPreviewUrl ? 'Production PDF ready' : 'Ready to review');
    renderPartnerAddressSelectors();
    renderPartnerInlineEditors();
    renderPartnerSelectionState();
  }

  async function selectPartnerCustomer(customerId, options = {}) {
    if (!PARTNER_CUSTOMER_IDS.includes(customerId)) return;
    partnerCustomerId = customerId;
    if (!partnerOrderPayload) {
      partnerCustomerOverride = customerId;
      renderPartnerWorkspace();
      setStatus(`${partnerCustomerLabel(customerId)} selected. Enter a Sales Order Number to continue.`, 'info');
      return;
    }
    partnerCustomerOverride = '';
    partnerLabelJobs = buildPartnerLabelJobs(partnerOrderPayload, customerId);
    partnerMplDraft = buildPartnerMplDraft(partnerOrderPayload, customerId);
    activeKeheDocumentType = 'masterPackingList';
    activeKeheDocumentDraft = partnerMplDraft;
    revokePartnerPreviewUrls();
    renderPartnerWorkspace();
    if (options.fromEditor) {
      renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
      setStatus(`${partnerCustomerLabel(customerId)} layout applied to the packing list and labels.`, 'success');
      return;
    }
    setStatus(`${partnerCustomerLabel(customerId)} layout applied. Review and generate each document below.`, 'success');
  }

  async function renderPartnerLabelsPreview(kind = 'packLabels') {
    if (!partnerOrderPayload || !document.getElementById('partner-generate-labels')?.checked) return true;
    const availableJobs = partnerJobsForKind(kind);
    if (!availableJobs.length) return true;
    const selectedJobs = availableJobs.map(({ job }) => job).filter(job => job.print_selected);
    if (!selectedJobs.length) throw new Error(`Select at least one ${partnerLabelKindName(kind).toLowerCase()} line.`);
    const response = await fetch('/api/partner/render-labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: selectedJobs })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || 'Labels could not be rendered.');
    }
    const pdf = await response.blob();
    setPartnerLabelPreviewUrl(kind, URL.createObjectURL(pdf));
    clearPartnerPreviewStale(kind);
    await recordGeneratedOutput(`partners-${kind}`, {
      scope: 'partners',
      name: partnerLabelFilename(kind),
      labelType: partnerLabelKindName(kind),
      format: 'rollo',
      labels: selectedJobs.reduce((total, job) => total + Math.max(1, Number(job.run?.copies || 1)) * Math.max(1, Number(job.run?.carton_total || 1)), 0),
      pallets: kind === 'palletLabel' ? Math.max(1, Number(partnerMplDraft?.packing_lists?.[0]?.total_pallets || 1)) : 0,
      blob: pdf,
    });
    renderPartnerInlineEditors();
    renderPartnerSelectionState();
    return true;
  }

  async function renderPartnerMplPreview() {
    if (!partnerMplDraft || !document.getElementById('partner-generate-mpl')?.checked) return true;
    activeKeheDocumentType = 'masterPackingList';
    activeKeheDocumentDraft = partnerMplDraft;
    activeKeheDocumentDraft.product_master = getActiveAllProductMasterRows();
    applyProductMasterToDraft(activeKeheDocumentDraft, true);
    finalizeMplPalletDraft();
    await captureCurrentMplTiHiSnapshots(activeKeheDocumentDraft);
    const response = await fetch('/render/kehe/master-packing-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activeKeheDocumentDraft)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || 'Packing list could not be rendered.');
    const resultId = response.headers.get('X-Result-Id') || payload.result_id;
    if (!resultId) throw new Error('Packing-list generation did not return a result ID.');
    await waitForGeneration(resultId);
    const fileResponse = await fetch(`/results/${encodeURIComponent(resultId)}/file`);
    if (!fileResponse.ok) throw new Error('The generated packing-list PDF could not be loaded.');
    if (partnerMplPreviewUrl) URL.revokeObjectURL(partnerMplPreviewUrl);
    const pdf = await fileResponse.blob();
    partnerMplPreviewUrl = URL.createObjectURL(pdf);
    clearPartnerPreviewStale('masterPackingList');
    await recordGeneratedOutput('partners-mpl', {
      scope: 'partners',
      name: `${partnerCustomerId || 'customer'}_packing_list.pdf`,
      labelType: 'Master Packing List',
      format: 'a4',
      pallets: Math.max(1, Number(activeKeheDocumentDraft.packing_lists?.[0]?.total_pallets || 1)),
      blob: pdf,
    });
    partnerMplDraft = activeKeheDocumentDraft;
    const editStatus = document.getElementById('partner-mpl-edit-status');
    if (editStatus) editStatus.textContent = 'Production PDF ready';
    renderPartnerSelectionState();
    return true;
  }

  async function openPartnerPreview(kind) {
    let previewUrl = kind === 'masterPackingList' ? partnerMplPreviewUrl : partnerLabelPreviewUrl(kind);
    try {
      if (!previewUrl || partnerPreviewIsStale(kind)) {
        if (!(await confirmDocumentReadiness('partners'))) return;
        showWorkflowProgress(kind === 'masterPackingList' ? 4 : 3, `Preparing ${kind === 'masterPackingList' ? 'packing list' : partnerLabelKindName(kind).toLowerCase()}…`);
        if (kind === 'masterPackingList') await renderPartnerMplPreview();
        else await renderPartnerLabelsPreview(kind);
        previewUrl = kind === 'masterPackingList' ? partnerMplPreviewUrl : partnerLabelPreviewUrl(kind);
      }
      if (!previewUrl) return;
      blobUrl = previewUrl;
      const filename = kind === 'masterPackingList' ? `${partnerCustomerId || 'customer'}_packing_list.pdf` : partnerLabelFilename(kind);
      document.getElementById('btn-download').download = filename;
      setDownloadReady(true, previewUrl);
      setActivePreviewFormat(kind === 'masterPackingList' ? 'a4' : 'rollo');
      resetPreviewSurface();
      await openPreview();
    } catch (err) {
      setStatus(`PDF generation failed: ${err?.message || 'unknown error'}`, 'error');
    } finally {
      closeWorkflowProgress();
    }
  }

  function openPartnerLabelEditor(kind = 'packLabels') {
    const jobs = partnerJobsForKind(kind);
    if (!partnerOrderPayload || !jobs.length) {
      setStatus(`Load an order that requires ${partnerLabelKindName(kind).toLowerCase()} before editing.`, 'error');
      return;
    }
    partnerEditingMpl = false;
    partnerEditingLabelKind = kind;
    activeKeheDocumentType = kind === 'palletLabel' ? 'partnerPalletLabels' : 'partnerPackLabels';
    activeKeheDocumentDraft = { jobs: partnerLabelJobs };
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    openDocumentEditor();
  }

  function editPartnerPackingList() {
    if (!partnerMplDraft) {
      setStatus('Load an order before editing the packing list.', 'error');
      return;
    }
    partnerEditingMpl = true;
    partnerEditingLabelKind = '';
    activeKeheDocumentType = 'masterPackingList';
    activeKeheDocumentDraft = partnerMplDraft;
    renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
    openDocumentEditor();
  }
