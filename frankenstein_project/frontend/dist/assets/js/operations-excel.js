/* Excel batch import stays detached from the current editable order session. */
let orderExcel = { busy: false, checkId: '', reviewId: '', resultId: '', matching: null, choices: {}, issuesOnly: false };

function openOrderExcel() {
  document.getElementById('order-excel-modal').classList.add('visible');
  document.getElementById('order-excel-export').disabled = !orderDocumentsState.payload?.items?.length;
  setOrderExcelStep(orderExcel.step || 1);
}
function setOrderExcelStep(step) {
  orderExcel.step=step;
  document.querySelectorAll('#order-excel-modal [data-bulk-step]').forEach(item=>{
    if(Number(item.dataset.bulkStep)===step)item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  });
}
function closeOrderExcel() { document.getElementById('order-excel-modal').classList.remove('visible'); }
function orderExcelStatus(message, error = false) {
  const target = document.getElementById('order-excel-status');
  target.textContent = message;
  target.classList.toggle('is-error', error);
}
function orderExcelBusy(busy) {
  orderExcel.busy = busy;
  document.querySelector('#order-excel-modal .editor-dialog').setAttribute('aria-busy', String(busy));
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
function downloadOrderExcelTemplate() { return orderExcelDownload('/api/order-documents/excel/template', 'Bulk_Order_Processing_Template.xlsx'); }

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
  orderExcel = { busy: false, checkId: '', reviewId: '', resultId: '', matching: null, choices: {}, issuesOnly: false };
  setOrderExcelStep(1);
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

const orderExcelSourceNames = { workbook: 'Excel', analytics: 'Analytics', product_master: 'Product Master', directory: 'Directory', default: 'App default', custom: 'Edited' };

function orderExcelSameValue(field,a,b) {
  if(field.type==='number' && a!=='' && b!=='') return Number(String(a).replaceAll(',',''))===Number(String(b).replaceAll(',',''));
  return String(a).trim().toLowerCase()===String(b).trim().toLowerCase();
}
function orderExcelFieldStatus(field) {
  if(field.stale)return 'Selected source unavailable — choose another value';
  if(field.missing)return 'Missing — required before printing';
  const stored=Object.entries(field.candidates).filter(([name])=>['analytics','product_master','directory'].includes(name));
  const differs=stored.some(([,value])=>!orderExcelSameValue(field,field.value,value));
  if(differs)return `${field.label} differs from saved value — using ${field.source_label}`;
  if(field.source==='custom')return 'Edited for this batch';
  if(stored.length && field.value)return `Matches saved value — using ${field.source_label}`;
  if(!field.value)return 'Not provided / optional';
  return `Using ${field.source_label}`;
}
function orderExcelFieldComparison(field,index) {
  if(field.readonly)return '';
  const entries=Object.entries(field.candidates).filter(([name])=>name!=='default');
  if(!entries.length)return '';
  return `<div class="order-excel-comparison">${entries.map(([source,value])=>{
    const same=orderExcelSameValue(field,field.value,value);
    const saved=['analytics','product_master','directory'].includes(source);
    return `<div><span><strong>${saved?'Saved in '+orderExcelSourceNames[source]:'Original Excel'}:</strong> ${escapeHtml(value)}</span>${!same?`<button data-excel-action type="button" class="btn-secondary" onclick="editOrderExcelField(${index}, '${field.path}', '${source}', null)">${saved?'Restore saved value':'Use Excel value'}</button>`:'<small>Matches current value</small>'}</div>`;
  }).join('')}</div>`;
}

function renderOrderExcelField(field, orderIndex, sectionIndex, fieldIndex) {
  const issue = field.missing || field.conflict || field.stale;
  if (orderExcel.issuesOnly && !issue) return '';
  const id = `excel-value-${orderIndex}-${sectionIndex}-${fieldIndex}`;
  const options = field.options.length ? field.options : orderExcel.matching.orders[orderIndex].choices[field.choice_list] || [];
  const badge = orderExcelFieldStatus(field);
  const source = `<select data-excel-action aria-label="${escapeHtml(field.label)} source" onchange="editOrderExcelField(${orderIndex}, '${field.path}', this.value, null)">
    <option value="auto">Default${field.default_source ? ' ('+escapeHtml(orderExcelSourceNames[field.default_source])+')' : ' (blank)'}</option>
    ${Object.entries(field.candidates).map(([name, value]) => `<option value="${name}">${escapeHtml(orderExcelSourceNames[name]+': '+value.replaceAll('\n', ', ').slice(0,80))}</option>`).join('')}
    <option value="custom">Enter my own value</option></select>`;
  const attrs = `data-excel-action id="${id}" aria-label="${escapeHtml(field.label)} value" onchange="editOrderExcelField(${orderIndex}, '${field.path}', 'custom', this.value)"`;
  const multiline = /Address|Instructions|Notes/.test(field.label);
  const dropdown = options.length && field.choice_list && !['skus','customers','configs'].includes(field.choice_list);
  const labels = orderExcel.matching.orders[orderIndex].choice_labels || {};
  const value = field.readonly ? `<span>${escapeHtml(field.value || 'Blank')}</span>` : multiline ? `<textarea ${attrs} rows="3">${escapeHtml(field.value)}</textarea>` : dropdown ? `<select ${attrs}><option value="">Not specified</option>${[...new Set([...(field.value ? [field.value] : []),...options])].map(option=>`<option value="${escapeHtml(option)}" ${option===field.value ? 'selected' : ''}>${escapeHtml(labels[option] || option)}</option>`).join('')}</select>` : `<input ${attrs} type="${field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}" ${field.type === 'number' ? 'step="any" min="0"' : ''} value="${escapeHtml(field.value)}" ${options.length ? `list="${id}-choices"` : ''}>
    ${options.length ? `<datalist id="${id}-choices">${options.map(option => `<option value="${escapeHtml(option)}"></option>`).join('')}</datalist>` : ''}`;
  return `<div class="order-excel-field ${field.missing || field.stale ? 'needs-input' : field.conflict ? 'has-conflict' : ''}" data-field-path="${field.path}">
    <div><label for="${id}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><small class="order-excel-badge">${escapeHtml(badge)}</small></div>
    ${field.readonly ? '<span class="order-excel-readonly">Linked identifier</span>' : source}<div>${value}${orderExcelFieldComparison(field,orderIndex)}</div></div>`;
}

function renderOrderExcelMatching() {
  setOrderExcelStep(2);
  const orders = orderExcel.matching?.orders || [];
  document.getElementById('order-excel-results').innerHTML = `<h3>Review Excel and app defaults</h3>
    <p>Check the values that will be printed. Excel values stay in use unless you change them. Compare saved values below each field, use Restore saved value when needed, or type a correction. Changes apply to this batch only.</p>
    <label class="order-excel-ack"><input id="order-excel-issues-only" type="checkbox" ${orderExcel.issuesOnly ? 'checked' : ''} onchange="orderExcel.issuesOnly=this.checked;renderOrderExcelMatching()"> Show only missing or conflicting fields</label>
    ${orders.map((order,index) => {
      const chosen = orderExcel.choices[order.order_number] || {};
      return `<section class="order-excel-order" data-excel-order="${index}"><header><strong>Order ${escapeHtml(order.order_number)}</strong><span>${order.filled_count} filled from app/defaults / ${order.missing_count} missing / ${order.conflict_count} conflicts</span></header>
      <div class="order-excel-source"><label><input data-excel-action type="checkbox" ${chosen.skip ? 'checked' : ''} onchange="skipOrderExcel(${index},this.checked)"> Skip this order</label>
      ${order.records.length ? `<label>Analytics order record<select data-excel-action aria-label="Order ${escapeHtml(order.order_number)} Analytics record" onchange="selectOrderExcelRecord(${index},this.value)">
      ${order.records.length > 1 ? '<option value="">Choose a record to fill missing fields</option>' : ''}${order.records.map(record => `<option value="${escapeHtml(record.ecomdash_id)}">${escapeHtml([record.ecomdash_id,record.storefront,record.invoice_date].filter(Boolean).join(' / '))}</option>`).join('')}<option value="__none__">No Analytics fallback</option></select></label>` : ''}</div>
      ${chosen.skip ? '<p>This order will be skipped. Its inputs are retained.</p>' : `${order.notices.length ? `<ul class="order-excel-notices">${order.notices.map(message=>`<li>${escapeHtml(message)}</li>`).join('')}</ul>` : ''}
      ${order.sections.map((section,sectionIndex)=>{
        const primary=[], optional=[];
        section.fields.forEach((field,fieldIndex)=>{
          const html=renderOrderExcelField(field,index,sectionIndex,fieldIndex);
          if(!field.value && !field.required && !field.conflict && !field.stale && !field.readonly)optional.push(html);
          else primary.push(html);
        });
        const fields=primary.join('')+(!orderExcel.issuesOnly && optional.length ? `<details class="order-excel-optional"><summary>Additional optional fields (${optional.length})</summary>${optional.join('')}</details>`:'');
        return fields ? `<details class="order-excel-section" ${section.fields.some(field=>field.missing || field.stale || field.conflict) || !orderExcel.issuesOnly ? 'open' : ''}><summary>${escapeHtml(section.title)}</summary>${section.kind==='line' ? `<p class="order-excel-match-status">${section.product_match==='matched' ? 'SKU found in Product Master' : section.product_match==='ambiguous' ? 'Multiple saved packaging configurations — choose a configuration' : 'SKU not found in Product Master — check the SKU or complete packing details'}<br>${section.analytics_match==='matched' ? 'SKU found on this Analytics order' : section.analytics_match==='missing' ? 'SKU not found on this Analytics order' : 'Analytics order match unavailable'}</p>` : ''}<div class="order-excel-fields">${fields}</div></details>` : '';
      }).join('')}
      ${orderExcel.issuesOnly && !order.missing_count && !order.conflict_count ? '<p>No missing or conflicting fields. Uncheck the filter to inspect or edit all defaults.</p>' : ''}
      ${order.notices.length || order.conflict_count ? `<label class="order-excel-ack"><input data-excel-action type="checkbox" class="order-excel-match-ack" ${chosen.acknowledge_matches ? 'checked' : ''} onchange="acknowledgeOrderExcel(${index},this.checked)"> I reviewed the match notices and conflicting values for this order.</label>` : ''}`}</section>`;
    }).join('')}
    <div class="order-excel-source"><button data-excel-action class="btn-secondary" type="button" onclick="refreshOrderExcelFields()">Recheck defaults</button><button data-excel-action class="btn-generate" type="button" onclick="resolveOrderExcel()">Recalculate and review documents</button></div>`;
  orders.forEach((order,index)=>{
    const selected=orderExcel.choices[order.order_number] || {};
    const record=document.querySelector(`[data-excel-order="${index}"] select[aria-label$="Analytics record"]`);
    if(record) record.value=selected.record_id ?? order.record_id;
    order.sections.forEach(section=>section.fields.forEach(field=>{
      const source=document.querySelector(`[data-excel-order="${index}"] [data-field-path="${field.path}"] select`);
      if(source)source.value=field.selection;
    }));
  });
}

function orderExcelChoice(index) {
  const order=orderExcel.matching.orders[index];
  return orderExcel.choices[order.order_number] ||= {fields:{}};
}
function acknowledgeOrderExcel(index,value) {
  orderExcelChoice(index).acknowledge_matches=value;orderExcel.reviewId='';
  document.querySelector(`[data-excel-order="${index}"] .order-excel-match-ack`)?.closest('label').classList.remove('needs-review');
}
function skipOrderExcel(index,value) {orderExcelChoice(index).skip=value;orderExcel.reviewId='';renderOrderExcelMatching();}
async function selectOrderExcelRecord(index,value) {const choice=orderExcelChoice(index);choice.record_id=value;choice.acknowledge_matches=false;orderExcel.reviewId='';await refreshOrderExcelFields(index);}

async function editOrderExcelField(index,path,source,value) {
  const choice=orderExcelChoice(index);choice.fields ||= {};
  const field=orderExcel.matching.orders[index].sections.flatMap(section=>section.fields).find(field=>field.path===path);
  choice.fields[path]={source,...(source==='custom'?{value:value===null?field.value:value}:{})};
  choice.acknowledge_matches=false;orderExcel.reviewId='';
  field.selection=source;field.source=source==='auto'?field.default_source:source;
  field.source_label=orderExcelSourceNames[field.source] || 'Not available';
  field.value=source==='custom'?choice.fields[path].value:field.candidates[field.source] || '';
  field.missing=field.required && !field.value;
  // Preserve the clicked DOM controls during blur/change. Rebuilding this form
  // here discards the next click (including Recalculate or its acknowledgment).
  const card=document.querySelector(`[data-excel-order="${index}"]`);
  const row=card.querySelector(`[data-field-path="${path}"]`);
  row.querySelector('select[aria-label$=" source"]').value=source;
  row.querySelector('[aria-label$=" value"]').value=field.value;
  row.querySelector('.order-excel-badge').textContent=orderExcelFieldStatus(field);
  row.querySelector('.order-excel-comparison')?.remove();
  row.querySelector('[aria-label$=" value"]').parentElement.insertAdjacentHTML('beforeend',orderExcelFieldComparison(field,index));
  row.classList.toggle('needs-input',field.missing);
  row.classList.toggle('has-conflict',!field.missing && field.conflict);
  const acknowledgment=card.querySelector('.order-excel-match-ack');
  if(acknowledgment)acknowledgment.checked=false;
  orderExcelStatus('Edits saved for this batch. Recalculate to refresh defaults and review documents.');
}

async function refreshOrderExcelFields(index=null) {
  if(orderExcel.busy)return false;
  orderExcelBusy(true);
  orderExcelStatus('Checking field defaults…');
  try {
    const indexes=index===null?orderExcel.matching.orders.map((_,i)=>i):[index];
    for(const i of indexes){
      const order=orderExcel.matching.orders[i];
      const model=await window.LabelKitAPI.json('/api/order-documents/excel/fields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_id:orderExcel.checkId,order_number:order.order_number,choice:orderExcelChoice(i)})});
      const before=order.sections.flatMap(section=>section.fields).map(field=>[field.path,field.value]);
      const after=model.sections.flatMap(section=>section.fields).map(field=>[field.path,field.value]);
      if(JSON.stringify(before)!==JSON.stringify(after) || JSON.stringify(order.notices)!==JSON.stringify(model.notices))
        orderExcelChoice(i).acknowledge_matches=false;
      orderExcel.matching.orders[i]=model;
    }
    renderOrderExcelMatching();orderExcelStatus('Defaults refreshed. Excel values and your edits are retained.');
    return true;
  } catch(error){orderExcelStatus(error.message,true);return false;}
  finally{orderExcelBusy(false);}
}

async function resolveOrderExcel() {
  if (orderExcel.busy) return orderExcelStatus('A workbook check is running. Please wait for it to finish.');
  if (!orderExcel.matching) return orderExcelStatus('Upload an order workbook first.',true);
  if (!await refreshOrderExcelFields()) return;
  for (const [index, order] of orderExcel.matching.orders.entries()) {
    const choice=orderExcelChoice(index);
    if(!choice.skip && (order.notices.length || order.conflict_count) && !choice.acknowledge_matches) {
      orderExcelStatus(`Order ${order.order_number}: review the match notices and check its acknowledgment.`,true);
      const ack=document.querySelector(`[data-excel-order="${index}"] .order-excel-match-ack`);
      ack?.closest('label').classList.add('needs-review');
      ack?.scrollIntoView({block:'center'});ack?.focus({preventScroll:true});
      return;
    }
  }
  orderExcelBusy(true);
  orderExcelStatus('Recalculating cartons, pallets and document inputs…');
  try {
    const job = await window.LabelKitAPI.json('/api/order-documents/excel/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result_id: orderExcel.checkId, choices: orderExcel.choices }) });
    orderExcel.reviewId = job.result_id;
    const review = await pollOrderExcel(job.result_id);
    setOrderExcelStep(3);
    document.getElementById('order-excel-results').innerHTML = `<h3>Review matched orders and documents</h3>
      <p>${review.error_count} blocking issue(s) · ${review.warning_count} warning(s) · ${review.label_pages} label page(s)</p>
      ${review.orders.map(order => `<section class="order-excel-order"><header><strong>Order ${escapeHtml(order.order_number)}</strong><span>${escapeHtml(order.skipped ? 'Skipped' : `${order.source === 'fields' ? 'Reviewed inputs' : order.source || 'Needs input'} · ${order.line_count || 0} line(s) · ${order.pallet_count || 0} pallet(s)`)}</span></header>
      ${order.review ? `<p>Customer: ${escapeHtml(order.review.customer || 'Not provided')} · PO: ${escapeHtml(order.review.po_number || 'Blank')} · Ship date: ${escapeHtml(order.review.ship_date || 'Blank')}</p><p>Outputs: ${escapeHtml(order.review.outputs.join(', '))}</p><div class="order-excel-table"><table><thead><tr><th>SKU / line</th><th>Ordered quantity</th><th>Shipping boxes</th><th>Label templates</th></tr></thead><tbody>${order.review.lines.map(line => `<tr><td>${escapeHtml(line.sku)}<br>${escapeHtml(line.line_id)}</td><td>${escapeHtml(line.quantity)} ${escapeHtml(line.unit)}</td><td>${line.boxes}</td><td>${escapeHtml(line.templates.join(', ') || 'None')}</td></tr>`).join('')}</tbody></table></div><details><summary>Review resolved addresses</summary><div class="order-excel-addresses">${[['Ship From', order.review.ship_from], ['Bill To', order.review.bill_to], ['Ship To', order.review.ship_to]].map(([name, value]) => `<div><strong>${name}</strong><p>${escapeHtml(value || 'Blank')}</p></div>`).join('')}</div></details>` : ''}
      ${order.errors.length ? `<ul class="order-excel-errors">${order.errors.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul>` : ''}
      ${order.warnings.length ? `<details><summary>${order.warnings.length} document warning(s)</summary><ul>${order.warnings.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul></details>` : ''}</section>`).join('')}
      ${review.warning_count ? '<label class="order-excel-ack"><input id="order-excel-ack" type="checkbox"> I reviewed the document warnings for these selected inputs.</label>' : ''}
      <div class="order-excel-source"><button data-excel-action class="btn-secondary" type="button" onclick="renderOrderExcelMatching()">Edit fields and defaults</button>
      <button data-excel-action class="btn-secondary" type="button" onclick="orderExcelDownload('/api/order-documents/excel/reviewed-inputs?result_id='+encodeURIComponent(orderExcel.reviewId), 'Reviewed_Order_Inputs.xlsx')">Download reviewed Excel</button>
      ${review.can_generate ? '<button data-excel-action class="btn-generate" type="button" onclick="generateOrderExcel()">Generate order ZIP</button>' : '<p>Use Edit fields and defaults to fix these issues here, then recalculate. You can also skip an order.</p>'}</div>`;
    document.querySelector('#order-excel-results h3')?.scrollIntoView({block:'start'});
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
    setOrderExcelStep(4);
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
