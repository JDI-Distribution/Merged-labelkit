const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

globalThis.window = globalThis;
const modulePath = path.join(__dirname, '..', 'frontend', 'dist', 'assets', 'js', 'b2b-order-jobs.js');
vm.runInThisContext(fs.readFileSync(modulePath, 'utf8'), { filename: modulePath });
const { buildB2BOrderLabelJobs } = globalThis.LabelKitB2BOrderJobs;

const normalizeProduct = row => ({ ...row, storefront: row.storefront || 'Customer', packaging_level: row.packaging_level || 'Case' });
const normalizeLevel = value => ({ 'master case': 'Master Case', 'inner pack': 'Inner Pack', each: 'Each', case: 'Case' }[String(value || '').toLowerCase()] || 'Other');
const groupKey = row => `${row.storefront}|${row.config_id || row.sku}`;
const templates = [
  { template_id: 'EACH-LABEL', default_copies: 1 },
  { template_id: 'INNER-LABEL', default_copies: 2 },
  { template_id: 'CASE-LABEL', default_copies: 1 },
];
const makeArgs = overrides => ({
  orderItems: [],
  fallbackProducts: [],
  productRows: [],
  templates,
  destination: { delivery_address: 'Order ship-to' },
  runFields: { order_number: 'SO-1' },
  normalizeProduct,
  normalizeLevel,
  productGroupKey: groupKey,
  getLabelEnabled: level => !!level.label_enabled,
  ...overrides,
});

const matchedLine = {
  sku: 'EACH-SKU',
  quantity_ordered: 25,
  quantity_ordered_eaches: 25,
  match_status: 'matched',
  product: { storefront: 'Customer', config_id: 'CFG-1', packaging_level: 'Each', sku: 'EACH-SKU', case_qty: '1', label_template_id: 'EACH-LABEL' },
  packaging_summary: [
    { packaging_level: 'Each', sku: 'EACH-SKU', eaches_per_unit: 1, label_enabled: true, label_template_id: 'EACH-LABEL' },
    { packaging_level: 'Inner Pack', sku: 'INNER-SKU', eaches_per_unit: 5, label_enabled: true, label_template_id: 'INNER-LABEL' },
    { packaging_level: 'Case', sku: 'CASE-SKU', eaches_per_unit: 25, label_enabled: true, label_template_id: 'CASE-LABEL' },
  ],
};
const productRows = matchedLine.packaging_summary.map(level => ({
  storefront: 'Customer', config_id: 'CFG-1', packaging_level: level.packaging_level,
  sku: level.sku, case_qty: String(level.eaches_per_unit), label_template_id: level.label_template_id,
  label_enabled: true, verification_status: 'VERIFIED',
}));
const matchedOrderCopy = { ...matchedLine.product, description: 'Edited for this order' };
const multiLevelJobs = buildB2BOrderLabelJobs(makeArgs({
  orderItems: [matchedLine],
  fallbackProducts: [matchedOrderCopy],
  productRows,
}));
assert.deepEqual(multiLevelJobs.map(job => job.product.packaging_level), ['Each', 'Inner Pack', 'Case']);
assert.deepEqual(multiLevelJobs.map(job => job.run.carton_total), ['25', '5', '1']);
assert(multiLevelJobs.every(job => job.match_status === 'matched'));
assert(multiLevelJobs.every(job => job.order_only));
assert(multiLevelJobs.every(job => job.product.description === 'Edited for this order'));

const sourceProductRows = productRows.map(row => ({ ...row }));
const matchedJobsForWorkspace = buildB2BOrderLabelJobs(makeArgs({
  orderItems: [matchedLine],
  fallbackProducts: [matchedOrderCopy],
  productRows: sourceProductRows,
}));
const editedOrderCopy = { ...matchedJobsForWorkspace[0].product, description: 'Changed only on this order' };
matchedJobsForWorkspace[0].product = editedOrderCopy;
assert.equal(matchedJobsForWorkspace[0].product.description, 'Changed only on this order');
assert.equal(sourceProductRows[0].description, undefined);
assert(matchedJobsForWorkspace.every(job => job.order_only));
assert(multiLevelJobs.every(job => !job.template_selection_required));

const unresolvedLine = {
  sku: 'NEW-SKU', quantity_ordered: 9, match_status: 'unmatched',
  product: { storefront: 'Customer', config_id: 'CFG-NEW', packaging_level: 'Case', sku: 'NEW-SKU', case_qty: '9', verification_status: 'NEEDS_REVIEW' },
  packaging_summary: [{ packaging_level: 'Case', sku: 'NEW-SKU', eaches_per_unit: 9, label_enabled: true, label_template_id: '' }],
};
const unresolvedJobs = buildB2BOrderLabelJobs(makeArgs({ orderItems: [unresolvedLine] }));
assert.equal(unresolvedJobs.length, 1);
assert.equal(unresolvedJobs[0].template_selection_required, true);
assert.equal(unresolvedJobs[0].template_id, '');
assert.match(unresolvedJobs[0].review_reasons[0], /Choose a label template/);

const disabledLine = { ...matchedLine, packaging_summary: matchedLine.packaging_summary.map(level => ({ ...level, label_enabled: false })) };
assert.deepEqual(buildB2BOrderLabelJobs(makeArgs({ orderItems: [disabledLine], productRows })), []);

console.log('B2B order-job tests passed.');
