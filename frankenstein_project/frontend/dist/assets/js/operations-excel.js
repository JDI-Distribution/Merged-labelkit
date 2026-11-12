/* Bulk intake stays detached from the current editable single-order session. */
let orderExcel = { busy: false, checkId: '', reviewId: '', resultId: '', matching: null, choices: {}, issuesOnly: false };

function openOrderExcel() {
  orderExcel.returnFocus=document.activeElement;
  document.getElementById('order-excel-modal').classList.add('visible');
  setOrderExcelStep(orderExcel.step || 1);
  document.querySelector('#order-excel-modal .editor-toolbar button').focus();
}
function setOrderExcelStep(step) {
  orderExcel.step=step;
  document.getElementById('bulk-order-upload').open=step===1;
  document.querySelectorAll('#order-excel-modal [data-bulk-step]').forEach(item=>{
    if(Number(item.dataset.bulkStep)===step)item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  });
}
function closeOrderExcel() {
  document.getElementById('order-excel-modal').classList.remove('visible');
  orderExcel.returnFocus?.focus();
}
document.getElementById('order-excel-modal').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();closeOrderExcel();return;}
  if(event.key!=='Tab')return;
  const controls=[...event.currentTarget.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(el=>!el.disabled && el.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
});
function orderExcelDockActions() {
  const dock=document.getElementById('order-excel-actions');
  dock.replaceChildren();
  const actions=document.querySelector('#order-excel-results [data-bulk-actions]');
  if(actions)dock.append(actions);
}
function orderExcelStatus(message, error = false) {
  const target = document.getElementById('order-excel-status');
  target.textContent = message;
  target.classList.toggle('is-error', error);
}
function orderExcelBusy(busy) {
  orderExcel.busy = busy;
  document.querySelector('#order-excel-modal .editor-dialog').setAttribute('aria-busy', String(busy));
  document.querySelectorAll('#order-excel-modal [data-excel-action]').forEach(element => { element.disabled = busy; });
}
async function orderExcelDownload(url, filename, body) {
  try {
    const blob = await window.LabelKitAPI.blob(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) { orderExcelStatus(error.message, true); }
}
function updateBulkOrderCount() {
  const values=document.getElementById('bulk-order-numbers').value.trim().split(/[,;\s]+/).filter(Boolean);
  const unique=new Set(values);
  document.getElementById('bulk-order-count').textContent=values.length
    ? `${unique.size} order(s) · ${values.length-unique.size} duplicate(s) ignored. Maximum 100 orders.`
    : 'Use commas, spaces or new lines. Up to 100 orders.';
}

async function pollOrderExcel(resultId) {
  const deadline = Date.now() + 30*60*1000;
  while (Date.now() < deadline) {
    const state = await window.LabelKitAPI.json(`/results/${encodeURIComponent(resultId)}/status`, {}, 30000);
    orderExcelStatus(state.detail || 'Processing orders…');
    if (state.status === 'error') throw new Error(state.detail || 'Order processing failed.');
    if (state.status === 'complete') return state.report;
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw new Error('This batch is taking longer than expected. Reopen the batch review or try fewer orders.');
}

async function checkOrderExcel() {
  if (orderExcel.busy) return;
  const numbers=document.getElementById('bulk-order-numbers').value.trim();
  if (!numbers) return orderExcelStatus('Enter at least one sales order number.', true);
  const unique=[...new Set(numbers.split(/[,;\s]+/).filter(Boolean))];
  if(numbers.length>10000 || unique.length>100 || unique.some(value=>!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)))
    return orderExcelStatus('Enter up to 100 valid order numbers using letters, numbers, dots, hyphens or underscores.',true);
  const previous=orderExcel;
  orderExcel = { busy: false, checkId: '', reviewId: '', resultId: '', matching: null, choices: {}, issuesOnly: false, returnFocus:orderExcel.returnFocus };
  document.getElementById('order-excel-actions').replaceChildren();
  setOrderExcelStep(1);
  document.getElementById('order-excel-results').innerHTML = '';
  orderExcelBusy(true);
  try {
    orderExcelStatus('Loading orders and matching products and addresses…');
    const job = await window.LabelKitAPI.json('/api/order-documents/batch/check', { method: 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({order_numbers:numbers}) }, 120000);
    orderExcel.checkId = job.result_id;
    orderExcel.matching = await pollOrderExcel(job.result_id);
    renderOrderExcelMatching();
  } catch (error) {
    orderExcel=previous;
    if(orderExcel.matching)renderOrderExcelMatching();
    orderExcelStatus(error.message, true);
  }
  finally { orderExcelBusy(false); }
}

const orderExcelSourceNames = { workbook: 'Order input', analytics: 'Analytics', product_master: 'Product Master', directory: 'Directory', default: 'App default', custom: 'Edited' };

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
    return `<div><span><strong>${saved?'Saved in '+orderExcelSourceNames[source]:'Original entry'}:</strong> ${escapeHtml(value)}</span>${!same?`<button data-excel-action type="button" class="btn-secondary" onclick="editOrderExcelField(${index}, '${field.path}', '${source}', null)">${saved?'Restore saved value':'Use original value'}</button>`:'<small>Matches current value</small>'}</div>`;
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
  const active=orders.filter(order=>!orderExcel.choices[order.order_number]?.skip);
  document.getElementById('order-excel-results').innerHTML = `<h3>Verify order details</h3>
    <div class="bulk-batch-summary"><strong>${active.length} of ${orders.length} orders selected</strong><span>${active.reduce((total,order)=>total+order.missing_count,0)} missing inputs</span><span>${active.reduce((total,order)=>total+order.conflict_count,0)} source differences</span></div>
    <nav class="bulk-order-jump" aria-label="Jump to order">${orders.map((order,index)=>`<a href="#bulk-order-${index}" onclick="event.preventDefault();document.getElementById('bulk-order-${index}').scrollIntoView({block:'start'})">Order ${escapeHtml(order.order_number)}</a>`).join('')}</nav>
    <p>Check every order before printing. Compare Analytics, saved products and addresses, restore a saved value, or enter a correction. Edits apply to this batch only.</p>
    <label class="order-excel-ack"><input id="order-excel-issues-only" type="checkbox" ${orderExcel.issuesOnly ? 'checked' : ''} onchange="orderExcel.issuesOnly=this.checked;renderOrderExcelMatching()"> Show only missing or conflicting fields</label>
    ${orders.map((order,index) => {
      const chosen = orderExcel.choices[order.order_number] || {};
      return `<section class="order-excel-order" id="bulk-order-${index}" data-excel-order="${index}"><header><strong>Order ${escapeHtml(order.order_number)}</strong><span>${order.filled_count} filled from app/defaults / ${order.missing_count} missing / ${order.conflict_count} conflicts</span></header>
      <div class="order-excel-source"><label><input data-excel-action type="checkbox" ${chosen.skip ? 'checked' : ''} onchange="skipOrderExcel(${index},this.checked)"> Skip this order</label>
      ${order.records.length ? `<label>Analytics order record<select data-excel-action aria-label="Order ${escapeHtml(order.order_number)} Analytics record" onchange="selectOrderExcelRecord(${index},this.value)">
      ${order.records.length > 1 ? '<option value="">Choose a record to fill missing fields</option>' : ''}${order.records.map(record => `<option value="${escapeHtml(record.ecomdash_id)}">${escapeHtml([record.ecomdash_id,record.storefront,record.invoice_date].filter(Boolean).join(' / '))}</option>`).join('')}<option value="__none__">No Analytics fallback</option></select></label>` : ''}</div>
      ${chosen.skip ? '<p>This order will be skipped. Its inputs are retained.</p>' : `${order.notices.length ? `<ul class="order-excel-notices">${order.notices.map(message=>`<li>${escapeHtml(message)}</li>`).join('')}</ul>` : ''}
      <details class="bulk-order-items"><summary>Included items (${order.item_choices.filter(item=>!item.excluded).length})</summary>${order.item_choices.map(item=>`<label><input data-excel-action type="checkbox" ${item.excluded?'':'checked'} onchange="toggleBulkOrderItem(${index}, '${jsString(item.line_id)}', this.checked)"> ${escapeHtml(item.sku || 'Order-only item')} · ${escapeHtml(item.line_id)}</label>`).join('')}</details>
      <button data-excel-action class="btn-secondary" type="button" onclick="addBulkOrderItem(${index})">Add order-only item</button>
      ${!order.records.length ? `<button data-excel-action class="btn-secondary" type="button" onclick="retryBulkOrder(${index})">Retry Analytics lookup (resets this order’s item edits)</button>` : ''}
      ${order.sections.map((section,sectionIndex)=>{
        const primary=[], optional=[];
        section.fields.forEach((field,fieldIndex)=>{
          const html=renderOrderExcelField(field,index,sectionIndex,fieldIndex);
          if(!field.value && !field.required && !field.conflict && !field.stale && !field.readonly)optional.push(html);
          else primary.push(html);
        });
        const fields=primary.join('')+(!orderExcel.issuesOnly && optional.length ? `<details class="order-excel-optional"><summary>Additional optional fields (${optional.length})</summary>${optional.join('')}</details>`:'');
        return fields ? `<details class="order-excel-section" ${section.fields.some(field=>field.missing || field.stale || field.conflict) || (index===0 && section.kind==='header') ? 'open' : ''}><summary>${escapeHtml(section.title)}</summary>${section.kind==='line' ? `<p class="order-excel-match-status">${section.product_match==='matched' ? 'SKU found in Product Master' : section.product_match==='ambiguous' ? 'Multiple saved packaging configurations — choose a configuration' : 'SKU not found in Product Master — enter packing details for this order. Adding to Product Master is optional. A description can identify an item without a SKU.'}<br>${section.analytics_match==='matched' ? 'SKU found on this Analytics order' : section.analytics_match==='missing' ? 'SKU not found on this Analytics order' : 'Analytics order match unavailable'}</p>` : ''}<div class="order-excel-fields">${fields}</div></details>` : '';
      }).join('')}
      ${orderExcel.issuesOnly && !order.missing_count && !order.conflict_count ? '<p>No missing or conflicting fields. Uncheck the filter to inspect or edit all defaults.</p>' : ''}
      ${order.notices.length || order.conflict_count ? `<label class="order-excel-ack"><input data-excel-action type="checkbox" class="order-excel-match-ack" ${chosen.acknowledge_matches ? 'checked' : ''} onchange="acknowledgeOrderExcel(${index},this.checked)"> I reviewed the match notices and conflicting values for this order.</label>` : ''}`}</section>`;
    }).join('')}
    <div class="order-excel-source" data-bulk-actions><button data-excel-action class="btn-secondary" type="button" onclick="refreshOrderExcelFields()">Recheck defaults</button><button data-excel-action class="btn-generate" type="button" onclick="resolveOrderExcel()">Recalculate and review documents</button></div>`;
  orderExcelDockActions();
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
async function selectOrderExcelRecord(index,value) {
  const choice=orderExcelChoice(index);
  choice.fields=Object.fromEntries(Object.entries(choice.fields || {}).filter(([path])=>path.startsWith('header:')));
  choice.record_id=value;choice.added_lines=[];choice.excluded_lines=[];choice.acknowledge_matches=false;
  orderExcel.reviewId='';await refreshOrderExcelFields(index);
}
async function addBulkOrderItem(index) {
  const choice=orderExcelChoice(index);
  choice.added_lines ||= orderExcel.matching.orders[index].item_choices.filter(item=>item.line_id.startsWith('MANUAL-')).map(item=>item.line_id);
  choice.added_lines.push('MANUAL-'+Date.now());choice.acknowledge_matches=false;orderExcel.reviewId='';
  await refreshOrderExcelFields(index);
}
async function retryBulkOrder(index) {
  if(orderExcel.busy)return;
  const order=orderExcel.matching.orders[index];
  orderExcelBusy(true);
  try {
    const job=await window.LabelKitAPI.json('/api/order-documents/batch/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_id:orderExcel.checkId,order_number:order.order_number})});
    const matching=await pollOrderExcel(job.result_id);
    const choice=orderExcelChoice(index);
    choice.fields=Object.fromEntries(Object.entries(choice.fields || {}).filter(([path])=>path.startsWith('header:')));
    delete choice.record_id;choice.added_lines=[];choice.excluded_lines=[];choice.acknowledge_matches=false;
    orderExcel.checkId=job.result_id;orderExcel.reviewId='';orderExcel.matching=matching;
    orderExcelBusy(false);
    await refreshOrderExcelFields();
    renderOrderExcelMatching();
    orderExcelStatus('Lookup retried. This order’s item edits were reset; other orders retain their edits. Verify the current items.');
  } catch(error){orderExcelStatus(error.message,true);}
  finally{orderExcelBusy(false);}
}
async function toggleBulkOrderItem(index,id,included) {
  const choice=orderExcelChoice(index);
  choice.excluded_lines=[...new Set([...(choice.excluded_lines || []).filter(value=>value!==id),...(included?[]:[id])])];
  choice.fields=Object.fromEntries(Object.entries(choice.fields || {}).filter(([path])=>!path.startsWith('label:')));
  choice.acknowledge_matches=false;orderExcel.reviewId='';await refreshOrderExcelFields(index);
}


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
      const model=await window.LabelKitAPI.json('/api/order-documents/batch/fields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_id:orderExcel.checkId,order_number:order.order_number,choice:orderExcelChoice(i)})});
      const before=order.sections.flatMap(section=>section.fields).map(field=>[field.path,field.value]);
      const after=model.sections.flatMap(section=>section.fields).map(field=>[field.path,field.value]);
      if(JSON.stringify(before)!==JSON.stringify(after) || JSON.stringify(order.notices)!==JSON.stringify(model.notices))
        orderExcelChoice(i).acknowledge_matches=false;
      orderExcel.matching.orders[i]=model;
    }
    renderOrderExcelMatching();orderExcelStatus('Defaults refreshed. Loaded values and your edits are retained.');
    return true;
  } catch(error){orderExcelStatus(error.message,true);return false;}
  finally{orderExcelBusy(false);}
}

async function resolveOrderExcel() {
  if (orderExcel.busy) return orderExcelStatus('An order check is running. Please wait for it to finish.');
  if (!orderExcel.matching) return orderExcelStatus('Load order numbers first.',true);
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
    const job = await window.LabelKitAPI.json('/api/order-documents/batch/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      <div class="order-excel-source" data-bulk-actions><button data-excel-action class="btn-secondary" type="button" onclick="renderOrderExcelMatching()">Edit fields and defaults</button>
      <button data-excel-action class="btn-secondary" type="button" onclick="orderExcelDownload('/api/order-documents/batch/reviewed-inputs?result_id='+encodeURIComponent(orderExcel.reviewId), 'Reviewed_Order_Inputs.json')">Download reviewed inputs</button>
      ${review.can_generate ? '<button data-excel-action class="btn-generate" type="button" onclick="generateOrderExcel()">Generate order ZIP</button>' : '<p>Use Edit fields and defaults to fix these issues here, then recalculate. You can also skip an order.</p>'}</div>`;
    orderExcelDockActions();
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
    const job = await window.LabelKitAPI.json('/api/order-documents/batch/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result_id: orderExcel.reviewId, approve_warnings: !!acknowledgement?.checked }) });
    orderExcel.resultId = job.result_id;
    const report = await pollOrderExcel(job.result_id);
    setOrderExcelStep(4);
    document.getElementById('order-excel-results').innerHTML = `<h3>${report.generated} order(s) generated · ${report.failed} failed · ${report.skipped} skipped</h3>
      <p>The ZIP includes order folders, source order numbers, reviewed inputs and the processing/source-decision report.</p>
      <ul>${report.orders.map(order => `<li>Order ${escapeHtml(order.order_number)}: ${escapeHtml(order.status)}${order.error ? ` — ${escapeHtml(order.error)}` : ''}</li>`).join('')}</ul>
      <div data-bulk-actions><button data-excel-action class="btn-generate" type="button" onclick="orderExcelDownload('/results/${encodeURIComponent(job.result_id)}/file', 'order_documents.zip')">Download ZIP and report</button></div>`;
    orderExcelDockActions();
    document.querySelector('#order-excel-results h3')?.scrollIntoView({block:'start'});
  } catch (error) { orderExcelStatus(error.message, true); }
  finally { orderExcelBusy(false); }
}
