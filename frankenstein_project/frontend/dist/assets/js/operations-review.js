/* One order-number intake with isolated per-order review and shared document editors. */
let orderExcel = { busy: false, checkId: '', reviewId: '', resultId: '', matching: null, choices: {}, issuesOnly: false };

function openOrderExcel() {
  orderExcel.returnFocus=document.activeElement;
  document.getElementById('order-excel-modal').classList.add('visible');
  setOrderExcelStep(orderExcel.step || 1);
  document.querySelector('#order-excel-modal .editor-toolbar [onclick="closeOrderExcel()"]').focus();
}
function setOrderExcelStep(step) {
  orderExcel.step=step;

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
  updateBulkSectionNavigation();
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
  const values=document.getElementById('operations-sales-order-number').value.trim().split(/[,;\s]+/).filter(Boolean);
  const unique=new Set(values);
  document.getElementById('operations-order-count').textContent=values.length
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

async function checkOrderExcel(numbersInput) {
  if (orderExcel.busy) return;
  const numbers=String(numbersInput ?? document.getElementById('operations-sales-order-number').value).trim();
  if (!numbers) return orderExcelStatus('Enter at least one sales order number.', true);
  const unique=[...new Set(numbers.split(/[,;\s]+/).filter(Boolean))];
  if(numbers.length>10000 || unique.length>100 || unique.some(value=>!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)))
    return orderExcelStatus('Enter up to 100 valid order numbers using letters, numbers, dots, hyphens or underscores.',true);
  const previous=orderExcel;
  orderExcel = { busy: false, checkId: '', reviewId: '', resultId: '', matching: null, choices: {}, issuesOnly: false, returnFocus:orderExcel.returnFocus, sessions:{}, activeOrder:0, numbers:unique.join(', ') };
  document.getElementById('order-excel-actions').replaceChildren();
  setOrderExcelStep(1);
  document.getElementById('order-excel-results').innerHTML = '';
  orderExcelBusy(true);
  try {
    orderExcelStatus('Loading orders and matching products and addresses…');
    const job = await window.LabelKitAPI.json('/api/order-documents/batch/check', { method: 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({order_numbers:numbers}) }, 120000);
    orderExcel.checkId = job.result_id;
    orderExcel.matching = await pollOrderExcel(job.result_id);
    resetOperationsWorkspaceState();
    document.getElementById('operations-sales-order-number').value=unique.join(', ');
    renderOrderExcelMatching();
    await keepOrderReview([previous.checkId,previous.reviewId,previous.lastReviewId]).catch(()=>{});
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

function orderReviewSession(index) {
  const order=orderExcel.matching.orders[index];
  orderExcel.sessions ||= {};
  return orderExcel.sessions[order.order_number] ||= {section:'header',revision:0,approvals:{},outputs:{}};
}
function orderReviewSignature(index) {const {fields={},record_id='',added_lines=[],excluded_lines=[],added_labels=[]}=orderExcel.choices[orderExcel.matching.orders[index].order_number] || {};const sorted=Object.fromEntries(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)));return JSON.stringify({fields:sorted,record_id,added_lines,excluded_lines,added_labels});}
function orderReviewChanged(index) {
  const session=orderReviewSession(index);
  session.revision++;session.approvals={};session.outputs={};orderExcel.reviewId='';
}
function orderReviewStatus(index) {
  const order=orderExcel.matching.orders[index], session=orderReviewSession(index);
  if(orderExcel.choices[order.order_number]?.skip)return 'Skipped';
  if(order.notices.some(message=>message.startsWith('Analytics could not be checked')))return 'Lookup failed';
  if(order.missing_count)return 'Needs input';
  if(!session.document || session.signature!==orderReviewSignature(index))return 'Needs review';
  return ['jobs','packing_list','pallet_labels'].every(kind=>!(kind==='jobs'?session.document.jobs.length:session.document[kind]) || session.approvals[kind]) ? 'Ready' : 'Needs review';
}
async function loadOrderDocuments(event, force=false) {
  event?.preventDefault();
  const input=document.getElementById('operations-sales-order-number');
  const numbers=input.value.trim();
  const parsed=[...new Set(numbers.split(/[,;\s]+/).filter(Boolean))];
  if(!parsed.length || numbers.length>10000 || parsed.length>100 || parsed.some(value=>!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value))) {
    setStatus('Enter 1 to 100 order numbers separated by commas, spaces or new lines.','error');input.focus();return;
  }
  if(orderExcel.busy)return openOrderExcel();
  if(!force && orderExcel.matching && parsed.join(', ')===orderExcel.numbers)return openOrderExcel();
  const hasWork=orderExcel.matching || orderDocumentsState.reviewedOrder || orderDocumentsState.customMode;
  if(hasWork && !window.confirm('Load these orders and replace the current document session? Download any files you need before continuing.'))return;
  openOrderExcel();setOperationsOrderBusy(true);
  try{await checkOrderExcel(numbers);}finally{setOperationsOrderBusy(false);}
}
function reloadOrderReview() {document.getElementById('operations-sales-order-number').value=orderExcel.numbers || '';return loadOrderDocuments(null,true);}
async function keepOrderReview(release_ids=[]) {
  const result_ids=[orderExcel.checkId,orderExcel.reviewId || orderExcel.lastReviewId].filter(Boolean);
  if(!result_ids.length)return;
  return window.LabelKitAPI.json('/api/order-documents/batch/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_ids,release_ids:[...new Set(release_ids.filter(Boolean))].filter(id=>!result_ids.includes(id))})});
}
setInterval(()=>{
  if(orderExcel.matching && !orderExcel.busy && (document.getElementById('order-excel-modal').classList.contains('visible') || orderReviewEditor || orderReviewPreview || orderReviewProduct))keepOrderReview().catch(()=>{});
},60000);
function selectReviewOrder(index) {
  if(orderExcel.busy)return;
  const panel=document.getElementById('order-review-content');
  if(panel && orderExcel.matching.orders[orderExcel.activeOrder || 0])orderReviewSession(orderExcel.activeOrder || 0).scroll=panel.scrollTop;
  orderExcel.activeOrder=Math.max(0,Math.min(orderExcel.matching.orders.length-1,Number(index)));
  renderOrderExcelMatching();
}
function reviewSections(order) {
  const sections=[{id:'items',title:`Included items (${order.item_choices.filter(item=>!item.excluded).length})`,kind:'items'},...order.sections];
  return [...sections,{id:'documents',title:'Document previews and approvals',kind:'documents'}].filter(section=>!orderExcel.issuesOnly || ['items','documents'].includes(section.kind) || section.fields.some(field=>field.missing || field.conflict || field.stale));
}
function activateBulkSection(index,id) {
  const session=orderReviewSession(index);
  if(session.section!==id)session.scroll=0;
  session.section=id;orderExcel.activeOrder=index;renderOrderExcelMatching();
}
function moveBulkSection(index,direction) {
  const sections=reviewSections(orderExcel.matching.orders[index]),session=orderReviewSession(index);
  const next=sections[sections.findIndex(section=>section.id===session.section)+direction];
  if(next)activateBulkSection(index,next.id);
}
function updateBulkSectionNavigation() {
  const order=orderExcel.matching?.orders[orderExcel.activeOrder || 0];if(!order)return;
  const sections=reviewSections(order),position=sections.findIndex(section=>section.id===orderReviewSession(orderExcel.activeOrder || 0).section);
  document.querySelectorAll('#order-excel-modal [data-section-previous]').forEach(button=>button.disabled=orderExcel.busy || position<=0);
  document.querySelectorAll('#order-excel-modal [data-section-next]').forEach(button=>button.disabled=orderExcel.busy || position>=sections.length-1);
  const previous=document.getElementById('review-order-previous'),next=document.getElementById('review-order-next');
  if(previous)previous.disabled=orderExcel.busy || !orderExcel.activeOrder;
  if(next)next.disabled=orderExcel.busy || (orderExcel.activeOrder || 0)>=orderExcel.matching.orders.length-1;
}
function renderReviewFields(section,index,sectionIndex) {
  const primary=[],optional=[];
  section.fields.forEach((field,fieldIndex)=>{
    const html=renderOrderExcelField(field,index,sectionIndex,fieldIndex);if(!html)return;
    if(!field.value && !field.required && !field.conflict && !field.stale && !field.readonly)optional.push(html);else primary.push(html);
  });
  return `${section.kind==='line'?`<p class="order-excel-match-status">${section.product_match==='matched'?'SKU found in Product Master':section.product_match==='ambiguous'?'Multiple packaging configurations — choose one':'SKU not found in Product Master — enter order-only packing details'}<br>${section.analytics_match==='matched'?'Item found on the Analytics order':'Analytics item match unavailable — verify this item'}</p>${section.product_match==='missing' && hasPermission('table_crud')?`<button data-excel-action class="btn-secondary" onclick="addUnifiedMissingProduct(${index},'${section.id}')">Add to Product Master (optional)</button>`:''}`:''}<div class="order-excel-fields">${primary.join('')}${optional.length?`<details class="order-excel-optional"><summary>Additional optional fields (${optional.length})</summary>${optional.join('')}</details>`:''}</div>${section.kind==='label'?`<button data-excel-action class="btn-secondary" onclick="addUnifiedLabel(${index},'${jsString(section.fields.find(field=>field.name==='line_id')?.value || '')}')">Add another label template for this item</button>`:''}`;
}
function renderOrderExcelMatching() {
  if(!orderExcel.matching)return;
  setOrderExcelStep(2);
  const orders=orderExcel.matching.orders,index=orderExcel.activeOrder || 0,order=orders[index],session=orderReviewSession(index),chosen=orderExcel.choices[order.order_number] || {};
  const sections=reviewSections(order);
  if(!sections.some(section=>section.id===session.section)){session.section=sections[0].id;session.scroll=0;}
  const section=sections.find(section=>section.id===session.section),position=sections.indexOf(section);
  const issues=section.fields?.filter(field=>field.missing || field.conflict || field.stale).length || 0;
  document.getElementById('order-excel-results').innerHTML=`<div class="order-review-navigation">
    <div class="order-review-order-nav"><button data-excel-action id="review-order-previous" class="btn-secondary" aria-label="Previous order" onclick="selectReviewOrder(${index-1})">← Order</button><label>Order ${index+1} of ${orders.length}<select data-excel-action id="review-order-select" aria-label="Current order" onchange="selectReviewOrder(this.value)">${orders.map((row,i)=>`<option value="${i}" ${i===index?'selected':''}>${escapeHtml(row.order_number)} · ${orderReviewStatus(i)}</option>`).join('')}</select></label><button data-excel-action id="review-order-next" class="btn-secondary" aria-label="Next order" onclick="selectReviewOrder(${index+1})">Order →</button></div>
    <div class="order-review-status"><span>${order.filled_count} filled · ${order.missing_count} missing · ${order.conflict_count} differences</span><label><input data-excel-action type="checkbox" ${chosen.skip?'checked':''} onchange="skipOrderExcel(${index},this.checked)"> Skip this order</label><label><input data-excel-action type="checkbox" ${orderExcel.issuesOnly?'checked':''} onchange="orderExcel.issuesOnly=this.checked;renderOrderExcelMatching()"> Only issues</label></div>
    <div class="bulk-section-navigation"><button data-excel-action data-section-previous class="btn-secondary" aria-label="Previous section" onclick="moveBulkSection(${index},-1)">← Previous</button><label><span>Section ${position+1} of ${sections.length}${issues?` · ${issues} to check`:''}</span><select data-excel-action id="review-section-select" aria-label="Current section" onchange="activateBulkSection(${index},this.value)">${sections.map(row=>`<option value="${row.id}" ${row.id===section.id?'selected':''}>${escapeHtml(row.title)}${row.fields?.some(field=>field.missing || field.conflict || field.stale)?' · Needs review':''}</option>`).join('')}</select></label><button data-excel-action data-section-next class="btn-secondary" aria-label="Next section" onclick="moveBulkSection(${index},1)">Next →</button></div>
    </div><div id="order-review-content" tabindex="-1" onscroll="orderReviewSession(${index}).scroll=this.scrollTop"><section class="order-excel-order" data-excel-order="${index}"><h3>${escapeHtml(section.title)}</h3>
    ${chosen.skip?'<p>This order is skipped. Uncheck Skip this order to resume; its edits are retained.</p>':`${section.kind==='header'?`${order.records.length?`<label class="review-record">Analytics order record<select data-excel-action aria-label="Order ${escapeHtml(order.order_number)} Analytics record" onchange="selectOrderExcelRecord(${index},this.value)">${order.records.length>1?'<option value="">Choose the correct record</option>':''}${order.records.map(record=>`<option value="${escapeHtml(record.ecomdash_id)}">${escapeHtml([record.ecomdash_id,record.storefront,record.invoice_date].filter(Boolean).join(' / '))}</option>`).join('')}<option value="__none__">No Analytics fallback</option></select></label>`:''}${order.notices.length?`<ul class="order-excel-notices">${order.notices.map(message=>`<li>${escapeHtml(message)}</li>`).join('')}</ul>`:''}${!order.records.length?`<button data-excel-action class="btn-secondary" onclick="retryBulkOrder(${index})">Retry Analytics lookup (resets this order’s item edits)</button>`:''}`:''}
    ${section.kind==='items'?`${order.item_choices.map(item=>`<label class="review-item-choice"><input data-excel-action type="checkbox" ${item.excluded?'':'checked'} onchange="toggleBulkOrderItem(${index},'${jsString(item.line_id)}',this.checked)"> ${escapeHtml(item.sku || 'Order-only item')} · ${escapeHtml(item.line_id)}</label>`).join('')}<button data-excel-action class="btn-secondary" onclick="addBulkOrderItem(${index})">Add order-only item</button>`:section.kind==='documents'?renderUnifiedDocuments(index):renderReviewFields(section,index,order.sections.indexOf(section))}
    `}</section></div><div data-bulk-actions class="order-excel-source"><button data-excel-action class="btn-secondary" onclick="refreshOrderExcelFields(${index})">Recheck this order</button>${!chosen.skip && (order.notices.length || order.conflict_count)?`<label class="order-excel-ack"><input data-excel-action type="checkbox" class="order-excel-match-ack" ${chosen.acknowledge_matches?'checked':''} onchange="acknowledgeOrderExcel(${index},this.checked)"> I reviewed this order’s match notices and differences.</label>`:''}<button data-excel-action class="btn-generate" onclick="resolveOrderExcel()">Recalculate and review documents</button></div>`;
  orderExcelDockActions();
  const record=document.querySelector(`[data-excel-order="${index}"] select[aria-label$="Analytics record"]`);if(record)record.value=chosen.record_id ?? order.record_id;
  document.querySelectorAll(`[data-excel-order="${index}"] [data-field-path]`).forEach(row=>{
    const field=section.fields?.find(field=>field.path===row.dataset.fieldPath),source=row.querySelector('select[aria-label$=" source"]');if(source && field)source.value=field.selection;
  });
  document.getElementById('order-review-content').scrollTop=session.scroll || 0;
  updateBulkSectionNavigation();
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
  orderReviewChanged(index);
  delete orderReviewSession(index).labelEdits;
  const choice=orderExcelChoice(index);
  choice.fields=Object.fromEntries(Object.entries(choice.fields || {}).filter(([path])=>path.startsWith('header:')));
  choice.record_id=value;choice.added_lines=[];choice.excluded_lines=[];choice.added_labels=[];choice.acknowledge_matches=false;
  orderExcel.reviewId='';await refreshOrderExcelFields(index);
}
async function addBulkOrderItem(index) {
  orderReviewChanged(index);
  const choice=orderExcelChoice(index);
  choice.added_lines ||= orderExcel.matching.orders[index].item_choices.filter(item=>item.line_id.startsWith('MANUAL-')).map(item=>item.line_id);
  choice.added_lines.push('MANUAL-'+Date.now());choice.acknowledge_matches=false;orderExcel.reviewId='';
  await refreshOrderExcelFields(index);
}
async function addUnifiedLabel(index,lineId) {
  orderReviewChanged(index);
  const choice=orderExcelChoice(index);choice.added_labels ||= [];
  choice.added_labels.push({line_id:lineId,id:'EXTRA-'+Date.now()});choice.acknowledge_matches=false;
  if(await refreshOrderExcelFields(index)){
    const section=orderExcel.matching.orders[index].sections.filter(section=>section.kind==='label').at(-1);
    activateBulkSection(index,section.id);
  }
}
async function retryBulkOrder(index) {
  if(orderExcel.busy)return;
  const order=orderExcel.matching.orders[index];
  orderExcelBusy(true);
  try {
    const previousCheckId=orderExcel.checkId;
    const job=await window.LabelKitAPI.json('/api/order-documents/batch/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_id:orderExcel.checkId,order_number:order.order_number})});
    const matching=await pollOrderExcel(job.result_id);
    const choice=orderExcelChoice(index);
    choice.fields=Object.fromEntries(Object.entries(choice.fields || {}).filter(([path])=>path.startsWith('header:')));
    orderReviewChanged(index);
    delete orderReviewSession(index).labelEdits;
    delete choice.record_id;choice.added_lines=[];choice.excluded_lines=[];choice.added_labels=[];choice.acknowledge_matches=false;
    orderExcel.checkId=job.result_id;orderExcel.reviewId='';orderExcel.matching.orders[index]=matching.orders[index];
    orderExcelBusy(false);
    await refreshOrderExcelFields(index);
    await keepOrderReview([previousCheckId]).catch(()=>{});
    renderOrderExcelMatching();
    orderExcelStatus('Lookup retried. This order’s item edits were reset; other orders retain their edits. Verify the current items.');
  } catch(error){orderExcelStatus(error.message,true);}
  finally{orderExcelBusy(false);}
}
async function toggleBulkOrderItem(index,id,included) {
  orderReviewChanged(index);
  const choice=orderExcelChoice(index);
  choice.excluded_lines=[...new Set([...(choice.excluded_lines || []).filter(value=>value!==id),...(included?[]:[id])])];
  choice.acknowledge_matches=false;orderExcel.reviewId='';await refreshOrderExcelFields(index);
}


async function editOrderExcelField(index,path,source,value) {
  orderReviewChanged(index);
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
  const acknowledgment=document.querySelector('#order-excel-actions .order-excel-match-ack');
  if(acknowledgment)acknowledgment.checked=false;
  orderExcelStatus('Edits saved for this order. Recalculate to refresh defaults and review documents.');
}

function rememberReviewLabelEdits(index) {
  const choice=orderExcelChoice(index),session=orderReviewSession(index);session.labelEdits ||= {};
  for(const section of orderExcel.matching.orders[index].sections.filter(section=>section.kind==='label')){
    const edits=Object.fromEntries(section.fields.filter(field=>choice.fields?.[field.path]).map(field=>[field.name,choice.fields[field.path]]));
    if(Object.keys(edits).length || !session.labelEdits[section.binding_id])session.labelEdits[section.binding_id]=edits;
  }
  choice.fields=Object.fromEntries(Object.entries(choice.fields || {}).filter(([path])=>!path.startsWith('label:')));
}
async function refreshOrderExcelFields(index=null) {
  if(orderExcel.busy)return false;
  orderExcelBusy(true);
  orderExcelStatus('Checking field defaults…');
  try {
    const indexes=index===null?orderExcel.matching.orders.map((_,i)=>i):[index];
    for(const i of indexes){
      const order=orderExcel.matching.orders[i];
      rememberReviewLabelEdits(i);
      let model=await window.LabelKitAPI.json('/api/order-documents/batch/fields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_id:orderExcel.checkId,order_number:order.order_number,choice:orderExcelChoice(i)})});
      const choice=orderExcelChoice(i),session=orderReviewSession(i);let restored=false;
      for(const section of model.sections.filter(section=>section.kind==='label'))for(const field of section.fields){
        const edit=session.labelEdits[section.binding_id]?.[field.name];if(edit){choice.fields[field.path]=edit;restored=true;}
      }
      if(restored)model=await window.LabelKitAPI.json('/api/order-documents/batch/fields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_id:orderExcel.checkId,order_number:order.order_number,choice})});
      const before=order.sections.flatMap(section=>section.fields).map(field=>[field.path,field.value]);
      const after=model.sections.flatMap(section=>section.fields).map(field=>[field.path,field.value]);
      if(JSON.stringify(before)!==JSON.stringify(after) || JSON.stringify(order.notices)!==JSON.stringify(model.notices)){
        orderExcelChoice(i).acknowledge_matches=false;
        orderReviewChanged(i);
      }
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
  if(orderExcel.matching.orders.some((order,index)=>{const session=orderReviewSession(index);return !orderExcel.choices[order.order_number]?.skip && session.manualEdited && session.signature!==orderReviewSignature(index);}) && !window.confirm('Packing inputs changed after manual document edits. Recalculate and replace those affected document drafts? Other orders keep their edits.'))return;
  if (!await refreshOrderExcelFields()) return;
  for (const [index, order] of orderExcel.matching.orders.entries()) {
    const choice=orderExcelChoice(index);
    if(!choice.skip && (order.notices.length || order.conflict_count) && !choice.acknowledge_matches) {
      orderExcelStatus(`Order ${order.order_number}: review the match notices and check its acknowledgment.`,true);
      selectReviewOrder(index);
      const ack=document.querySelector('#order-excel-actions .order-excel-match-ack');
      ack?.closest('label').classList.add('needs-review');
      ack?.scrollIntoView({block:'center'});ack?.focus({preventScroll:true});
      return;
    }
  }
  orderExcelBusy(true);
  orderExcelStatus('Recalculating cartons, pallets and document inputs…');
  try {
    const previousReviewId=orderExcel.lastReviewId || orderExcel.reviewId;
    const job = await window.LabelKitAPI.json('/api/order-documents/batch/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result_id: orderExcel.checkId, choices: orderExcel.choices }) });
    orderExcel.reviewId = job.result_id;
    const review = await pollOrderExcel(job.result_id);
    const snapshots=await window.LabelKitAPI.json('/api/order-documents/batch/documents?result_id='+encodeURIComponent(job.result_id));
    for(const doc of snapshots.documents){
      const index=orderExcel.matching.orders.findIndex(order=>order.order_number===doc.order_number),session=orderReviewSession(index),signature=orderReviewSignature(index);
      if(!session.document || session.signature!==signature){
        session.document=doc;session.signature=signature;session.approvals={};session.outputs={};session.revision++;session.manualEdited=false;
      }
    }
    orderExcel.review=review;orderExcel.lastReviewId=job.result_id;
    await keepOrderReview([previousReviewId]).catch(()=>{});
    renderUnifiedOrderSummary();
  } catch (error) { orderExcelStatus(error.message, true); }
  finally { orderExcelBusy(false); }
}

async function generateOrderExcel() {
  if(orderExcel.busy)return;
  if(!orderExcel.reviewId)return orderExcelStatus('Recalculate the current inputs before generating.',true);
  const active=orderExcel.matching.orders.map((order,index)=>({order,index})).filter(({order})=>!orderExcel.choices[order.order_number]?.skip);
  for(const {order,index} of active){
    const session=orderReviewSession(index),doc=session.document;
    if(!doc || session.signature!==orderReviewSignature(index) || ['jobs','packing_list','pallet_labels'].some(kind=>Boolean(kind==='jobs'?doc[kind]?.length:doc[kind]) && !session.approvals[kind])){
      activateBulkSection(index,'documents');return orderExcelStatus(`Order ${order.order_number}: preview and approve its selected documents first.`,true);
    }
  }
  if(!document.getElementById('order-excel-ack')?.checked)return orderExcelStatus('Acknowledge the document warnings before generating.',true);
  orderExcelBusy(true);
  try{
    const reviewed_documents=Object.fromEntries(active.map(({order,index})=>{const session=orderReviewSession(index);return [order.order_number,{jobs:session.document.jobs,packing_list:session.document.packing_list,pallet_labels:session.document.pallet_labels,approvals:session.approvals}];}));
    const job=await window.LabelKitAPI.json('/api/order-documents/batch/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_id:orderExcel.reviewId,approve_warnings:true,reviewed_documents})});
    orderExcel.resultId=job.result_id;
    const report=await pollOrderExcel(job.result_id);setOrderExcelStep(4);
    document.getElementById('order-excel-results').innerHTML=`<h3>${report.generated} order(s) generated · ${report.failed} failed · ${report.skipped} skipped</h3><p>Files are separated by sales order. The ZIP also includes reviewed inputs and a processing report.</p>${report.orders.map(row=>`<section class="order-excel-order"><strong>Order ${escapeHtml(row.order_number)} · ${escapeHtml(row.status)}</strong>${row.error?`<p class="is-error">${escapeHtml(row.error)}</p>`:''}<div class="review-document-actions">${(row.files || []).map(path=>`<button class="btn-secondary" onclick="orderExcelDownload('/api/order-documents/batch/file?result_id=${encodeURIComponent(job.result_id)}&order_number=${encodeURIComponent(row.order_number)}&name=${encodeURIComponent(path.split('/').at(-1))}','${jsString(path.split('/').at(-1))}')">${escapeHtml(path.split('/').at(-1))}</button>`).join('')}</div></section>`).join('')}<div data-bulk-actions><button class="btn-secondary" onclick="renderOrderExcelMatching()">Return to orders</button><button class="btn-generate" onclick="orderExcelDownload('/results/${encodeURIComponent(job.result_id)}/file','order_documents.zip')">Download ZIP and report</button></div>`;
    orderExcelDockActions();
  }catch(error){orderExcelStatus(error.message,true);}finally{orderExcelBusy(false);}
}
