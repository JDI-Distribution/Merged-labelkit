const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/dist/assets/js/modules/order-packing-model.js'), 'utf8').replace(/\bexport\s+/g, ''), ctx);
const { orderedUnits, unitNetLbs, boxGroups } = ctx.window.LabelKitOrderPackingModel;

test('650 one-pound units preserve the source quantity and use 26 25lb boxes', () => {
  const source = { sku: 'CMB109-1LB', quantity_ordered_eaches: 650, quantity_ordered: 650 };
  const before = JSON.stringify(source);
  const groups = boxGroups({ totalUnits: orderedUnits(source), unitLbs: unitNetLbs(source), mode: 'lbs', value: 25 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 26);
  assert.equal(groups[0].netLbs, 25);
  assert.equal(JSON.stringify(source), before);
});

test('partial boxes conserve all 650lb instead of rounding demand up', () => {
  const groups = boxGroups({ totalUnits: 650, unitLbs: 1, mode: 'lbs', value: 30 });
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 22);
  assert.equal(groups.reduce((sum, group) => sum + group.count * group.netLbs, 0), 650);
  assert.equal(groups[0].count, 21);
  assert.equal(groups[1].netLbs, 20);
});

test('total box count balances whole ordered units without losing demand', () => {
  const groups = boxGroups({ totalUnits: 650, unitLbs: 1, mode: 'boxes', value: 28 });
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 28);
  assert.equal(groups.reduce((sum, group) => sum + group.count * group.units, 0), 650);
  assert.ok(groups.every(group => Number.isInteger(group.units)));
});

test('invalid counts and unknown net weight cannot silently change carton quantities', () => {
  assert.throws(() => boxGroups({ totalUnits: 650, unitLbs: null, mode: 'lbs', value: 25 }), /pounds per ordered unit/);
  for (const value of [0, -1, 1.5, 651, Infinity]) assert.throws(() => boxGroups({ totalUnits: 650, unitLbs: 1, mode: 'boxes', value }));
  assert.equal(unitNetLbs({ sku: 'UNKNOWN', product: { gross_weight_lbs: '50' } }), null);
});
