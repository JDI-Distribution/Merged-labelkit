/* Create a missing order SKU with the shared Product Master editor. */
let operationsNewProduct = null;

function operationsProductError(message = '') {
  document.getElementById('mpl-product-order-error').textContent = message;
  if (message) setStatus(message, 'error');
}

function operationsAddProductButton(lineIndex) {
  const item = orderDocumentsState.payload?.items?.[lineIndex];
  return item?.match_status === 'unmatched' && hasPermission('table_crud')
    ? `<button class="btn-secondary" type="button" onclick="addOperationsMissingProduct(${lineIndex})">Add ${escapeHtml(item.sku)} to Product Master</button>` : '';
}

async function addOperationsMissingProduct(lineIndex) {
  const source = orderDocumentsState.payload?.items?.[lineIndex];
  if (!source || source.match_status !== 'unmatched' || !hasPermission('table_crud') || operationsNewProduct) return;
  const pending = operationsNewProduct = { lineIndex, orderId: orderDocumentsState.reviewedOrder?.id, busy: true };
  try {
    if (!await productMasterTable.flush()) throw new Error('Product Master could not be saved. Resolve the table error before adding this SKU.');
    if (pending.orderId !== orderDocumentsState.reviewedOrder?.id) throw new Error('The loaded order changed. Select the missing SKU again.');
    pending.originalRows = JSON.parse(JSON.stringify(mplProductMasterRows));
    const customer = b2bSelectedCustomer || orderDocumentsState.customerName;
    if (mplProductMasterRows.some(row => row.is_active !== false && row.storefront === customer && canonicalId(row.sku) === canonicalId(source.sku))) {
      throw new Error('This SKU is already in Product Master. Reload the order to use the existing configuration.');
    }
    addMplProductRow({ storefront: customer, sku: source.sku, description: source.description || source.sku,
      gtin: source.gtin || '', customer_item_number: source.customer_item_number || '',
      label_enabled: false, verification_status: 'DRAFT', is_active: true });
    pending.busy = false;
    operationsProductError();
    renderMplProductEditor();
    setStatus('Complete the product setup, then Save & update order. Close discards this unsaved configuration.', 'info');
  } catch (error) {
    operationsNewProduct = null;
    setStatus(error.message, 'error');
  }
}

async function saveOperationsNewProduct() {
  const pending = operationsNewProduct;
  if (!pending || pending.busy) return;
  const source = orderDocumentsState.payload?.items?.[pending.lineIndex];
  const entries = mplProductEntriesForGroup(mplProductEditorGroupKey);
  operationsProductError();
  if (!source || pending.orderId !== orderDocumentsState.reviewedOrder?.id) return operationsProductError('The loaded order changed. Close this setup and select the missing SKU again.');
  if (!entries.some(({ row }) => canonicalId(row.sku) === canonicalId(source.sku) && row.is_active !== false) || !entries[0]?.row.description) {
    return operationsProductError('Enter a product name and keep the incoming order SKU on its correct active packaging level.');
  }
  const own = new Set(entries.map(entry => entry.index));
  if (entries.some(({ row }) => mplProductMasterRows.some((other, index) => !own.has(index)
      && other.storefront === row.storefront && other.is_active !== false && row.sku && canonicalId(other.sku) === canonicalId(row.sku)))) {
    return operationsProductError('A SKU on this configuration already exists for this customer. Use the existing configuration instead.');
  }
  pending.busy = true;
  renderMplProductEditor();
  try {
    pending.saving = true;
    const saved = await productMasterTable.flush(true);
    pending.saving = false;
    if (!saved) throw new Error('Product Master was not saved. Your setup remains open; correct the save error and retry.');
    pending.saved = true;
    saveMplProductMasterToStorage();
    showWorkflowProgress(1, 'Matching the saved SKU and recalculating this order…');
    await rematchOperationsProduct(pending.lineIndex, pending.orderId);
    pending.busy = false;
    closeMplProductEditor();
    setStatus(`${source.sku} saved to Product Master. Order matching and pallets updated; review documents before printing.`, 'success');
  } catch (error) {
    pending.saving = false;
    pending.busy = false;
    renderMplProductEditor();
    operationsProductError(`${pending.saved ? 'Product saved; order update failed. Retry order update. ' : ''}${error.message}`);
  } finally { closeWorkflowProgress(); }
}

async function rematchOperationsProduct(lineIndex, orderId) {
  const previous = orderDocumentsState.mplDraft;
  const version = JSON.stringify(previous);
  const original = orderDocumentsState.payload;
  const lookup = await window.LabelKitAPI.json('/api/order-documents/orders/lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sales_order_number: orderDocumentsState.orderNumber, ecomdash_id: orderDocumentsState.ecomdashId }),
  });
  const matched = lookup.items?.find(item => canonicalId(item.sku) === canonicalId(original.items[lineIndex].sku));
  if (matched?.match_status !== 'matched') throw new Error(matched?.match_reason || 'The saved SKU did not resolve to one active configuration. Review its level SKUs and retry.');
  const payload = JSON.parse(JSON.stringify(original));
  payload.items[lineIndex] = matched;
  payload.summary = { ...payload.summary,
    matched_products: payload.items.filter(item => item.match_status === 'matched').length,
    unmatched_products: payload.items.filter(item => item.match_status === 'unmatched').length,
    ambiguous_products: payload.items.filter(item => item.match_status === 'ambiguous').length,
    defaulted_level_skus: payload.items.filter(item => item.needs_match_review).length };
  const draft = JSON.parse(version);
  const context = orderDocumentsState.reviewedOrder.context;
  const fresh = buildAnalyticsOrderMplDraft(payload, draft.template_id || 'standard', context).packing_lists[0];
  const custom = draft.packing_lists.some(mpl => mpl.items.some(item => item.review_line_index === lineIndex && item.order_packaging));
  if (!custom) for (const [index, mpl] of draft.packing_lists.entries()) {
    mpl.items = [...mpl.items.filter(item => item.review_line_index !== lineIndex),
      ...(index === 0 ? fresh.items.filter(item => item.review_line_index === lineIndex) : [])];
  }
  const config = matched.product.config_id;
  draft.reviewed_product_master = [...(draft.reviewed_product_master || []).filter(row => !(row.config_id === config && row.storefront === matched.product.storefront)),
    ...mplProductMasterRows.filter(row => row.config_id === config && row.storefront === matched.product.storefront)];
  draft.product_master = draft.reviewed_product_master;
  for (const mpl of draft.packing_lists) {
    mpl.warnings = [...(mpl.warnings || []).filter(warning => !String(warning).includes(original.items[lineIndex].sku)),
      ...fresh.warnings.filter(warning => String(warning).includes(matched.sku))];
    mpl._pallet_weights = {}; mpl._pallet_ids = [];
  }
  draft.warnings = [...new Set(draft.packing_lists.flatMap(mpl => mpl.warnings || []))];
  draft.summary = { ...draft.summary, ...payload.summary };
  await autoPalletizeMpl(0, { draft, render: false, showStatus: false });
  if (orderId !== orderDocumentsState.reviewedOrder?.id || previous !== orderDocumentsState.mplDraft || version !== JSON.stringify(previous)) {
    throw new Error('Order edits changed during recalculation. Retry to update the current version.');
  }
  orderDocumentsState.payload = payload;
  orderDocumentsState.mplDraft = draft;
  orderDocumentsState.palletDraft = null;
  activeKeheDocumentDraft = keheLastMplDraft = draft;
  const jobs = buildB2BOrderLabelJobs([matched], [matched.product]).map(job => ({ ...job, line_index: lineIndex }));
  for (const job of jobs) {
    const old = b2bOrderLabelJobs.find(candidate => candidate.line_index === lineIndex && candidate.product.packaging_level === job.product.packaging_level);
    job.run.lot_number = old?.run.lot_number || '';
    job.run.best_before = old?.run.best_before || '';
  }
  b2bOrderLabelJobs = b2bOrderLabelJobs.filter(job => job.line_index !== lineIndex || isPartnerPalletLabelJob(job) || (custom && job.order_packaging));
  b2bOrderLabelJobs.push(...jobs.filter(job => !custom || !['Case', 'Master Case'].includes(normalizePackagingLevel(job.product.packaging_level))));
  for (const job of b2bOrderLabelJobs.filter(isPartnerPalletLabelJob)) {
    for (const run of [job.run, ...Object.values(job.template_runs || {})].filter(Boolean)) Object.assign(run, {
      carton_total: String(draft.packing_lists[0].total_pallets), carton_start: '1', carton_end: String(draft.packing_lists[0].total_pallets),
    });
  }
  b2bOrderFallbackProducts = b2bOrderLabelJobs.map((job, index) => { job.order_only_product_index = index; return { ...job.product }; });
  applyReviewedOrder();
  syncReviewedOrderItems();
  invalidateReviewedOrder();
  b2bSelectedOrderJobIndex = -1;
  if (b2bOrderLabelJobs.length) selectB2BOrderJob(0);
  renderOperationsWorkspace();
  if (document.getElementById('document-editor-panel')?.classList.contains('visible')) renderDocumentEditor('masterPackingList', draft);
  mplDraftSync?.schedule();
}
