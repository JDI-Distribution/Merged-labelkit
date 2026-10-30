const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function context() {
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  const root = path.join(__dirname, '../frontend/dist/assets/js');
  for (const filename of ['modules/packing-model.js', 'modules/document-editor-model.js', 'mpl-tihi.js']) {
    const text = fs.readFileSync(path.join(root, filename), 'utf8').replace(/\bexport\s+(?=(?:function|const|class)\b)/g, '');
    vm.runInContext(text, ctx, { filename });
  }
  Object.assign(ctx, {
    normalizePalletId: value => String(value || '').trim(),
    canonicalId: value => String(value || '').trim().toLowerCase(),
    parsePositiveNumber: value => Number(value) > 0 ? Number(value) : null,
    parseWeight: value => Number(value) || 0,
    formatNumberString: value => String(value),
    itemQuantityForWeight: item => Number(item.qty_on_pallet),
    matchCaseProductForPallet: () => null,
    activeKeheDocumentDraft: null,
    getActiveAllProductMasterRows: () => [],
  });
  return ctx;
}

test('browser displays backend Ti-Hi results and requests a new plan when an override changes', async () => {
  const ctx = context();
  let calls = 0;
  ctx.activeKeheDocumentType = '';
  ctx.LabelKitPackingModel.configurePalletDefaults({ max_length_in: 48, max_width_in: 40, max_height_in: 70, max_gross_lbs: 2000, pallet_base_height_in: 6, cases_per_layer: 0, max_layers: 0 });
  ctx.LabelKitAPI = { json: async (_url, options, timeoutMs) => {
    assert.equal(timeoutMs, 45000);
    const { mpl } = JSON.parse(options.body); calls++;
    const override = mpl._tihi_constraints.cases_per_layer;
    return { mpl: { _pallet_dimensions: { '1': override ? '48 x 40 x 21 in' : '48 x 40 x 11 in' }, _pallet_tihi: { '1': override ? '4 x 3' : '9 x 1' } },
      entries: [{ pallet_label: '1', ti: override || 9, hi: override ? 3 : 1, loaded_height: override ? 21 : 11, overflow_cases: 0 }], warnings: [], constraints: {} };
  } };
  ctx.mpl = { _tihi_constraints: { cases_per_layer: 4 }, items: [] };
  await ctx.fetchMplPalletPlan(ctx.mpl);
  const entry = ctx.buildMplTiHiEntries(ctx.mpl).entries[0];
  assert.equal(entry.ti, 4); assert.equal(entry.hi, 3); assert.equal(entry.loadedHeight, 21);
  assert.equal(ctx.mpl._pallet_dimensions['1'], '48 x 40 x 21 in');
  ctx.mpl._tihi_constraints.cases_per_layer = '';
  await ctx.fetchMplPalletPlan(ctx.mpl);
  assert.equal(ctx.buildMplTiHiEntries(ctx.mpl).entries[0].hi, 1);
  assert.equal(calls, 2);
});

test('Ti-Hi control handlers save global and pallet-specific edits into the request', () => {
  const ctx = context();
  ctx.LabelKitPackingModel.configurePalletDefaults({ max_length_in: 48, max_width_in: 40, max_height_in: 70, max_gross_lbs: 2000, pallet_base_height_in: 6 });
  const mpl = { items: [], _tihi_constraints: { cases_per_layer: 0 } };
  ctx.getMpl = () => mpl;
  ctx.updateMplTiHiConstraint(0, '', 'cases_per_layer', '4');
  ctx.updateMplTiHiConstraint(0, '1', 'max_layers', '2');
  const input = ctx.palletPlanInput(mpl);
  assert.equal(Number(input.mpl._tihi_constraints.cases_per_layer), 4);
  assert.equal(Number(input.mpl._tihi_pallet_constraints['1'].max_layers), 2);
  assert.equal(input.mpl._tihi_pallet_constraints['1'].cases_per_layer, 4);
  ctx.updateMplTiHiConstraint(0, '', 'cases_per_layer', '');
  assert.equal(ctx.palletPlanInput(mpl).mpl._tihi_constraints.cases_per_layer, '');
});

test('browser order balance sums split cases and preserves zero shipped', () => {
  const ctx = context();
  const balance = ctx.LabelKitDocumentEditor.orderBalanceCases({ items: [
    { sku: 'A', total_ordered: '10', total_shipped: '6' },
    { sku: 'A', total_ordered: '0', total_shipped: '3' },
    { sku: 'B', total_ordered: '1', total_shipped: 0 },
  ] });
  assert.equal(balance, 2);
});

test('a failed backend pallet calculation never falls back to browser geometry', async () => {
  const ctx = context();
  ctx.LabelKitAPI = { json: async () => { throw new Error('Backend unavailable'); } };
  const mpl = { items: [], _tihi_constraints: {} };
  await assert.rejects(ctx.fetchMplPalletPlan(mpl), /Backend unavailable/);
  const result = ctx.buildMplTiHiEntries(mpl);
  assert.equal(result.entries.length, 0);
  assert.equal(result.pending, false);
  assert.match(result.warnings[0], /Backend unavailable/);
});

test('partner Balance Owed column shows zero only in the first row', () => {
  const ctx = context();
  const mpl = { items: [{ sku: 'A', total_ordered: '3', total_shipped: '3' }, { sku: 'A', total_ordered: '2', total_shipped: '2' }] };
  const model = ctx.LabelKitDocumentEditor;
  assert.ok(model.defaultColumns('dutch_bros').some(column => column[0] === 'balance_owed'));
  assert.equal(model.columnValue(mpl.items[0], mpl, { key: 'balance_owed' }), '0');
  assert.equal(model.columnValue(mpl.items[1], mpl, { key: 'balance_owed' }), '');
});
