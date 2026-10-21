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
    roundProductWeightForPallet: value => Math.ceil(value * 1.05 / 10) * 10,
  });
  return ctx;
}

test('Ti override changes browser placements, height, saved dimensions, and can be cleared', () => {
  const ctx = context();
  ctx.mpl = { _tihi_constraints: { cases_per_layer: 4 }, items: [
    { sku: 'A', line: 1, location_on_pallet: '1', qty_on_pallet: '9', length_in: '12', width_in: '10', height_in: '5', unit_weight_lbs: '1' },
  ] };
  const entry = vm.runInContext('buildMplTiHiEntries(mpl).entries[0]', ctx);
  assert.equal(entry.ti, 4);
  assert.equal(entry.hi, 3);
  assert.equal(entry.loadedHeight, 21);
  assert.equal(entry.overflowCases, 0);
  assert.equal(ctx.mpl._pallet_dimensions['1'], '48 x 40 x 21 in');
  ctx.mpl._tihi_constraints.cases_per_layer = '';
  ctx.mpl._tihi_pallet_constraints = {};
  assert.equal(vm.runInContext('buildMplTiHiEntries(mpl).entries[0].hi', ctx), 1);
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
