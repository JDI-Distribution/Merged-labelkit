const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'frontend', 'dist', 'assets', 'js', 'operations-workspace.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function createOperationsContext(selected = {}) {
  const controls = {
    'operations-generate-labels': { checked: !!selected.labels },
    'operations-generate-mpl': { checked: !!selected.mpl },
    'operations-generate-pallets': { checked: !!selected.pallets },
  };
  const context = vm.createContext({
    document: { getElementById: id => controls[id] || null },
    window: {},
  });
  vm.runInContext(source, context, { filename: sourcePath });
  vm.runInContext(`
    let b2bSelectedCustomer = '';
    let b2bSelectedGroupKey = '';
    let b2bOrderLabelJobs = [];
    let productForTest = null;
    let templateIdsForTest = [];
    let palletCountForTest = 0;
    function getSelectedB2BProduct() { return productForTest; }
    function b2bTemplateIdsForJob(job) { return job ? (job.template_ids || []) : templateIdsForTest; }
    function operationsPalletCount() { return palletCountForTest; }
  `, context);
  return context;
}

function blocker(context, expression = 'operationsGenerationBlocker()') {
  return vm.runInContext(expression, context);
}

test('requires at least one selected document', () => {
  const context = createOperationsContext();
  assert.equal(blocker(context).message, 'Select at least one document to generate.');
});

test('custom labels block until customer, product, level, and template are selected', () => {
  const context = createOperationsContext({ labels: true });
  vm.runInContext("orderDocumentsState.customMode = 'labels'", context);
  assert.equal(blocker(context).elementId, 'b2b-template-gallery-search');

  vm.runInContext("templateIdsForTest = ['STANDARD_CASE_PACK_4X6']", context);
  assert.equal(blocker(context).elementId, 'b2b-customer-select');

  vm.runInContext("b2bSelectedCustomer = 'BAKELL.COM'", context);
  assert.equal(blocker(context).elementId, 'b2b-product-select');

  vm.runInContext("b2bSelectedGroupKey = 'BAKELL.COM|CFG-1'", context);
  assert.equal(blocker(context).elementId, 'b2b-level-select');

  vm.runInContext("productForTest = { sku: 'SKU-1', packaging_level: 'Case' }", context);
  assert.equal(blocker(context), null);
});

test('automatic labels block when order jobs have unresolved templates', () => {
  const context = createOperationsContext({ labels: true });
  vm.runInContext(`
    orderDocumentsState.payload = { sales_order_number: 'SO-1' };
    b2bOrderLabelJobs = [{ template_ids: [], template_selection_required: true }];
  `, context);
  assert.match(blocker(context).message, /Choose templates for 1 label job/);

  vm.runInContext("b2bOrderLabelJobs[0] = { template_ids: ['STANDARD_CASE_PACK_4X6'], template_selection_required: false }", context);
  assert.equal(blocker(context), null);
});

test('packing lists and pallet labels require their source drafts', () => {
  const context = createOperationsContext({ mpl: true, pallets: true });
  assert.match(blocker(context).message, /Create or load a packing-list draft/);

  vm.runInContext("orderDocumentsState.mplDraft = { packing_lists: [{}] }", context);
  assert.equal(blocker(context), null);
  assert.equal(vm.runInContext('operationsNextReviewStage()', context), 'mpl');
  assert.match(blocker(context, 'operationsGenerationBlocker(undefined, true)').message, /Assign at least one pallet/);

  vm.runInContext('palletCountForTest = 1', context);
  assert.equal(blocker(context, 'operationsGenerationBlocker(undefined, true)'), null);

  vm.runInContext("document.getElementById('operations-generate-mpl').checked = false; document.getElementById('operations-generate-pallets').checked = true", context);
  assert.equal(blocker(context), null);
});

test('order pallet labels accept a manual count when packing-list output is excluded', () => {
  const context = createOperationsContext({ pallets: true });
  vm.runInContext(`
    orderDocumentsState.payload = { sales_order_number: 'SO-1' };
    orderDocumentsState.mplDraft = { packing_lists: [{ customer_po_number: 'PO-1' }] };
    orderDocumentsState.manualPalletCount = 3;
    orderDocumentsState.manualPalletCopies = 2;
  `, context);
  assert.equal(blocker(context), null);
  assert.equal(vm.runInContext('operationsUsesManualPalletCount()', context), true);
  assert.equal(vm.runInContext('operationsEffectivePalletCount()', context), 3);
  assert.equal(vm.runInContext('buildOperationsManualPalletDraft().pallets.length', context), 3);
  assert.equal(vm.runInContext('buildOperationsManualPalletDraft().pallets[0].copies', context), 2);
});

test('review stages run labels, MPL, pallets, then final generation', () => {
  const context = createOperationsContext({ labels: true, mpl: true, pallets: true });
  vm.runInContext(`
    orderDocumentsState.payload = { sales_order_number: 'SO-1' };
    orderDocumentsState.mplDraft = { packing_lists: [{}] };
    b2bOrderLabelJobs = [{ template_ids: ['STANDARD_CASE_PACK_4X6'], template_selection_required: false }];
  `, context);
  assert.equal(vm.runInContext('operationsNextReviewStage()', context), 'labels');
  vm.runInContext('orderDocumentsState.reviewedDocuments.labels = true', context);
  assert.equal(vm.runInContext('operationsNextReviewStage()', context), 'mpl');
  vm.runInContext('orderDocumentsState.reviewedDocuments.mpl = true', context);
  assert.equal(vm.runInContext('operationsNextReviewStage()', context), 'mpl');
  assert.equal(blocker(context), null);
  vm.runInContext('palletCountForTest = 1', context);
  assert.equal(vm.runInContext('operationsNextReviewStage()', context), 'pallets');
  vm.runInContext('orderDocumentsState.reviewedDocuments.pallets = true', context);
  assert.equal(vm.runInContext('operationsNextReviewStage()', context), 'generate');
});
