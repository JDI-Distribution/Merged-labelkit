const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const filename = path.join(__dirname, '../frontend/dist/assets/js/modules/master-data-model.js');
const source = fs.readFileSync(filename, 'utf8').replace(/\bexport\s+(?=(?:function|const|class)\b)/g, '');
const ctx = vm.createContext({});
vm.runInContext(source, ctx);
const model = ctx.LabelKitMasterData;

test('address cleanup retains line order and leaves product pipes intact', () => {
  const draft = { packing_lists: [{ ship_to: 'Contact | Warehouse\nStreet|Suite 200', description: 'Sugar | Purple' }] };
  model.normalizeAddressFields(draft);
  assert.equal(draft.packing_lists[0].ship_to, 'Contact\nWarehouse\nStreet\nSuite 200');
  assert.equal(draft.packing_lists[0].description, 'Sugar | Purple');
});

test('directory normalization cleans existing pipe-separated addresses', () => {
  const row = model.normalizeDirectory({ record_type: 'SHIP_TO', address: 'Warehouse | Street | City' });
  assert.equal(row.address, 'Warehouse\nStreet\nCity');
  assert.equal(row.delivery_address, row.address);
});
