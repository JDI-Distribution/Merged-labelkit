/* Readiness, progress, print summaries, Product Master quality, and MPL productivity. */
(function () {
  const PROGRESS_STEPS = [
    'Loading order',
    'Matching SKUs',
    'Planning pallets',
    'Calculating cartons',
    'Preparing labels',
    'Rendering packing list',
    'Saving MPL',
    'Opening preview',
  ];
  const generatedOutputs = new Map();
  let readinessResolve = null;
  let mplHistoryDraftRef = null;
  let mplHistory = [];
  let mplHistoryIndex = -1;
  let generatedOutputPreviewUrl = null;

  let qualityState = null;
  async function analyzeProductRows(rawRows = []) {
    const rows = rawRows.map(normalizeProductRow);
    const result = await window.LabelKitAPI.json('/api/mpl/product-master/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: rawRows }),
    });
    result.groups = new Map(result.groups.map(group => [group.key, { ...group,
      entries: group.row_indexes.map(index => ({ row: rows[index], index })), primary: rows[group.primary_index],
    }]));
    return result;
  }
  async function loadProductQuality() {
    const rows = typeof mplProductMasterRows === 'undefined' ? [] : mplProductMasterRows;
    const key = JSON.stringify(rows);
    if (qualityState?.key === key && !qualityState.error) return qualityState.promise;
    const state = { key, result: null, error: null };
    qualityState = state;
    state.promise = analyzeProductRows(rows).then(result => {
      state.result = result;
      if (qualityState === state) renderMplProductMasterTable();
      return result;
    }).catch(error => { state.error = error; throw error; });
    return state.promise;
  }
  function productQualitySnapshot() {
    loadProductQuality().catch(error => setStatus(`Product validation failed: ${error.message}`, 'error'));
    return qualityState?.result || { groups: new Map(), rows: [], pending: true, summary: {
      configurations: 0, ready_configurations: 0, average_score: 0, needs_review_rows: 0,
    } };
  }
  function productGroupPassesFilter(group, filter, search = '', quality) {
    const haystack = group.entries.map(({ row }) => [row.storefront, row.display_sku, row.sku, row.config_id, row.gtin, row.description, row.customer_item_number].join(' ')).join(' ').toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (!filter || filter === 'all') return true;
    return group.entries.some(({ index }) => quality.rows[index]?.issues?.some(issue => issue.code === filter));
  }
  function renderProductQualitySummary(quality = productQualitySnapshot(), shown = null) {
    const target = document.getElementById('product-quality-summary');
    if (!target) return;
    const summary = quality.summary;
    if (quality.pending) { target.textContent = qualityState?.error ? 'Product validation unavailable. Retry after restoring the connection.' : 'Checking product information…'; return; }
    target.innerHTML = `<strong>${summary.average_score}% average completeness</strong> · ${summary.ready_configurations}/${summary.configurations} ready · ${summary.needs_review_rows} row(s) need review${shown === null ? '' : ` · ${shown} shown`}`;
  }

  window.focusNextProductIssue = async () => {
    const quality = await loadProductQuality();
    const priority = ['hierarchy_conflict', 'duplicate_row', 'invalid_gtin', 'missing_gtin', 'missing_label_template', 'missing_case_quantity', 'missing_dimensions', 'missing_weight', 'needs_review'];
    const candidates = [...quality.groups.values()].filter(group => group.score < 100 || group.issues.length);
    candidates.sort((left, right) => {
      const issueRank = group => Math.min(...group.issues.map(issue => priority.indexOf(issue.code)).filter(rank => rank >= 0), priority.length);
      return issueRank(left) - issueRank(right) || left.score - right.score;
    });
    const next = candidates[0];
    if (!next) {
      setStatus('Every Product Master configuration is complete.', 'success');
      return;
    }
    const search = document.getElementById('mpl-product-search');
    const customer = document.getElementById('mpl-product-storefront-filter');
    const filter = document.getElementById('mpl-product-quality-filter');
    if (search) search.value = '';
    if (customer) customer.value = '';
    if (filter) filter.value = 'all';
    renderMplProductMasterTable();
    openMplProductEditor(next.key);
    setStatus(`Opened the next configuration needing attention: ${next.issues[0]?.message || 'review required'}`, 'info');
  };

  function labelReviewDraft() {
    if (b2bOrderLabelJobs.length) {
      return { jobs: [...window.LabelKitB2BOrderJobs.expandB2BTemplateJobs(b2bOrderLabelJobs),
        ...b2bOrderLabelJobs.filter(job => job.print_selected !== false && !b2bTemplateIdsForJob(job).length)] };
    }
    return { jobs: b2bTemplateIdsForJob().map(id => buildB2BPayload(id)) };
  }
  const readinessStates = new Map();
  function readinessInputs(scope) {
    const mpl = typeof orderDocumentsState !== 'undefined' ? orderDocumentsState.mplDraft : activeKeheDocumentDraft;
    if (scope === 'operations') {
      const selected = operationsSelectedDocuments();
      const documents = [];
      if (selected.labels) documents.push({ kind: 'labels', draft: labelReviewDraft() });
      if (selected.mpl || (selected.pallets && !operationsUsesManualPalletCount(selected))) documents.push({ kind: 'masterPackingList', draft: mpl || {} });
      if (selected.pallets && operationsUsesManualPalletCount(selected)) documents.push({ kind: 'palletLabel', draft: buildOperationsManualPalletDraft() });
      return documents;
    }
    return [{ kind: scope === 'b2b' ? 'labels' : scope === 'kehe' ? (activeKeheDocumentType || 'packLabels') : 'masterPackingList',
      draft: scope === 'b2b' ? labelReviewDraft() : activeKeheDocumentDraft || {} }];
  }
  async function getReadiness(scope, force = false) {
    const inputs = readinessInputs(scope), key = JSON.stringify(inputs);
    const cached = readinessStates.get(scope);
    if (!force && cached?.key === key) return cached.promise;
    const state = { key, result: null, error: null };
    readinessStates.set(scope, state);
    state.promise = Promise.all(inputs.map(input => window.LabelKitAPI.json('/api/documents/readiness', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }))).then(results => { state.result = readinessResult(results.flatMap(result => result.issues)); return state.result; })
      .catch(error => { state.error = error; throw error; });
    return state.promise;
  }
  function labelWarnings() {
    getReadiness('b2b').catch(() => {});
    const state = readinessStates.get('b2b');
    if (!state.notified) {
      state.notified = true;
      state.promise.then(() => renderB2BValidation(), () => renderB2BValidation());
    }
    return state.result ? state.result.issues.map(issue => issue.message)
      : [state.error ? `Label validation unavailable: ${state.error.message}` : 'Checking label information…'];
  }
  function readinessResult(issues) {
    const unique = [...new Map(issues.map(issue => [`${issue.sku}|${issue.message}`, issue])).values()];
    const groups = [...unique.reduce((map, issue) => {
      const key = issue.index >= 0 ? `${issue.index}|${issue.sku}` : issue.sku;
      if (!map.has(key)) map.set(key, { sku: issue.sku, index: issue.index, issues: [], categories: new Set() });
      const group = map.get(key);
      group.issues.push(issue);
      group.categories.add(issue.category);
      return map;
    }, new Map()).values()].map(group => ({ ...group, categories: [...group.categories] }));
    const count = category => groups.filter(group => group.categories.includes(category)).length;
    return {
      ready: unique.length === 0,
      issues: unique,
      groups,
      metrics: {
        ready: unique.length === 0 ? 1 : 0,
        product: count('product'), barcode: count('barcode'), case: count('case'), dimensions: count('dimensions'), review: count('review'),
      },
    };
  }
  function readinessHtml(scope, result) {
    const m = result.metrics;
    const cards = [
      ['Ready to print', result.ready ? 'Yes' : 'Review', result.ready ? 'ready' : 'review'],
      ['Missing Product Master data', m.product, m.product ? 'review' : 'ready'],
      ['Missing barcode information', m.barcode, m.barcode ? 'review' : 'ready'],
      ['Missing case-pack quantity', m.case, m.case ? 'review' : 'ready'],
      ['Missing dimensions or weight', m.dimensions, m.dimensions ? 'review' : 'ready'],
      ['Requires label review', m.review, m.review ? 'review' : 'ready'],
    ];
    const categoryNames = { product: 'Product Master', barcode: 'Barcode', case: 'Case quantity', dimensions: 'Dimensions / weight', review: 'Label review' };
    const rows = result.groups.length ? result.groups.map(group => `
      <details class="workflow-warning-group">
        <summary><strong>${escapeHtml(group.sku)}</strong><span>${group.categories.map(category => escapeHtml(categoryNames[category] || category)).join(' · ')}</span><small>${group.issues.length} ${group.issues.length === 1 ? 'check' : 'checks'}</small></summary>
        <div class="workflow-warning-details">
          <ul>${group.issues.map(issue => `<li>${escapeHtml(issue.message)}</li>`).join('')}</ul>
          <span class="workflow-warning-actions">
          ${scope === 'b2b' && b2bSelectedProductIndex <= -1000 ? '<button class="btn-secondary" type="button" onclick="useB2BProductForRun()">Use for this run</button>' : ''}
          ${scope === 'b2b' && b2bSelectedProductIndex <= -1000 && hasPermission('table_crud') ? '<button class="btn-secondary" type="button" onclick="saveB2BProductConfiguration()">Save configuration</button>' : ''}
          <button class="btn-secondary" type="button" onclick="openProductConfigurationForIssue('${jsString(group.sku)}')">Open Product Master</button>
          </span>
        </div>
      </details>`).join('') : '<div class="workflow-warning-row"><strong>Ready</strong><small>No readiness issues were found.</small><span></span></div>';
    const affected = result.groups.length;
    return `<div class="workflow-readiness-grid">${cards.map(([label, value, state]) => `<div class="workflow-readiness-card ${state}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('')}</div>
      <section class="workflow-warning-panel"><header><div><strong>Items needing review</strong><small>Open an item only when you need its details or Product Master actions.</small></div><span>${affected} ${affected === 1 ? 'item' : 'items'}</span></header><div class="workflow-warning-list">${rows}</div></section>`;
  }
  async function showReadiness(scope, continueAction = null, prepared = null) {
    const result = prepared || await getReadiness(scope, true);
    document.getElementById('workflow-readiness-body').innerHTML = readinessHtml(scope, result);
    const button = document.getElementById('workflow-readiness-continue');
    button.textContent = result.ready ? 'Continue to generation' : 'Generate with warnings';
    button.onclick = () => { closeWorkflowReadiness(true); if (typeof continueAction === 'function') continueAction(); };
    document.getElementById('workflow-readiness-modal').classList.add('visible');
    return result;
  }

  window.openDocumentReadiness = scope => showReadiness(scope || (
    selectedKit === 'operations' ? 'operations'
      : selectedKit === 'b2b' ? 'b2b'
        : activeKeheDocumentType === 'masterPackingList' ? 'mpl' : 'kehe'
  ));
  window.confirmDocumentReadiness = async scopeOrResult => {
    const result = typeof scopeOrResult === 'string' ? await getReadiness(scopeOrResult, true) : scopeOrResult;
    if (result.ready) return true;
    await showReadiness(typeof scopeOrResult === 'string' ? scopeOrResult : '', null, result);
    return new Promise(resolve => {
      readinessResolve = resolve;
      document.getElementById('workflow-readiness-continue').onclick = () => closeWorkflowReadiness(true);
    });
  };
  window.closeWorkflowReadiness = accepted => {
    document.getElementById('workflow-readiness-modal')?.classList.remove('visible');
    if (readinessResolve) { const resolve = readinessResolve; readinessResolve = null; resolve(!!accepted); }
  };

  window.showWorkflowProgress = (activeStep = 0, message = '') => {
    document.getElementById('workflow-progress-list').innerHTML = PROGRESS_STEPS.map((step, index) => `<div class="workflow-progress-step ${index < activeStep ? 'done' : index === activeStep ? 'active' : ''}"><span></span><strong>${escapeHtml(step)}</strong><small>${index < activeStep ? 'Complete' : index === activeStep ? 'In progress' : 'Waiting'}</small></div>`).join('');
    document.getElementById('workflow-progress-message').textContent = message || PROGRESS_STEPS[activeStep] || 'Working…';
    document.getElementById('workflow-progress-modal').classList.add('visible');
  };
  window.updateWorkflowProgress = (step, message = '') => showWorkflowProgress(Math.max(0, PROGRESS_STEPS.indexOf(step)), message || step);
  window.closeWorkflowProgress = () => document.getElementById('workflow-progress-modal')?.classList.remove('visible');

  async function pdfPages(blob) {
    if (!blob || !window.pdfjsLib) return 0;
    try {
      const data = await blob.arrayBuffer();
      const documentTask = window.pdfjsLib.getDocument({ data });
      const pdf = await documentTask.promise;
      const pages = pdf.numPages || 0;
      await pdf.destroy();
      return pages;
    } catch (_err) { return 0; }
  }
  window.recordGeneratedOutput = async (key, details = {}) => {
    const pages = Number(details.pages || 0) || await pdfPages(details.blob);
    const { isCurrent, ...output } = details;
    if (isCurrent && !isCurrent()) return false;
    generatedOutputs.set(key, { ...output, pages });
    if (details.scope === 'operations' && typeof renderOperationsFiles === 'function') renderOperationsFiles();
    return pages;
  };
  window.getGeneratedOutputs = (scope = '') => [...generatedOutputs.entries()].filter(([, output]) => !scope || output.scope === scope);
  window.clearGeneratedOutputs = (...keys) => {
    keys.flat().forEach(key => generatedOutputs.delete(key));
    if (typeof renderOperationsFiles === 'function') renderOperationsFiles();
  };
  window.showPrintSummary = async (scope = selectedKit) => {
    const outputs = [...generatedOutputs.entries()].filter(([, output]) => !scope || output.scope === scope);
    const readiness = await getReadiness(['partners', 'b2b', 'kehe', 'operations'].includes(scope) ? scope : 'mpl');
    const reviewSkuCount = scope === 'b2b' && b2bOrderLabelJobs.length
      ? new Set(b2bOrderLabelJobs.filter(job => (
        job.match_status !== 'matched'
        || String(job.product?.verification_status || '').toUpperCase() !== 'VERIFIED'
        || !job.product?.gtin
      )).map(job => job.product?.sku || job.product?.customer_item_number).filter(Boolean)).size
      : new Set(readiness.issues.map(issue => issue.sku)).size;
    const metrics = {
      files: outputs.length,
      pages: outputs.reduce((sum, [, output]) => sum + Number(output.pages || 0), 0),
      labels: outputs.reduce((sum, [, output]) => sum + Number(output.labels || 0), 0),
      pallets: outputs.reduce((sum, [, output]) => sum + Number(output.pallets || 0), 0),
      review: reviewSkuCount,
    };
    const labelCounts = new Map();
    outputs.map(([, output]) => output).filter(output => Number(output.labels || 0) > 0).forEach(output => {
      const label = output.labelType || 'Labels';
      labelCounts.set(label, (labelCounts.get(label) || 0) + Number(output.labels || 0));
    });
    const summaryJobs = ['b2b', 'operations'].includes(scope) && b2bOrderLabelJobs.length
        ? window.LabelKitB2BOrderJobs.expandB2BTemplateJobs(b2bOrderLabelJobs).filter(job => job.print_selected !== false)
        : scope === 'b2b' && getSelectedB2BProduct?.()
          ? (b2bSelectedTemplateIds || []).map(templateId => ({ product: getSelectedB2BProduct(), template_id: templateId, run: b2bRunFields }))
        : [];
    const jobGroups = new Map();
    summaryJobs.forEach((job, index) => {
      const sku = job.product?.sku || job.product?.customer_item_number || `Line ${index + 1}`;
      const type = b2bLabelTemplates.find(template => template.template_id === job.template_id)?.name || job.template_id || 'Label';
      const key = `${sku}|${type}`;
      const copies = Number(job.run?.copies || 1) * Math.max(1, Number(job.run?.carton_total || 1));
      if (!jobGroups.has(key)) jobGroups.set(key, { sku, type, copies: 0 });
      jobGroups.get(key).copies += copies;
    });
    const isB2BSummary = scope === 'b2b';
    const isOperationsSummary = scope === 'operations';
    const isCompactLabelSummary = isB2BSummary || isOperationsSummary;
    const modal = document.getElementById('workflow-print-summary-modal');
    modal?.classList.toggle('workflow-print-summary-compact', isCompactLabelSummary);
    modal?.classList.remove('workflow-print-summary-partner');
    const title = document.getElementById('workflow-print-summary-title');
    const subtitle = document.getElementById('workflow-print-summary-subtitle');
    const done = document.getElementById('workflow-print-summary-done');
    if (title) title.textContent = isB2BSummary ? 'Labels ready' : isOperationsSummary ? 'Documents ready' : 'Final Print Summary';
    if (subtitle) subtitle.textContent = isB2BSummary
      ? 'Confirm this job, then continue to the PDF preview.'
      : isOperationsSummary
        ? 'The selected PDFs were created and are ready for review.'
        : 'Final generated output and remaining review items.';
    if (done) done.textContent = isB2BSummary ? 'View PDF' : isOperationsSummary ? 'Close' : 'Done';
    const metricRows = isB2BSummary
      ? [['PDF files', metrics.files], ['Pages', metrics.pages], ['Labels', metrics.labels], ['Needs review', metrics.review]]
      : isOperationsSummary
        ? [['PDF files', metrics.files], ['Pages', metrics.pages], ['Labels', metrics.labels], ['Pallets', metrics.pallets], ['Needs review', metrics.review]]
      : [['PDF files', metrics.files], ['Total pages', metrics.pages], ['Labels', metrics.labels], ['Pallets', metrics.pallets], ['SKUs requiring review', metrics.review]];
    document.getElementById('workflow-print-summary-body').innerHTML = `<div class="print-summary-grid">${metricRows
      .map(([label, value]) => `<div class="workflow-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('')}</div>
      ${jobGroups.size ? `<section class="workflow-warning-panel"><header><strong>Label job</strong><span>${jobGroups.size}</span></header><div class="workflow-warning-list">${[...jobGroups.values()].map(group => `<div class="workflow-warning-row"><strong>${escapeHtml(group.sku)}</strong><small>${escapeHtml(group.type)}</small><span>${escapeHtml(String(group.copies))} label(s)</span></div>`).join('')}</div></section>` : ''}
      ${labelCounts.size && !isCompactLabelSummary ? `<section class="workflow-warning-panel"><header><strong>Labels by type</strong><span>${labelCounts.size}</span></header><div class="workflow-warning-list">${[...labelCounts.entries()].map(([label, count]) => `<div class="workflow-warning-row"><strong>${escapeHtml(label)}</strong><small>Included in this print run</small><span>${count}</span></div>`).join('')}</div></section>` : ''}
      <section class="workflow-warning-panel"><header><div><strong>Generated files</strong><small>Open each PDF directly from here—no need to return to the document sections.</small></div><span>${outputs.length}</span></header><div class="workflow-warning-list">${outputs.length ? outputs.map(([key, output]) => `<div class="workflow-generated-file"><div><strong>${escapeHtml(output.name || 'PDF')}</strong><small>${escapeHtml(output.labelType || '')}</small></div><span>${escapeHtml(String(output.pages || 0))} page(s)</span><button class="btn-secondary" type="button" onclick="openGeneratedOutput('${jsString(key)}')">Open PDF</button></div>`).join('') : '<div class="workflow-warning-row"><strong>No PDFs</strong><small>Generate a document to populate this summary.</small><span></span></div>'}</div></section>`;
    modal?.classList.add('visible');
  };
  window.closePrintSummary = () => document.getElementById('workflow-print-summary-modal')?.classList.remove('visible');
  window.openGeneratedOutput = async key => {
    const output = generatedOutputs.get(String(key || ''));
    if (!output?.blob) return;
    if (output.kind === 'zip') {
      const url = window.LabelKitPreview.create(output.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = output.name || 'labels.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.LabelKitPreview.release(url), 60000);
      return;
    }
    generatedOutputPreviewUrl = window.LabelKitPreview.replace(generatedOutputPreviewUrl, output.blob);
    blobUrl = generatedOutputPreviewUrl;
    document.getElementById('btn-download').download = output.name || 'document.pdf';
    setDownloadReady(true, generatedOutputPreviewUrl);
    setActivePreviewFormat(output.format || (/packing list/i.test(output.labelType || '') ? 'a4' : 'rollo'));
    resetPreviewSurface();
    closePrintSummary();
    await openPreview();
  };

  window.openLabelJobSummary = scope => {
    const jobs = b2bOrderLabelJobs.length
        ? window.LabelKitB2BOrderJobs.expandB2BTemplateJobs(b2bOrderLabelJobs)
        : (getSelectedB2BProduct?.() ? (b2bSelectedTemplateIds || []).map(templateId => ({ print_selected: true, product: getSelectedB2BProduct(), template_id: templateId, run: b2bRunFields })) : []);
    const groups = new Map();
    jobs.forEach((job, index) => {
      const sku = job.product?.sku || job.product?.customer_item_number || `Line ${index + 1}`;
      const type = b2bLabelTemplates.find(template => template.template_id === job.template_id)?.name || job.template_id || 'Label';
      const key = `${sku}|${type}`;
      if (!groups.has(key)) groups.set(key, { sku, type, jobs: 0, copies: 0, selected: 0 });
      const group = groups.get(key);
      group.jobs += 1;
      group.copies += Number(job.run?.copies || 1) * Math.max(1, Number(job.run?.carton_total || 1));
      if (job.print_selected !== false) group.selected += 1;
    });
    document.getElementById('workflow-label-summary-body').innerHTML = groups.size ? `<table class="label-summary-table"><thead><tr><th>SKU</th><th>Label type</th><th>Jobs</th><th>Selected</th><th>Estimated copies</th></tr></thead><tbody>${[...groups.values()].map(group => `<tr><td>${escapeHtml(group.sku)}</td><td>${escapeHtml(group.type)}</td><td>${group.jobs}</td><td>${group.selected}</td><td>${group.copies}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-row">Load or select a label job first.</div>';
    document.getElementById('workflow-label-summary-modal').dataset.scope = scope;
    document.getElementById('workflow-label-summary-modal').classList.add('visible');
  };
  window.closeLabelJobSummary = () => document.getElementById('workflow-label-summary-modal')?.classList.remove('visible');
  window.useB2BProductForRun = () => {
    showReadiness('b2b');
    setStatus('The edited order values will be used for this label run only.', 'info');
  };
  window.saveB2BProductConfiguration = (options = {}) => {
    if (b2bSelectedProductIndex > -1000 || !hasPermission('table_crud')) return;
    const product = normalizeProductRow({
      ...(getSelectedB2BProduct() || {}),
      verification_status: getSelectedB2BProduct()?.verification_status || 'NEEDS_REVIEW',
      label_enabled: true,
      label_template_id: b2bSelectedTemplateId || getSelectedB2BProduct()?.label_template_id || '',
      source_note: `Created from Sales Order ${b2bRunFields?.order_number || ''}`,
    });
    mplProductMasterRows.push(product);
    b2bSelectedProductIndex = mplProductMasterRows.length - 1;
    b2bSelectedGroupKey = mplProductGroupKey(product, b2bSelectedProductIndex);
    const selectedJob = b2bOrderLabelJobs?.[b2bSelectedOrderJobIndex];
    if (selectedJob) {
      selectedJob.product = { ...selectedJob.product, ...product };
      selectedJob.match_status = 'matched';
      selectedJob.match_reason_code = 'created_from_order';
      selectedJob.match_reason = 'Draft Product Master configuration created from this order line.';
    }
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderB2BCreator();
    if (options.showReadinessAfter !== false) showReadiness('b2b');
    setStatus(`${product.sku || 'Product'} added to Product Master for review.`, 'success');
    return product;
  };
  window.openProductConfigurationForIssue = sku => {
    closeWorkflowReadiness(false);
    openB2BProductMaster();
    setTimeout(() => {
      const search = document.getElementById('mpl-product-search');
      if (search) search.value = sku || '';
      renderMplProductMasterTable();
    }, 100);
  };

  function cloneDraft(draft) { return JSON.parse(JSON.stringify(draft || {})); }
  function historyComparable(draft) {
    const copy = cloneDraft(draft);
    delete copy.product_master;
    Object.keys(copy).filter(key => key.startsWith('_saved_draft_')).forEach(key => delete copy[key]);
    return JSON.stringify(copy);
  }
  function updateHistoryButtons() {
    const undo = document.getElementById('btn-mpl-undo');
    const redo = document.getElementById('btn-mpl-redo');
    if (undo) undo.disabled = mplHistoryIndex <= 0;
    if (redo) redo.disabled = mplHistoryIndex < 0 || mplHistoryIndex >= mplHistory.length - 1;
  }
  window.initializeMplHistory = draft => {
    if (!draft || mplHistoryDraftRef === draft) { updateHistoryButtons(); return; }
    mplHistoryDraftRef = draft;
    mplHistory = [cloneDraft(draft)];
    mplHistoryIndex = 0;
    updateHistoryButtons();
  };
  window.captureMplHistoryCheckpoint = () => {
    if (activeKeheDocumentType !== 'masterPackingList' || !activeKeheDocumentDraft) return;
    initializeMplHistory(activeKeheDocumentDraft);
    const snapshot = cloneDraft(activeKeheDocumentDraft);
    if (historyComparable(snapshot) === historyComparable(mplHistory[mplHistoryIndex])) return;
    mplHistory = mplHistory.slice(0, mplHistoryIndex + 1);
    mplHistory.push(snapshot);
    if (mplHistory.length > 50) mplHistory.shift();
    mplHistoryIndex = mplHistory.length - 1;
    updateHistoryButtons();
  };
  function applyHistorySnapshot(index) {
    if (index < 0 || index >= mplHistory.length) return;
    mplHistoryIndex = index;
    const saved = Object.fromEntries(Object.entries(activeKeheDocumentDraft).filter(([key]) => key.startsWith('_saved_draft_')));
    Object.keys(activeKeheDocumentDraft).forEach(key => delete activeKeheDocumentDraft[key]);
    Object.assign(activeKeheDocumentDraft, cloneDraft(mplHistory[index]), saved);
    mplHistoryDraftRef = activeKeheDocumentDraft;
    markOperationsMplChanged();
    renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
    mplDraftSync?.schedule();
    updateHistoryButtons();
  }
  window.undoMplEdit = () => applyHistorySnapshot(mplHistoryIndex - 1);
  window.redoMplEdit = () => applyHistorySnapshot(mplHistoryIndex + 1);
  window.setMplReviewStatus = status => {
    if (!activeKeheDocumentDraft) return;
    captureMplHistoryCheckpoint();
    const normalized = ['DRAFT', 'REVIEWED', 'APPROVED'].includes(String(status).toUpperCase()) ? String(status).toUpperCase() : 'DRAFT';
    activeKeheDocumentDraft.review_status = normalized;
    (activeKeheDocumentDraft.packing_lists || []).forEach(mpl => { mpl.review_status = normalized; });
    captureMplHistoryCheckpoint();
    mplDraftSync?.schedule();
  };

  window.renderWorkflowWarningsInEditor = async () => {
    if (activeKeheDocumentType !== 'masterPackingList') return;
    const body = document.getElementById('document-editor-body');
    if (!body) return;
    const draft = activeKeheDocumentDraft;
    let result;
    try { result = await getReadiness('mpl'); } catch (error) { setStatus(`Readiness check failed: ${error.message}`, 'error'); return; }
    if (activeKeheDocumentDraft !== draft || activeKeheDocumentType !== 'masterPackingList' || !body.isConnected) return;
    body.querySelector('.document-editor-warning-summary')?.remove();
    const panel = document.createElement('section');
    panel.className = 'workflow-warning-panel document-editor-warning-summary';
    panel.innerHTML = `<header><strong>Document readiness</strong><button class="btn-secondary" type="button" onclick="openDocumentReadiness('mpl')">${result.ready ? 'Ready to print' : `${result.issues.length} review item(s)`}</button></header>`;
    body.prepend(panel);
  };

  window.downloadMissingProductInformation = async () => {
    const quality = await loadProductQuality();
    const rows = [['Customer', 'Product SKU', 'Level SKU', 'Packaging Level', 'GTIN', 'Completeness', 'Missing or invalid information']];
    quality.rows.forEach(result => {
      if (!result.issues.length) return;
      const product = normalizeProductRow(mplProductMasterRows[result.index] || {});
      rows.push([product.storefront, product.config_id, product.sku, product.packaging_level, product.gtin, `${result.score}%`, result.issues.map(issue => issue.message).join('; ')]);
    });
    downloadCsvRows('labelkit_missing_product_information.csv', rows);
  };
  window.validateProductNumericInput = input => {
    const valid = input?.checkValidity() ?? true;
    input?.classList.toggle('input-invalid', !valid);
    return valid;
  };
  window.downloadImportMissingInformation = () => {
    const preview = activeExcelImportPreview || {};
    const qualityRows = preview.quality?.rows || [];
    const rows = [['Row', 'Customer', 'Product SKU', 'Level SKU', 'Packaging Level', 'GTIN', 'Completeness', 'Missing or invalid information']];
    qualityRows.forEach(result => {
      if (!result.issues?.length) return;
      const product = preview.rows?.[result.index] || {};
      rows.push([result.index + 1, product.storefront, product.config_id, product.sku, product.packaging_level, product.gtin, `${result.score}%`, result.issues.map(issue => issue.message).join('; ')]);
    });
    downloadCsvRows('labelkit_import_missing_information.csv', rows);
  };

  window.duplicateSavedMplDraft = async draftId => {
    try {
      const response = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Could not copy this packing list.');
      const record = data.draft || {};
      const draft = cloneDraft(record.draft || {});
      delete draft._saved_draft_id;
      delete draft._saved_draft_revision;
      const copyTime = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      draft._saved_draft_name = `Copy of ${record.name || 'MPL'} · ${copyTime}`;
      draft.review_status = 'DRAFT';
      (draft.packing_lists || []).forEach(mpl => { mpl.review_status = 'DRAFT'; });
      activeKeheDocumentType = 'masterPackingList';
      activeKeheDocumentDraft = draft;
      closeSavedMplModal(false);
      renderDocumentEditor('masterPackingList', draft);
      openDocumentEditor();
      setStatus('Packing list copied. Rename and save it as a new MPL.', 'success');
    } catch (error) { setStatus(`Copy failed: ${error.message}`, 'error'); }
  };

  function flattenMplForComparison(draft = {}) {
    const mpl = draft.packing_lists?.[0] || {};
    return {
      'Review Status': draft.review_status || mpl.review_status || 'DRAFT',
      'Customer PO': mpl.customer_po_number || '', 'Order Number': mpl.order_no || '', 'Ship To': mpl.ship_to || '',
      'Total Weight': mpl.total_weight || '', 'Total Pallets': mpl.total_pallets || '', 'Ship Date': mpl.est_ship_date || '',
      'Line Items': (mpl.items || []).length, 'Total Shipped': (mpl.items || []).reduce((sum, item) => sum + (Number(item.total_shipped) || 0), 0),
      'Warnings': (mpl.warnings || []).join('; '),
    };
  }
  window.compareMplVersion = async versionId => {
    const draftId = activeKeheDocumentDraft?._saved_draft_id;
    if (!draftId) return;
    try {
      const response = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}/versions/${encodeURIComponent(versionId)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Could not load this version.');
      const previous = flattenMplForComparison(data.version?.draft || {});
      const current = flattenMplForComparison(activeKeheDocumentDraft);
      document.getElementById('mpl-version-compare-body').innerHTML = `<table class="version-compare-table"><thead><tr><th>Field</th><th>Selected version</th><th>Current MPL</th></tr></thead><tbody>${Object.keys(current).map(field => `<tr class="${String(previous[field]) !== String(current[field]) ? 'version-change' : ''}"><td>${escapeHtml(field)}</td><td>${escapeHtml(String(previous[field] ?? ''))}</td><td>${escapeHtml(String(current[field] ?? ''))}</td></tr>`).join('')}</tbody></table>`;
      document.getElementById('mpl-version-compare-modal').classList.add('visible');
    } catch (error) { setStatus(`Comparison failed: ${error.message}`, 'error'); }
  };
  window.closeMplVersionComparison = () => document.getElementById('mpl-version-compare-modal')?.classList.remove('visible');

  window.showImportResultReport = (preview, selectedRows) => {
    const selectedIndexes = selectedRows.map(row => (preview.rows || []).indexOf(row)).filter(index => index >= 0);
    const selectedKeys = new Set(selectedIndexes.map(index => importPreviewRowKey(preview.rows[index], index)));
    const actions = { add: 0, update: 0, unchanged: 0 };
    selectedRows.forEach(row => {
      const index = (preview.rows || []).indexOf(row);
      const key = importPreviewRowKey(row, index);
      const action = importPreviewRowAction((preview.changes || []).filter(change => String(change.record_key || '') === key));
      actions[action] = (actions[action] || 0) + 1;
    });
    const qualityRows = (preview.quality?.rows || []).filter(row => selectedKeys.has(importPreviewRowKey(preview.rows?.[row.index] || {}, row.index)));
    const duplicate = qualityRows.filter(row => row.status === 'duplicate').length;
    const invalid = qualityRows.filter(row => row.status === 'invalid').length;
    const review = qualityRows.filter(row => row.status !== 'ready').length;
    const target = document.getElementById('excel-import-result-summary');
    target.innerHTML = [['New configurations', actions.add || 0], ['Updated configurations', actions.update || 0], ['Unchanged configurations', actions.unchanged || 0], ['Duplicate rows', duplicate], ['Invalid rows', invalid], ['Rows requiring review', review]].map(([label, value]) => `<div class="workflow-metric"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join('');
    target.classList.add('visible');
  };

  window.LabelKitWorkflow = {
    analyzeProductRows,
    productQualitySnapshot,
    productGroupPassesFilter,
    renderProductQualitySummary,
    labelWarnings,
    getReadiness,
    generatedOutputs,
  };
})();
