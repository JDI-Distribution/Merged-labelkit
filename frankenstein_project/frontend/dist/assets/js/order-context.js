/* Shared order resolution for order-driven workspaces.
   Product conversion is authoritative from the backend. This layer resolves
   customer/address choices and exposes one context to every frontend flow. */

  function orderContextClean(value) {
    return String(value ?? '').trim();
  }

  function orderContextCanonical(value) {
    return orderContextClean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function orderInstanceCustomerLabel(instance = {}) {
    return orderContextClean(
      instance.storefront
      || instance.billing_customer_name
      || instance.email_id
      || 'Customer not identified'
    );
  }

  function orderInstanceOptionLabel(instance = {}) {
    const id = orderContextClean(instance.ecomdash_id) || 'No record ID';
    const customer = orderInstanceCustomerLabel(instance);
    const date = orderContextClean(instance.invoice_date) || 'No date';
    const skuCount = Number(instance.sku_count || 0);
    const matchedCount = Number(instance.matched_sku_count || 0);
    const recommended = instance.recommended ? 'Recommended · ' : '';
    const match = matchedCount ? ` · ${matchedCount}/${skuCount} SKU matches` : ` · ${skuCount} SKU(s)`;
    return `${recommended}${customer} · ${date}${match} · Record ${id}`;
  }

  function renderOrderInstanceTableRows(body, instances = [], selectionHandler) {
    if (!body) return;
    body.innerHTML = '';
    (Array.isArray(instances) ? instances : []).forEach(instance => {
      const id = orderContextClean(instance?.ecomdash_id);
      const row = document.createElement('tr');
      row.classList.toggle('recommended', !!instance?.recommended);
      const cells = [
        { value: orderInstanceCustomerLabel(instance), recommended: !!instance?.recommended, reason: orderContextClean(instance?.recommendation_reason) },
        { value: orderContextClean(instance?.invoice_date) || '—' },
        { value: `${Number(instance?.matched_sku_count || 0)}/${Number(instance?.sku_count || 0)} matched` },
        { value: orderContextClean(instance?.billing_customer_name) || '—' },
        { value: id || '—', className: 'mpl-order-instance-id' },
      ];
      cells.forEach(cellData => {
        const cell = document.createElement('td');
        if (cellData.className) cell.className = cellData.className;
        if (cellData.recommended) {
          const badge = document.createElement('span');
          badge.className = 'order-instance-recommended';
          badge.textContent = 'Recommended';
          cell.appendChild(badge);
        }
        const text = document.createElement('span');
        text.textContent = cellData.value;
        cell.appendChild(text);
        if (cellData.reason) {
          const reason = document.createElement('small');
          reason.textContent = cellData.reason;
          cell.appendChild(reason);
        }
        row.appendChild(cell);
      });
      const selectCell = document.createElement('td');
      selectCell.className = 'mpl-order-instance-select-column';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'mpl-order-instance-checkbox';
      checkbox.value = id;
      checkbox.disabled = !id;
      checkbox.setAttribute('aria-label', `Select ${orderInstanceCustomerLabel(instance)}, record ${id || 'missing'}`);
      checkbox.addEventListener('change', () => selectionHandler?.(checkbox));
      selectCell.appendChild(checkbox);
      row.appendChild(selectCell);
      body.appendChild(row);
    });
  }

  function orderContextCustomerAliases(customer = '') {
    const normalized = normalizeStorefront(customer || '');
    const aliases = new Set([normalized]);
    Object.values(typeof PARTNER_WORKFLOW_CONFIG === 'object' ? PARTNER_WORKFLOW_CONFIG : {}).forEach(config => {
      const names = [config?.label, ...(config?.detectionAliases || [])].filter(Boolean);
      if (names.some(name => {
        const a = orderContextCanonical(name).replaceAll(' ', '');
        const b = orderContextCanonical(normalized).replaceAll(' ', '');
        return a && b && (a === b || a.includes(b) || b.includes(a));
      })) names.forEach(name => aliases.add(normalizeStorefront(name)));
    });
    return [...aliases].map(orderContextCanonical).filter(Boolean);
  }

  function orderContextSearchText(payload = {}) {
    const details = payload?.order_details || {};
    return orderContextCanonical([
      payload?.sales_order_number,
      details.email_id,
      details.email,
      details.storefront,
      details.billing_customer_name,
      details.ship_to_name,
      details.billing_zip_code,
      details.shipping_zip_code,
      details.billing_city,
      details.shipping_city,
      details.billing_state,
      details.shipping_state,
      details.billing_street1,
      details.shipping_street1,
      details.purchase_order_number,
      details.po_number,
    ].filter(Boolean).join(' | '));
  }

  function orderContextDirectoryScore(row, payload = {}) {
    const searchText = ` ${orderContextSearchText(payload)} `;
    if (!searchText.trim()) return 0;
    const values = [row?.dc, row?.name, ...(row?.match_values || [])]
      .map(orderContextCanonical)
      .filter(Boolean);
    return values.reduce((score, value) => {
      const compactValue = value.replaceAll(' ', '');
      const compactSearch = searchText.replaceAll(' ', '');
      if (` ${searchText} `.includes(` ${value} `)) return Math.max(score, 100 + value.length);
      if (compactValue.length >= 4 && compactSearch.includes(compactValue)) return Math.max(score, 60 + compactValue.length);
      return score;
    }, 0);
  }

  function orderContextDirectoryRows(customer = '') {
    const aliases = orderContextCustomerAliases(customer);
    return (mplDirectoryRows || [])
      .map((raw, index) => ({ row: normalizeDcDirectoryRow(raw), index }))
      .filter(({ row }) => row.is_active !== false)
      .filter(({ row }) => {
        if (!aliases.length) return true;
        const storefront = orderContextCanonical(row.storefront);
        return storefront && aliases.some(alias => storefront === alias || storefront.includes(alias) || alias.includes(storefront));
      });
  }

  function orderContextRoleAddress(row, role) {
    if (!row) return '';
    if (role === 'SHIP_FROM') return orderContextClean(row.address || row.ship_from);
    if (role === 'BILL_TO') return orderContextClean(row.address || row.billing_address);
    return orderContextClean(row.address || row.delivery_address);
  }

  function resolveOrderDirectoryRole(payload, customer, role, options = {}) {
    const customerRows = orderContextDirectoryRows(customer)
      .filter(({ row }) => directoryHasRole(row, role))
      .map(entry => ({ ...entry, score: orderContextDirectoryScore(entry.row, payload) }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const allRoleRows = (mplDirectoryRows || [])
      .map((raw, index) => ({ row: normalizeDcDirectoryRow(raw), index }))
      .filter(({ row }) => row.is_active !== false && directoryHasRole(row, role));
    let selected = customerRows.find(entry => entry.score > 0) || null;
    if (!selected && customerRows.length === 1) selected = customerRows[0];
    if (!selected && role === 'SHIP_FROM') {
      selected = customerRows[0]
        || allRoleRows.find(entry => orderContextClean(entry.row.dc).toUpperCase() === 'DEFAULT-SHIP-FROM')
        || allRoleRows[0]
        || null;
    }
    if (!selected && options.allowFirstCustomerMatch) selected = customerRows[0] || null;
    return {
      role,
      row: selected?.row || null,
      index: Number.isInteger(selected?.index) ? selected.index : -1,
      address: orderContextRoleAddress(selected?.row, role),
      source: selected ? (selected.score > 0 ? 'directory_match' : 'directory_default') : 'missing',
      score: Number(selected?.score || 0),
      options: customerRows,
    };
  }

  function resolvedOrderUnitCount(item = {}, product = {}) {
    const converted = Number(item?.quantity_ordered_cases);
    if (Number.isFinite(converted) && converted > 0) return Math.max(1, Math.ceil(converted));
    const ordered = Number(String(item?.quantity_ordered ?? '').replace(/,/g, ''));
    if (!Number.isFinite(ordered) || ordered <= 0) return 1;
    const quantityUom = orderContextClean(item?.quantity_uom).toUpperCase().replace(/\s+/g, '_');
    const productLevel = normalizePackagingLevel(product?.packaging_level).toUpperCase().replace(/\s+/g, '_');
    if (quantityUom && quantityUom === productLevel) return Math.max(1, Math.ceil(ordered));
    const eachesPerUnit = Number(product?.case_qty);
    return Number.isFinite(eachesPerUnit) && eachesPerUnit > 0
      ? Math.max(1, Math.ceil(ordered / eachesPerUnit))
      : Math.max(1, Math.ceil(ordered));
  }

  function resolveOrderContext(payload = {}, options = {}) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const matchedItems = items.filter(item => item?.match_status === 'matched' && item?.product);
    let customer = normalizeStorefront(
      options.customer
      || matchedItems[0]?.product?.storefront
      || payload?.order_details?.storefront
      || payload?.order_details?.billing_customer_name
      || payload?.order_details?.ship_to_name
      || ''
    );
    if (!matchedItems.length) {
      const directoryMatch = (mplDirectoryRows || [])
        .map((raw, index) => ({ row: normalizeDcDirectoryRow(raw), index }))
        .filter(({ row }) => row.is_active !== false)
        .map(entry => ({ ...entry, score: orderContextDirectoryScore(entry.row, payload) }))
        .sort((left, right) => right.score - left.score || left.index - right.index)[0];
      if (directoryMatch?.score > 0 && directoryMatch.row.storefront) {
        customer = normalizeStorefront(directoryMatch.row.storefront);
      }
    }
    const shipFrom = resolveOrderDirectoryRole(payload, customer, 'SHIP_FROM');
    const shipTo = resolveOrderDirectoryRole(payload, customer, 'SHIP_TO');
    const billTo = resolveOrderDirectoryRole(payload, customer, 'BILL_TO');
    const details = payload?.order_details || {};
    const orderShipTo = typeof analyticsMplAddress === 'function' ? analyticsMplAddress(details, 'shipping') : '';
    const orderBillTo = typeof analyticsMplAddress === 'function' ? analyticsMplAddress(details, 'billing') : '';
    return {
      salesOrderNumber: orderContextClean(payload?.sales_order_number),
      customer,
      items,
      matchedItems,
      primaryItem: matchedItems[0] || items[0] || null,
      shipFrom,
      shipTo: { ...shipTo, address: orderShipTo || shipTo.address, source: orderShipTo ? 'order' : shipTo.source },
      billTo: { ...billTo, address: orderBillTo || billTo.address, source: orderBillTo ? 'order' : billTo.source },
      directoryShipTo: shipTo,
      directoryBillTo: billTo,
      reviewCount: items.filter(item => item?.match_status !== 'matched').length,
    };
  }

  function initializeManualReviewedOrder(draft) {
    const mpl = draft.packing_lists?.[0] || {};
    initializeReviewedOrder({ sales_order_number: mpl.order_no || 'manual' }, {
      shipTo: { address: mpl.ship_to || '' }, billTo: { address: mpl.bill_to || '' }, shipFrom: { address: mpl.supplier_info || '' },
    }, draft);
  }
  function initializeReviewedOrder(payload, context, draft) {
    const mpl = draft.packing_lists?.[0] || {};
    const productMaster = JSON.parse(JSON.stringify(draft.reviewed_product_master || mplProductMasterRows));
    orderDocumentsState.reviewedOrder = {
      id: `${payload.sales_order_number || 'manual'}:${payload.source?.ecomdash_id || ''}`,
      revision: 0, context,
      fields: { po_number: mpl.customer_po_number || b2bRunFields.po_number || '',
        ship_date: mpl.est_ship_date || b2bRunFields.ship_date || '',
        ship_to: mpl.ship_to || context.shipTo?.address || '', bill_to: mpl.bill_to || context.billTo?.address || '',
        ship_from: mpl.supplier_info || context.shipFrom?.address || '' },
    };
    draft.reviewed_product_master = productMaster;
    draft.product_master = productMaster;
    applyReviewedOrder();
  }

  const REVIEWED_ORDER_FIELDS = {
    customer_po_number: 'po_number', customer_po_numbers: 'po_number', po_number: 'po_number',
    est_ship_date: 'ship_date', ship_date: 'ship_date', date: 'ship_date',
    ship_to: 'ship_to', delivery_address: 'ship_to', bill_to: 'bill_to', billing_address: 'bill_to',
    supplier_info: 'ship_from', ship_from: 'ship_from',
  };
  function reviewedProductRows() {
    return typeof orderDocumentsState !== 'undefined' && selectedKit === 'operations'
      ? orderDocumentsState.mplDraft?.reviewed_product_master : null;
  }
  function refreshReviewedProductSnapshot(field = null, value = null, product = null) {
    const rows = reviewedProductRows();
    if (!rows || !orderDocumentsState.reviewedOrder) return;
    const snapshot = JSON.parse(JSON.stringify(field ? rows : mplProductMasterRows));
    if (field && product) {
      const previous = snapshot.find(row => row.config_id === product.config_id && row.storefront === product.storefront
        && normalizePackagingLevel(row.packaging_level) === normalizePackagingLevel(product.packaging_level));
      const previousSku = previous?.sku || product.sku;
      if (previous) previous[field] = value;
      else snapshot.push({ ...product, [field]: value });
      for (const item of orderDocumentsState.mplDraft.packing_lists.flatMap(mpl => mpl.items || [])) {
        if (item.order_packaging?.product?.config_id === product.config_id) item.order_packaging.product[field] = value;
      }
      if (normalizePackagingLevel(product.packaging_level) === 'Case') {
        for (const item of orderDocumentsState.mplDraft.packing_lists.flatMap(mpl => mpl.items || [])) {
          if (item.sku !== previousSku || (item.order_packaging && item.order_packaging.product.config_id !== product.config_id)) continue;
          if (field === 'description' || field === 'sku') item[field] = value;
          if (field === 'gtin') item.case_upc = value;
        }
      }
    }
    orderDocumentsState.mplDraft.reviewed_product_master = snapshot;
    orderDocumentsState.mplDraft.product_master = snapshot;
    for (const job of b2bOrderLabelJobs) {
      const product = job.product || {};
      const replacement = snapshot.find(row => row.config_id === product.config_id && row.storefront === product.storefront
        && normalizePackagingLevel(row.packaging_level) === normalizePackagingLevel(product.packaging_level));
      if (replacement) {
        job.product = { ...replacement };
        if (job.order_only_product_index >= 0) b2bOrderFallbackProducts[job.order_only_product_index] = { ...replacement };
      }
    }
    applyProductMasterToDraft(orderDocumentsState.mplDraft, true);
    syncReviewedOrderItems();
    invalidateReviewedOrder();
  }
  function invalidateReviewedOrder() {
    orderDocumentsState.reviewedDocuments = { labels: false, mpl: false, pallets: false };
    if (orderDocumentsState.mplDraft) {
      orderDocumentsState.mplDraft.review_status = 'DRAFT';
      (orderDocumentsState.mplDraft.packing_lists || []).forEach(mpl => { mpl.review_status = 'DRAFT'; });
    }
    clearGeneratedOutputs('operations-labels', 'operations-mpl', 'operations-pallets', 'operations-labels-review');
    clearB2BPreview();
    mplDraftSync?.schedule();
  }
  function updateReviewedOrder(field, value) {
    const session = typeof orderDocumentsState !== 'undefined' && selectedKit === 'operations' && orderDocumentsState.reviewedOrder;
    const key = REVIEWED_ORDER_FIELDS[field];
    if (!session || !key || session.fields[key] === String(value ?? '')) return;
    session.fields[key] = String(value ?? '');
    session.revision += 1;
    applyReviewedOrder();
    invalidateReviewedOrder();
  }

  function applyReviewedOrder() {
    const session = orderDocumentsState.reviewedOrder;
    if (!session) return;
    const fields = session.fields;
    Object.assign(b2bRunFields, { po_number: fields.po_number, ship_date: fields.ship_date });
    for (const job of b2bOrderLabelJobs) {
      for (const run of [job.run, ...Object.values(job.template_runs || {})].filter(Boolean)) {
        Object.assign(run, { po_number: fields.po_number, ship_date: fields.ship_date });
      }
      Object.assign(job.directory ||= {}, { delivery_address: fields.ship_to, address: fields.ship_to,
        billing_address: fields.bill_to, ship_from: fields.ship_from });
    }
    for (const run of Object.values(b2bTemplateRunFields || {})) Object.assign(run, { po_number: fields.po_number, ship_date: fields.ship_date });
    b2bOrderDestinationOverride = fields.ship_to;
    Object.assign(b2bResolvedDirectoryFallback ||= {}, { address: fields.ship_to, delivery_address: fields.ship_to,
      billing_address: fields.bill_to, ship_from: fields.ship_from });
    for (const mpl of orderDocumentsState.mplDraft?.packing_lists || []) Object.assign(mpl, {
      customer_po_number: fields.po_number, est_ship_date: fields.ship_date,
      ship_to: fields.ship_to, bill_to: fields.bill_to, supplier_info: fields.ship_from,
    });
    for (const pallet of orderDocumentsState.palletDraft?.pallets || []) Object.assign(pallet, {
      customer_po_numbers: fields.po_number, date: fields.ship_date, ship_to: fields.ship_to, ship_from: fields.ship_from,
    });
  }
  function replaceReviewedLineProduct(lineIndex, product) {
    const rows = reviewedProductRows();
    if (!rows || lineIndex == null) return;
    for (const job of b2bOrderLabelJobs.filter(job => job.line_index === lineIndex)) {
      const row = rows.find(row => row.config_id === product.config_id && row.storefront === product.storefront
        && normalizePackagingLevel(row.packaging_level) === normalizePackagingLevel(job.product?.packaging_level));
      job.product = row ? { ...row } : { storefront: product.storefront, config_id: product.config_id,
        description: product.description, packaging_level: job.product?.packaging_level,
        verification_status: 'NEEDS_REVIEW', sku: '', gtin: '', case_qty: '', label_enabled: true };
      job.match_status = row ? 'matched' : 'unmatched';
      if (!row) {
        job.match_reason = 'Select a label configuration for the reviewed product.';
        job.template_id = ''; job.template_ids = []; job.template_selection_required = true;
      }
      b2bOrderFallbackProducts[job.order_only_product_index] = { ...job.product };
    }
    syncReviewedOrderItems();
  }
  function syncReviewedOrderItems() {
    const session = typeof orderDocumentsState !== 'undefined' && selectedKit === 'operations' && orderDocumentsState.reviewedOrder;
    if (!session) return;
    const draft = orderDocumentsState.mplDraft;
    const products = draft?.reviewed_product_master || [];
    const items = draft?.packing_lists?.flatMap(mpl => mpl.items || []) || [];
    for (const job of b2bOrderLabelJobs) {
      const product = job.product || {};
      if (normalizePackagingLevel(product.packaging_level) === 'Pallet') continue;
      const caseRow = products.find(row => row.config_id && row.config_id === product.config_id
        && row.storefront === product.storefront && normalizePackagingLevel(row.packaging_level) === 'Case');
      const matches = items.filter(item => item.review_line_index != null && job.line_index != null
        ? item.review_line_index === job.line_index
        : String(item.sku || '').toLowerCase() === String(caseRow?.sku || product.sku || '').toLowerCase());
      if (!matches.length) continue;
      if (job.order_packaging) {
        const groupRows = matches.filter(item => item.order_packing_group === job.order_packing_group);
        const keys = [...new Set(matches.map(item => item.order_packing_group))].sort();
        const count = rows => rows.reduce((sum, item) => sum + Number(item.qty_on_pallet || item.total_shipped || 0), 0);
        const total = count(matches);
        const start = 1 + count(matches.filter(item => keys.indexOf(item.order_packing_group) < keys.indexOf(job.order_packing_group)));
        for (const run of [job.run, ...Object.values(job.template_runs || {})].filter(Boolean)) {
          Object.assign(run, { carton_total: String(total), carton_start: String(start), carton_end: String(start + count(groupRows) - 1) });
        }
        continue;
      }
      const eaches = matches.reduce((sum, item) => sum + (Number(item.qty_on_pallet || item.total_shipped) || 0) * (Number(item.quantity_per_case || caseRow?.case_qty) || 1), 0);
      const total = Math.ceil(eaches / (Number(product.case_qty) || 1));
      for (const run of [job.run, ...Object.values(job.template_runs || {})].filter(Boolean)) {
        const fullRange = String(run.carton_end) === String(run.carton_total);
        run.carton_total = String(total);
        run.carton_end = String(fullRange ? total : Math.min(total, Number(run.carton_end) || total));
        run.carton_start = String(Math.min(total || 1, Number(run.carton_start) || 1));
      }
      if (matches[0].description) job.product.description = matches[0].description;
    }
    session.revision += 1;
    clearB2BPreview();
  }

  function reviewedOrderSnapshot() {
    if (typeof orderDocumentsState === 'undefined' || selectedKit !== 'operations' || !orderDocumentsState.reviewedOrder) return null;
    const { id, revision, fields } = orderDocumentsState.reviewedOrder;
    return JSON.parse(JSON.stringify({ id, revision, fields,
      items: orderDocumentsState.mplDraft?.packing_lists?.flatMap(mpl => mpl.items || []) || [],
      label_jobs: b2bOrderLabelJobs,
    }));
  }

  function applyResolvedOrderContextToMpl(mpl, context) {
    if (!mpl || !context) return mpl;
    if (context.shipFrom?.address) mpl.supplier_info = context.shipFrom.address;
    if (context.shipTo?.address) mpl.ship_to = context.shipTo.address;
    if (context.billTo?.address) mpl.bill_to = context.billTo.address;
    const destination = context.directoryShipTo?.row || context.shipTo?.row || {};
    if (destination.dc) mpl.dc = destination.dc;
    if (destination.name) mpl.dc_name = destination.name;
    mpl.resolved_address_context = {
      ship_from_index: context.shipFrom?.index ?? -1,
      ship_to_index: context.directoryShipTo?.index ?? -1,
      bill_to_index: context.directoryBillTo?.index ?? -1,
      ship_from_source: context.shipFrom?.source || 'missing',
      ship_to_source: context.shipTo?.source || 'missing',
      bill_to_source: context.billTo?.source || 'missing',
    };
    return mpl;
  }
