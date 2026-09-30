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
