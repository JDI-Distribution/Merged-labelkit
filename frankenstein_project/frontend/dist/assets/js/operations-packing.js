/* Optional, order-only box counts and physical box measurements. */
  let operationsPackingLine = 0;
  const operationsPackingBatch={running:false,waiting:null};
  function closeOperationsPacking() {
    document.getElementById('operations-packing-modal')?.classList.remove('visible');
    const checkbox = document.getElementById('operations-customize-packing');
    if (checkbox) checkbox.checked = !!orderDocumentsState.mplDraft?.packing_lists?.some(mpl => mpl.items?.some(item => item.order_packaging));
  }
  function openOperationsPacking(lineIndex = operationsPackingLine) {
    if(operationsPackingBatch.running)return;
    if (!orderDocumentsState.payload?.items?.length) return;
    operationsPackingLine = Number.isInteger(lineIndex) ? lineIndex : operationsPackingLine;
    document.getElementById('operations-customize-packing').checked = true;
    persistB2BActiveRunFields();
    const select = document.getElementById('operations-packing-line');
    document.getElementById('operations-packing-all-skus').checked=false;
    document.getElementById('operations-packing-all-orders').checked=false;
    document.getElementById('operations-packing-all-orders').disabled=workspaceOrders.entries.length<2;
    select.innerHTML = orderDocumentsState.payload.items.map((item, index) =>
      `<option value="${index}">${escapeHtml(item.sku || item.description || `Line ${index + 1}`)}${orderDocumentsState.mplDraft?.packing_lists?.some(mpl => mpl.items?.some(row => row.review_line_index === index && row.order_packaging)) ? ' · Customized' : ''}</option>`).join('');
    document.getElementById('operations-packing-modal').classList.add('visible');
    selectOperationsPackingLine(String(Math.min(operationsPackingLine, orderDocumentsState.payload.items.length - 1)));
    select.value = String(operationsPackingLine);
    document.querySelector('#operations-packing-modal .editor-body').scrollTop=0;
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
    const settings = item.order_packaging?.settings;
    document.getElementById('operations-packing-unit-lbs').value = settings?.unitLbs ?? lbs ?? '';
    document.getElementById('operations-packing-mode').value = settings?.mode || (lbs ? 'lbs' : 'units');
    document.getElementById('operations-packing-value').value = settings?.value || '';
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
    updateOperationsPackingScope();
  }
  function updateOperationsPackingScope() {
    const allSkus=document.getElementById('operations-packing-all-skus').checked;
    const allOrders=document.getElementById('operations-packing-all-orders').checked;
    const source=orderDocumentsState.payload?.items?.[operationsPackingLine];
    const orders=allOrders?workspaceOrders.entries.filter(entry=>!entry.skip).length:1;
    document.getElementById('operations-packing-scope-summary').textContent=
      `${allSkus?'All SKUs':allOrders?`SKU ${source?.sku || '(SKU required)'}`:'Selected line'} · ${orders} ${allOrders?'included orders':'order'}. `
      +(allOrders?'Unloaded orders load first. ':'')
      +(document.getElementById('operations-packing-mode').value==='boxes'?'Total boxes applies separately to each affected item, not to the whole shipment.':'Box counts are recalculated separately for each item.');
  }
  function continueOperationsPacking() {
    try {
      operationsPackingGroups();
      document.getElementById('operations-packing-quantity-step').classList.add('hidden');
      document.getElementById('operations-packing-size-step').classList.remove('hidden');
      document.getElementById('operations-packing-size-step').scrollIntoView({block:'start'});
      document.getElementById('operations-packing-error').textContent = '';
    } catch (error) { document.getElementById('operations-packing-error').textContent = error.message; }
  }
  function buildOperationsPackingLine(draft,labelJobs,lineIndex,groups,measurements,settings) {
      const maxNet=Math.max(...groups.map(group=>group.netLbs || 0));
      const source = orderDocumentsState.payload.items[lineIndex];
      const previousItems = draft.packing_lists.flatMap(list => list.items || []);
      const original = previousItems.find(item => item.review_line_index === lineIndex);
      if (!original) throw new Error('This order line has no packing-list row.');
      const boxJobs = labelJobs.filter(job => job.line_index === lineIndex && ['Case', 'Master Case'].includes(normalizePackagingLevel(job.product?.packaging_level)));
      // Collapse only previously split custom jobs; keep every template/level.
      const baseJobs = boxJobs.filter((job, index) => boxJobs.findIndex(other => other.product.packaging_level === job.product.packaging_level && JSON.stringify(b2bTemplateIdsForJob(other)) === JSON.stringify(b2bTemplateIdsForJob(job))) === index);
      if (!baseJobs.length) {
        const job = labelJobs.find(job => job.line_index === lineIndex && !isPartnerPalletLabelJob(job));
        if (job) baseJobs.push(job);
      }
      const totalBoxes = groups.reduce((sum, group) => sum + group.count, 0);
      const products = [], replacements = [], jobs = [];
      let start = 1;
      for (const group of groups) {
        const samePack = normalizePackagingLevel(source.product?.packaging_level) === 'Case'
          && Number(source.product?.case_qty) === group.units;
        const product = normalizeProductRow({ ...(original.order_packaging?.product || source.product || {}),
          sku: source.sku || original.sku, description: source.description || original.description,
          storefront: source.product?.storefront || original.storefront || orderDocumentsState.customerName,
          config_id: `ORDER-${orderDocumentsState.orderNumber}-${lineIndex}-${group.key}`,
          packaging_level: 'Case', case_qty: String(group.units),
          gtin: samePack ? source.product.gtin : '', barcode_type: samePack ? source.product.barcode_type : 'NONE',
          length_in: String(measurements.length), width_in: String(measurements.width), height_in: String(measurements.height),
          gross_weight_lbs: String(group.netLbs == null ? measurements.gross : group.netLbs + measurements.gross - maxNet),
          package_net_weight_g: group.netLbs == null ? '' : String(group.netLbs * 453.59237),
          label_enabled: true, in_packing_list: true, is_active: true,
        });
        products.push(product);
        if (!baseJobs.length) {
          baseJobs.push(...buildB2BOrderLabelJobs([{ ...source, product, packaging_summary: [{ ...product, label_enabled: true }] }], [product])
            .map(job => ({ ...job, line_index: lineIndex })));
        }
        replacements.push({ ...original, review_line_index: lineIndex, order_packing_group: group.key,
          order_packaging: { product, source_units: window.LabelKitOrderPackingModel.orderedUnits(source), net_lbs_per_box: group.netLbs,
            settings: { ...settings } },
          qty_on_pallet: String(group.count), total_shipped: String(group.count), total_ordered: String(group.count),
          quantity_per_case: String(group.units), eaches_per_case: String(group.units), uom: 'CASES',
          product_size: group.netLbs == null ? original.product_size : `${formatNumberString(group.netLbs)} lb per box`,
          gtin: product.gtin, case_upc: product.gtin, each_gtin: '', location_on_pallet: '', pallet_weight: '',
          notes: `Order-only packing: ${group.count} box(es), ${group.units} ordered units per box.`,
        });
        for (const baseJob of baseJobs) {
          const job = JSON.parse(JSON.stringify(baseJob));
          Object.assign(job, { product: { ...product, packaging_level: boxJobs.includes(baseJob) ? baseJob.product.packaging_level : 'Case' }, order_packing_group: group.key, order_packaging: true });
          for (const run of [job.run, ...Object.values(job.template_runs || {})].filter(Boolean)) Object.assign(run, {
            carton_total: String(totalBoxes), carton_start: String(start), carton_end: String(start + group.count - 1),
            net_weight: group.netLbs == null ? '' : `${formatNumberString(group.netLbs)} lb`, print_barcode: !!product.gtin && run.print_barcode !== false,
          });
          jobs.push(job);
        }
        start += group.count;
      }
      let inserted=false;
      for (const list of draft.packing_lists) list.items=list.items.flatMap(item=>{
        if(item.review_line_index!==lineIndex)return [item];
        if(inserted)return [];
        inserted=true;return replacements;
      });
      for (const list of draft.packing_lists) list.warnings = (list.warnings || []).filter(warning =>
        !(String(warning).startsWith(`SKU ${source.sku}:`) && /using order data;/i.test(String(warning))));
      for (const list of draft.packing_lists) { list._pallet_weights = {}; list._pallet_ids = []; }
      draft.reviewed_product_master = [...(draft.reviewed_product_master || []).filter(row => !String(row.config_id || '').startsWith(`ORDER-${orderDocumentsState.orderNumber}-${lineIndex}-`)), ...products];
      draft.product_master = draft.reviewed_product_master;
      labelJobs.splice(0,labelJobs.length,...labelJobs.filter(job=>job.line_index!==lineIndex || (!job.order_packaging && !boxJobs.includes(job))),...jobs);
      return totalBoxes;
  }

  function operationsPackingOrderLoaded(outcome,number) {
    const waiting=operationsPackingBatch.waiting;
    if(!waiting || waiting.number!==number || outcome?.selection)return;
    operationsPackingBatch.waiting=null;
    waiting.resolve(!!outcome?.loaded);
  }
  async function loadOperationsPackingOrder(index) {
    const entry=workspaceOrders.entries[index];
    if(entry.snapshot)return;
    const loaded=new Promise(resolve=>{operationsPackingBatch.waiting={number:entry.number,resolve};});
    closeWorkflowProgress();
    await switchWorkspaceOrder(index,false,true);
    if(!entry.snapshot && entry.status!=='selection')throw new Error(`Order ${entry.number}: ${entry.error || 'could not load; finish any current save and retry'}. Packing changes have not been applied.`);
    if(!(await loaded))throw new Error(`Order ${entry.number} was not loaded. Packing changes have not been applied.`);
  }
  async function stageOperationsPacking(lines,input,originIndex) {
    const previousDraft=orderDocumentsState.mplDraft,version=JSON.stringify(previousDraft);
    if(!previousDraft)throw new Error('This order has no packing-list draft.');
    const draft=workspaceCopy(previousDraft),jobs=workspaceCopy(b2bOrderLabelJobs);
    let boxes=0;
    for(const lineIndex of lines){
      const source=orderDocumentsState.payload.items[lineIndex];
      const row=draft.packing_lists.flatMap(list=>list.items || []).find(item=>item.review_line_index===lineIndex);
      const sameSku=operationsSkuKey(source.sku)===input.sku && !!input.sku;
      const selected=workspaceOrders.active===originIndex && lineIndex===input.lineIndex;
      const unitLbs=selected || sameSku ? input.settings.unitLbs
        : Number(row?.order_packaging?.settings?.unitLbs) || window.LabelKitOrderPackingModel.unitNetLbs(source);
      try {
        if(!selected && !(unitLbs>0))throw new Error('Pounds per ordered unit is unknown. Set up this item first, or apply only to the selected SKU.');
        const groups=window.LabelKitOrderPackingModel.boxGroups({totalUnits:window.LabelKitOrderPackingModel.orderedUnits(source),...input.settings,unitLbs});
        if(groups.length>1 && groups.some(group=>group.netLbs==null))throw new Error('Enter pounds per ordered unit to calculate partial box weights.');
        const gross=selected?input.measurements.gross:Math.max(...groups.map(group=>group.netLbs || 0))+input.tare;
        boxes+=buildOperationsPackingLine(draft,jobs,lineIndex,groups,{...input.measurements,gross},{...input.settings,unitLbs});
      }catch(error){throw new Error(`${orderDocumentsState.orderNumber} · ${source.sku || `Line ${lineIndex+1}`}: ${error.message}`);}
    }
    await autoPalletizeMpl(0,{draft,render:false,showStatus:false});
    if(orderDocumentsState.mplDraft!==previousDraft || JSON.stringify(previousDraft)!==version)throw new Error('Order changed during recalculation. No packing changes were applied.');
    orderDocumentsState.mplDraft=activeKeheDocumentDraft=keheLastMplDraft=draft;
    activeKeheDocumentType='masterPackingList';orderDocumentsState.palletDraft=null;
    b2bOrderLabelJobs=jobs;
    for(const job of jobs.filter(isPartnerPalletLabelJob))for(const run of [job.run,...Object.values(job.template_runs || {})].filter(Boolean))Object.assign(run,{
      carton_total:String(draft.packing_lists[0].total_pallets),carton_start:'1',carton_end:String(draft.packing_lists[0].total_pallets),
    });
    b2bOrderFallbackProducts=jobs.map((job,index)=>{job.order_only_product_index=index;return {...job.product};});
    syncReviewedOrderItems();invalidateReviewedOrder();
    window.clearGeneratedOutputs?.('operations-mpl-review','operations-pallets-review');
    b2bSelectedOrderJobIndex=-1;
    selectB2BOrderJob(Math.max(0,jobs.findIndex(job=>lines.includes(job.line_index) && job.order_packaging)));
    const snapshot=captureWorkspaceOrder();
    mplDraftSync?.discard(); // Stage in memory; publish all orders only after every calculation succeeds.
    return {snapshot,boxes};
  }
  async function applyOperationsPacking() {
    if(operationsPackingBatch.running)return;
    const errorTarget=document.getElementById('operations-packing-error');
    const button=document.getElementById('operations-packing-apply');
    const origin=workspaceOrders.active,staged=new Map();
    let started=false;
    try {
      if(mplDraftSync?.isSaving?.())throw new Error('Wait for the current draft save to finish, then apply packing.');
      const settings={mode:document.getElementById('operations-packing-mode').value,value:Number(document.getElementById('operations-packing-value').value),unitLbs:Number(document.getElementById('operations-packing-unit-lbs').value)};
      const groups=operationsPackingGroups();
      const measurements=Object.fromEntries(['length','width','height','gross'].map(key=>[key,Number(document.getElementById(`operations-packing-${key}`).value)]));
      if(Object.values(measurements).some(value=>!(Number.isFinite(value) && value>0)))throw new Error('Enter positive box length, width, height, and packed box weight.');
      const maxNet=Math.max(...groups.map(group=>group.netLbs || 0));
      if(maxNet>measurements.gross+0.0001)throw new Error('Packed box weight must include the contents and the box.');
      const allSkus=document.getElementById('operations-packing-all-skus').checked,allOrders=document.getElementById('operations-packing-all-orders').checked;
      if((allSkus || allOrders) && !(Number.isFinite(settings.unitLbs) && settings.unitLbs>0))throw new Error('Enter pounds per ordered unit for the selected line before applying across SKUs or orders.');
      const sku=operationsSkuKey(orderDocumentsState.payload.items[operationsPackingLine].sku);
      if(allOrders && !allSkus && !sku)throw new Error('This line has no SKU to match across orders. Select All SKUs, or update this line only.');
      const targets=workspaceOrders.entries.map((entry,index)=>({entry,index})).filter(({entry,index})=>allOrders?!entry.skip:index===origin);
      if(!targets.length)throw new Error('No included orders. Unskip an order before applying.');
      const input={settings,measurements,tare:measurements.gross-maxNet,lineIndex:operationsPackingLine,sku};
      saveWorkspaceOrder();operationsPackingBatch.running=true;started=true;button.disabled=true;closeOperationsPacking();
      for(const {index} of targets)await loadOperationsPackingOrder(index);
      showWorkflowProgress(4,'Reprocessing packing with your new quantities and box sizes…');
      let boxes=0,items=0;
      for(const {entry,index} of targets){
        workspaceOrders.active=index;restoreWorkspaceOrder(entry.snapshot);
        const lines=(orderDocumentsState.payload?.items || []).map((source,lineIndex)=>({source,lineIndex})).filter(({source,lineIndex})=>allSkus || (allOrders?!!sku && operationsSkuKey(source.sku)===sku:lineIndex===input.lineIndex)).map(row=>row.lineIndex);
        if(!lines.length)continue;
        updateWorkflowProgress('Planning pallets',`Reprocessing order ${entry.number} (${staged.size+1}/${targets.length})…`);
        const result=await stageOperationsPacking(lines,input,origin);
        staged.set(entry,result.snapshot);boxes+=result.boxes;items+=lines.length;
      }
      if(!staged.size)throw new Error('The selected SKU was not found in the included orders.');
      for(const [entry,snapshot] of staged)entry.snapshot=snapshot;
      workspaceOrders.active=origin;restoreWorkspaceOrder(workspaceOrders.entries[origin].snapshot);
      setStatus(`Packing updated: ${boxes} boxes across ${items} item(s) in ${staged.size} order(s). Pallets recalculated. Review labels and packing lists before printing.`,'success');
    }catch(error){
      if(started){workspaceOrders.active=origin;restoreWorkspaceOrder(workspaceOrders.entries[origin].snapshot);document.getElementById('operations-packing-modal').classList.add('visible');document.getElementById('operations-customize-packing').checked=true;}
      errorTarget.textContent=error.message;
      setStatus(`Packing not changed: ${error.message}`,'error');
    }finally{
      operationsPackingBatch.running=false;operationsPackingBatch.waiting=null;button.disabled=false;
      if(started)closeWorkflowProgress();
      renderWorkspaceOrderNavigation();
    }
  }
