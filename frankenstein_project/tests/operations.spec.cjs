const { test, expect } = require('@playwright/test');

async function openOperations(page) {
  await page.goto('/#operations');
  await expect(page.getByRole('heading', { name: 'Order Documents' })).toBeVisible();
}

async function loadOrder(page, orderNumber) {
  await page.locator('#operations-sales-order-number').fill(orderNumber);
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

test('Custom Labels resets order state, selects multiple templates, and reports readiness', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Label Without an Order' }).click();
  await page.selectOption('#b2b-template-gallery-customer', 'Fancy Sprinkles');
  const fancyChecks = page.locator('#b2b-template-gallery-grid input[type="checkbox"]');
  await expect(fancyChecks).toHaveCount(3);
  await fancyChecks.nth(0).check();
  await fancyChecks.nth(1).check();
  await expect(page.locator('#b2b-template-gallery-grid input:checked')).toHaveCount(2);
  await expect(page.locator('#b2b-template-gallery-count')).toContainText('2 selected');
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await page.getByRole('button', { name: 'Save Packing List Review & Continue' }).click();
  await page.getByRole('button', { name: 'Create Label Without an Order' }).click();
  await expect(page.locator('#b2b-template-gallery-grid input:checked')).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate With Order Number' }).click();
  await expect(page.locator('#operations-order-card')).toBeVisible();
  await expect(page.locator('#operations-sales-order-number')).toBeFocused();
  await expect(page).toHaveURL(/#operations$/);
  expect(errors).toEqual([]);
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
  await page.getByRole('button', { name: 'Save Pallet Label Review & Continue' }).click();
  await expect(page).toHaveURL(/operations\/pallets/);
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Generate Reviewed Documents');
});

test('Custom Packing List opens its editor and exposes pallet review only when available', async ({ page }) => {
  await openOperations(page);
  await page.getByRole('button', { name: 'Create Packing List Without an Order' }).click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await expect(page.locator('#operations-sales-order-number')).not.toHaveAttribute('required', '');
  await page.getByRole('button', { name: 'Save Packing List Review & Continue' }).click();
  await expect(page).toHaveURL(/operations\/packing/);
  await expect(page.locator('#operations-mpl-review-state')).not.toHaveText('Not created');
  const pallets = page.locator('[data-operations-tab="pallets"]');
  await expect(pallets).toBeEnabled();
  await pallets.click();
  await page.getByRole('button', { name: 'Review & Edit Pallet Labels', exact: true }).click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await expect(page.getByText('Pallet Placard Groups')).toBeVisible();
  await page.getByRole('button', { name: 'Save Pallet Label Review & Continue' }).click();
  await expect(page).toHaveURL(/operations\/pallets/);
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Generate Reviewed Documents');
});

test('Unique and duplicate order lookup preserve or replace work intentionally', async ({ page }) => {
  await openOperations(page);
  await loadOrder(page, '38800');
  await expect(page.locator('.operations-order-summary')).toContainText('38800');
  await page.locator('#operations-sales-order-number').fill('63494');
  await page.locator('#btn-load-operations-order').click();
  const picker = page.locator('#operations-order-instance-picker');
  await expect(picker).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#operations-session')).toHaveJSProperty('inert', true);
  await expect(page.locator('body > header')).toHaveJSProperty('inert', true);
  await picker.getByRole('button', { name: 'Keep Current Work' }).click();
  await expect(page.locator('.operations-order-summary')).toContainText('38800');
  await page.locator('#operations-sales-order-number').fill('63494');
  await page.locator('#btn-load-operations-order').click();
  await page.locator('#operations-order-instance-picker').getByRole('button', { name: 'Load Selected Order' }).click();
  await expect(page.locator('#operations-order-number')).toHaveText('63494');
  await expect(page.locator('#operations-status-bar')).toContainText('previous document session replaced');
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
  await page.getByRole('button', { name: 'Save Packing List Review & Continue' }).click();
  await expect(page).toHaveURL(/operations\/packing/);
  await expect(page.locator('#operations-pallet-count')).not.toHaveText('0');
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Continue to Pallet Label Review');
  await page.locator('#btn-generate-operations-documents').click();
  await expect(page).toHaveURL(/operations\/document-editor/);
  await expect(page.getByText('Pallet Placard Groups')).toBeVisible();
  await page.getByRole('button', { name: 'Save Pallet Label Review & Continue' }).click();
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Generate Reviewed Documents');
  await expect(page.locator('#btn-generate-operations-documents')).toBeEnabled();
});

test('Custom label generation appears in Finished Files and opens its PDF preview', async ({ page }) => {
  await openOperations(page);
  await setUpManualLabel(page);
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Continue to Label Preview');
  await page.locator('#btn-generate-operations-documents').click();
  const readiness = page.locator('#workflow-readiness-modal');
  if (await readiness.isVisible()) await readiness.getByRole('button', { name: 'Generate with warnings' }).click();
  await expect(page).toHaveURL(/operations\/preview/);
  await expect(page.getByRole('link', { name: 'Save PDF' })).toBeVisible();
  await page.locator('#preview-panel .btn-close-preview').click();
  await expect(page).toHaveURL(/operations\/labels/);
  await expect(page.locator('#btn-generate-operations-documents')).toHaveText('Generate Reviewed Documents');
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
