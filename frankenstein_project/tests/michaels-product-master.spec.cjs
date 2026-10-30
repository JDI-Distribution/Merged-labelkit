const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

// This integration test edits the catalog. Run only against a local server
// whose MPL_PRODUCT_MASTER_FILE and AUDIT_LOG_FILE point to temporary files.
test.skip(process.env.LABELKIT_ISOLATED_SANITY !== '1', 'Requires an isolated local catalog.');
let originalRows;

test('missing order SKU can be created inline, cancelled, retried, and rematched without losing other order edits', async ({ page, request }) => {
  test.skip(process.env.LABELKIT_INLINE_SKU_SANITY !== '1', 'Requires the isolated inline order fixture.');
  const sku = 'CMB109-1LB';
  let rejectSave = true, rejectPlan = true;
  await page.route('**/api/mpl/product-master', async route => {
    if (route.request().method() === 'PUT' && rejectSave && route.request().postDataJSON().rows.some(row => row.sku === sku)) {
      rejectSave = false;
      return route.fulfill({ status: 503, json: { detail: 'Injected master save failure' } });
    }
    await route.continue();
  });
  await page.route('**/api/documents/pallet-plan', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'auto' && rejectPlan && body.mpl.items.some(item => item.review_line_index === 0 && item.order_match_status === 'matched')) {
      rejectPlan = false;
      return route.fulfill({ status: 503, json: { detail: 'Injected plan failure' } });
    }
    await route.continue();
  });
  await page.goto('/#operations');
  await page.locator('#operations-sales-order-number').fill('99126030');
  await page.getByRole('button', { name: 'Load Order', exact: true }).click();
  await expect(page.locator('#operations-order-number')).toHaveText('99126030');
  const add = page.locator('#operations-missing-products').getByRole('button', { name: `Add ${sku} to Product Master`, exact: true });
  const editor = page.locator('#mpl-product-editor-modal');
  await add.click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Each SKU', { exact: false })).toHaveValue(sku);
  await expect(editor.locator('.mpl-product-description-field input')).toHaveValue('Candy Mini Bits - Bubblegum (1LB)');
  await page.screenshot({ path: test.info().outputPath('inline-sku-setup.png') });
  expect((await (await request.get('/api/mpl/product-master')).json()).rows.some(row => row.sku === sku)).toBe(false);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(await page.evaluate(() => mplProductMasterRows.some(row => row.sku === 'CMB109-1LB'))).toBe(false);
  const before = await page.evaluate(() => {
    updateReviewedOrder('po_number', 'KEEP-PO');
    const other = orderDocumentsState.mplDraft.packing_lists[0].items.find(item => item.review_line_index === 1);
    other.notes = 'Keep this order-only note';
    const product = orderDocumentsState.payload.items[1].product;
    other.order_packaging = { product, settings: { mode: 'boxes', value: 1 } };
    return { notes: other.notes, packing: JSON.stringify(other.order_packaging) };
  });
  await add.click();
  await editor.locator('.mpl-product-level-add').selectOption('Case');
  const caseCard = editor.locator('.mpl-packaging-level-card').filter({ has: page.locator('header strong', { hasText: /^Case$/ }) });
  for (const [label, value] of [['Case SKU', 'CMB109-CASE'], ['Eaches per Case', '25'], ['Length (in)', '24'], ['Width (in)', '16'], ['Height (in)', '10']]) {
    const field = caseCard.getByLabel(label, { exact: false });
    await field.fill(value); await field.press('Tab');
  }
  await editor.getByLabel('Packaged Weight (lb)', { exact: false }).fill('26');
  await editor.getByLabel('Packaged Weight (lb)', { exact: false }).press('Tab');
  await editor.getByRole('button', { name: 'Save & update order', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('not saved');
  expect((await (await request.get('/api/mpl/product-master')).json()).rows.some(row => row.sku === sku)).toBe(false);
  await editor.getByRole('button', { name: 'Save & update order', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Product saved; order update failed');
  expect((await (await request.get('/api/mpl/product-master')).json()).rows.filter(row => row.sku === sku)).toHaveLength(1);
  await editor.getByRole('button', { name: 'Retry order update', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(add).toHaveCount(0);
  const after = await page.evaluate(() => {
    const items = orderDocumentsState.mplDraft.packing_lists.flatMap(mpl => mpl.items);
    const other = items.find(item => item.review_line_index === 1);
    return { po: orderDocumentsState.reviewedOrder.fields.po_number, source: orderDocumentsState.payload.items[0].quantity_ordered_eaches,
      matched: orderDocumentsState.payload.items[0].match_status, boxes: items.filter(item => item.review_line_index === 0).reduce((sum, item) => sum + Number(item.qty_on_pallet), 0),
      notes: other.notes, packing: JSON.stringify(other.order_packaging), pallets: operationsPalletCount() };
  });
  expect(after).toMatchObject({ po: 'KEEP-PO', source: 650, matched: 'matched', boxes: 26, ...before });
  expect(after.pallets).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('inline-sku-added.png') });
});

async function replaceCatalog(request, rows) {
  const current = await (await request.get('/api/mpl/product-master')).json();
  return request.put('/api/mpl/product-master', { data: { rows, expected_revision: current.revision } });
}
test.beforeAll(async ({ request }) => {
  originalRows = (await (await request.get('/api/mpl/product-master')).json()).rows;
});
test.beforeEach(async ({ request }) => {
  expect((await replaceCatalog(request, originalRows)).ok()).toBeTruthy();
});
test.afterAll(async ({ request }) => {
  if (originalRows) await replaceCatalog(request, originalRows);
});

test('Michaels configurations stay together and survive CSV export/import', async ({ page, request }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const initial = await (await request.get('/api/mpl/product-master')).json();
  const sku = 'MIC_816202418306';
  const seed = {
    storefront: 'Michaels', sku, config_id: 'SANITY-SYNTHETIC', description: 'Synthetic White Pearl',
    packaging_level: 'Each', gtin: '00850068684038', case_qty: '1', is_active: true,
    display_sku: sku, display_sku_uom: 'Each', package_net_weight_g: '42',
  };
  const response = await replaceCatalog(request, [...initial.rows.filter(row => row.sku !== sku), seed]);
  expect(response.ok()).toBeTruthy();

  await page.goto('/#operations/product-master');
  const master = page.locator('#mpl-product-master-modal');
  await expect(master).toBeVisible();
  await page.locator('#mpl-product-search').fill(sku);
  await expect(page.locator('.mpl-shared-sku-row')).toHaveCount(0);
  await page.locator('.mpl-product-group-row').getByRole('button').click();
  await expect(page.locator('#mpl-product-editor-modal').getByLabel('Configuration ID', { exact: false })).toHaveCount(0);
  await page.locator('#mpl-product-editor-modal').getByRole('button', { name: '+ Add configuration', exact: true }).click();

  const editor = page.locator('#mpl-product-editor-modal');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Product SKU', { exact: false })).toHaveValue(sku);
  await expect(editor.locator('.mpl-packaging-primary-grid').getByLabel('GTIN', { exact: true })).toHaveValue('');
  const idInput = editor.getByLabel('Configuration ID', { exact: false });
  await expect(idInput).toBeVisible();
  const generatedId = await idInput.inputValue();
  await idInput.fill(seed.config_id);
  await idInput.press('Tab');
  await expect(idInput).toHaveValue(generatedId);
  await expect(editor.locator('.mpl-sku-configuration-list button')).toHaveCount(2);
  await idInput.fill('');
  await idInput.press('Tab');
  await expect(idInput).toHaveValue(generatedId);
  await idInput.fill('SANITY-NATURAL');
  await idInput.press('Tab');
  await expect(idInput).toHaveValue('SANITY-NATURAL');
  await editor.locator('.mpl-product-description-field input').fill('Natural White Pearl');
  await editor.locator('.mpl-product-description-field input').press('Tab');
  await editor.locator('.mpl-packaging-primary-grid').getByLabel('GTIN', { exact: true }).fill('00850079841659');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/mpl/product-master') && r.request().method() === 'PUT' && r.status() === 200);
  await editor.locator('.mpl-packaging-primary-grid').getByLabel('GTIN', { exact: true }).press('Tab');
  await saved;
  const currentCatalog = await (await request.get('/api/mpl/product-master')).json();
  const configId = currentCatalog.rows.find(row => row.sku === sku && row.gtin === '00850079841659').config_id;
  expect(configId).toBe('SANITY-NATURAL');
  await expect(editor.locator('.mpl-sku-configuration-list button')).toHaveCount(2);
  await expect(editor.locator('.mpl-sku-configuration-list')).toContainText('Natural White Pearl · 00850079841659');
  await editor.locator('.editor-body').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('michaels-configuration-editor.png'), fullPage: true });
  await page.reload();
  await expect(master).toBeVisible();
  await page.locator('#mpl-product-search').fill(sku);
  await expect(page.locator('.mpl-shared-sku-row')).toHaveCount(1);
  await expect(page.locator('.mpl-sku-configuration-row')).toHaveCount(2);
  await expect(master).toContainText('Synthetic White Pearl');
  await expect(master).toContainText('Natural White Pearl');
  await page.screenshot({ path: testInfo.outputPath('michaels-sku-group.png'), fullPage: true });

  // Deactivating the new configuration must not touch its sibling.
  await page.locator('.mpl-sku-configuration-row').filter({ hasText: 'Natural White Pearl' }).getByRole('button').click();
  await editor.locator('.mpl-packaging-advanced summary').click();
  const deactivated = page.waitForResponse(r => r.url().endsWith('/api/mpl/product-master') && r.request().method() === 'PUT' && r.status() === 200);
  await editor.getByLabel('Level active', { exact: false }).uncheck();
  await deactivated;
  const afterEdit = await (await request.get('/api/mpl/product-master')).json();
  const formulations = afterEdit.rows.filter(row => row.sku === sku);
  expect(formulations).toHaveLength(2);
  expect(formulations.find(row => row.config_id === seed.config_id).is_active).toBe(true);
  expect(formulations.find(row => row.config_id === configId).is_active).toBe(false);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();

  const download = page.waitForEvent('download');
  await master.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const file = await download;
  const csv = fs.readFileSync(await file.path());
  expect(csv.toString()).toContain('Configuration ID');
  expect(csv.toString()).toContain('00850068684038');
  expect(csv.toString()).toContain('00850079841659');
  const previewResponse = await request.post('/api/mpl/product-master/import-preview', {
    multipart: { file: { name: 'roundtrip.csv', mimeType: 'text/csv', buffer: csv } },
  });
  expect(previewResponse.ok()).toBeTruthy();
  const preview = await previewResponse.json();
  expect(preview.summary.added_rows).toBe(0);
  expect(preview.rows.filter(row => row.sku === sku)).toHaveLength(2);
  const exportedSynthetic = preview.rows.find(row => row.config_id === seed.config_id);
  expect(exportedSynthetic.display_sku).toBe(sku);
  expect(exportedSynthetic.display_sku_uom).toBe('Each');
  expect(exportedSynthetic.package_net_weight_g).toBe('42');
  for (let run = 0; run < 2; run++) {
    const imported = await request.post('/api/mpl/product-master/import-confirm', { data: { rows: preview.rows } });
    expect(imported.ok()).toBeTruthy();
    expect((await imported.json()).rows.filter(row => row.sku === sku)).toHaveLength(2);
  }
  await page.reload();
  await page.locator('#mpl-product-search').fill(sku);
  await expect(page.locator('.mpl-sku-configuration-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('Configuration ID appears only for shared SKUs across customers', async ({ page }, testInfo) => {
  await page.goto('/#operations/product-master');
  const master = page.locator('#mpl-product-master-modal');
  await expect(master).toBeVisible();
  await master.getByRole('button', { name: 'Add product', exact: true }).click();
  const editor = page.locator('#mpl-product-editor-modal');
  await editor.locator('.mpl-product-shared-grid select').first().selectOption('KeHE', { force: true });
  await expect(editor.getByLabel('Configuration ID', { exact: false })).toHaveCount(0);
  await expect(editor.locator('.mpl-sku-configurations')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '+ Add configuration', exact: true })).toBeDisabled();
  await editor.getByLabel('Product SKU', { exact: false }).fill('SANITY-SHARED-SKU');
  await editor.getByLabel('Product SKU', { exact: false }).press('Tab');
  await expect(editor.getByRole('button', { name: '+ Add configuration', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: '+ Add configuration', exact: true }).click();
  await expect(editor.getByLabel('Product SKU', { exact: false })).toHaveValue('SANITY-SHARED-SKU');
  await expect(editor.getByLabel('Configuration ID', { exact: false })).toBeVisible();
  await editor.locator('.mpl-product-shared-grid select').first().selectOption('Michaels', { force: true });
  await expect(editor.locator('.mpl-sku-configuration-list button')).toHaveCount(2);
  await expect(editor.locator('.mpl-sku-configuration-list')).toContainText('KeHE');
  await expect(editor.locator('.mpl-sku-configuration-list')).toContainText('Michaels');
  await page.screenshot({ path: testInfo.outputPath('shared-sku-across-customers.png'), fullPage: true });
  await editor.getByLabel('Product SKU', { exact: false }).fill('SANITY-DIFFERENT-SKU');
  await editor.getByLabel('Product SKU', { exact: false }).press('Tab');
  await expect(editor.locator('.mpl-sku-configurations')).toHaveCount(0);
  await expect(editor.getByLabel('Configuration ID', { exact: false })).toHaveCount(0);
  const saved = page.waitForResponse(r => r.url().endsWith('/api/mpl/product-master') && r.request().method() === 'PUT' && r.status() === 200);
  await saved;
});
