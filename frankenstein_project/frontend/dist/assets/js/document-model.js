/* Shared customer-specific document model used by Order Documents.
   This file owns customer detection plus label/MPL draft construction; it does
   not own navigation, page state, or rendering. */
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
    return resolvedOrderUnitCount(item, product);
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
    const entries = mplProductMasterRows.map((row, index) => ({ row: normalizeProductRow(row), index })).filter(({ row }) => (
      normalizeStorefront(row.storefront).toLowerCase().includes(String(customer || '').toLowerCase())
      && (
        (configId && String(row.config_id || '').trim().toLowerCase() === configId)
        || (!configId && sku && String(row.sku || '').trim().toLowerCase() === sku)
      )
    ));
    return mplProductOutermostEntry(entries)?.row || null;
  }

  function partnerShipFromRecord(customerId = partnerCustomerId) {
    const customerRows = partnerDirectoryRows(customerId).filter(row => directoryHasRole(row, 'SHIP_FROM'));
    const allOrigins = mplDirectoryRows.map(normalizeDcDirectoryRow)
      .filter(row => row.is_active !== false && directoryHasRole(row, 'SHIP_FROM'));
    return customerRows[0]
      || allOrigins.find(row => String(row.dc || '').trim().toUpperCase() === 'DEFAULT-SHIP-FROM')
      || allOrigins[0]
      || {};
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

  function buildPartnerLabelJobs(payload, customerId) {
    const details = payload?.order_details || {};
    const customer = partnerCustomerLabel(customerId);
    const shippingAddress = analyticsMplAddress(details, 'shipping');
    const context = partnerResolvedOrderContext || resolveOrderContext(payload, { customer });
    const shipToRecord = context.directoryShipTo?.row || {};
    const billToRecord = context.directoryBillTo?.row || {};
    const shipFromRecord = context.shipFrom?.row || partnerShipFromRecord(customerId);
    const directory = {
      ...shipToRecord,
      ship_from_name: shipFromRecord.name || '',
      ship_from: context.shipFrom?.address || shipFromRecord.address || getSharedMplDirectoryShipFrom(),
      delivery_address: context.shipTo?.address || shipToRecord.address || '',
      billing_address: context.billTo?.address || billToRecord.address || '',
    };
    const makeJob = (item, index, requestedTemplateId = '', levelProduct = null) => {
      const product = normalizeProductRow(levelProduct || item?.product || {
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
      const templateId = requestedTemplateId || partnerTemplateForItem({ ...item, product }, customerId);
      const matchingProduct = mplProductMasterRows.map(normalizeProductRow).find(row => (
        (
          String(row.sku || '').trim().toLowerCase() === String(product.sku || '').trim().toLowerCase()
          || (String(product.config_id || '').trim() && String(row.config_id || '').trim().toLowerCase() === String(product.config_id || '').trim().toLowerCase())
        )
        && normalizeStorefront(row.storefront).toLowerCase().includes(customer.toLowerCase())
        && normalizePackagingLevel(row.packaging_level) === normalizePackagingLevel(product.packaging_level)
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
      const orderedEaches = Number(item?.quantity_ordered_eaches);
      const eachesPerLabel = normalizePackagingLevel(resolvedProduct.packaging_level) === 'Each'
        ? 1
        : Number(resolvedProduct.case_qty || 1);
      const cartons = Number.isFinite(orderedEaches) && orderedEaches > 0 && Number.isFinite(eachesPerLabel) && eachesPerLabel > 0
        ? Math.max(1, Math.ceil(orderedEaches / eachesPerLabel))
        : calculateOrderCartonCount(item, resolvedProduct);
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
          quantity_label: String(item?.quantity_ordered_eaches ?? item?.quantity_ordered ?? ''),
          expected_delivery_date: String(details.expected_delivery_date || details.ship_date || ''),
          carton_total: String(cartons),
          carton_start: '1',
          carton_end: String(cartons),
          copies: String(resolvedProduct.default_copies || template.default_copies || 1),
          print_barcode: !!(resolvedProduct.gtin && resolvedProduct.barcode_type !== 'NONE'),
        },
        source_quantity: item?.quantity_ordered_eaches ?? item?.quantity_ordered ?? '',
        match_status: item?.match_status || 'unmatched',
        match_reason_code: item?.match_reason_code || '',
        match_reason: item?.match_reason || '',
        needs_match_review: !!item?.needs_match_review,
        line_index: index,
      };
    };

    const items = payload?.items || [];
    const jobs = [];
    items.forEach((item, index) => {
      const itemProduct = normalizeProductRow(item?.product || {});
      const itemConfig = String(itemProduct.config_id || '').trim().toLowerCase();
      const itemStorefront = normalizeStorefront(itemProduct.storefront || customer).toLowerCase();
      const enabledLevels = mplProductMasterRows
        .map(normalizeProductRow)
        .filter(row => row.is_active !== false && row.label_enabled)
        .filter(row => normalizeStorefront(row.storefront).toLowerCase() === itemStorefront)
        .filter(row => itemConfig
          ? String(row.config_id || '').trim().toLowerCase() === itemConfig
          : String(row.sku || '').trim().toLowerCase() === String(itemProduct.sku || item?.sku || '').trim().toLowerCase())
        .filter(row => normalizePackagingLevel(row.packaging_level) !== 'Pallet' && row.label_template_id !== 'FANCY_PALLET_3X3')
        .filter((row, position, rows) => rows.findIndex(candidate => normalizePackagingLevel(candidate.packaging_level) === normalizePackagingLevel(row.packaging_level)) === position);
      const outputLevels = enabledLevels.length ? enabledLevels : [itemProduct];
      outputLevels.forEach(level => jobs.push(makeJob(item, index, '', level)));
    });

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
      const context = partnerResolvedOrderContext || resolveOrderContext(payload, { customer: partnerCustomerLabel(customerId) });
      const shipToRecord = context.directoryShipTo?.row || {};
      mpl.template_id = mplTemplateId;
      mpl.brand_id = 'bakell';
      mpl.storefront = partnerCustomerLabel(customerId);
      applyResolvedOrderContextToMpl(mpl, context);
      mpl.supplier_info ||= getSharedMplDirectoryShipFrom();
      mpl.dc = shipToRecord.dc || mpl.dc || '';
      mpl.dc_name = shipToRecord.name || mpl.dc_name || '';
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

  function isPartnerPalletLabelJob(job) {
    return String(job?.template_id || '').toUpperCase() === 'FANCY_PALLET_3X3';
  }
