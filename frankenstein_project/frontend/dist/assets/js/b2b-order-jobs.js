/* Pure transformation from order lines and packaging data into B2B label jobs. */
(function () {
  function canonicalCustomer(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function resolveB2BTemplateChoice({ templates, customer, productTemplateId, directoryTemplateId, currentTemplateId }) {
    const available = (templates || []).filter(template => template && template.template_id);
    const availableById = new Map(available.map(template => [String(template.template_id), template]));
    const preferredIds = [currentTemplateId, productTemplateId, directoryTemplateId]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const explicitId = preferredIds.find(templateId => availableById.has(templateId)) || '';
    const wantedCustomer = canonicalCustomer(customer);
    const compatible = available.filter(template => {
      const templateCustomer = canonicalCustomer(template.customer);
      return !templateCustomer || (wantedCustomer && templateCustomer === wantedCustomer);
    });
    const uniqueCompatible = [...new Map(compatible.map(template => [template.template_id, template])).values()];
    const selectedId = explicitId || (uniqueCompatible.length === 1 ? String(uniqueCompatible[0].template_id) : '');
    const ordered = [...uniqueCompatible];
    available.forEach(template => {
      if (!ordered.some(candidate => candidate.template_id === template.template_id)) ordered.push(template);
    });
    return {
      selectedId,
      compatible: uniqueCompatible,
      options: ordered,
      source: explicitId
        ? (explicitId === String(productTemplateId || '').trim() ? 'product_master'
          : explicitId === String(directoryTemplateId || '').trim() ? 'directory'
            : 'current')
        : selectedId ? 'customer' : 'manual',
    };
  }

  function selectedTemplateIds(job) {
    const configured = Array.isArray(job?.template_ids) ? job.template_ids : [];
    return [...new Set([...configured, job?.template_id]
      .map(value => String(value || '').trim())
      .filter(Boolean))];
  }

  function expandB2BTemplateJobs(jobs) {
    return (jobs || []).flatMap(job => selectedTemplateIds(job).map(templateId => ({
      ...job,
      template_id: templateId,
      template_ids: [templateId],
      product: { ...(job.product || {}), label_template_id: templateId },
      directory: { ...(job.directory || {}) },
      run: { ...(job.run || {}), ...(job.template_runs?.[templateId] || {}) },
    })));
  }

  function buildB2BOrderLabelJobs({
    orderItems,
    fallbackProducts,
    productRows,
    templates,
    destination,
    runFields,
    customer,
    normalizeProduct,
    normalizeLevel,
    productGroupKey,
    getLabelEnabled,
  }) {
    const orderOnlyProducts = fallbackProducts || [];
    return (orderItems || []).flatMap((source, index) => {
      const matchedProduct = source?.product || null;
      const sourceProduct = orderOnlyProducts[index]
        || matchedProduct
        || {
          sku: source?.sku || '',
          customer_item_number: source?.customer_item_number || source?.item_number || source?.sku || '',
          description: source?.description || source?.sku || `Order line ${index + 1}`,
          gtin: source?.gtin || '',
          unit_weight_lbs: source?.unit_weight_lbs || '',
          case_qty: '',
          verification_status: 'NEEDS_REVIEW',
        };
      const product = normalizeProduct(sourceProduct);
      const groupRows = (productRows || [])
        .map((row, rowIndex) => ({ row: normalizeProduct(row), index: rowIndex }))
        .filter(entry => productGroupKey(entry.row, entry.index) === productGroupKey(matchedProduct || product, index));
      const summary = Array.isArray(source?.packaging_summary) ? source.packaging_summary : [];
      const enabledSummary = summary.filter(getLabelEnabled);
      const levels = enabledSummary.length
        ? enabledSummary
        : summary.length
          ? []
          : [{
            packaging_level: product.packaging_level || 'Case',
            label_template_id: product.label_template_id || '',
            sku: product.sku,
            label_enabled: true,
          }];

      return levels.map(level => {
        const levelName = normalizeLevel(level.packaging_level || product.packaging_level || 'Case');
        const productLevelRow = groupRows.find(entry => normalizeLevel(entry.row.packaging_level) === levelName)?.row;
        const orderLevelRow = normalizeLevel(product.packaging_level) === levelName ? product : {};
        const levelRow = { ...product, ...(productLevelRow || {}), ...orderLevelRow };
        const levelTemplateId = String(
          level.label_template_id || productLevelRow?.label_template_id || orderLevelRow.label_template_id || ''
        ).trim();
        const templateResolution = resolveB2BTemplateChoice({
          templates,
          customer: customer || levelRow.storefront || product.storefront,
          productTemplateId: levelTemplateId,
          directoryTemplateId: destination?.default_label_template_id,
        });
        const templateId = String(templateResolution.selectedId || '');
        const template = (templates || []).find(candidate => candidate.template_id === templateId) || {};
        const templateSelectionRequired = !templateId;
        const eachesPerUnit = Number(
          level.eaches_per_unit || (levelName === 'Each' ? 1 : levelRow.case_qty || product.case_qty) || 1
        );
        const outputProduct = {
          ...levelRow,
          storefront: customer || levelRow.storefront || product.storefront,
          packaging_level: levelName,
          sku: String(level.sku || product.sku || levelRow.sku || '').trim(),
          gtin: String(level.gtin || product.gtin || levelRow.gtin || '').trim(),
          barcode_type: String(level.barcode_type || product.barcode_type || levelRow.barcode_type || '').trim(),
          case_qty: String(eachesPerUnit),
          default_copies: String(level.default_copies || product.default_copies || levelRow.default_copies || '').trim(),
          label_template_id: templateId,
          label_enabled: true,
          verification_status: level.label_review_required
            ? 'NEEDS_REVIEW'
            : (level.verification_status || levelRow.verification_status || product.verification_status),
        };
        const eachQuantity = Number(source?.quantity_ordered_eaches ?? source?.quantity_ordered ?? 0) || 0;
        const labelUnitCount = Math.max(1, Math.ceil(eachQuantity / eachesPerUnit));
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
        const reviewReasons = [
          ...(templateSelectionRequired ? [`Choose a label template for ${levelName}.`] : []),
          ...(level.label_review_required ? [`${levelName} label requires review.`] : []),
          ...(source?.needs_match_review && source?.match_reason ? [String(source.match_reason)] : []),
        ];
        return {
          print_selected: true,
          template_id: templateId,
          template_ids: templateId ? [templateId] : [],
          template_selection_required: templateSelectionRequired,
          product: outputProduct,
          directory: { ...(destination || {}) },
          run: {
            ...(runFields || {}),
            order_number: String(runFields?.order_number || ''),
            quantity_label: String(source?.quantity_ordered_eaches ?? source?.quantity_ordered ?? ''),
            carton_total: String(labelUnitCount),
            carton_start: '1',
            carton_end: String(labelUnitCount),
            copies: String(outputProduct.default_copies || template.default_copies || 1),
            print_barcode: hasBarcode,
          },
          source_quantity: source?.quantity_ordered ?? '',
          source_quantity_eaches: source?.quantity_ordered_eaches ?? source?.quantity_ordered ?? '',
          level_eaches_per_unit: eachesPerUnit,
          packaging_summary: summary,
          needs_label_review: reviewReasons.length > 0,
          review_reasons: reviewReasons,
          match_status: source?.match_status || 'unmatched',
          match_reason_code: source?.match_reason_code || '',
          match_reason: source?.match_reason || '',
          candidate_config_ids: source?.candidate_config_ids || [],
          line_index: index,
          order_only: true,
        };
      });
    });
  }

  const api = { buildB2BOrderLabelJobs, resolveB2BTemplateChoice, selectedTemplateIds, expandB2BTemplateJobs };
  window.LabelKitB2BOrderJobs = api;
  globalThis.LabelKitB2BOrderJobs = api;
})();
