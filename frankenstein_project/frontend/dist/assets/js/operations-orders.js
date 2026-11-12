/* Multiple orders wrap the original workspace; each order uses its existing pipeline. */
let workspaceOrders={entries:[],active:0,busy:false,suspended:false,rollback:null};
const workspaceCopy=value=>JSON.parse(JSON.stringify(value));

function updateWorkspaceOrderCount() {
  const values=document.getElementById('operations-sales-order-number').value.trim().split(/[,;\s]+/).filter(Boolean);
  document.getElementById('operations-order-count').textContent=values.length
    ? `${new Set(values).size} order(s) · ${values.length-new Set(values).size} duplicate(s) ignored`
    : 'Separate order numbers with commas, spaces or new lines. Up to 100 orders.';
}
function canSwitchWorkspaceOrder() {
  return !workspaceOrders.busy && !orderDocumentsState.loading && !orderDocumentsState.approvingDocument
    && !globalThis.documentPipelineActive && !mplDraftSync?.isSaving?.() && !operationsNewProduct
    && !['document-editor-panel','preview-panel','operations-packing-modal','workflow-progress-modal'].some(id=>document.getElementById(id)?.classList.contains('visible'));
}
function captureWorkspaceOrder() {
  persistB2BActiveRunFields();
  return {
    data:workspaceCopy({state:orderDocumentsState,selection:operationsSelectedDocuments(),
      b2b:{b2bSelectedCustomer,b2bSelectedGroupKey,b2bSelectedProductIndex,b2bSelectedDirectoryIndex,b2bSelectedTemplateId,b2bSelectedTemplateIds,
        b2bTemplateRunFields,b2bOrderFallbackProducts,b2bOrderLabelJobs,b2bSelectedOrderJobIndex,b2bOrderCustomerOverride,b2bOrderDestinationOverride,
        b2bOrderShipToName,b2bResolvedOrderContext,b2bResolvedDirectoryFallback,b2bCopiesTemplateId,b2bSettingsProductIndex,b2bOpenSkuRowIndex,b2bRunFields},
      editor:{type:activeKeheDocumentType,operationsPackingLine,keheMplPalletizationSource,kehePalletLabelSource,mplVersionHistory,activeKeheAuditEntries}}),
    outputs:window.getGeneratedOutputs().filter(([,output])=>String(output.scope || '').startsWith('operations')),
    history:window.captureMplHistory?.(orderDocumentsState.mplDraft),dirty:!!mplDraftSync?.hasUnsavedChanges(),scroll:window.scrollY,
  };
}
function saveWorkspaceOrder() {
  const entry=workspaceOrders.entries[workspaceOrders.active];
  if(!entry || workspaceOrders.suspended || orderDocumentsState.orderNumber!==entry.number)return;
  entry.snapshot=captureWorkspaceOrder();
}
function restoreWorkspaceOrder(snapshot) {
  mplDraftSync?.discard();clearB2BPreview();resetKehePreviewUrls();
  const {state,selection,b2b,editor}=workspaceCopy(snapshot.data);
  Object.assign(orderDocumentsState,initialOperationsState(),state,{loading:false,initializingOrder:false,rendering:false,approvingDocument:''});
  ({b2bSelectedCustomer,b2bSelectedGroupKey,b2bSelectedProductIndex,b2bSelectedDirectoryIndex,b2bSelectedTemplateId,b2bSelectedTemplateIds,
    b2bTemplateRunFields,b2bOrderFallbackProducts,b2bOrderLabelJobs,b2bSelectedOrderJobIndex,b2bOrderCustomerOverride,b2bOrderDestinationOverride,
    b2bOrderShipToName,b2bResolvedOrderContext,b2bResolvedDirectoryFallback,b2bCopiesTemplateId,b2bSettingsProductIndex,b2bOpenSkuRowIndex,b2bRunFields}=b2b);
  ({operationsPackingLine,keheMplPalletizationSource,kehePalletLabelSource,mplVersionHistory,activeKeheAuditEntries}=editor);
  activeKeheDocumentType=editor.type || 'masterPackingList';
  activeKeheDocumentDraft=activeKeheDocumentType==='palletLabel'?orderDocumentsState.palletDraft:orderDocumentsState.mplDraft;
  keheLastMplDraft=orderDocumentsState.mplDraft;keheLastPalletLabelDraft=orderDocumentsState.palletDraft;
  for(const [kind,id] of [['labels','operations-generate-labels'],['mpl','operations-generate-mpl'],['pallets','operations-generate-pallets']])document.getElementById(id).checked=selection[kind];
  window.replaceOperationsOutputs(snapshot.outputs);
  const labels=snapshot.outputs.find(([key])=>key==='operations-labels-review')?.[1];
  if(labels?.blob && state.labelPreviewReady){b2bPreviewUrl=window.LabelKitPreview.create(labels.blob);blobUrl=b2bPreviewUrl;}
  window.restoreMplHistory?.(orderDocumentsState.mplDraft,snapshot.history);
  if(snapshot.dirty)mplDraftSync?.schedule();
  document.getElementById('operations-sales-order-number').value=workspaceOrders.entries.map(entry=>entry.number).join(', ');
  setHistoryRoute(`operations/${orderDocumentsState.activeTab}`,true);
  renderOperationsWorkspace();
  window.requestAnimationFrame(()=>window.scrollTo({top:snapshot.scroll || 0}));
}
function workspaceOrderStatus(entry,index) {
  if(entry.skip)return 'Skipped';
  if(entry.error)return 'Load failed';
  if(entry.status==='selection')return 'Choose record';
  const active=index===workspaceOrders.active && !workspaceOrders.suspended && orderDocumentsState.orderNumber===entry.number;
  const state=active?orderDocumentsState:entry.snapshot?.data.state;
  if(!state)return 'Not loaded';
  const selected=active?operationsSelectedDocuments():entry.snapshot.data.selection;
  const outputs=active?window.getGeneratedOutputs('operations'):entry.snapshot.outputs.filter(([,output])=>output.scope==='operations');
  return Object.values(selected).some(Boolean) && Object.entries(selected).every(([kind,value])=>!value || (state.reviewedDocuments[kind] && outputs.some(([key,output])=>key===`operations-${kind}` && output.blob)))?'Ready':'Needs review';
}
function renderWorkspaceOrderNavigation() {
  const nav=document.getElementById('operations-order-navigation');if(!nav)return;
  const {entries,active,suspended}=workspaceOrders;
  nav.classList.toggle('hidden',!entries.length);
  if(!entries.length)return;
  const entry=entries[active],blocked=!canSwitchWorkspaceOrder() || orderDocumentsState.selectingOrderInstance;
  nav.innerHTML=`<div class="operations-order-switcher"><button type="button" class="btn-secondary" aria-label="Previous order" onclick="switchWorkspaceOrder(${active-1})" ${blocked || suspended || active===0?'disabled':''}>← Previous order</button><label>${suspended?'Custom document':`Order ${active+1} of ${entries.length}`}<select aria-label="Current sales order" onchange="switchWorkspaceOrder(this.value)" ${blocked?'disabled':''}>${suspended?'<option value="" selected>Custom document — select an order to return</option>':''}${entries.map((item,index)=>`<option value="${index}" ${!suspended&&index===active?'selected':''}>${escapeHtml(item.number)} · ${workspaceOrderStatus(item,index)}</option>`).join('')}</select></label><button type="button" class="btn-secondary" aria-label="Next order" onclick="switchWorkspaceOrder(${active+1})" ${blocked || suspended || active===entries.length-1?'disabled':''}>Next order →</button></div>
    <div class="operations-order-batch-actions"><span>${entries.filter((item,index)=>workspaceOrderStatus(item,index)==='Ready').length} ready · ${entries.filter(item=>item.skip).length} skipped</span><label><input type="checkbox" aria-label="Skip current order" ${entry.skip?'checked':''} ${blocked||suspended?'disabled':''} onchange="skipWorkspaceOrder(this.checked)"> Skip this order</label>${entry.error || entry.status==='selection'?`<button class="btn-secondary" type="button" ${blocked?'disabled':''} onclick="switchWorkspaceOrder(${active},true)">Retry / choose record</button>`:''}<button type="button" class="btn-secondary" ${blocked?'disabled':''} onclick="downloadWorkspaceOrders()">Download approved orders ZIP</button></div>
    ${entry.error&&!suspended?`<div class="operations-order-load-error" role="alert">${escapeHtml(entry.error)} <button type="button" class="btn-secondary" onclick="createWorkspaceManualOrder()" ${blocked?'disabled':''}>Create packing list manually</button></div>`:''}`;
}
async function loadOrderDocuments(event) {
  event?.preventDefault();
  if(!canSwitchWorkspaceOrder() || orderDocumentsState.selectingOrderInstance)return setStatus('Finish the current calculation or document review before loading another order.','info');
  const numbers=[...new Set(document.getElementById('operations-sales-order-number').value.trim().split(/[,;\s]+/).filter(Boolean))];
  if(!numbers.length || numbers.length>100 || numbers.some(number=>!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(number)))return setStatus('Enter up to 100 valid sales order numbers separated by commas, spaces or new lines.','error');
  const hasWork=orderDocumentsState.payload || orderDocumentsState.mplDraft || orderDocumentsState.customMode || workspaceOrders.entries.some(entry=>entry.snapshot);
  if(hasWork && !window.confirm('Replace the current order list? Save or download any documents you need first.'))return;
  saveWorkspaceOrder();
  const rollback=hasWork?{batch:workspaceOrders,snapshot:captureWorkspaceOrder()}:null;
  workspaceOrders={entries:numbers.map(number=>({number,key:crypto.randomUUID(),status:'pending',skip:false})),active:0,busy:false,suspended:false,rollback};
  await switchWorkspaceOrder(0);
}
async function switchWorkspaceOrder(index,retry=false) {
  index=Number(index);
  if(!Number.isInteger(index) || !workspaceOrders.entries[index] || !canSwitchWorkspaceOrder() || orderDocumentsState.selectingOrderInstance)return;
  if(workspaceOrders.suspended && (orderDocumentsState.customMode || orderDocumentsState.mplDraft) && !window.confirm('Return to the order list? Save or download this custom document first.'))return;
  saveWorkspaceOrder();
  const previous=workspaceOrders.active;
  workspaceOrders.active=index;workspaceOrders.suspended=false;
  const entry=workspaceOrders.entries[index];
  if(entry.snapshot && !retry){restoreWorkspaceOrder(entry.snapshot);return;}
  workspaceOrders.previousActive=previous;workspaceOrders.busy=true;
  mplDraftSync?.discard();resetOperationsWorkspaceState();
  document.getElementById('operations-sales-order-number').value=workspaceOrders.entries.map(item=>item.number).join(', ');
  entry.error='';renderWorkspaceOrderNavigation();
  try{await loadOperationsOrder(null,'',entry.number);}finally{workspaceOrders.busy=false;renderWorkspaceOrderNavigation();}
}
function workspaceOrderLoadFinished(outcome,number) {
  const entry=workspaceOrders.entries[workspaceOrders.active];if(!entry || entry.number!==number)return;
  if(outcome?.loaded){
    if(orderDocumentsState.reviewedOrder)orderDocumentsState.reviewedOrder.id+=`:${entry.key}`;
    entry.status='loaded';entry.error='';workspaceOrders.rollback=null;saveWorkspaceOrder();
  }else if(outcome?.selection)entry.status='selection';
  else if(outcome?.error){
    entry.error=outcome.error;
    if(workspaceOrders.rollback){const previous=workspaceOrders.rollback;workspaceOrders=previous.batch;restoreWorkspaceOrder(previous.snapshot);setStatus(`Order load failed: ${outcome.error}. Previous work retained.`,'error');}
  }
  renderWorkspaceOrderNavigation();
}
function cancelWorkspaceOrderSelection() {
  const entry=workspaceOrders.entries[workspaceOrders.active];if(!entry || entry.status!=='selection')return false;
  if(workspaceOrders.rollback){const previous=workspaceOrders.rollback;workspaceOrders=previous.batch;restoreWorkspaceOrder(previous.snapshot);}
  else if(workspaceOrders.entries[workspaceOrders.previousActive]?.snapshot){workspaceOrders.active=workspaceOrders.previousActive;restoreWorkspaceOrder(workspaceOrders.entries[workspaceOrders.active].snapshot);}
  renderWorkspaceOrderNavigation();setStatus('Record selection cancelled. Existing order edits are retained.','info');return true;
}
function skipWorkspaceOrder(value) {workspaceOrders.entries[workspaceOrders.active].skip=value;renderWorkspaceOrderNavigation();}
function suspendWorkspaceOrders() {
  if(!canSwitchWorkspaceOrder()){setStatus('Finish the current calculation or document review first.','info');return false;}
  if(!workspaceOrders.creatingManual){saveWorkspaceOrder();workspaceOrders.suspended=!!workspaceOrders.entries.length;}
  return true;
}
async function createWorkspaceManualOrder() {
  const entry=workspaceOrders.entries[workspaceOrders.active];if(!entry || !canSwitchWorkspaceOrder())return;
  workspaceOrders.creatingManual=true;
  try {
    await openOperationsCustomMpl();workspaceOrders.suspended=false;
    orderDocumentsState.orderNumber=entry.number;
    const mpl=orderDocumentsState.mplDraft?.packing_lists?.[0];
    if(mpl){mpl.order_no=entry.number;mpl.customer_no=entry.number;renderDocumentEditor('masterPackingList',orderDocumentsState.mplDraft);}
    if(orderDocumentsState.reviewedOrder)orderDocumentsState.reviewedOrder.id=`manual:${entry.number}:${entry.key}`;
    entry.error='';entry.status='loaded';workspaceOrders.rollback=null;saveWorkspaceOrder();renderWorkspaceOrderNavigation();
  }finally{workspaceOrders.creatingManual=false;}
}
async function downloadWorkspaceOrders() {
  if(!canSwitchWorkspaceOrder())return setStatus('Finish the current calculation or document review first.','info');
  saveWorkspaceOrder();
  const entries=workspaceOrders.entries.filter(entry=>!entry.skip);
  const missing=entries.filter(entry=>workspaceOrderStatus(entry,workspaceOrders.entries.indexOf(entry))!=='Ready');
  if(!entries.length || missing.length)return setStatus(missing.length?`Review and approve the selected documents for: ${missing.map(entry=>entry.number).join(', ')}.`:'Select at least one order to download.','error');
  const form=new FormData(),orders=[];
  for(const entry of entries){
    const {data,outputs}=entry.snapshot,files=[];
    for(const [kind,selected] of Object.entries(data.selection)){
      if(!selected)continue;
      const output=outputs.find(([key])=>key===`operations-${kind}`)?.[1];
      files.push({index:orders.reduce((sum,row)=>sum+row.files.length,0)+files.length,name:output.name || `${kind}.pdf`});
      form.append('files',output.blob,output.name || `${kind}.pdf`);
    }
    orders.push({order_number:entry.number,record_id:data.state.ecomdashId,files,reviewed_order:data.state.reviewedOrder});
  }
  form.append('manifest',JSON.stringify({order_numbers:workspaceOrders.entries.map(entry=>entry.number),skipped:workspaceOrders.entries.filter(entry=>entry.skip).map(entry=>entry.number),orders}));
  workspaceOrders.busy=true;renderWorkspaceOrderNavigation();
  try {
    setStatus('Packaging the approved PDFs. Cartons and pallets are unchanged.','info');
    const job=await window.LabelKitAPI.json('/api/order-documents/archive',{method:'POST',body:form},0);
    while(true){
      const status=await window.LabelKitAPI.json(`/results/${encodeURIComponent(job.result_id)}/status`);
      if(status.status==='error')throw new Error(status.detail);
      if(status.status==='complete')break;
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    const blob=await window.LabelKitAPI.blob(`/results/${encodeURIComponent(job.result_id)}/file`,{},0),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='approved_order_documents.zip';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus('Approved order PDFs downloaded in separate order folders.','success');
  }catch(error){setStatus(error.message,'error');}finally{workspaceOrders.busy=false;renderWorkspaceOrderNavigation();}
}
