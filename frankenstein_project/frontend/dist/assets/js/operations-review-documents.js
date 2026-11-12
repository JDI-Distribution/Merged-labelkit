/* Adapters to the existing PDF pipeline and MPL/pallet editors; no packing math. */
let orderReviewEditor=null, orderReviewPreview=null;
const orderDocumentNames={jobs:'Customer labels',packing_list:'Packing list and Ti-Hi',pallet_labels:'Pallet labels'};

function renderUnifiedDocuments(index) {
  const session=orderReviewSession(index),doc=session.document;
  if(!doc || session.signature!==orderReviewSignature(index))return '<p>Recalculate the current inputs to prepare document previews.</p>';
  if(doc.errors.length)return `<ul class="order-excel-errors">${doc.errors.map(error=>`<li>${escapeHtml(error)}</li>`).join('')}</ul>`;
  return `<p>Preview each selected document, then approve it. Editing a packing list keeps its manual pallet assignments until you explicitly recalculate packing inputs.</p>${Object.entries(orderDocumentNames).filter(([kind])=>kind==='jobs'?doc.jobs.length:doc[kind]).map(([kind,name])=>{
    const output=session.outputs[kind],current=output?.revision===session.revision;
    return `<article class="review-document-card"><div><strong>${name}</strong><span>${session.approvals[kind]?'Approved':current?'Preview ready — approval required':'Preview required'}</span></div><div class="review-document-actions"><button data-excel-action class="btn-secondary" onclick="previewUnifiedDocument(${index},'${kind}')">Preview ${name}</button>${kind!=='jobs'?`<button data-excel-action class="btn-secondary" onclick="editUnifiedDocument(${index},'${kind}')">Edit ${name}</button>`:''}${current&&!session.approvals[kind]?`<button data-excel-action class="btn-generate" onclick="approveUnifiedDocument(${index},'${kind}')">Approve ${name}</button>`:''}${current?`<button data-excel-action class="btn-secondary" onclick="downloadUnifiedOutput(${index},'${kind}')">Download PDF${output.kind==='zip'?'s (ZIP)':''}</button>`:''}</div></article>`;
  }).join('')}${doc.warnings.length?`<details class="review-warnings"><summary>${doc.warnings.length} document warnings</summary><ul>${doc.warnings.map(warning=>`<li>${escapeHtml(warning)}</li>`).join('')}</ul></details>`:''}`;
}
function renderUnifiedOrderSummary() {
  setOrderExcelStep(3);
  const review=orderExcel.review;
  document.getElementById('order-excel-results').innerHTML=`<h3>Review orders and documents</h3><p>${review.error_count} blocking issue(s) · ${review.warning_count} warning(s) · ${review.label_pages} label page(s)</p><div class="order-excel-table"><table><thead><tr><th>Order</th><th>Boxes</th><th>Pallets</th><th>Status</th><th>Review</th></tr></thead><tbody>${orderExcel.matching.orders.map((order,index)=>{
    const row=review.orders.find(row=>row.order_number===order.order_number),session=orderReviewSession(index),doc=session.document,mpl=doc?.packing_list?.packing_lists?.[0];
    const boxes=mpl?(mpl.items || []).reduce((sum,item)=>sum+Number(item.qty_on_pallet || 0),0):(doc?.review.lines || []).reduce((sum,line)=>sum+line.boxes,0);
    return `<tr><td>${escapeHtml(order.order_number)}</td><td>${boxes || '—'}</td><td>${mpl?window.LabelKitOrderDocuments.assignedPalletCount(doc.packing_list):doc?.pallet_count || '—'}</td><td>${escapeHtml(orderReviewStatus(index))}${row?.errors.length?`<ul class="order-excel-errors">${row.errors.map(error=>`<li>${escapeHtml(error)}</li>`).join('')}</ul>`:''}</td><td><button data-excel-action class="btn-secondary" onclick="activateBulkSection(${index},'${row?.errors.length?'header':'documents'}')">${row?.errors.length?'Fix inputs':'Review documents'}</button></td></tr>`;
  }).join('')}</tbody></table></div><label class="order-excel-ack"><input id="order-excel-ack" type="checkbox"> I reviewed the selected documents and their warnings before printing.</label><div class="order-excel-source" data-bulk-actions><button data-excel-action class="btn-secondary" onclick="renderOrderExcelMatching()">Return to order details</button><button data-excel-action class="btn-secondary" onclick="orderExcelDownload('/api/order-documents/batch/reviewed-inputs?result_id='+encodeURIComponent(orderExcel.reviewId),'Reviewed_Order_Inputs.json')">Download reviewed inputs</button>${review.can_generate?'<button data-excel-action class="btn-generate" onclick="generateOrderExcel()">Generate order ZIP</button>':'<span>Fix blocking inputs or skip those orders, then recalculate.</span>'}</div>`;
  orderExcelDockActions();
}
function unifiedOrderSnapshot(index) {
  const session=orderReviewSession(index),header=session.document.header;
  return {id:`${orderExcel.checkId}:${session.document.order_number}`,revision:session.revision,fields:{po_number:header.po_number || '',ship_date:header.ship_date || '',ship_from:header.ship_from || '',ship_to:header.ship_to || '',bill_to:header.bill_to || ''}};
}
async function previewUnifiedDocument(index,kind) {
  if(orderExcel.busy)return;
  const session=orderReviewSession(index),revision=session.revision,doc=session.document;
  if(!doc || session.signature!==orderReviewSignature(index))return orderExcelStatus('Recalculate the current inputs first.',true);
  orderExcelBusy(true);
  document.getElementById('order-excel-modal').classList.remove('visible');
  showWorkflowProgress(3,`Preparing ${orderDocumentNames[kind]} for order ${doc.order_number}…`);
  try {
    await keepOrderReview();
    const large=kind==='jobs' && estimateB2BOrderPages(doc.jobs)>1000;
    const key=`orders:${orderExcel.checkId}:${doc.order_number}:${revision}:${kind}`;
    const draft=kind==='jobs'?{jobs:doc.jobs,order_number:doc.order_number}:doc[kind];
    const endpoint=kind==='jobs'?(large?'/api/b2b/render-batch-archive':'/api/b2b/render-batch'):KEHE_DOCUMENT_CONFIG[kind==='packing_list'?'masterPackingList':'palletLabel'].renderEndpoint;
    const generated=await runDocumentPipeline({kind:kind==='jobs'?'labels':kind==='packing_list'?'masterPackingList':'palletLabel',draft,
      getOrderSnapshot:()=>unifiedOrderSnapshot(index),isCurrent:()=>session.revision===revision && orderExcel.matching?.orders[index]?.order_number===doc.order_number,
      output:{key,scope:'orders',name:`${doc.order_number}_${kind}.${large?'zip':'pdf'}`,kind:large?'zip':'pdf',labelType:orderDocumentNames[kind]},
      render:async(snapshot,ensureCurrent)=>{
        const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)};
        let blob;
        if(kind==='jobs')blob=await window.LabelKitAPI.blob(endpoint,options,0);
        else {
          const job=await window.LabelKitAPI.json(endpoint,options,0);await pollOrderExcel(job.result_id);ensureCurrent();
          blob=await window.LabelKitAPI.blob(`/results/${encodeURIComponent(job.result_id)}/file`,{},0);
        }
        ensureCurrent();return {blob};
      }});
    closeWorkflowProgress();
    if(!generated){openOrderExcel();return;}
    session.outputs[kind]={...generated,key,revision,kind:large?'zip':'pdf'};
    session.approvals[kind]=false;
    orderReviewPreview={index,kind,revision};
    document.getElementById('order-excel-modal').classList.remove('visible');
    await window.openGeneratedOutput(key);
    const approve=document.getElementById('btn-approve-order-preview');
    if(!large){approve.classList.remove('hidden');approve.textContent=`Approve ${orderDocumentNames[kind]}`;}
    else {orderReviewPreview=null;openOrderExcel();renderOrderExcelMatching();orderExcelStatus('Review the downloaded label PDFs, then approve Customer labels.');}
  }catch(error){closeWorkflowProgress();openOrderExcel();orderExcelStatus(error.message,true);}finally{orderExcelBusy(false);}
}
function approveUnifiedDocument(index,kind) {
  const session=orderReviewSession(index);
  if(session.outputs[kind]?.revision!==session.revision)return orderExcelStatus('Preview the current document before approving.',true);
  session.approvals[kind]=true;
  if(orderReviewPreview){orderReviewPreview=null;closePreview(false);document.getElementById('btn-approve-order-preview').classList.add('hidden');}
  openOrderExcel();renderOrderExcelMatching();orderExcelStatus(`${orderDocumentNames[kind]} approved for order ${session.document.order_number}.`);
}
function approveUnifiedPreview() {if(orderReviewPreview)approveUnifiedDocument(orderReviewPreview.index,orderReviewPreview.kind);}
function returnFromUnifiedPreview() {
  if(!orderReviewPreview)return;
  orderReviewPreview=null;document.getElementById('btn-approve-order-preview').classList.add('hidden');openOrderExcel();renderOrderExcelMatching();
}
function downloadUnifiedOutput(index,kind) {
  const output=orderReviewSession(index).outputs[kind];if(!output?.blob)return;
  const link=document.createElement('a'),url=URL.createObjectURL(output.blob);
  link.href=url;link.download=`${orderExcel.matching.orders[index].order_number}_${kind}.${output.kind==='zip'?'zip':'pdf'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function editUnifiedDocument(index,kind) {
  const session=orderReviewSession(index),doc=session.document;if(!doc?.[kind])return;
  if(doc.packing_list){doc.packing_list.storefront=doc.header.customer || '';for(const mpl of doc.packing_list.packing_lists)mpl.storefront=doc.header.customer || '';}
  mplDraftSync?.discard();clearB2BPreview();resetOperationsReviewState();
  Object.assign(orderDocumentsState,initialOperationsState(),{initialized:true,orderNumber:doc.order_number,ecomdashId:doc.record_id,customerName:doc.header.customer,
    mplDraft:doc.packing_list,palletDraft:doc.pallet_labels,payload:{sales_order_number:doc.order_number,items:doc.review.lines},
    reviewedOrder:{...unifiedOrderSnapshot(index),context:{}}});
  b2bOrderLabelJobs=doc.jobs;b2bRunFields={...B2B_RUN_FIELD_DEFAULTS,order_number:doc.order_number,po_number:doc.header.po_number,ship_date:doc.header.ship_date};
  for(const [id,selected] of [['operations-generate-labels',!!doc.jobs.length],['operations-generate-mpl',!!doc.packing_list],['operations-generate-pallets',!!doc.pallet_labels]])document.getElementById(id).checked=selected;
  orderReviewEditor={index,kind,session};
  document.getElementById('order-excel-modal').classList.remove('visible');
  activeKeheDocumentType=kind==='packing_list'?'masterPackingList':'palletLabel';activeKeheDocumentDraft=doc[kind];keheLastMplDraft=doc.packing_list;
  beginOperationsDocumentReview(kind==='packing_list'?'mpl':'pallets');
  renderDocumentEditor(activeKeheDocumentType,activeKeheDocumentDraft);openDocumentEditor();
}
function unifiedDocumentChanged() {
  if(!orderReviewEditor)return;
  const session=orderReviewEditor.session;session.manualEdited=true;session.revision++;session.approvals={};session.outputs={};
}
async function finishUnifiedOrderEditor(approved=false) {
  const editor=orderReviewEditor;if(!editor)return;
  const {index,kind,session}=editor;
  session.document[kind]=activeKeheDocumentDraft;session.document.jobs=b2bOrderLabelJobs;
  const fields=orderDocumentsState.reviewedOrder?.fields || {};
  const model=orderExcel.matching.orders[index];
  for(const [name,value] of Object.entries(fields)){
    const field=model.sections.flatMap(section=>section.fields).find(field=>field.path===`header:${name}`);
    if(field && field.value!==value){
      orderExcelChoice(index).fields[`header:${name}`]={source:'custom',value};
      Object.assign(field,{value,selection:'custom',source:'custom',source_label:'Edited',missing:field.required&&!value});
    }
    session.document.header[name]=value;
  }
  session.signature=orderReviewSignature(index);
  if(kind==='packing_list' && session.document.pallet_labels){
    session.document.pallet_labels=buildPalletLabelDraftFromMplDraft(session.document.packing_list);
    session.approvals.pallet_labels=false;delete session.outputs.pallet_labels;
  }
  if(approved){
    const output=window.getGeneratedOutputs('operations').find(([key])=>key===(kind==='packing_list'?'operations-mpl':'operations-pallets'))?.[1];
    if(output?.blob){
      const key=`orders:${orderExcel.checkId}:${session.document.order_number}:${session.revision}:${kind}`;
      await window.recordGeneratedOutput(key,{...output,scope:'orders'});
      session.outputs[kind]={...output,key,revision:session.revision};session.approvals[kind]=true;
    }
  }
  mplDraftSync?.discard();orderReviewEditor=null;clearOperationsDocumentReview();closeDocumentEditor(false);
  orderExcel.activeOrder=index;session.section='documents';openOrderExcel();renderOrderExcelMatching();
  orderExcelStatus(approved?'Document approved. Manual edits are retained for this order.':'Returned to the order. Edits are retained; preview and approve before printing.');
}

let orderReviewProduct=null;
async function addUnifiedMissingProduct(index,sectionId) {
  if(orderReviewProduct || !hasPermission('table_crud'))return;
  const order=orderExcel.matching.orders[index],section=order.sections.find(section=>section.id===sectionId),header=order.sections.find(section=>section.kind==='header');
  const source=Object.fromEntries(section.fields.map(field=>[field.name,field.value]));
  if(!source.sku)return orderExcelStatus('Enter a SKU before optionally registering it in Product Master.',true);
  const lineIndex=Number(sectionId.split(':')[1]),customer=header.fields.find(field=>field.name==='customer').value;
  Object.assign(orderDocumentsState,initialOperationsState(),{initialized:true,orderNumber:order.order_number,ecomdashId:order.record_id,customerName:customer,
    reviewedOrder:{id:`${orderExcel.checkId}:${order.order_number}`,revision:0,fields:{}},payload:{items:Array.from({length:lineIndex+1},(_,i)=>i===lineIndex?{...source,quantity_ordered:source.quantity,match_status:'unmatched'}:{})}});
  b2bSelectedCustomer=customer;
  orderReviewProduct={index};document.getElementById('order-excel-modal').classList.remove('visible');
  await addOperationsMissingProduct(lineIndex);
  if(operationsNewProduct)operationsNewProduct.unified={index};
  else {orderReviewProduct=null;openOrderExcel();orderExcelStatus(document.getElementById('mpl-product-order-error').textContent || 'Product setup could not be opened. Review the Product Master save status and retry.',true);}
}
async function rematchUnifiedProduct(pending) {
  const index=pending.unified.index,order=orderExcel.matching.orders[index];
  const previousCheckId=orderExcel.checkId;
  const job=await window.LabelKitAPI.json('/api/order-documents/batch/references',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_id:orderExcel.checkId,order_number:order.order_number})});
  const matching=await pollOrderExcel(job.result_id);
  rememberReviewLabelEdits(index);
  orderExcel.checkId=job.result_id;orderExcel.matching.orders[index]=matching.orders[index];orderReviewChanged(index);
  if(!await refreshOrderExcelFields(index))throw new Error('Product saved, but defaults could not be refreshed. Retry order update.');
  await keepOrderReview([previousCheckId]).catch(()=>{});
}
function returnFromUnifiedProduct() {
  if(!orderReviewProduct)return;
  orderExcel.activeOrder=orderReviewProduct.index;orderReviewProduct=null;openOrderExcel();renderOrderExcelMatching();
}
