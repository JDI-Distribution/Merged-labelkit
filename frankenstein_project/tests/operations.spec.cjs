const { test, expect } = require('@playwright/test');

test.describe('Multiple orders in the original workspace',()=>{
  test.skip(!process.env.LABELKIT_WORKSPACE_QA,'Requires isolated order fixtures.');
  async function chooseRecord(page,number){
    const picker=page.locator('#operations-order-instance-picker');
    await page.waitForFunction(number=>!document.getElementById('operations-order-instance-picker').classList.contains('hidden') || document.getElementById('operations-order-number')?.textContent.trim()===number,number,{timeout:25000});
    if(await picker.isVisible()){
      await picker.locator('.mpl-order-instance-checkbox').first().check();await picker.getByRole('button',{name:'Load Selected Order',exact:true}).click();
    }
    await expect(page.locator('#operations-order-number')).toHaveText(number,{timeout:30000});
    await expect(page.getByRole('combobox',{name:'Current sales order',exact:true})).toBeEnabled();
  }
  async function start(page,numbers){
    await openOperations(page);await page.locator('#operations-sales-order-number').fill(numbers);await page.locator('#btn-load-operations-order').click();
    await chooseRecord(page,numbers.split(',')[0].trim());
    await expect(page.locator('#order-excel-modal')).toHaveCount(0);
    await expect(page.locator('#operations-session')).toBeVisible();
  }
  async function packingOnly(page){await page.locator('#operations-generate-labels').uncheck();await page.locator('#operations-generate-pallets').uncheck();}
  test('orders stay on the original page and exact approved PDFs are zipped without recalculation',async({page},info)=>{
    test.setTimeout(120000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await start(page,'70801,70804,70801');await expect(page.getByRole('combobox',{name:'Current sales order',exact:true}).locator('option')).toHaveCount(2);
    await packingOnly(page);await page.locator('#btn-generate-operations-documents').click();
    await expect(page.locator('#document-editor-panel')).toBeVisible();
    await page.locator('[data-draft-path="packing_lists.0.customer_po_number"]').fill('KEEP-A');
    await page.locator('.mpl-pallet-weight-edit input').first().fill('777 lbs');
    await page.locator('#btn-operations-review-continue').click();
    await expect(page.locator('#document-editor-panel')).toBeHidden({timeout:30000});
    await expect(page.getByRole('button',{name:'Next order',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Next order',exact:true}).click();await chooseRecord(page,'70804');
    await packingOnly(page);await page.locator('#btn-generate-operations-documents').click();
    await page.locator('[data-draft-path="packing_lists.0.customer_po_number"]').fill('KEEP-B');
    await page.locator('#btn-operations-review-continue').click();await expect(page.locator('#document-editor-panel')).toBeHidden({timeout:30000});
    await page.getByRole('button',{name:'Previous order',exact:true}).click();
    await expect(page.locator('#operations-order-number')).toHaveText('70801');
    await expect(page.locator('#operations-mpl-tab-state')).toContainText('Approved');
    await page.getByRole('button',{name:/^Finished Files/}).click();await expect(page.locator('.operations-file-row')).toHaveCount(1);
    const saved=await page.evaluate(async()=>{
      const entry=workspaceOrders.entries[0];saveWorkspaceOrder();
      const output=entry.snapshot.outputs.find(([key])=>key==='operations-mpl')[1];
      return Array.from(new Uint8Array(await output.blob.arrayBuffer()));
    });
    await page.screenshot({path:info.outputPath('original-workspace-orders.png'),fullPage:true});
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download approved orders ZIP',exact:true}).click();
    const zip=await download;await zip.saveAs(info.outputPath('approved-orders.zip'));
    require('node:fs').writeFileSync(info.outputPath('approved-A.pdf'),Buffer.from(saved));
    await expect(page.locator('#operations-status-bar')).toContainText('downloaded in separate order folders');expect(errors).toEqual([]);
  });
  test('packing, order fields, label choices and manual pallet edits survive switching',async({page},info)=>{
    await start(page,'70801,70804');
    await page.evaluate(()=>{updateReviewedOrder('po_number','FIRST-ORDER');updateB2BRunField('lot_number','LOT-A');});
    await page.getByRole('button',{name:'Next order',exact:true}).click();await chooseRecord(page,'70804');
    await page.evaluate(()=>updateReviewedOrder('po_number','SECOND-ORDER'));
    await page.getByRole('button',{name:'Previous order',exact:true}).click();
    expect(await page.evaluate(()=>orderDocumentsState.reviewedOrder.fields.po_number)).toBe('FIRST-ORDER');
    await page.getByRole('button',{name:/^Packing List & Ti-Hi .*Approval required/}).click();
    await page.getByRole('button',{name:'Review & Edit Packing List',exact:true}).click();
    await page.locator('.mpl-pallet-weight-edit input').first().fill('888 lbs');
    await page.locator('#btn-operations-review-back').click();
    await page.getByRole('button',{name:'Next order',exact:true}).click();await expect(page.locator('#operations-order-number')).toHaveText('70804');
    expect(await page.evaluate(()=>orderDocumentsState.reviewedOrder.fields.po_number)).toBe('SECOND-ORDER');
    await page.getByRole('button',{name:'Previous order',exact:true}).click();
    await page.getByRole('button',{name:'Review & Edit Packing List',exact:true}).click();
    await expect(page.locator('.mpl-pallet-weight-edit input').first()).toHaveValue('888 lbs');
    await expect(page.locator('#btn-mpl-undo')).toBeEnabled();await page.locator('#btn-operations-review-back').click();
    await page.setViewportSize({width:390,height:844});
    expect(await page.locator('#operations-workspace-page').evaluate(node=>node.scrollWidth<=window.innerWidth)).toBeTruthy();
    await page.screenshot({path:info.outputPath('original-workspace-mobile.png'),fullPage:true});
  });
  test('failed lookup and cancelled record selection retain other orders; missing orders can be skipped',async({page})=>{
    await page.route('**/api/order-documents/orders/lookup',async route=>{
      if(route.request().postDataJSON().sales_order_number==='99999')return route.fulfill({status:404,json:{detail:'Order not found'}});
      await route.continue();
    });
    await start(page,'70801,70803,99999');await page.evaluate(()=>updateReviewedOrder('po_number','RETAIN-ME'));
    await page.getByRole('button',{name:'Next order',exact:true}).click();
    const picker=page.locator('#operations-order-instance-picker');await expect(picker).toBeVisible();
    await picker.getByRole('button',{name:'Keep Current Work',exact:true}).click();
    await expect(page.locator('#operations-order-number')).toHaveText('70801');
    await page.getByRole('combobox',{name:'Current sales order',exact:true}).selectOption('2');
    await expect(page.locator('.operations-order-load-error')).toContainText('Order not found');
    await page.getByRole('checkbox',{name:'Skip current order',exact:true}).check();
    await page.getByRole('combobox',{name:'Current sales order',exact:true}).selectOption('0');
    expect(await page.evaluate(()=>orderDocumentsState.reviewedOrder.fields.po_number)).toBe('RETAIN-ME');
    await page.getByRole('button',{name:'Download approved orders ZIP',exact:true}).click();
    await expect(page.locator('#operations-status-bar')).toContainText('Review and approve');
  });
  test('customer label previews and approvals stay with their original order',async({page})=>{
    test.setTimeout(90000);await start(page,'70801,70804');
    for(const [index,number] of [[0,'70801'],[1,'70804']]){
      if(index){await page.getByRole('button',{name:'Next order',exact:true}).click();await chooseRecord(page,number);}
      await page.evaluate(number=>updateReviewedOrder('po_number','PO-'+number),number);
      await page.locator('#operations-generate-mpl').uncheck();await page.locator('#operations-generate-pallets').uncheck();
      await page.locator('#btn-generate-operations-documents').click();await continueLabelReadiness(page);
      await expect(page.locator('#preview-panel')).toBeVisible({timeout:25000});
      await page.locator('#btn-approve-preview-labels').click();await expect(page.locator('#preview-panel')).toBeHidden();
    }
    await page.getByRole('button',{name:'Previous order',exact:true}).click();
    await expect(page.locator('#operations-order-number')).toHaveText('70801');
    await expect(page.locator('#operations-label-tab-state')).toHaveText('Approved');
    expect(await page.evaluate(()=>getGeneratedOutputs('operations').find(([key])=>key==='operations-labels')[1].pages)).toBe(26);
    await page.getByRole('button',{name:'Next order',exact:true}).click();
    await expect(page.locator('#operations-label-tab-state')).toHaveText('Approved');
    expect(await page.evaluate(()=>getGeneratedOutputs('operations').find(([key])=>key==='operations-labels')[1].pages)).toBe(2);
  });
});

async function openOperations(page) {
  await page.goto('/#operations');
  await expect(page.getByRole('heading', { name: 'Order Documents' })).toBeVisible();
}

async function continueLabelReadiness(page) {
  const modal = page.locator('#workflow-readiness-modal');
  await Promise.race([modal.waitFor({ state: 'visible' }), page.waitForURL(/operations\/preview/)]);
  if (await modal.isVisible()) await modal.getByRole('button', { name: 'Generate with warnings' }).click();
}

async function loadOrder(page, orderNumber) {
  await page.locator('#operations-sales-order-number').fill(orderNumber);
  const replacing=await page.evaluate(number=>!!(orderDocumentsState.payload || orderDocumentsState.customMode || orderDocumentsState.mplDraft) && workspaceOrders.entries.map(entry=>entry.number).join(',')!==number,orderNumber);
  if(replacing)page.once('dialog',dialog=>dialog.accept());
  await page.locator('#btn-load-operations-order').click();
  const picker = page.locator('#operations-order-instance-picker');
  await page.waitForFunction(value => {
    const dialog = document.getElementById('operations-order-instance-picker');
    const loadedOrder = document.getElementById('operations-order-number')?.textContent?.trim();
    return !dialog?.classList.contains('hidden') || loadedOrder === value;
  }, orderNumber, { timeout: 20000 });
  if (await picker.isVisible()) {
    const recommended = picker.locator('.mpl-order-instance-checkbox').first();
    if (!(await recommended.isChecked())) await recommended.check();
    await picker.getByRole('button', { name: 'Load Selected Order' }).click();
    await expect(picker).toBeHidden({ timeout: 25000 });
  }
  await expect(page.locator('#operations-order-number')).toHaveText(orderNumber, { timeout: 15000 });
}

async function setUpManualLabel(page) {
  await page.getByRole('button', { name: 'Create Label Without an Order' }).click();
  await expect(page.locator('#operations-order-card')).toBeHidden();
  await expect(page.locator('#operations-sales-order-number')).not.toHaveAttribute('required', '');
  await expect(page.locator('#btn-generate-operations-documents')).toBeDisabled();
  await expect(page.locator('#b2b-template-gallery')).toBeVisible();
  await page.getByRole('checkbox', { name: /DecoPac Combined A\/B Case Label/ }).check();
  await page.waitForFunction(() => document.querySelectorAll('#b2b-product-select option').length > 1);
  const product = await page.locator('#b2b-product-select option').nth(1).getAttribute('value');
  await page.selectOption('#b2b-product-select', product);
  await expect(page.locator('#b2b-level-select')).not.toHaveValue('');
  await expect(page.locator('#b2b-sku-template-list .b2b-sku-row')).toHaveCount(1);
}

test('an unmatched Fancy order retains its buyer, exposes unassigned demand and does not invent a PO', async ({ page }) => {
  await page.route('**/api/order-documents/orders/lookup', route => route.fulfill({ json: {
    sales_order_number: '72638', source: { ecomdash_id: '103853499' },
    detected_customer: { name: 'Fancy Sprinkles', source: 'email', confidence: 'exact' },
    detected_partner_customer: 'fancy',
    order_details: { email_id: 'orders@fancysprinkles.com', order_notes: 'Reference FS PO # PO1917' },
    items: [{ sku: 'CMB109-1LB', description: 'Candy Mini Bits', quantity_ordered: 650, match_status: 'unmatched' }],
    summary: { unmatched_products: 1, matched_products: 0 },
  } }));
  await openOperations(page);
  await loadOrder(page, '72638');
  await expect(page.locator('#operations-customer')).toHaveText('Fancy Sprinkles');
  await expect(page.locator('#b2b-order-customer-select')).toHaveValue('Fancy Sprinkles');
  await page.getByRole('button', { name: /^Packing List & Ti-Hi .*Approval required/ }).click();
  await page.getByRole('button', { name: 'Review & Edit Packing List', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unassigned order lines' })).toBeVisible();
  await expect(page.locator('#document-editor-panel')).toContainText('CMB109-1LB');
  await expect(page.locator('#document-editor-panel')).toContainText('Confirm customer PO from order notes: PO1917');
  await expect(page.locator('[data-draft-path="packing_lists.0.customer_po_number"]')).toHaveValue('');
  await page.evaluate(() => closeDocumentEditor());
  const writes = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/api\/mpl\/(product-master|directory)/.test(request.url())) writes.push(request.url());
  });
  await page.getByRole('button', { name: 'Set up for this order', exact: true }).first().click();
  const packing = page.locator('#operations-packing-modal');
  await expect(packing).toBeVisible();
  await expect(packing).toContainText('Product Master registration is optional');
  await page.locator('#operations-packing-value').fill('25');
  await packing.getByRole('button', { name: 'Next: box size' }).click();
  for (const [field, value] of Object.entries({ length: '16', width: '12', height: '10', gross: '26' })) await page.locator(`#operations-packing-${field}`).fill(value);
  await packing.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(packing).toBeHidden();
  await expect(page.locator('#workflow-progress-modal')).toBeHidden();
  const result = await page.evaluate(() => ({
    rows: orderDocumentsState.mplDraft.packing_lists.flatMap(mpl => mpl.items),
    source: orderDocumentsState.payload.items[0],
    jobs: b2bOrderLabelJobs.filter(job => job.order_packaging),
    warnings: orderDocumentsState.mplDraft.packing_lists.flatMap(mpl => mpl.warnings || []),
  }));
  expect(result.rows.reduce((sum, row) => sum + Number(row.qty_on_pallet), 0)).toBe(26);
  expect(result.rows.every(row => !!row.location_on_pallet)).toBe(true);
  expect(result.jobs.length).toBeGreaterThan(0);
  expect(result.source.match_status).toBe('unmatched');
  expect(result.source.quantity_ordered).toBe(650);
  expect(result.warnings.some(warning => warning.includes('missing checked Case'))).toBe(false);
  expect(writes).toEqual([]);

});

test('order loading identifies the pallet planning stage and completes after its response', async ({ page }) => {
  let releasePlan, planStarted;
  const gate = new Promise(resolve => { releasePlan = resolve; });
  const started = new Promise(resolve => { planStarted = resolve; });
  await page.route('**/api/documents/pallet-plan', async route => {
    planStarted();
    await gate;
    await route.continue();
  });
  await openOperations(page);
  const loading = loadOrder(page, '38800');
  try {
    await started;
    await expect(page.locator('#workflow-progress-list .active strong')).toHaveText('Planning pallets');
    await expect(page.locator('#workflow-progress-message')).toContainText('Ti-Hi');
  } finally {
    releasePlan();
  }
  await loading;
  await expect(page.locator('#btn-load-operations-order')).toBeEnabled();
});

test('optional box customization preserves the source and shares partial boxes with labels and pallets', async ({ page }) => {
  let failCustom = false;
  let releaseReprocessing;
  const reprocessingGate = new Promise(resolve => { releaseReprocessing = resolve; });
  await page.route('**/api/order-documents/orders/lookup', route => route.fulfill({ json: {
    sales_order_number: '72638', source: { ecomdash_id: '144540224' }, summary: { matched_products: 1 },
    order_details: { email_id: 'orders@fancysprinkles.com', storefront: 'BAKELL.COM' },
    items: [{ sku: 'CMB109-1LB', description: 'Candy Mini Bits - Bubblegum (1LB)', quantity_ordered: 650,
      quantity_ordered_eaches: 650, quantity_uom: 'EACHES', match_status: 'matched',
      packaging_summary: [
        { packaging_level: 'Each', sku: 'CMB109-1LB', eaches_per_unit: 1, label_enabled: true },
        { packaging_level: 'Inner Pack', sku: 'CMB-INNER', eaches_per_unit: 5, label_enabled: true },
        { packaging_level: 'Case', sku: 'CMB109-1LB', eaches_per_unit: 1, label_enabled: true },
      ], product: {
        sku: 'CMB109-1LB', description: 'Candy Mini Bits - Bubblegum (1LB)', storefront: 'Fancy Sprinkles', config_id: 'TEST-CMB',
        packaging_level: 'Case', case_qty: '1', length_in: '8', width_in: '5', height_in: '5', gross_weight_lbs: '1',
        label_enabled: true, in_packing_list: true, is_active: true,
      } }],
  } }));
  // The unchanged initial default is covered elsewhere; exercise the real server
  // geometry only for the user-customized boxes in this scenario.
  await page.route('**/api/documents/pallet-plan', async route => {
    const { mpl } = route.request().postDataJSON();
    if (mpl.items.some(item => item.order_packaging)) {
      if (failCustom) return route.fulfill({ status: 503, json: { detail: 'Pallet calculation unavailable' } });
      await reprocessingGate;
      return route.continue();
    }
    return route.fulfill({ json: { mpl: { ...mpl, _pallet_ids: ['1'], _pallet_weights: {}, _pallet_dimensions: {}, _pallet_tihi: {}, total_pallets: '1' }, entries: [], warnings: [], constraints: {}, signature: 'initial' } });
  });
  await openOperations(page);
  await loadOrder(page, '72638');
  const state = () => page.evaluate(() => ({
    source: orderDocumentsState.payload.items[0].quantity_ordered_eaches,
    boxes: orderDocumentsState.mplDraft.packing_lists.flatMap(mpl => mpl.items).reduce((sum, item) => sum + Number(item.qty_on_pallet), 0),
    rows: orderDocumentsState.mplDraft.packing_lists.flatMap(mpl => mpl.items),
    jobs: b2bOrderLabelJobs.filter(job => job.order_packaging),
    otherJobs: b2bOrderLabelJobs.filter(job => !job.order_packaging && job.product.packaging_level !== 'Pallet'),
  }));
  expect((await state()).boxes).toBe(650);
  await expect(page.getByRole('checkbox', { name: 'Customize packing', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Customize packing', exact: true }).click();
  const dialog = page.locator('#operations-packing-modal');
  await expect(page.locator('#operations-packing-value')).toHaveValue('');
  await page.locator('#operations-packing-value').fill('30');
  await expect(page.locator('#operations-packing-summary')).toContainText('21 box(es)');
  await dialog.getByRole('button', { name: 'Next: box size' }).click();
  for (const [field, value] of Object.entries({ length: '20', width: '16', height: '10', gross: '31' })) await page.locator(`#operations-packing-${field}`).fill(value);
  await page.screenshot({ path: test.info().outputPath('box-setup.png') });
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#workflow-progress-message')).toContainText('Reprocessing order');
  expect((await state()).boxes).toBe(650);
  releaseReprocessing();
  await expect(page.locator('#workflow-progress-modal')).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'Customize packing', exact: true })).toBeChecked();
  const packed = await state();
  expect(packed.source).toBe(650);
  expect(packed.boxes).toBe(22);
  expect(packed.rows.reduce((sum, item) => sum + Number(item.qty_on_pallet) * Number(item.quantity_per_case), 0)).toBe(650);
  expect(packed.rows.every(item => item.length_in === '20' && item.width_in === '16' && item.height_in === '10')).toBe(true);
  expect(packed.jobs.map(job => [job.run.carton_start, job.run.carton_end, job.run.carton_total, job.run.net_weight])).toEqual([
    ['1', '21', '22', '30 lb'], ['22', '22', '22', '20 lb'],
  ]);
  expect(packed.otherJobs.map(job => [job.product.packaging_level, job.run.carton_total])).toEqual([['Each', '650'], ['Inner Pack', '130']]);
  await page.getByRole('checkbox', { name: 'Customize packing', exact: true }).click();
  await expect(page.locator('#operations-packing-value')).toHaveValue('30');
  await page.locator('#operations-packing-mode').selectOption('boxes');
  await page.locator('#operations-packing-value').fill('26');
  await expect(page.locator('#operations-packing-summary')).toHaveText('26 box(es) × 25 lb');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Customize packing', exact: true })).toBeChecked();
  expect((await state()).boxes).toBe(22);
  failCustom = true;
  await page.getByRole('checkbox', { name: 'Customize packing', exact: true }).click();
  await page.locator('#operations-packing-value').fill('25');
  await dialog.getByRole('button', { name: 'Next: box size' }).click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('#operations-packing-error')).toContainText('Pallet calculation unavailable');
  expect((await state()).boxes).toBe(22);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('Custom Labels resets order state, selects multiple templates, and reports readiness', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Label Without an Order' }).click();
  await page.selectOption('#b2b-template-gallery-customer', 'Fancy Sprinkles');
  const fancyChecks = page.locator('#b2b-template-gallery-grid input[type="checkbox"]');
  await expect(fancyChecks).toHaveCount(5);
  await fancyChecks.nth(0).check();
  await fancyChecks.nth(1).check();
  await expect(page.locator('#b2b-template-gallery-grid input:checked')).toHaveCount(2);
  await expect(page.locator('#b2b-template-gallery-count')).toContainText('2 selected');
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await page.locator('#btn-operations-review-continue').click();
  await page.getByRole('button', { name: 'Create Label Without an Order' }).click();
  await expect(page.locator('#b2b-template-gallery-grid input:checked')).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate With Order Number' }).click();
  await expect(page.locator('#operations-order-card')).toBeVisible();
  await expect(page.locator('#operations-sales-order-number')).toBeFocused();
  await expect(page).toHaveURL(/#operations$/);
  expect(errors).toEqual([]);
});

test('Generic label layouts remain selectable across customer filters', async ({ page }) => {
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Label Without an Order' }).click();
  for (const customer of ['DecoPac', 'Dutch Bros', 'Fancy Sprinkles']) {
    await page.selectOption('#b2b-template-gallery-customer', customer);
    await expect(page.getByRole('checkbox', { name: /GENERIC_1/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Generic_2barcode/ })).toBeVisible();
  }
  await page.getByRole('checkbox', { name: /GENERIC_1/ }).check();
  await page.getByRole('checkbox', { name: /Generic_2barcode/ }).check();
  await expect(page.locator('#b2b-template-gallery-grid input:checked')).toHaveCount(2);
});

test('Pallet labels use an editable manual count when packing list output is excluded', async ({ page }) => {
  await openOperations(page);
  await loadOrder(page, '38800');
  await page.locator('#operations-generate-labels').uncheck();
  await page.locator('#operations-generate-mpl').uncheck();
  await expect(page.locator('#operations-manual-pallets')).toBeVisible();
  await expect(page.locator('#operations-manual-pallet-count')).toHaveValue('1');
  await expect(page.locator('#operations-manual-pallet-copies')).toHaveValue('1');
  await page.locator('#operations-manual-pallet-count').fill('3');
  await page.locator('#operations-manual-pallet-copies').fill('2');
  await expect(page.locator('#operations-pallet-tab-state')).toContainText('3 pallet(s)');
  await page.locator('[data-operations-tab="pallets"]').click();
  await page.getByRole('button', { name: 'Review & Edit Pallet Labels', exact: true }).click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await expect(page.locator('[data-pallet-label-index]')).toHaveCount(3);
  await expect(page.locator('[data-draft-path="pallets.0.copies"]')).toHaveValue('2');
  await page.locator('#btn-operations-review-continue').click();
  await expect(page).toHaveURL(/operations\/pallets/);
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('View Finished Files');
});

test('Custom Packing List opens its editor and exposes pallet review only when available', async ({ page }) => {
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await expect(page.locator('#operations-sales-order-number')).not.toHaveAttribute('required', '');
  await expect(page.locator('#btn-operations-review-top')).toHaveText('Approve Packing List & Ti-Hi');
  await expect(page.locator('#btn-operations-review-top')).toHaveCSS('background-color', 'rgb(33, 79, 75)');
  await page.locator('#btn-operations-review-back').click();
  await expect(page).toHaveURL(/operations\/packing/);
  await expect(page.locator('.operations-file-row')).toHaveCount(0);
  await expect(page.locator('#operations-mpl-tab-state')).toContainText('Approval required');
  await page.getByRole('button', { name: 'Review & Edit Packing List', exact: true }).click();
  await page.locator('#btn-operations-review-continue').click();
  await expect(page).toHaveURL(/operations\/packing/);
  await expect(page.locator('.operations-file-row')).toHaveCount(1);
  await expect(page.locator('#operations-mpl-review-state')).not.toHaveText('Not created');
  const pallets = page.locator('[data-operations-tab="pallets"]');
  await expect(pallets).toBeEnabled();
  await pallets.click();
  await page.getByRole('button', { name: 'Review & Edit Pallet Labels', exact: true }).click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await expect(page.getByText('Pallet Placard Groups')).toBeVisible();
  await page.locator('#btn-operations-review-continue').click();
  await expect(page).toHaveURL(/operations\/pallets/);
  await expect(page.locator('.operations-file-row')).toHaveCount(2);
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('View Finished Files');
});

test('Packing-list total follows pallet weight edits and sums multiple pallets', async ({ page }) => {
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  const total = page.locator('[data-draft-path="packing_lists.0.total_weight"]');
  await expect(total).toHaveAttribute('readonly', '');
  await page.locator('[data-pallet-id="1"] .mpl-pallet-weight-edit input').fill('2,200 lbs');
  await expect(total).toHaveValue('2200 lbs');
  await page.getByRole('button', { name: 'Add Pallet', exact: true }).click();
  await expect(total).toHaveValue('');
  await page.locator('[data-pallet-id="2"] .mpl-pallet-weight-edit input').fill('1100.5 lbs');
  await expect(total).toHaveValue('3300.5 lbs');
  await page.locator('[data-pallet-id="1"] .mpl-pallet-weight-edit input').fill('2100 lbs');
  await expect(total).toHaveValue('3200.5 lbs');
  await page.locator('#btn-operations-review-back').click();
  await page.getByRole('button', { name: 'Review & Edit Packing List', exact: true }).click();
  await expect(total).toHaveValue('3200.5 lbs');
});

test('Ti-Hi settings expose optional overrides and a six-inch pallet base', async ({ page }) => {
  let releaseCatalog;
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
  await page.route('**/api/mpl/product-master', async route => {
    if (route.request().method() === 'GET') await catalogGate;
    await route.continue();
  });
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  releaseCatalog();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await page.getByRole('button', { name: 'Ti-Hi Settings', exact: true }).click();
  const ti = page.getByRole('spinbutton', { name: 'Cases per layer (Ti)', exact: true });
  const hi = page.getByRole('spinbutton', { name: 'Maximum layers (Hi)', exact: true });
  const base = page.getByRole('spinbutton', { name: 'Pallet base height (in)', exact: true });
  await expect(ti).toHaveValue('');
  await expect(hi).toHaveValue('');
  await expect(base).toHaveValue('6');
  await ti.fill('36');
  await ti.press('Tab');
  await expect(ti).toHaveValue('36');
  await page.getByRole('button', { name: 'Restore default limits', exact: true }).click();
  await expect(ti).toHaveValue('');
  await expect(base).toHaveValue('6');
});

test('Partner packing list keeps Balance Owed column and a Total Weight footer', async ({ page }) => {
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  await page.getByRole('radio', { name: 'Dutch Bros', exact: true }).click();
  await expect(page.locator('.decopac-table thead input[value="Balance Owed"]')).toHaveCount(1);
  await expect(page.locator('[data-order-balance="0"]')).toHaveText('0');
  await page.getByRole('button', { name: 'Add Pallet', exact: true }).click();
  const summary = page.locator('.decopac-summary-table');
  await expect(summary.locator('thead')).not.toContainText('Total Weight');
  await expect(summary.locator('tbody tr')).toHaveCount(2);
  await expect(summary.locator('tfoot tr')).toHaveCount(1);
  await expect(summary.locator('tfoot')).toContainText('Total Weight');
});

test('Order label rows support multiple templates and Previous/Next navigation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openOperations(page);
  await loadOrder(page, '38800');
  await loadOrder(page, '63494');
  const rows = page.locator('#b2b-sku-template-list .b2b-sku-row');
  await expect(rows).toHaveCount(9);
  const row = rows.nth(1);
  await row.locator('summary').click();
  const checkbox = row.locator('input[type="checkbox"]').first();
  if (!(await checkbox.isChecked())) await checkbox.check();
  await expect(page.locator('#b2b-label-next')).toBeEnabled();
  const first = await page.locator('#b2b-label-editor-title').innerText();
  await page.locator('#b2b-label-next').click();
  const second = await page.locator('#b2b-label-editor-title').innerText();
  await expect(page.locator('#b2b-label-previous')).toBeEnabled();
  await page.locator('#b2b-label-previous').click();
  await expect(page.locator('#b2b-label-editor-title')).toHaveText(first);
  expect(second).not.toBe(first);
  expect(errors).toEqual([]);
});

test('Pallet count is resolved from the reviewed packing list before pallet preview', async ({ page }) => {
  await openOperations(page);
  await loadOrder(page, '63494');
  await page.locator('#operations-generate-labels').uncheck();
  await page.locator('#operations-generate-pallets').check();
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Continue to Packing List Review');
  await page.locator('#btn-generate-operations-documents').click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await page.getByRole('button', { name: 'Add Pallet' }).click();
  await page.locator('#btn-operations-review-continue').click();
  await expect(page).toHaveURL(/operations\/packing/);
  await expect(page.locator('#operations-pallet-count')).not.toHaveText('0');
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Continue to Pallet Label Review');
  await page.locator('#btn-generate-operations-documents').click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await expect(page.getByText('Pallet Placard Groups')).toBeVisible();
  await page.locator('#btn-operations-review-continue').click();
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('View Finished Files');
  await expect(page.locator('#btn-generate-operations-documents')).toBeEnabled();
});

test('Custom label generation appears in Finished Files and opens its PDF preview', async ({ page }) => {
  await openOperations(page);
  await setUpManualLabel(page);
  await expect(page.locator('#btn-approve-operations-labels')).toBeDisabled();
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Continue to Label Preview');
  await page.locator('#btn-generate-operations-documents').click();
  const readiness = page.locator('#workflow-readiness-modal');
  await continueLabelReadiness(page);
  await expect(page).toHaveURL(/operations\/preview/);
  await expect(page.getByRole('link', { name: 'Save PDF' })).toBeVisible();
  await expect(page.locator('#btn-approve-preview-labels')).toBeVisible();
  await page.locator('#preview-panel .btn-close-preview').click();
  await expect(page).toHaveURL(/operations\/labels/);
  await expect(page.locator('.operations-file-row')).toHaveCount(0);
  await expect(page.locator('#operations-label-tab-state')).toHaveText('Approval required');
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Approve Labels');
  await page.locator('#btn-approve-operations-labels').click();
  await expect(page.locator('.operations-file-row')).toHaveCount(1);
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('View Finished Files');
  await page.locator('[data-b2b-run-field="copies"]').fill('2');
  await expect(page.locator('#btn-approve-operations-labels')).toBeDisabled();
  await expect(page.locator('.operations-file-row')).toHaveCount(0);
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Continue to Label Preview');
  await page.locator('#btn-generate-operations-documents').click();
  await continueLabelReadiness(page);
  await expect(page).toHaveURL(/operations\/preview/);
  await page.locator('#btn-approve-preview-labels').click();
  await expect(page).toHaveURL(/operations\/labels/);
  await expect(page.locator('#operations-label-tab-state')).toHaveText('Approved');
  await page.locator('#btn-generate-operations-documents').click();
  const finalReadiness = page.locator('#workflow-readiness-modal');
  if (await finalReadiness.isVisible()) await finalReadiness.getByRole('button', { name: 'Generate with warnings' }).click();
  await expect(page.locator('.operations-file-row')).toHaveCount(1, { timeout: 20000 });
  const summary = page.locator('#workflow-print-summary-modal');
  if (await summary.isVisible()) await summary.getByRole('button', { name: 'Close' }).last().click();
  await page.locator('.operations-file-row').getByRole('button', { name: 'Open PDF' }).click();
  await expect(page).toHaveURL(/operations\/preview/);
  await expect(page.getByRole('link', { name: 'Save PDF' })).toBeVisible();
});

test('A failed packing-list render does not approve or publish a file', async ({ page }) => {
  await page.route('**/render/kehe/master-packing-list', route => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Test render failure' }),
  }));
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  await page.locator('#btn-operations-review-top').click();
  await expect(page.getByText('Error: Test render failure', { exact: true })).toBeVisible();
  await expect(page.locator('.operations-file-row')).toHaveCount(0);
  await expect(page.locator('#btn-operations-review-top')).toBeEnabled();
  await page.locator('#btn-operations-review-back').click();
  await expect(page.locator('#operations-mpl-tab-state')).toContainText('Approval required');
});

test('Operations remains within responsive viewport widths', async ({ page }) => {
  await openOperations(page);
  for (const width of [1920, 1366, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      navigationHeight: document.querySelector('body > header').getBoundingClientRect().height,
      heroHeight: document.querySelector('.operations-hero').getBoundingClientRect().height,
    }));
    expect(layout.overflow, `horizontal overflow at ${width}px`).toBe(false);
    expect(layout.navigationHeight).toBe(62);
    expect(layout.heroHeight).toBeGreaterThan(layout.navigationHeight);
  }
});

test('Legacy workflow hashes redirect into the matching Order Documents tab', async ({ page }) => {
  const redirects = [
    ['mpl', 'operations/packing'],
    ['b2b', 'operations/labels'],
    ['partners', 'operations/labels'],
  ];
  for (const [legacy, canonical] of redirects) {
    await page.goto(`/#${legacy}`);
    await expect(page).toHaveURL(new RegExp(`#${canonical}$`));
    await expect(page.locator('#operations-workspace-page')).toBeVisible();
  }
  await expect(page.locator('#operations-labels-mount > .b2b-creator-layout')).toHaveCount(1);
  await expect(page.locator('#mpl-workspace-page, #b2b-workspace-page, #partner-workspace-page')).toHaveCount(0);
});

for (const switchDraft of [false, true]) {
  test(`A delayed save preserves ${switchDraft ? 'a different active draft' : 'newer unsaved edits'}`, async ({ page, request }) => {
    await openOperations(page);
    await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
    await expect(page).toHaveURL(/operations\/document-editor/);
    let received, release;
    const arrived = new Promise(resolve => { received = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/kehe/mpl-drafts', async route => {
      received(); await gate; await route.continue();
    });
    await page.evaluate(() => {
      ensureMplDraftSync();
      activeKeheDocumentDraft.packing_lists[0].ship_to = 'Original destination';
      window.originalSavingDraft = activeKeheDocumentDraft;
      window.delayedSave = saveActiveMplDraft({ showStatus: false });
    });
    await arrived;
    await page.evaluate(changeDraft => {
      if (changeDraft) {
        window.queuedSave = saveActiveMplDraft({ showStatus: false });
        activeKeheDocumentDraft = JSON.parse(JSON.stringify(activeKeheDocumentDraft));
        mplDraftSync.discard();
      }
      activeKeheDocumentDraft.packing_lists[0].ship_to = 'Later destination';
      activeKeheDocumentDraft._saved_draft_name = 'Later name';
      mplDraftSync.schedule();
    }, switchDraft);
    release();
    expect(await page.evaluate(() => window.delayedSave)).toBe(true);
    const result = await page.evaluate(() => ({
      savedId: window.originalSavingDraft._saved_draft_id,
      activeId: activeKeheDocumentDraft._saved_draft_id,
      dirty: mplDraftSync.hasUnsavedChanges(),
      address: activeKeheDocumentDraft.packing_lists[0].ship_to,
      name: activeKeheDocumentDraft._saved_draft_name,
    }));
    expect(result.dirty).toBe(true);
    expect(result.address).toBe('Later destination');
    expect(result.name).toBe('Later name');
    if (switchDraft) {
      expect(result.activeId).toBeUndefined();
      expect(await page.evaluate(() => window.queuedSave)).toBe(false);
    }
    const persisted = await (await request.get(`/api/kehe/mpl-drafts/${result.savedId}`)).json();
    expect(persisted.draft.draft.packing_lists[0].ship_to).toBe('Original destination');
    await request.delete(`/api/kehe/mpl-drafts/${result.savedId}`);
  });
}

test('Directory reports failed server saves while keeping edits open', async ({ page }) => {
  await openOperations(page);
  await page.evaluate(() => loadMplDirectoryFromBackend());
  await page.route('**/api/mpl/directory', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Injected save failure' }) })
    : route.continue());
  await page.evaluate(() => saveMplDirectoryToBackend());
  await expect(page.locator('#operations-status-bar')).toContainText('Directory was not saved to the server: Injected save failure');
  await expect(page.locator('#operations-status-bar')).toHaveClass(/error/);
});

test('Undo and redo preserve saved draft identity and the latest revision', async ({ page, request }) => {
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  await page.locator('[data-draft-path="packing_lists.0.ship_to"]').fill('Edited destination');
  const saved = await page.evaluate(async () => {
    if (!(await saveActiveMplDraft({ showStatus: false }))) throw new Error('Initial save failed');
    return { id: activeKeheDocumentDraft._saved_draft_id, revision: activeKeheDocumentDraft._saved_draft_revision };
  });
  try {
    await page.locator('#btn-mpl-undo').click();
    expect(await page.evaluate(() => activeKeheDocumentDraft._saved_draft_id)).toBe(saved.id);
    expect(await page.evaluate(() => activeKeheDocumentDraft._saved_draft_revision)).toBe(saved.revision);
    expect(await page.evaluate(() => saveActiveMplDraft({ showStatus: false }))).toBe(true);
    await page.locator('#btn-mpl-redo').click();
    expect(await page.evaluate(() => activeKeheDocumentDraft._saved_draft_id)).toBe(saved.id);
    expect(await page.evaluate(() => activeKeheDocumentDraft._saved_draft_revision)).toBe(saved.revision + 1);
    expect(await page.evaluate(() => saveActiveMplDraft({ showStatus: false }))).toBe(true);
  } finally { await request.delete(`/api/kehe/mpl-drafts/${saved.id}`); }
});

test('Editing during packing-list rendering prevents approval of the older PDF', async ({ page }) => {
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  let release, received;
  const gate = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { received = resolve; });
  await page.route('**/render/kehe/master-packing-list', async route => {
    received(); await gate; await route.continue();
  });
  await page.evaluate(() => { window.pendingApproval = finishOperationsDocumentReview(); });
  await arrived;
  expect(await page.evaluate(() => mplDraftSync.flush())).toBe(false);
  await page.locator('[data-draft-path="packing_lists.0.ship_to"]').fill('Changed during rendering');
  release();
  await page.evaluate(() => window.pendingApproval);
  expect(await page.evaluate(() => orderDocumentsState.reviewedDocuments.mpl)).toBe(false);
  await expect(page.locator('.operations-file-row')).toHaveCount(0);
  await expect(page.locator('#btn-operations-review-top')).toBeVisible();
});

test('Changing label settings during rendering discards the older preview', async ({ page }) => {
  await openOperations(page);
  await setUpManualLabel(page);
  let release, received;
  const gate = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { received = resolve; });
  await page.route('**/api/b2b/render*', async route => {
    received(); await gate; await route.continue();
  });
  await page.evaluate(() => { window.pendingLabels = generateB2BPreview(false, {
    skipReadiness: true, showSummary: false, scope: 'operations-review', outputKey: 'operations-labels-review',
  }); });
  await arrived;
  await page.locator('[data-b2b-run-field="copies"]').fill('2');
  release();
  expect(await page.evaluate(() => window.pendingLabels)).toBe(false);
  expect(await page.evaluate(() => getGeneratedOutputs('operations-review').length)).toBe(0);
});

test('KeHE pack-label edits invalidate an in-progress PDF', async ({ page }) => {
  await page.goto('/#kehe');
  await page.evaluate(() => {
    activeKeheDocumentType = 'packLabels';
    activeKeheDocumentDraft = { pack_labels: [{ gtin: '10850079841588', description: 'Original label', copies: '1', case_qty: '12' }] };
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    openDocumentEditor();
  });
  let release, received;
  const gate = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { received = resolve; });
  await page.route('**/render/kehe/pack-labels', async route => { received(); await gate; await route.continue(); });
  await page.evaluate(() => { window.pendingPack = renderEditedKeheDocument({
    skipReadiness: true, keepEditorOpen: true, openPreview: false, showSummary: false,
  }); });
  await arrived;
  await page.locator('[data-draft-path="pack_labels.0.description"]').fill('Updated label');
  release();
  expect(await page.evaluate(() => window.pendingPack)).toBe(false);
  expect(await page.evaluate(() => getGeneratedOutputs('kehe').length)).toBe(0);
});

test('shared reviewed PO and address edits feed labels and pallet labels and revoke approvals', async ({ page }) => {
  await openOperations(page);
  await loadOrder(page, '38800');
  await page.locator('[data-operations-tab="packing"]').click();
  await page.locator('#operations-review-mpl').click();
  const po = page.locator('[data-draft-path="packing_lists.0.customer_po_number"]');
  await expect(po).toBeVisible();
  await page.evaluate(() => { orderDocumentsState.reviewedDocuments = { labels: true, mpl: true, pallets: true }; });
  await po.fill('029902');
  const address = 'Shanna Stephens\nMcDonalds Wholesale\n7531 Metro Air Pkwy\nSuite 200\nSacramento CA 95837\nUnited States';
  await page.locator('[data-draft-path="packing_lists.0.ship_to"]').fill(address);
  const result = await page.evaluate(() => ({
    order: reviewedOrderSnapshot(), run: b2bRunFields.po_number,
    pallet: buildOperationsManualPalletDraft().pallets[0], reviewed: orderDocumentsState.reviewedDocuments,
    addresses: b2bOrderLabelJobs.map(job => job.directory.delivery_address),
  }));
  expect(result.order.fields.po_number).toBe('029902');
  expect(result.run).toBe('029902');
  expect(result.pallet.customer_po_numbers).toBe('029902');
  expect(result.pallet.ship_to).toBe(address);
  expect(result.addresses.every(value => value === address)).toBe(true);
  expect(result.reviewed).toEqual({ labels: false, mpl: false, pallets: false });
});

test('Ti-Hi controls persist edited limits and Recalculate uses them for real allocation', async ({ page }) => {
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await page.evaluate(() => {
    const product = { sku: 'CONTROL-CASE', config_id: 'CONTROL', storefront: 'Generic B2B', packaging_level: 'Case',
      case_qty: '1', length_in: '12', width_in: '10', height_in: '5', gross_weight_lbs: '1', in_packing_list: true, is_active: true };
    activeKeheDocumentDraft.reviewed_product_master = [product];
    activeKeheDocumentDraft.product_master = [product];
    const mpl = activeKeheDocumentDraft.packing_lists[0];
    mpl.items = [{ ...product, location_on_pallet: '1', qty_on_pallet: '9', total_ordered: '9', total_shipped: '9', unit_weight_lbs: '1' }];
    mpl._tihi_constraints = defaultTiHiConstraints();
    mpl._tihi_pallet_constraints = {};
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  });
  await page.getByRole('button', { name: 'Ti-Hi Settings', exact: true }).click();
  const ti = page.getByRole('spinbutton', { name: 'Cases per layer (Ti)', exact: true });
  const hi = page.getByRole('spinbutton', { name: 'Maximum layers (Hi)', exact: true });
  await ti.fill('4'); await ti.press('Tab');
  await hi.fill('2'); await hi.press('Tab');
  const planResponse = () => page.waitForResponse(response => response.url().endsWith('/api/documents/pallet-plan') && response.request().postDataJSON()?.action === 'auto');
  const first = planResponse();
  await page.getByRole('button', { name: 'Recalculate', exact: true }).click();
  const split = await (await first).json();
  expect(split.mpl._pallet_ids).toHaveLength(2);
  expect(split.entries[0].ti).toBe(4);
  expect(split.entries[0].hi).toBe(2);
  await expect(ti).toHaveValue('4');
  await ti.fill(''); await ti.press('Tab');
  const second = planResponse();
  await page.getByRole('button', { name: 'Recalculate', exact: true }).click();
  const combined = await (await second).json();
  expect(combined.mpl._pallet_ids).toHaveLength(1);
  expect(combined.entries[0].hi).toBe(1);
  expect(combined.mpl.items.reduce((sum, item) => sum + Number(item.qty_on_pallet), 0)).toBe(9);
});
