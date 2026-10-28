const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

// This integration test edits the catalog. Run only against a local server
// whose MPL_PRODUCT_MASTER_FILE and AUDIT_LOG_FILE point to temporary files.
test.skip(process.env.LABELKIT_ISOLATED_SANITY !== '1', 'Requires an isolated local catalog.');
let originalRows;

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
