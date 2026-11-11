/* Excel batch import stays detached from the current editable order session. */
let orderExcel = { busy: false, checkId: '', reviewId: '', resultId: '', matching: null, choices: {} };

function openOrderExcel() {
  document.getElementById('order-excel-modal').classList.add('visible');
  document.getElementById('order-excel-export').disabled = !orderDocumentsState.payload?.items?.length;
}
function closeOrderExcel() { document.getElementById('order-excel-modal').classList.remove('visible'); }
function orderExcelStatus(message, error = false) {
  const target = document.getElementById('order-excel-status');
  target.textContent = message;
  target.classList.toggle('is-error', error);
}
function orderExcelBusy(busy) {
  orderExcel.busy = busy;
  document.querySelectorAll('#order-excel-modal [data-excel-action], #order-excel-file').forEach(element => { element.disabled = busy; });
}
async function orderExcelDownload(url, filename, body) {
  try {
    const blob = await window.LabelKitAPI.blob(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) { orderExcelStatus(error.message, true); }
}
function downloadOrderExcelTemplate() { return orderExcelDownload('/api/order-documents/excel/template', 'Order_Documents_Template.xlsx'); }

async function pollOrderExcel(resultId) {
  const deadline = Date.now() + 30*60*1000;
  while (Date.now() < deadline) {
    const state = await window.LabelKitAPI.json(`/results/${encodeURIComponent(resultId)}/status`, {}, 30000);
    orderExcelStatus(state.detail || 'Processing workbook…');
    if (state.status === 'error') throw new Error(state.detail || 'Workbook processing failed.');
    if (state.status === 'complete') return state.report;
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw new Error('This batch is taking longer than expected. Reopen the batch review or use a smaller workbook.');
}

async function checkOrderExcel() {
  if (orderExcel.busy) return;
  const file = document.getElementById('order-excel-file').files[0];
  if (!file) return orderExcelStatus('Choose the completed .xlsx order workbook first.', true);
  if (!/\.xlsx$/i.test(file.name)) return orderExcelStatus('Choose an .xlsx order workbook.', true);
  orderExcel = { busy: false, checkId: '', reviewId: '', resultId: '', matching: null, choices: {} };
  document.getElementById('order-excel-results').innerHTML = '';
  orderExcelBusy(true);
  try {
    const form = new FormData(); form.append('file', file);
    orderExcelStatus('Uploading workbook and matching order numbers, SKUs and supplied data…');
    const job = await window.LabelKitAPI.json('/api/order-documents/excel/check', { method: 'POST', body: form }, 120000);
    orderExcel.checkId = job.result_id;
    orderExcel.matching = await pollOrderExcel(job.result_id);
    renderOrderExcelMatching();
  } catch (error) { orderExcelStatus(error.message, true); }
  finally { orderExcelBusy(false); }
}

function renderOrderExcelMatching() {
  const orders = orderExcel.matching?.orders || [];
  document.getElementById('order-excel-results').innerHTML = `<h3>Match orders before processing</h3>
    <p>Choose a source for every discrepancy. The source controls order data and SKU quantities. Explicit document, label and custom packing settings apply to the selected order data.</p>
    ${orders.map((order, index) => {
      const chosen = orderExcel.choices[order.order_number] || {};
      const records = order.records || [];
      return `<section class="order-excel-order"><header><strong>Order ${escapeHtml(order.order_number)}</strong><span>${order.line_count} uploaded line(s) · ${order.differences.length} discrepancy(s)</span></header>
        <div class="order-excel-source"><label>Use data from<select data-excel-action id="order-excel-source-${index}">
          ${!order.differences.length ? '<option value="auto">Matched available data</option>' : '<option value="">Choose a source…</option>'}
          <option value="analytics" ${order.analytics_available ? '' : 'disabled'}>Analytics${order.analytics_available ? '' : ' — unavailable'}</option>
          <option value="workbook">Uploaded workbook</option><option value="skip">Skip this order</option></select></label>
          ${records.length ? `<label>Analytics order record<select data-excel-action id="order-excel-record-${index}">${records.length > 1 ? '<option value="">Select the correct order record…</option>' : ''}${records.map(record => `<option value="${escapeHtml(record.ecomdash_id)}">${escapeHtml([record.ecomdash_id, record.storefront, record.billing_customer_name, record.invoice_date].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>` : '<span>Analytics has no available record. Supply the required fields in the workbook or skip this order.</span>'}
        </div>${order.differences.length ? `<div class="order-excel-table"><table><thead><tr><th>Field</th><th>Analytics / Product Master</th><th>Uploaded workbook</th><th>Discrepancy</th></tr></thead><tbody>${order.differences.map(diff => `<tr><td>${escapeHtml(diff.field)}</td><td>${escapeHtml(diff.analytics || 'Blank')}</td><td>${escapeHtml(diff.workbook || 'Blank')}</td><td>${escapeHtml(diff.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<p>Order and supplied SKU data match. Missing optional values will use the available source defaults.</p>'}</section>`;
    }).join('')}
    <button data-excel-action class="btn-generate" type="button" onclick="resolveOrderExcel()">Validate selected sources</button>`;
  orders.forEach((order, index) => {
    const source = document.getElementById(`order-excel-source-${index}`), record = document.getElementById(`order-excel-record-${index}`);
    source.value = orderExcel.choices[order.order_number]?.source || (order.differences.length ? '' : 'auto');
    if (record && orderExcel.choices[order.order_number]?.record_id) record.value = orderExcel.choices[order.order_number].record_id;
  });
}

async function resolveOrderExcel() {
  if (orderExcel.busy) return;
  for (const [index, order] of orderExcel.matching.orders.entries()) {
    const source = document.getElementById(`order-excel-source-${index}`).value;
    const record = document.getElementById(`order-excel-record-${index}`)?.value || '';
    if (!source) return orderExcelStatus(`Order ${order.order_number}: choose Analytics, uploaded workbook, or Skip.`, true);
    if (source === 'analytics' && !record && order.records.length > 1) return orderExcelStatus(`Order ${order.order_number}: select an Analytics record.`, true);
    orderExcel.choices[order.order_number] = { source, record_id: record };
  }
  orderExcelBusy(true);
  try {
    const job = await window.LabelKitAPI.json('/api/order-documents/excel/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result_id: orderExcel.checkId, choices: orderExcel.choices }) });
    orderExcel.reviewId = job.result_id;
    const review = await pollOrderExcel(job.result_id);
    document.getElementById('order-excel-results').innerHTML = `<h3>Review matched orders and documents</h3>
      <p>${review.error_count} blocking issue(s) · ${review.warning_count} warning(s) · ${review.label_pages} label page(s)</p>
      ${review.orders.map(order => `<section class="order-excel-order"><header><strong>Order ${escapeHtml(order.order_number)}</strong><span>${escapeHtml(order.skipped ? 'Skipped' : `${order.source || 'Needs source'} · ${order.line_count || 0} line(s) · ${order.pallet_count || 0} pallet(s)`)}</span></header>
      ${order.review ? `<p>Customer: ${escapeHtml(order.review.customer || 'Not provided')} · PO: ${escapeHtml(order.review.po_number || 'Blank')} · Ship date: ${escapeHtml(order.review.ship_date || 'Blank')}</p><p>Outputs: ${escapeHtml(order.review.outputs.join(', '))}</p><div class="order-excel-table"><table><thead><tr><th>SKU / line</th><th>Ordered quantity</th><th>Shipping boxes</th><th>Label templates</th></tr></thead><tbody>${order.review.lines.map(line => `<tr><td>${escapeHtml(line.sku)}<br>${escapeHtml(line.line_id)}</td><td>${escapeHtml(line.quantity)} ${escapeHtml(line.unit)}</td><td>${line.boxes}</td><td>${escapeHtml(line.templates.join(', ') || 'None')}</td></tr>`).join('')}</tbody></table></div><details><summary>Review resolved addresses</summary><div class="order-excel-addresses">${[['Ship From', order.review.ship_from], ['Bill To', order.review.bill_to], ['Ship To', order.review.ship_to]].map(([name, value]) => `<div><strong>${name}</strong><p>${escapeHtml(value || 'Blank')}</p></div>`).join('')}</div></details>` : ''}
      ${order.errors.length ? `<ul class="order-excel-errors">${order.errors.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul>` : ''}
      ${order.warnings.length ? `<details><summary>${order.warnings.length} document warning(s)</summary><ul>${order.warnings.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul></details>` : ''}</section>`).join('')}
      ${review.warning_count ? '<label class="order-excel-ack"><input id="order-excel-ack" type="checkbox"> I reviewed the document warnings for these selected inputs.</label>' : ''}
      <div class="order-excel-source"><button data-excel-action class="btn-secondary" type="button" onclick="renderOrderExcelMatching()">Back to source choices</button>
      ${review.can_generate ? '<button data-excel-action class="btn-generate" type="button" onclick="generateOrderExcel()">Generate order ZIP</button>' : '<p>Correct the workbook and upload again, or go back and skip orders with blocking issues.</p>'}</div>`;
  } catch (error) { orderExcelStatus(error.message, true); }
  finally { orderExcelBusy(false); }
}

async function generateOrderExcel() {
  if (orderExcel.busy) return;
  const acknowledgement = document.getElementById('order-excel-ack');
  if (acknowledgement && !acknowledgement.checked) return orderExcelStatus('Review and acknowledge the document warnings before generating.', true);
  orderExcelBusy(true);
  try {
    const job = await window.LabelKitAPI.json('/api/order-documents/excel/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result_id: orderExcel.reviewId, approve_warnings: !!acknowledgement?.checked }) });
    orderExcel.resultId = job.result_id;
    const report = await pollOrderExcel(job.result_id);
    document.getElementById('order-excel-results').innerHTML = `<h3>${report.generated} order(s) generated · ${report.failed} failed · ${report.skipped} skipped</h3>
      <p>The ZIP includes one folder per generated order, the source workbook and the processing/source-decision report.</p>
      <ul>${report.orders.map(order => `<li>Order ${escapeHtml(order.order_number)}: ${escapeHtml(order.status)}${order.error ? ` — ${escapeHtml(order.error)}` : ''}</li>`).join('')}</ul>
      <button data-excel-action class="btn-generate" type="button" onclick="orderExcelDownload('/results/${encodeURIComponent(job.result_id)}/file', 'order_documents.zip')">Download ZIP and report</button>`;
  } catch (error) { orderExcelStatus(error.message, true); }
  finally { orderExcelBusy(false); }
}

async function exportLoadedOrderExcel() {
  const payload = orderDocumentsState.payload;
  if (!payload?.items?.length) return orderExcelStatus('Load an order before exporting its inputs.', true);
  const draft = orderDocumentsState.mplDraft, mpl = draft.packing_lists[0], fields = orderDocumentsState.reviewedOrder?.fields || {};
  const order = orderDocumentsState.orderNumber;
  const selected = operationsSelectedDocuments();
  const header = { order_number: order, record_id: orderDocumentsState.ecomdashId, customer: b2bSelectedCustomer || orderDocumentsState.customerName,
    po_number: fields.po_number, ship_date: fields.ship_date, ship_from: fields.ship_from, ship_to: fields.ship_to, bill_to: fields.bill_to,
    po_date: mpl.po_date, bol_number: mpl.bol_number, pro_number: mpl.pro_number, ship_via: mpl.ship_via, shipping_instructions: mpl.shipping_instructions,
    mpl_layout: mpl.template_id || draft.template_id, brand: mpl.brand_id || draft.brand_id,
    labels: selected.labels ? 'Yes' : 'No', packing_list: selected.mpl ? 'Yes' : 'No', pallet_labels: selected.pallets ? 'Yes' : 'No', ...mpl._tihi_constraints };
  const rows = draft.packing_lists.flatMap(list => list.items || []);
  const lines = payload.items.map((item, index) => {
    const row = rows.find(row => row.review_line_index === index) || {}, packing = row.order_packaging, product = packing?.product || item.product || {};
    const each = (draft.reviewed_product_master || []).find(candidate => candidate.config_id === item.product?.config_id && candidate.storefront === item.product?.storefront && candidate.packaging_level === 'Each');
    return { order_number: order, line_id: `LINE-${index+1}`, sku: item.sku, quantity: Number(item.quantity_ordered_eaches ?? item.quantity_ordered),
      quantity_uom: item.quantity_ordered_eaches != null ? 'Each' : 'Auto', config_id: item.product?.config_id || '', description: row.description || item.description,
      customer_item_number: row.customer_item_number, each_gtin: each?.gtin || row.each_gtin, case_gtin: product.packaging_level === 'Case' ? product.gtin : '',
      eaches_per_case: row.quantity_per_case || product.case_qty, length_in: product.length_in, width_in: product.width_in, height_in: product.height_in,
      gross_weight_lbs: product.gross_weight_lbs, pack_by: ({ units: 'Units per box', lbs: 'Pounds per box', boxes: 'Total boxes' })[packing?.settings?.mode] || 'Default',
      pack_value: packing?.settings?.value, unit_lbs: packing?.settings?.unitLbs || '', expiration_date: row.expiration_date, notes: row.notes };
  });
  // Preserve added packing-list lines which did not originate in Analytics.
  const manual = new Map();
  for (const row of rows.filter(row => row.review_line_index == null)) {
    const identity = `${row.sku}|${row.config_id || ''}`;
    if (!manual.has(identity)) manual.set(identity, { ...row, quantity: 0 });
    manual.get(identity).quantity += Number(row.qty_on_pallet || 0);
  }
  for (const row of manual.values()) lines.push({ order_number: order, line_id: `MANUAL-${lines.length+1}`, sku: row.sku || row.item_number,
    quantity: row.quantity, quantity_uom: row.uom === 'EACHES' ? 'Each' : 'Case', description: row.description, eaches_per_case: row.quantity_per_case,
    case_gtin: row.case_upc || row.gtin, each_gtin: row.each_gtin, length_in: row.length_in, width_in: row.width_in, height_in: row.height_in,
    gross_weight_lbs: row.unit_weight_lbs, notes: row.notes, expiration_date: row.expiration_date });
  const labels = [], seen = new Set();
  for (const job of b2bOrderLabelJobs.filter(job => job.print_selected !== false)) {
    for (const template of b2bTemplateIdsForJob(job)) {
      const identity = JSON.stringify([job.line_index, job.product.packaging_level, template]);
      if (job.order_packaging && seen.has(identity)) continue;
      seen.add(identity);
      const run = job.template_runs?.[template] || job.run || {};
      labels.push({ order_number: order, line_id: `LINE-${Number(job.line_index)+1}`, sku: payload.items[job.line_index]?.sku || job.product.sku,
        level: job.product.packaging_level, template_id: template, copies: Number(run.copies || 1), lot_number: run.lot_number,
        best_before: run.best_before, expected_delivery_date: run.expected_delivery_date, print_barcode: run.print_barcode ? 'Yes' : 'No',
        carton_start: job.order_packaging ? '' : run.carton_start, carton_end: job.order_packaging ? '' : run.carton_end,
        quantity_label: run.quantity_label, net_weight: job.order_packaging ? '' : run.net_weight, case_pack_text: run.pack_text });
    }
  }
  await orderExcelDownload('/api/order-documents/excel/export', `Order_${order}_Inputs.xlsx`, { sheets: { Orders: [header], 'Order Lines': lines, Labels: labels } });
}
