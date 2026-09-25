/* Readiness, progress, print summaries, Product Master quality, and MPL productivity. */
(function () {
  const PROGRESS_STEPS = [
    'Loading order',
    'Matching SKUs',
    'Calculating cartons',
    'Preparing labels',
    'Rendering packing list',
    'Saving MPL',
    'Opening preview',
  ];
  const generatedOutputs = new Map();
  const partnerStaleKinds = new Set();
  let readinessResolve = null;
  let mplHistoryDraftRef = null;
  let mplHistory = [];
  let mplHistoryIndex = -1;
  let singlePartnerPreviewUrl = null;
  let generatedOutputPreviewUrl = null;

  function digits(value) { return String(value || '').replace(/\D/g, ''); }
  function positive(value, whole = false) {
    const number = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(number) && number > 0 && (!whole || Number.isInteger(number));
  }
  function gtinValid(value) {
    const valueDigits = digits(value);
    if (![8, 12, 13, 14].includes(valueDigits.length)) return false;
    const body = valueDigits.slice(0, -1).split('').map(Number).reverse();
    const sum = body.reduce((total, number, index) => total + number * (index % 2 === 0 ? 3 : 1), 0);
    return ((10 - (sum % 10)) % 10) === Number(valueDigits.at(-1));
  }
  function qualityGroupKey(row, index = 0) {
    const storefront = String(row?.storefront || '').trim().toLowerCase() || 'no-storefront';
    const identity = String(row?.config_id || row?.sku || row?.customer_item_number || row?.gtin || `row-${index}`).trim().toLowerCase();
    return `${storefront}|${identity}`;
  }
  function qualityIssue(code, message, severity = 'review') { return { code, message, severity }; }

  function analyzeProductRows(rawRows = []) {
    const rows = rawRows.map(row => typeof normalizeProductRow === 'function' ? normalizeProductRow(row) : { ...row });
    const groups = new Map();
    rows.forEach((row, index) => {
      const key = qualityGroupKey(row, index);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ row, index });
    });
    const duplicateCounts = new Map();
    rows.forEach(row => {
      const key = [row.storefront, row.sku, row.packaging_level, digits(row.gtin), row.config_id].map(value => String(value || '').trim().toLowerCase()).join('|');
      duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
    });
    const groupResults = new Map();
    const rowResults = rows.map((_row, index) => ({ index, issues: [], score: 0, status: 'ready' }));

    groups.forEach((entries, key) => {
      const level = wanted => entries.find(entry => normalizePackagingLevel(entry.row.packaging_level) === wanted)?.row;
      const each = level('Each');
      const inner = level('Inner Pack');
      const caseRow = level('Case');
      const primary = caseRow || inner || each || entries[0].row;
      const groupIssues = [];
      if (!each?.gtin) groupIssues.push(qualityIssue('missing_each_gtin', 'Each-level GTIN is missing.'));
      const levelCounts = new Map();
      entries.forEach(entry => {
        const name = normalizePackagingLevel(entry.row.packaging_level);
        levelCounts.set(name, (levelCounts.get(name) || 0) + 1);
      });
      levelCounts.forEach((count, name) => {
        if (name !== 'Other' && count > 1) groupIssues.push(qualityIssue('duplicate_row', `${count} ${name} rows exist in this configuration.`, 'duplicate'));
      });
      const eachQty = Number(each?.case_qty || 0);
      const innerQty = Number(inner?.case_qty || 0);
      const caseQty = Number(caseRow?.case_qty || 0);
      const innersPerCase = Number(caseRow?.inner_packs_per_case || 0);
      if (each && positive(each.case_qty, true) && eachQty !== 1) groupIssues.push(qualityIssue('hierarchy_conflict', 'Each quantity must equal 1.', 'invalid'));
      if (inner && caseRow && (!positive(innersPerCase, true) || caseQty !== innerQty * innersPerCase)) groupIssues.push(qualityIssue('hierarchy_conflict', 'Case quantity must equal eaches per inner × inner packs per case.', 'invalid'));

      const criteria = {
        identity: !!(each?.sku || primary.sku || primary.config_id),
        description: !!primary.description,
        gtin: !!primary.gtin && gtinValid(primary.gtin),
        each_gtin: !!each?.gtin && gtinValid(each.gtin),
        package_quantity: normalizePackagingLevel(primary.packaging_level) === 'Each' || positive(primary.case_qty, true),
        dimensions: ['length_in', 'width_in', 'height_in'].every(field => positive(primary[field])),
        weight: positive(primary.gross_weight_lbs),
        each_weight: positive(each?.each_net_weight_g || primary.each_net_weight_g),
        label_template: primary.label_enabled ? !!primary.label_template_id : true,
        verified: String(primary.verification_status || '').toUpperCase() === 'VERIFIED',
        hierarchy: !groupIssues.some(issue => ['invalid', 'duplicate'].includes(issue.severity)),
      };
      const score = Math.round(100 * Object.values(criteria).filter(Boolean).length / Object.keys(criteria).length);
      const commonIssues = [...groupIssues];
      if (!['length_in', 'width_in', 'height_in'].every(field => positive(primary[field]))) commonIssues.push(qualityIssue('missing_dimensions', `${primary.packaging_level || 'Outermost'} dimensions are incomplete.`));
      if (!positive(primary.gross_weight_lbs)) commonIssues.push(qualityIssue('missing_weight', 'Outermost packaged weight is missing.'));
      if (!positive(each?.each_net_weight_g || primary.each_net_weight_g)) commonIssues.push(qualityIssue('missing_weight', 'Each weight is missing.'));
      if (normalizePackagingLevel(primary.packaging_level) !== 'Each' && !positive(primary.case_qty, true)) commonIssues.push(qualityIssue('missing_case_quantity', `${primary.packaging_level} quantity is missing.`));
      if (primary.label_enabled && !primary.label_template_id) commonIssues.push(qualityIssue('missing_label_template', 'Label template is missing.'));
      if (String(primary.verification_status || '').toUpperCase() !== 'VERIFIED') commonIssues.push(qualityIssue('needs_review', 'Configuration is Draft or Needs Review.'));

      entries.forEach(({ row, index }) => {
        const issues = [...commonIssues];
        if (!row.gtin) issues.push(qualityIssue('missing_gtin', 'GTIN is missing.'));
        else if (!gtinValid(row.gtin)) issues.push(qualityIssue('invalid_gtin', 'GTIN check digit or length is invalid.', 'invalid'));
        const duplicateKey = [row.storefront, row.sku, row.packaging_level, digits(row.gtin), row.config_id].map(value => String(value || '').trim().toLowerCase()).join('|');
        if (duplicateKey.replaceAll('|', '') && duplicateCounts.get(duplicateKey) > 1) issues.push(qualityIssue('duplicate_row', 'Duplicate configuration row.', 'duplicate'));
        rowResults[index] = {
          index,
          score,
          issues: [...new Map(issues.map(issue => [`${issue.code}|${issue.message}`, issue])).values()],
        };
        rowResults[index].status = rowResults[index].issues.some(issue => issue.severity === 'invalid') ? 'invalid'
          : rowResults[index].issues.some(issue => issue.severity === 'duplicate') ? 'duplicate'
          : rowResults[index].issues.length ? 'review' : 'ready';
      });
      groupResults.set(key, { key, entries, primary, score, criteria, issues: commonIssues });
    });
    const groupsList = [...groupResults.values()];
    return {
      groups: groupResults,
      rows: rowResults,
      summary: {
        configurations: groupsList.length,
        ready_configurations: groupsList.filter(group => group.score === 100).length,
        average_score: groupsList.length ? Math.round(groupsList.reduce((sum, group) => sum + group.score, 0) / groupsList.length) : 0,
        duplicate_rows: rowResults.filter(row => row.status === 'duplicate').length,
        invalid_rows: rowResults.filter(row => row.status === 'invalid').length,
        needs_review_rows: rowResults.filter(row => row.status !== 'ready').length,
      },
    };
  }

  function productQualitySnapshot() { return analyzeProductRows(typeof mplProductMasterRows === 'undefined' ? [] : mplProductMasterRows); }
  function productGroupPassesFilter(group, filter, search = '') {
    const haystack = group.entries.map(({ row }) => [row.storefront, row.display_sku, row.sku, row.config_id, row.gtin, row.description, row.customer_item_number].join(' ')).join(' ').toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (!filter || filter === 'all') return true;
    return group.entries.some(({ index }) => productQualitySnapshot().rows[index]?.issues?.some(issue => issue.code === filter));
  }
  function renderProductQualitySummary(quality = productQualitySnapshot(), shown = null) {
    const target = document.getElementById('product-quality-summary');
    if (!target) return;
    const summary = quality.summary;
    target.innerHTML = `<strong>${summary.average_score}% average completeness</strong> · ${summary.ready_configurations}/${summary.configurations} ready · ${summary.needs_review_rows} row(s) need review${shown === null ? '' : ` · ${shown} shown`}`;
  }

  function readinessItem(sku, message, category, index = -1) { return { sku: sku || 'Unidentified SKU', message, category, index }; }
  function collectPartnerReadiness() {
    const issues = [];
    (partnerLabelJobs || []).forEach((job, index) => {
      if (!job.print_selected) return;
      const product = job.product || {};
      const sku = product.sku || product.customer_item_number || `Line ${index + 1}`;
      if (!['matched', 'run_only'].includes(job.match_status)) issues.push(readinessItem(sku, 'Product Master configuration was not matched.', 'product', index));
      if (!isPartnerPalletLabelJob(job) && job.run?.print_barcode && (!product.gtin || !gtinValid(product.gtin))) issues.push(readinessItem(sku, 'Barcode GTIN is missing or invalid.', 'barcode', index));
      if (!positive(product.case_qty, true) && !isPartnerPalletLabelJob(job)) issues.push(readinessItem(sku, 'Case-pack quantity is missing.', 'case', index));
      if (!isPartnerPalletLabelJob(job) && !['length_in', 'width_in', 'height_in'].every(field => positive(product[field]))) issues.push(readinessItem(sku, 'Dimensions are incomplete.', 'dimensions', index));
      if (!isPartnerPalletLabelJob(job) && !positive(product.gross_weight_lbs)) issues.push(readinessItem(sku, 'Gross weight is missing.', 'dimensions', index));
      if (String(product.verification_status || '').toUpperCase() !== 'VERIFIED') issues.push(readinessItem(sku, `Product status is ${product.verification_status || 'not set'}.`, 'review', index));
    });
    return readinessResult(issues);
  }
  function collectB2BReadiness() {
    const product = getSelectedB2BProduct?.() || {};
    const sku = product.sku || product.customer_item_number || 'Selected label';
    const issues = (getB2BValidationWarnings?.() || []).map(message => readinessItem(sku, message, /barcode|gtin/i.test(message) ? 'barcode' : /case|quantity/i.test(message) ? 'case' : 'review'));
    return readinessResult(issues);
  }
  function collectMplReadiness(draft = activeKeheDocumentDraft) {
    const issues = [];
    (draft?.packing_lists || []).forEach((mpl, mplIndex) => {
      const palletWeights = mpl?._pallet_weights || {};
      const palletIds = Array.isArray(mpl?._pallet_ids) && mpl._pallet_ids.length ? mpl._pallet_ids : Object.keys(palletWeights);
      palletIds.forEach(pallet => {
        if (!String(palletWeights[pallet] || '').trim()) issues.push(readinessItem(`Pallet ${pallet}`, 'Pallet weight is missing.', 'dimensions'));
      });
      Object.entries(palletWeights).forEach(([pallet, weight]) => {
        if (String(weight || '').trim() && !positive(String(weight).replace(/[^0-9.-]/g, ''))) issues.push(readinessItem(`Pallet ${pallet}`, 'Pallet weight must be a positive number.', 'review'));
      });
      (mpl.items || []).forEach((item, itemIndex) => {
        const sku = item.sku || item.item_number || `MPL ${mplIndex + 1}, line ${itemIndex + 1}`;
        const ordered = Number(item.total_ordered || 0);
        const shipped = Number(item.total_shipped || 0);
        const palletQty = Number(item.qty_on_pallet || 0);
        [['Total ordered', item.total_ordered], ['Total shipped', item.total_shipped], ['Quantity on pallet', item.qty_on_pallet]].forEach(([label, value]) => {
          if (String(value || '').trim() && (!Number.isFinite(Number(value)) || Number(value) < 0)) issues.push(readinessItem(sku, `${label} must be zero or a positive number.`, 'review'));
        });
        if (ordered > 0 && !String(item.total_shipped || '').trim()) issues.push(readinessItem(sku, 'Total shipped is missing.', 'review'));
        if (ordered && shipped && ordered !== shipped) issues.push(readinessItem(sku, `Total ordered (${ordered}) does not match total shipped (${shipped}).`, 'review'));
        if (shipped && palletQty && palletQty > shipped) issues.push(readinessItem(sku, 'Quantity on pallet exceeds total shipped.', 'review'));
        if (!item.item_number) issues.push(readinessItem(sku, 'Item Number is missing.', 'product'));
        if (!item.description) issues.push(readinessItem(sku, 'Item Description is missing.', 'product'));
      });
      (mpl.warnings || []).forEach(message => issues.push(readinessItem(mpl.customer_po_number || `MPL ${mplIndex + 1}`, message, 'review')));
    });
    return readinessResult(issues);
  }
  function collectKeheLabelReadiness(draft = activeKeheDocumentDraft) {
    const issues = [];
    if (activeKeheDocumentType === 'packLabels') {
      (draft?.pack_labels || []).forEach((label, index) => {
        if (label.print_selected === false) return;
        const sku = label.sku || label.item_number || label.id || `Pack label ${index + 1}`;
        if (!label.gtin || !gtinValid(label.gtin)) issues.push(readinessItem(sku, 'Barcode GTIN is missing or has an invalid check digit.', 'barcode', index));
        if (!positive(label.case_qty, true)) issues.push(readinessItem(sku, 'Case-pack quantity is missing or invalid.', 'case', index));
        if (!positive(String(label.gross_weight_lbs || label.weight_lbs || '').replace(/[^0-9.-]/g, ''))) issues.push(readinessItem(sku, 'Package weight is missing or invalid.', 'dimensions', index));
        if (String(label.status || '').toLowerCase().includes('review')) issues.push(readinessItem(sku, 'Label source data requires review.', 'review', index));
        (label.warnings || []).forEach(message => issues.push(readinessItem(sku, message, 'review', index)));
      });
    } else if (activeKeheDocumentType === 'palletLabel') {
      (draft?.pallets || []).forEach((pallet, index) => {
        const name = pallet.id || `Pallet ${index + 1}`;
        if (!pallet.customer_po_numbers) issues.push(readinessItem(name, 'Customer PO number is missing.', 'review', index));
        if (!pallet.ship_to) issues.push(readinessItem(name, 'Ship To information is missing.', 'product', index));
        if (String(pallet.status || '').toLowerCase().includes('review')) issues.push(readinessItem(name, 'Pallet label source data requires review.', 'review', index));
        (pallet.warnings || []).forEach(message => issues.push(readinessItem(name, message, 'review', index)));
      });
    }
    return readinessResult(issues);
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
  function getReadiness(scope) {
    if (scope === 'partners') return collectPartnerReadiness();
    if (scope === 'b2b') return collectB2BReadiness();
    if (scope === 'kehe') return collectKeheLabelReadiness();
    return collectMplReadiness();
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
          ${scope === 'partners' && group.index >= 0 ? `<button class="btn-secondary" type="button" onclick="usePartnerProductForRun(${group.index})">Use current values</button>` : ''}
          ${scope === 'partners' && group.index >= 0 && hasPermission('table_crud') ? `<button class="btn-secondary" type="button" onclick="savePartnerProductConfiguration(${group.index})">Save to Product Master</button>` : ''}
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
  function showReadiness(scope, continueAction = null) {
    const result = getReadiness(scope);
    document.getElementById('workflow-readiness-body').innerHTML = readinessHtml(scope, result);
    const button = document.getElementById('workflow-readiness-continue');
    button.textContent = result.ready ? 'Continue to generation' : 'Generate with warnings';
    button.onclick = () => { closeWorkflowReadiness(true); if (typeof continueAction === 'function') continueAction(); };
    document.getElementById('workflow-readiness-modal').classList.add('visible');
    return result;
  }

  window.openDocumentReadiness = scope => showReadiness(scope || (
    selectedKit === 'partners' ? 'partners'
      : selectedKit === 'b2b' ? 'b2b'
        : activeKeheDocumentType === 'masterPackingList' ? 'mpl' : 'kehe'
  ));
  window.confirmDocumentReadiness = scope => {
    if (getReadiness(scope).ready) return Promise.resolve(true);
    return new Promise(resolve => {
      readinessResolve = resolve;
      showReadiness(scope);
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
    generatedOutputs.set(key, { ...details, pages });
    return pages;
  };
  window.clearGeneratedOutputs = (...keys) => keys.flat().forEach(key => generatedOutputs.delete(key));
  window.showPrintSummary = (scope = selectedKit) => {
    const outputs = [...generatedOutputs.entries()].filter(([, output]) => !scope || output.scope === scope);
    const readiness = getReadiness(['partners', 'b2b', 'kehe'].includes(scope) ? scope : 'mpl');
    const metrics = {
      files: outputs.length,
      pages: outputs.reduce((sum, [, output]) => sum + Number(output.pages || 0), 0),
      labels: outputs.reduce((sum, [, output]) => sum + Number(output.labels || 0), 0),
      pallets: outputs.reduce((sum, [, output]) => sum + Number(output.pallets || 0), 0),
      review: new Set(readiness.issues.map(issue => issue.sku)).size,
    };
    const labelCounts = new Map();
    outputs.map(([, output]) => output).filter(output => Number(output.labels || 0) > 0).forEach(output => {
      const label = output.labelType || 'Labels';
      labelCounts.set(label, (labelCounts.get(label) || 0) + Number(output.labels || 0));
    });
    const summaryJobs = scope === 'partners'
      ? (partnerLabelJobs || []).filter(job => job.print_selected !== false)
      : scope === 'b2b' && getSelectedB2BProduct?.()
        ? [{ product: getSelectedB2BProduct(), template_id: b2bSelectedTemplateId, run: b2bRunFields }]
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
    const isPartnerSummary = scope === 'partners';
    const isCompactLabelSummary = isB2BSummary || isPartnerSummary;
    const modal = document.getElementById('workflow-print-summary-modal');
    modal?.classList.toggle('workflow-print-summary-compact', isCompactLabelSummary);
    modal?.classList.toggle('workflow-print-summary-partner', isPartnerSummary);
    const title = document.getElementById('workflow-print-summary-title');
    const subtitle = document.getElementById('workflow-print-summary-subtitle');
    const done = document.getElementById('workflow-print-summary-done');
    if (title) title.textContent = isB2BSummary ? 'Labels ready' : isPartnerSummary ? 'Documents ready' : 'Final Print Summary';
    if (subtitle) subtitle.textContent = isB2BSummary
      ? 'Confirm this job, then continue to the PDF preview.'
      : isPartnerSummary
        ? 'The selected PDFs were created and are ready for review.'
        : 'Final generated output and remaining review items.';
    if (done) done.textContent = isB2BSummary ? 'View PDF' : isPartnerSummary ? 'Close' : 'Done';
    const metricRows = isB2BSummary
      ? [['PDF files', metrics.files], ['Pages', metrics.pages], ['Labels', metrics.labels], ['Needs review', metrics.review]]
      : isPartnerSummary
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
    if (generatedOutputPreviewUrl) URL.revokeObjectURL(generatedOutputPreviewUrl);
    generatedOutputPreviewUrl = URL.createObjectURL(output.blob);
    blobUrl = generatedOutputPreviewUrl;
    document.getElementById('btn-download').download = output.name || 'document.pdf';
    setDownloadReady(true, generatedOutputPreviewUrl);
    setActivePreviewFormat(output.format || (/packing list/i.test(output.labelType || '') ? 'a4' : 'rollo'));
    resetPreviewSurface();
    closePrintSummary();
    await openPreview();
  };

  window.openLabelJobSummary = scope => {
    const jobs = scope === 'partners' ? (partnerLabelJobs || []) : (getSelectedB2BProduct?.() ? [{ print_selected: true, product: getSelectedB2BProduct(), template_id: b2bSelectedTemplateId, run: b2bRunFields }] : []);
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
    document.getElementById('workflow-label-batch-actions')?.classList.toggle('hidden', scope !== 'partners');
    document.getElementById('workflow-label-summary-modal').classList.add('visible');
  };
  window.closeLabelJobSummary = () => document.getElementById('workflow-label-summary-modal')?.classList.remove('visible');
  window.selectAllPartnerLabels = (selected, kind = '') => {
    const refreshSummary = document.getElementById('workflow-label-summary-modal')?.classList.contains('visible');
    partnerLabelJobs.forEach(job => {
      if (!kind || isPartnerPalletLabelJob(job) === (kind === 'palletLabel')) job.print_selected = !!selected;
    });
    partnerStaleKinds.add('packLabels'); partnerStaleKinds.add('palletLabel');
    renderPartnerSelectionState();
    if (refreshSummary) openLabelJobSummary('partners');
  };
  window.resetPartnerLabelCopies = (kind = '') => {
    const refreshSummary = document.getElementById('workflow-label-summary-modal')?.classList.contains('visible');
    partnerLabelJobs.forEach(job => {
      if (kind && isPartnerPalletLabelJob(job) !== (kind === 'palletLabel')) return;
      const template = b2bLabelTemplates.find(candidate => candidate.template_id === job.template_id) || {};
      job.run.copies = String(job.template_id === 'FANCY_PALLET_3X3' ? 2 : job.product?.default_copies || template.default_copies || 1);
    });
    partnerStaleKinds.add('packLabels'); partnerStaleKinds.add('palletLabel');
    renderPartnerSelectionState();
    if (refreshSummary) openLabelJobSummary('partners');
  };
  window.markPartnerPreviewStale = kind => { partnerStaleKinds.add(kind); renderPartnerSelectionState(); };
  window.clearPartnerPreviewStale = kind => partnerStaleKinds.delete(kind);
  window.partnerPreviewIsStale = kind => partnerStaleKinds.has(kind);

  window.regeneratePartnerLabel = async index => {
    const job = partnerLabelJobs[index];
    if (!job) return;
    try {
      showWorkflowProgress(3, `Preparing ${job.product?.sku || 'label'}…`);
      const response = await fetch('/api/partner/render-labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobs: [{ ...job, print_selected: true }] }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Label could not be rendered.');
      const blob = await response.blob();
      if (singlePartnerPreviewUrl) URL.revokeObjectURL(singlePartnerPreviewUrl);
      singlePartnerPreviewUrl = URL.createObjectURL(blob);
      closeWorkflowProgress();
      blobUrl = singlePartnerPreviewUrl;
      setDownloadReady(true, singlePartnerPreviewUrl);
      document.getElementById('btn-download').download = `${job.product?.sku || 'label'}_${job.template_id || 'label'}.pdf`;
      resetPreviewSurface();
      await openPreview();
    } catch (error) { closeWorkflowProgress(); setStatus(`Label generation failed: ${error.message}`, 'error'); }
  };

  window.usePartnerProductForRun = index => {
    const job = partnerLabelJobs[index];
    if (!job) return;
    job.match_status = 'run_only';
    showReadiness('partners');
    setStatus(`${job.product?.sku || 'Order item'} will use the current values for this run only.`, 'info');
  };
  window.savePartnerProductConfiguration = index => {
    const job = partnerLabelJobs[index];
    if (!job || !hasPermission('table_crud')) return;
    const product = { ...(job.product || {}), verification_status: job.product?.verification_status || 'NEEDS_REVIEW', label_enabled: !!job.template_id, label_template_id: job.template_id || job.product?.label_template_id || '', source_note: `Created from Sales Order ${partnerOrderPayload?.sales_order_number || ''}` };
    addMplProductRow(product);
    job.match_status = 'matched';
    showReadiness('partners');
    setStatus(`${product.sku || 'Product'} added to Product Master for review.`, 'success');
  };
  window.useB2BProductForRun = () => {
    showReadiness('b2b');
    setStatus('The edited order values will be used for this label run only.', 'info');
  };
  window.saveB2BProductConfiguration = () => {
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
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderB2BCreator();
    showReadiness('b2b');
    setStatus(`${product.sku || 'Product'} added to Product Master for review.`, 'success');
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
    delete copy._saved_draft_revision;
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
    activeKeheDocumentDraft = cloneDraft(mplHistory[index]);
    mplHistoryDraftRef = activeKeheDocumentDraft;
    if (selectedKit === 'partners') partnerMplDraft = activeKeheDocumentDraft;
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

  window.renderWorkflowWarningsInEditor = () => {
    if (activeKeheDocumentType !== 'masterPackingList') return;
    const body = document.getElementById('document-editor-body');
    if (!body) return;
    const result = collectMplReadiness(activeKeheDocumentDraft);
    const panel = document.createElement('section');
    panel.className = 'workflow-warning-panel document-editor-warning-summary';
    panel.innerHTML = `<header><strong>Document readiness</strong><button class="btn-secondary" type="button" onclick="openDocumentReadiness('mpl')">${result.ready ? 'Ready to print' : `${result.issues.length} review item(s)`}</button></header>`;
    body.prepend(panel);
  };

  window.downloadMissingProductInformation = () => {
    const quality = productQualitySnapshot();
    const rows = [['Storefront', 'Config ID', 'SKU', 'Packaging Level', 'GTIN', 'Completeness', 'Missing or invalid information']];
    quality.rows.forEach(result => {
      if (!result.issues.length) return;
      const product = normalizeProductRow(mplProductMasterRows[result.index] || {});
      rows.push([product.storefront, product.config_id, product.sku, product.packaging_level, product.gtin, `${result.score}%`, result.issues.map(issue => issue.message).join('; ')]);
    });
    downloadCsvRows('labelkit_missing_product_information.csv', rows);
  };
  window.validateProductNumericInput = (input, whole = false) => {
    const value = String(input?.value || '').trim();
    const valid = !value || positive(value, whole);
    input?.setCustomValidity(valid ? '' : whole ? 'Enter a positive whole number.' : 'Enter a positive number.');
    input?.classList.toggle('input-invalid', !valid);
    return valid;
  };
  window.downloadImportMissingInformation = () => {
    const preview = activeExcelImportPreview || {};
    const qualityRows = preview.quality?.rows || [];
    const rows = [['Row', 'Storefront', 'Config ID', 'SKU', 'Packaging Level', 'GTIN', 'Completeness', 'Missing or invalid information']];
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
      draft._saved_draft_name = `Copy of ${record.name || 'MPL'}`;
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
    gtinValid,
    generatedOutputs,
    partnerStaleKinds,
  };
})();
