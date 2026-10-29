/* Optional, order-only box counts and physical box measurements. */
  let operationsPackingLine = 0;
  function closeOperationsPacking() {
    document.getElementById('operations-packing-modal')?.classList.remove('visible');
    const checkbox = document.getElementById('operations-customize-packing');
    if (checkbox) checkbox.checked = false;
  }
  function openOperationsPacking() {
    if (!orderDocumentsState.payload?.items?.length) return;
    document.getElementById('operations-customize-packing').checked = true;
    persistB2BActiveRunFields();
    const select = document.getElementById('operations-packing-line');
    select.innerHTML = orderDocumentsState.payload.items.map((item, index) =>
      `<option value="${index}">${escapeHtml(item.sku || item.description || `Line ${index + 1}`)}</option>`).join('');
    document.getElementById('operations-packing-modal').classList.add('visible');
    selectOperationsPackingLine('0');
  }
  function selectOperationsPackingLine(value) {
    operationsPackingLine = Number(value);
    const source = orderDocumentsState.payload.items[operationsPackingLine];
    const rows = orderDocumentsState.mplDraft.packing_lists.flatMap(mpl => mpl.items || []);
    const item = rows.find(row => row.review_line_index === operationsPackingLine) || {};
    const product = item.order_packaging?.product || source.product || {};
    const units = window.LabelKitOrderPackingModel.orderedUnits(source);
    const lbs = window.LabelKitOrderPackingModel.unitNetLbs(source);
    document.getElementById('operations-packing-source').textContent = `${units} ordered unit(s)${lbs ? ` · ${formatNumberString(units * lbs)} lb total` : ''}. Current packing: ${rows.filter(row => row.review_line_index === operationsPackingLine).reduce((sum, row) => sum + Number(row.qty_on_pallet || 0), 0)} boxes.`;
    document.getElementById('operations-packing-unit-lbs').value = lbs || '';
    document.getElementById('operations-packing-mode').value = lbs ? 'lbs' : 'units';
    document.getElementById('operations-packing-value').value = '';
    for (const [id, field] of [['length', 'length_in'], ['width', 'width_in'], ['height', 'height_in'], ['gross', 'gross_weight_lbs']]) {
      document.getElementById(`operations-packing-${id}`).value = product[field] || item[field] || '';
    }
    document.getElementById('operations-packing-quantity-step').classList.remove('hidden');
    document.getElementById('operations-packing-size-step').classList.add('hidden');
    document.getElementById('operations-packing-error').textContent = '';
    updateOperationsPackingSummary();
  }
  function operationsPackingGroups() {
    const source = orderDocumentsState.payload.items[operationsPackingLine];
    return window.LabelKitOrderPackingModel.boxGroups({
      totalUnits: window.LabelKitOrderPackingModel.orderedUnits(source),
      unitLbs: Number(document.getElementById('operations-packing-unit-lbs').value),
      mode: document.getElementById('operations-packing-mode').value,
      value: Number(document.getElementById('operations-packing-value').value),
    });
  }
  function updateOperationsPackingSummary() {
    const mode = document.getElementById('operations-packing-mode').value;
    document.getElementById('operations-packing-value-label').textContent = { lbs: 'Pounds per box', units: 'Ordered units per box', boxes: 'Total boxes' }[mode];
    const summary = document.getElementById('operations-packing-summary');
    try {
      const groups = operationsPackingGroups();
      summary.textContent = groups.map(group => `${group.count} box(es) × ${formatNumberString(group.netLbs ?? group.units)} ${group.netLbs != null ? 'lb' : 'ordered units'}`).join(' + ');
    } catch (error) { summary.textContent = error.message; }
  }
  function continueOperationsPacking() {
    try {
      operationsPackingGroups();
      document.getElementById('operations-packing-quantity-step').classList.add('hidden');
      document.getElementById('operations-packing-size-step').classList.remove('hidden');
      document.getElementById('operations-packing-error').textContent = '';
    } catch (error) { document.getElementById('operations-packing-error').textContent = error.message; }
  }
  async function applyOperationsPacking() {
    const lineIndex = operationsPackingLine;
    const button = document.getElementById('operations-packing-apply');
    const errorTarget = document.getElementById('operations-packing-error');
    const checkbox = document.getElementById('operations-customize-packing');
    let reprocessing = false;
    try {
      const groups = operationsPackingGroups();
      const measurements = Object.fromEntries(['length', 'width', 'height', 'gross'].map(key => [key, Number(document.getElementById(`operations-packing-${key}`).value)]));
      if (Object.values(measurements).some(value => !(Number.isFinite(value) && value > 0))) throw new Error('Enter positive box length, width, height, and packed box weight.');
      const maxNet = Math.max(...groups.map(group => group.netLbs || 0));
      if (maxNet > measurements.gross + 0.0001) throw new Error('Packed box weight must include the contents and the box.');
      if (groups.length > 1 && groups.some(group => group.netLbs == null)) throw new Error('Enter pounds per ordered unit so weights can be calculated for the different box quantities.');
      const source = orderDocumentsState.payload.items[operationsPackingLine];
      const previousDraft = orderDocumentsState.mplDraft;
      const previousVersion = JSON.stringify(previousDraft);
      const draft = JSON.parse(JSON.stringify(previousDraft));
      const mpl = draft.packing_lists[0];
      const previousItems = draft.packing_lists.flatMap(list => list.items || []);
      const original = previousItems.find(item => item.review_line_index === operationsPackingLine);
      if (!original) throw new Error('This order line has no packing-list row.');
      const baseJob = b2bOrderLabelJobs.find(job => job.line_index === operationsPackingLine && normalizePackagingLevel(job.product?.packaging_level) === 'Case' && !isPartnerPalletLabelJob(job))
        || b2bOrderLabelJobs.find(job => job.line_index === operationsPackingLine && !isPartnerPalletLabelJob(job));
      const totalBoxes = groups.reduce((sum, group) => sum + group.count, 0);
      const products = [], replacements = [], jobs = [];
      let start = 1;
      for (const group of groups) {
        const samePack = normalizePackagingLevel(source.product?.packaging_level) === 'Case'
          && Number(source.product?.case_qty) === group.units;
        const product = normalizeProductRow({ ...(original.order_packaging?.product || source.product || {}),
          sku: source.sku || original.sku, description: source.description || original.description,
          storefront: source.product?.storefront || original.storefront || orderDocumentsState.customerName,
          config_id: `ORDER-${orderDocumentsState.orderNumber}-${operationsPackingLine}-${group.key}`,
          packaging_level: 'Case', case_qty: String(group.units),
          gtin: samePack ? source.product.gtin : '', barcode_type: samePack ? source.product.barcode_type : 'NONE',
          length_in: String(measurements.length), width_in: String(measurements.width), height_in: String(measurements.height),
          gross_weight_lbs: String(group.netLbs == null ? measurements.gross : group.netLbs + measurements.gross - maxNet),
          package_net_weight_g: group.netLbs == null ? '' : String(group.netLbs * 453.59237),
          label_enabled: true, in_packing_list: true, is_active: true,
        });
        products.push(product);
        replacements.push({ ...original, review_line_index: operationsPackingLine, order_packing_group: group.key,
          order_packaging: { product, source_units: window.LabelKitOrderPackingModel.orderedUnits(source), net_lbs_per_box: group.netLbs },
          qty_on_pallet: String(group.count), total_shipped: String(group.count), total_ordered: String(group.count),
          quantity_per_case: String(group.units), eaches_per_case: String(group.units), uom: 'CASES',
          product_size: group.netLbs == null ? original.product_size : `${formatNumberString(group.netLbs)} lb per box`,
          gtin: product.gtin, case_upc: product.gtin, each_gtin: '', location_on_pallet: '', pallet_weight: '',
          notes: `Order-only packing: ${group.count} box(es), ${group.units} ordered units per box.`,
        });
        if (baseJob) {
          const job = JSON.parse(JSON.stringify(baseJob));
          Object.assign(job, { product, order_packing_group: group.key, order_packaging: true });
          for (const run of [job.run, ...Object.values(job.template_runs || {})].filter(Boolean)) Object.assign(run, {
            carton_total: String(totalBoxes), carton_start: String(start), carton_end: String(start + group.count - 1),
            net_weight: group.netLbs == null ? '' : `${formatNumberString(group.netLbs)} lb`, print_barcode: !!product.gtin && run.print_barcode !== false,
          });
          jobs.push(job);
        }
        start += group.count;
      }
      for (const list of draft.packing_lists) list.items = list.items.filter(item => item.review_line_index !== operationsPackingLine);
      mpl.items.push(...replacements);
      for (const list of draft.packing_lists) { list._pallet_weights = {}; list._pallet_ids = []; }
      draft.reviewed_product_master = [...(draft.reviewed_product_master || []).filter(row => !products.some(product => product.config_id === row.config_id)), ...products];
      draft.product_master = draft.reviewed_product_master;
      button.disabled = true;
      checkbox.disabled = true;
      reprocessing = true;
      closeOperationsPacking();
      updateWorkflowProgress('Planning pallets', 'Reprocessing order with your new packing quantities and box sizes…');
      setStatus('Reprocessing order with your new packing information…', 'info');
      // Commit only after a successful calculation; failed requests preserve the session.
      const input = { mpl, product_master: draft.reviewed_product_master, action: 'auto' };
      const result = await window.LabelKitAPI.json('/api/documents/pallet-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, 45000);
      if (orderDocumentsState.mplDraft !== previousDraft || JSON.stringify(previousDraft) !== previousVersion || operationsPackingLine !== lineIndex) throw new Error('The active order changed. Reopen Customize packing.');
      draft.packing_lists[0] = result.mpl;
      orderDocumentsState.mplDraft = draft;
      activeKeheDocumentDraft = draft;
      activeKeheDocumentType = 'masterPackingList';
      keheLastMplDraft = draft;
      orderDocumentsState.palletDraft = null;
      b2bOrderLabelJobs = b2bOrderLabelJobs.filter(job => job.line_index !== operationsPackingLine || isPartnerPalletLabelJob(job));
      b2bOrderLabelJobs.push(...jobs);
      for (const job of b2bOrderLabelJobs.filter(isPartnerPalletLabelJob)) {
        for (const run of [job.run, ...Object.values(job.template_runs || {})].filter(Boolean)) Object.assign(run, {
          carton_total: String(result.mpl.total_pallets), carton_start: '1', carton_end: String(result.mpl.total_pallets),
        });
      }
      b2bOrderFallbackProducts = [];
      b2bOrderLabelJobs.forEach(job => {
        job.order_only_product_index = b2bOrderFallbackProducts.length;
        b2bOrderFallbackProducts.push({ ...job.product });
      });
      syncReviewedOrderItems();
      invalidateReviewedOrder();
      b2bSelectedOrderJobIndex = -1;
      selectB2BOrderJob(Math.max(0, b2bOrderLabelJobs.findIndex(job => job.line_index === lineIndex && job.order_packaging)));
      renderOperationsWorkspace();
      closeOperationsPacking();
      setStatus(`Packing updated: ${totalBoxes} boxes. Pallets recalculated. Review labels and packing list before printing.`, 'success');
    } catch (error) {
      errorTarget.textContent = error.message;
      if (reprocessing) {
        document.getElementById('operations-packing-modal').classList.add('visible');
        checkbox.checked = true;
        setStatus(`Reprocessing failed: ${error.message}`, 'error');
      }
    } finally {
      if (reprocessing) closeWorkflowProgress();
      checkbox.disabled = false;
      button.disabled = false;
    }
  }
