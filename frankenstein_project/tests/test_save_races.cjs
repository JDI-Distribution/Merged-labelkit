const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(files) {
  const ctx = vm.createContext({ setTimeout, clearTimeout, AbortController });
  ctx.window = ctx;
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/dist/assets/js', file), 'utf8');
    vm.runInContext(source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class)\b)/g, ''), ctx);
  }
  return ctx;
}

test('shared table saves queue newer edits and use the returned revision without overwriting edits', async () => {
  const ctx = load(['reference-data.js']);
  let rows = [{ value: 'loaded' }], finish, queued;
  const requests = [], statuses = [];
  Object.assign(ctx, {
    allowLocalFallback: () => false, hasPermission: () => true,
    setStatus: message => statuses.push(message),
    setTimeout: callback => { queued = callback; return 1; }, clearTimeout: () => {},
    LabelKitAPI: { json: async (_, options) => {
      if (!options.body) return { rows, revision: 'r1' };
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) return new Promise(resolve => { finish = resolve; });
      return { rows, revision: 'r3' };
    } },
  });
  const table = ctx.createReferenceTable({ endpoint: '/table', label: 'Table',
    getRows: () => rows.map(row => ({ ...row })), setRows: value => { rows = value; },
    normalizeRows: value => value, loadLocal: () => [], saveLocal: () => {}, render: () => {},
    mergeMessage: 'merged' });
  await table.load();
  rows = [{ value: 'first' }, { value: 'duplicate' }];
  const first = table.save();
  rows = [{ value: 'newer' }];
  await table.save();
  finish({ rows: [{ value: 'first' }], revision: 'r2' });
  await first;
  assert.equal(rows[0].value, 'newer');
  assert.equal(statuses.length, 0);
  await queued();
  assert.deepEqual(requests.map(request => request.expected_revision), ['r1', 'r2']);
  assert.equal(requests[1].rows[0].value, 'newer');
});

test('shared table reports rejected saves and blocks saving after a failed load', async () => {
  const ctx = load(['reference-data.js']);
  let rows = [], failedLoad = false, writes = 0;
  const statuses = [];
  Object.assign(ctx, {
    allowLocalFallback: () => true, hasPermission: () => true,
    setStatus: message => statuses.push(message),
    LabelKitAPI: { json: async (_, options) => {
      if (options.body) { writes++; throw new Error('This table changed'); }
      if (failedLoad) throw new Error('Unavailable');
      return { rows: [{ value: 'loaded' }], revision: 'r1' };
    } },
  });
  const table = ctx.createReferenceTable({ endpoint: '/table', label: 'Directory',
    getRows: () => rows, setRows: value => { rows = value; }, normalizeRows: value => value,
    loadLocal: () => [{ value: 'cached' }], saveLocal: () => {}, render: () => {} });
  await table.load();
  rows = [{ value: 'unsaved' }];
  await table.save();
  assert.equal(rows[0].value, 'unsaved');
  assert.match(statuses.pop(), /This table changed.*Your edits remain open/);
  failedLoad = true;
  await table.load(); await table.save();
  assert.equal(rows[0].value, 'cached');
  assert.equal(writes, 1);
  assert.match(statuses.pop(), /Reload this table before saving/);
});

test('autosave keeps edits made during an older request dirty and saves them next', async () => {
  const ctx = load(['modules/mpl-draft-sync.js']);
  let finish, current = 'first', stored;
  const sync = ctx.LabelKitDraftSync.create({ delayMs: 60000, canSave: () => true,
    save: async () => { const snapshot = current; await new Promise(resolve => { finish = resolve; }); stored = snapshot; return true; } });
  try {
    sync.schedule();
    let saving = sync.flush();
    const oldVersion = sync.version();
    current = 'second'; sync.schedule();
    finish(); await saving;
    sync.markSaved(oldVersion);
    assert.equal(stored, 'first');
    assert.equal(sync.hasUnsavedChanges(), true);
    saving = sync.flush(); finish(); await saving;
    assert.equal(stored, 'second');
    assert.equal(sync.hasUnsavedChanges(), false);
  } finally { sync.dispose(); }
});

test('address value lookups preserve source objects and product separators', () => {
  const ctx = load(['modules/master-data-model.js', 'b2b-workspace.js']);
  const job = { run: {}, product: { description: 'Purple | Sugar' }, directory: { ship_to: 'Contact | Warehouse' } };
  assert.equal(ctx.b2bJobValue(job, 'ship_to'), 'Contact\nWarehouse');
  assert.equal(ctx.b2bJobValue(job, 'description'), 'Purple | Sugar');
  assert.equal(job.directory.ship_to, 'Contact | Warehouse');
  assert.equal(ctx.b2bPreviewValue(job.product, job.directory, {}, 'ship_to'), 'Contact\nWarehouse');
});

test('an edit is rescheduled when its timer fires during a slower save', async () => {
  const ctx = load(['modules/mpl-draft-sync.js']);
  let finish, nextSaved, calls = 0;
  const next = new Promise(resolve => { nextSaved = resolve; });
  const sync = ctx.LabelKitDraftSync.create({ delayMs: 10, canSave: () => true, save: async () => {
    if (++calls === 1) await new Promise(resolve => { finish = resolve; });
    else nextSaved();
    return true;
  } });
  let timeout;
  try {
    sync.schedule(); const first = sync.flush();
    sync.schedule();
    await sync.flush(); // The newer edit's timer fires while the first request is pending.
    finish(); await first;
    await Promise.race([next, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Newer edit was never retried')), 1000); })]);
    assert.equal(calls, 2);
  } finally { clearTimeout(timeout); sync.dispose(); }
});

test('quality filtering uses the supplied snapshot without recalculating the catalog', () => {
  const ctx = load(['workflow-enhancements.js']);
  const result = ctx.LabelKitWorkflow.productGroupPassesFilter(
    { entries: [{ row: { sku: 'A' }, index: 0 }] }, 'missing_gtin', '',
    { rows: [{ issues: [{ code: 'missing_gtin' }] }] });
  assert.equal(result, true);
});

test('an already cancelled request never starts fetching', async () => {
  const ctx = load(['modules/api-client.js']);
  let calls = 0;
  ctx.fetch = async () => { calls += 1; return { ok: true }; };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(ctx.LabelKitAPI.request('/cancelled', { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(calls, 0);
});

test('cancellation during a request is reported as cancellation', async () => {
  const ctx = load(['modules/api-client.js']);
  ctx.fetch = (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const controller = new AbortController();
  const pending = ctx.LabelKitAPI.request('/cancelled', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('JSON and PDF requests retain the same HTTP error details', async () => {
  const ctx = load(['modules/api-client.js']);
  ctx.fetch = async () => ({ ok: false, status: 409, json: async () => ({ detail: 'Newer revision exists' }) });
  for (const kind of ['json', 'blob', 'response']) {
    await assert.rejects(ctx.LabelKitAPI[kind]('/conflict'), error =>
      error.name === 'LabelKitHttpError' && error.status === 409 && error.message === 'Newer revision exists');
  }
});

test('shared HTTP handling preserves JSON and PDF bodies and real timeouts', async () => {
  const ctx = load(['modules/api-client.js']);
  const payload = { rows: [{ sku: 'A' }] }, pdf = new Blob(['%PDF-test']);
  const response = { ok: true, headers: new Map([['X-Result-Id', 'job']]), json: async () => payload, blob: async () => pdf };
  ctx.fetch = async () => response;
  assert.equal((await ctx.LabelKitAPI.response('/render')).headers.get('X-Result-Id'), 'job');
  assert.equal(await ctx.LabelKitAPI.json('/json'), payload);
  assert.equal(await ctx.LabelKitAPI.blob('/pdf'), pdf);
  ctx.fetch = (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  await assert.rejects(ctx.LabelKitAPI.request('/slow', {}, 1), error =>
    error.name === 'LabelKitHttpError' && error.message.startsWith('Request timed out'));
  ctx.fetch = async () => response;
  ctx.setTimeout = () => { throw new Error('Long renders must not get an immediate timeout'); };
  assert.equal(await ctx.LabelKitAPI.response('/long-render', {}, 0), response);
});

test('output registry rejects a result invalidated while PDF pages are being read', async () => {
  const ctx = load(['workflow-enhancements.js']);
  let ready, current = true;
  const pending = new Promise(resolve => { ready = resolve; });
  ctx.pdfjsLib = { getDocument: () => ({ promise: pending }) };
  const recording = ctx.recordGeneratedOutput('obsolete', {
    blob: { arrayBuffer: async () => new ArrayBuffer(0) }, isCurrent: () => current,
  });
  current = false;
  ready({ numPages: 1, destroy: async () => {} });
  assert.equal(await recording, false);
  assert.equal(ctx.getGeneratedOutputs().length, 0);
});

test('document pipeline renders an isolated reviewed snapshot and publishes only after validation', async () => {
  const ctx = load(['modules/document-pipeline.js']);
  const steps = [], original = { value: 'reviewed' };
  Object.assign(ctx, {
    LabelKitAPI: { json: async (_url, options) => {
      steps.push('readiness'); assert.equal(JSON.parse(options.body).draft.value, 'reviewed');
      return { ready: false };
    } },
    confirmDocumentReadiness: async () => { steps.push('confirm'); return true; },
    recordGeneratedOutput: async (_key, output) => { steps.push('publish'); assert.equal(output.documentSnapshot.value, 'reviewed'); },
  });
  const result = await ctx.runDocumentPipeline({ kind: 'labels', draft: original, output: { key: 'test' },
    render: async snapshot => { steps.push('render'); original.value = 'later'; assert.equal(snapshot.value, 'reviewed'); return { blob: 'pdf' }; } });
  assert.equal(result.blob, 'pdf');
  assert.deepEqual(steps, ['readiness', 'confirm', 'render', 'publish']);
  assert.equal(ctx.documentPipelineActive, 0);
});

test('document pipeline rejects a changed input or failed renderer without publishing', async () => {
  for (const failure of ['changed', 'render']) {
    const ctx = load(['modules/document-pipeline.js']);
    let current = true, publications = 0;
    Object.assign(ctx, {
      LabelKitAPI: { json: async () => ({ ready: true }) }, confirmDocumentReadiness: async () => true,
      recordGeneratedOutput: async () => { publications++; },
    });
    await assert.rejects(ctx.runDocumentPipeline({ kind: 'labels', draft: {}, output: { key: 'test' }, isCurrent: () => current,
      render: async () => { if (failure === 'render') throw new Error('Renderer failed'); current = false; return { blob: 'obsolete' }; } }),
    failure === 'render' ? /Renderer failed/ : /Document changed/);
    assert.equal(publications, 0);
    assert.equal(ctx.documentPipelineActive, 0);
  }
});

test('shared order edits update dependent documents and preserve address lines and per-label lots', () => {
  const ctx = load(['order-context.js']);
  const address = 'Contact\nWarehouse\nStreet\nSuite 200';
  Object.assign(ctx, {
    selectedKit: 'operations', b2bRunFields: {}, b2bTemplateRunFields: {},
    b2bResolvedDirectoryFallback: {}, b2bOrderDestinationOverride: '',
    b2bOrderLabelJobs: [{ run: { lot_number: 'LOT-A' }, template_runs: { one: { lot_number: 'LOT-B' } }, directory: {} }],
    clearGeneratedOutputs: () => {}, clearB2BPreview: () => {}, mplDraftSync: null,
    orderDocumentsState: { reviewedOrder: { id: '1', revision: 0, fields: { po_number: 'old', ship_date: '10/28/26', ship_to: address, bill_to: address, ship_from: address } },
      mplDraft: { packing_lists: [{}] }, palletDraft: { pallets: [{}] } },
  });
  ctx.updateReviewedOrder('customer_po_number', '029902');
  const snapshot = ctx.reviewedOrderSnapshot();
  assert.equal(snapshot.fields.po_number, '029902');
  assert.equal(ctx.b2bOrderLabelJobs[0].run.po_number, '029902');
  assert.equal(ctx.orderDocumentsState.mplDraft.packing_lists[0].customer_po_number, '029902');
  assert.equal(ctx.orderDocumentsState.palletDraft.pallets[0].customer_po_numbers, '029902');
  assert.equal(ctx.b2bOrderLabelJobs[0].directory.delivery_address, address);
  assert.equal(ctx.b2bOrderLabelJobs[0].run.lot_number, 'LOT-A');
  assert.equal(ctx.b2bOrderLabelJobs[0].template_runs.one.lot_number, 'LOT-B');
  assert.equal(ctx.orderDocumentsState.reviewedDocuments.labels, false);
});

test('changing a reviewed line replaces label SKUs and blocks a level missing from the new configuration', () => {
  const ctx = load(['order-context.js']);
  const product = { sku: 'NEW-CASE', config_id: 'new', storefront: 'Dutch Bros', packaging_level: 'Case', case_qty: '12' };
  Object.assign(ctx, {
    selectedKit: 'operations', normalizePackagingLevel: value => value, clearB2BPreview: () => {},
    b2bOrderFallbackProducts: [], b2bOrderLabelJobs: ['Case', 'Each'].map((level, index) => ({
      line_index: 0, order_only_product_index: index, product: { sku: `OLD-${level}`, packaging_level: level },
      template_id: 'generic', template_ids: ['generic'], run: {},
    })),
    orderDocumentsState: { reviewedOrder: { revision: 0 }, mplDraft: { reviewed_product_master: [product],
      packing_lists: [{ items: [{ review_line_index: 0, sku: 'NEW-CASE', qty_on_pallet: '2', quantity_per_case: '12' }] }] } },
  });
  ctx.replaceReviewedLineProduct(0, product);
  assert.equal(ctx.b2bOrderLabelJobs[0].product.sku, 'NEW-CASE');
  assert.equal(ctx.b2bOrderLabelJobs[0].run.carton_total, '2');
  assert.equal(ctx.b2bOrderLabelJobs[1].product.sku, '');
  assert.equal(ctx.b2bOrderLabelJobs[1].template_selection_required, true);
  assert.equal(ctx.b2bOrderLabelJobs[1].template_ids.length, 0);
  assert.equal(ctx.b2bOrderFallbackProducts[1].sku, '');
});
