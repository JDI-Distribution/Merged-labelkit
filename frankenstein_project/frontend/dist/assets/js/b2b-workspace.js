/* B2B label configuration, editing, validation, and rendering workflow. */
  async function loadB2BLabelTemplates() {
    try {
      const res = await fetchWithTimeout('/api/b2b/label-templates', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load templates.');
      b2bLabelTemplates = Array.isArray(payload.templates)
        ? payload.templates.filter(template => template && template.template_id)
        : [];
      return b2bLabelTemplates;
    } catch (err) {
      b2bLabelTemplates = [];
      setStatus(`Could not load B2B templates: ${err.message || 'unknown error'}`, 'error');
      return [];
    }
  }

  function getB2BProductEntries(customer = b2bSelectedCustomer) {
    const rawCustomer = String(customer || '').trim();
    const normalizedCustomer = rawCustomer ? normalizeStorefront(rawCustomer).toLowerCase() : '';
    const savedEntries = mplProductMasterRows
      .map((raw, index) => ({ row: normalizeProductRow(raw), index }))
      .filter(({ row }) => !isKeheStorefront(row.storefront))
      .filter(({ row }) => hasPermission('table_crud') || (
        row.is_active
        && row.label_enabled
        && row.verification_status !== 'BLOCKED'
      ))
      .filter(({ row }) => !normalizedCustomer || normalizeStorefront(row.storefront).toLowerCase() === normalizedCustomer)
      .filter(({ row }) => row.config_id || row.sku || row.customer_item_number || row.description || row.label_template_id);
    const fallbackEntries = b2bOrderFallbackProducts
      .map((raw, index) => ({ row: normalizeProductRow(raw), index: -1000 - index }))
      .filter(({ row }) => !normalizedCustomer || normalizeStorefront(row.storefront).toLowerCase() === normalizedCustomer);
    return [...savedEntries, ...fallbackEntries];
  }

  function getB2BProductGroups(customer = b2bSelectedCustomer) {
    const groups = new Map();
    getB2BProductEntries(customer).forEach(entry => {
      const key = mplProductGroupKey(entry.row, entry.index);
      if (!groups.has(key)) groups.set(key, { key, entries: [] });
      groups.get(key).entries.push(entry);
    });
    return [...groups.values()].sort((left, right) => {
      const a = left.entries[0]?.row || {};
      const b = right.entries[0]?.row || {};
      return `${a.description}|${a.config_id}`.localeCompare(`${b.description}|${b.config_id}`, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  function getB2BDirectoryEntries(customer = b2bSelectedCustomer) {
    const normalizedCustomer = normalizeStorefront(customer).toLowerCase();
    return mplDirectoryRows
      .map((raw, index) => ({ row: normalizeDcDirectoryRow(raw), index }))
      .filter(({ row }) => normalizeStorefront(row.storefront).toLowerCase() === normalizedCustomer)
      .filter(({ row }) => directoryHasRole(row, 'SHIP_TO'))
      .filter(({ row }) => hasPermission('table_crud') || row.is_active);
  }

  function getSelectedB2BProduct() {
    if (b2bSelectedProductIndex >= 0) {
      return normalizeProductRow(mplProductMasterRows[b2bSelectedProductIndex] || {});
    }
    if (b2bSelectedProductIndex <= -1000) {
      return normalizeProductRow(b2bOrderFallbackProducts[-1000 - b2bSelectedProductIndex] || {});
    }
    return null;
  }

  async function openMplVersionHistory() {
    const draftId = activeKeheDocumentDraft?._saved_draft_id;
    if (!draftId) {
      setStatus('Save the MPL once before opening version history.', 'error');
      return;
    }
    const modal = document.getElementById('mpl-version-modal');
    const list = document.getElementById('mpl-version-list');
    if (list) list.innerHTML = '<div class="empty-row">Loading versions…</div>';
    modal?.classList.add('visible');
    try {
      const res = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}/versions`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not load version history.');
      mplVersionHistory = Array.isArray(data.versions) ? data.versions : [];
      if (!list) return;
      list.innerHTML = mplVersionHistory.length ? mplVersionHistory.map(version => `
        <div class="mpl-version-row">
          <strong>Version ${escapeHtml(String(version.revision || '—'))}</strong>
          <div>${escapeHtml(version.reason || 'Explicit save')}<small>${escapeHtml(formatDateTime(version.updated_at))} · ${escapeHtml(version.updated_by || 'Unknown user')}</small></div>
          <button class="btn-secondary" type="button" onclick="compareMplVersion('${jsString(version.id)}')">Compare</button>
          <button class="btn-secondary" type="button" onclick="restoreMplVersion('${jsString(version.id)}')">Restore</button>
        </div>`).join('') : '<div class="empty-row">No explicit versions have been saved yet.</div>';
    } catch (err) {
      if (list) list.innerHTML = `<div class="empty-row">${escapeHtml(err.message || 'Could not load version history.')}</div>`;
    }
  }

  function closeMplVersionHistory() {
    document.getElementById('mpl-version-modal')?.classList.remove('visible');
  }

  async function restoreMplVersion(versionId) {
    const draftId = activeKeheDocumentDraft?._saved_draft_id;
    if (!draftId) return;
    try {
      const res = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}/versions/${encodeURIComponent(versionId)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: Number(activeKeheDocumentDraft._saved_draft_revision || 0) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not restore this MPL version.');
      const record = data.draft || {};
      activeKeheDocumentDraft = record.draft || activeKeheDocumentDraft;
      activeKeheDocumentDraft._saved_draft_id = record.id;
      activeKeheDocumentDraft._saved_draft_name = record.name;
      activeKeheDocumentDraft._saved_draft_revision = Number(record.revision || 0);
      activeKeheDocumentDraft.product_master = getActiveAllProductMasterRows();
      closeMplVersionHistory();
      renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
      mplDraftSync?.markSaved();
      setStatus('Saved MPL version restored.', 'success');
    } catch (err) {
      setStatus(`Error: ${err.message || 'Could not restore this MPL version.'}`, 'error');
    }
  }

  function getSelectedB2BDirectory() {
    return b2bSelectedDirectoryIndex >= 0
      ? normalizeDcDirectoryRow(mplDirectoryRows[b2bSelectedDirectoryIndex] || {})
      : normalizeDcDirectoryRow(b2bResolvedDirectoryFallback || {});
  }

  function getDefaultB2BShipFrom() {
    const origins = mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.is_active !== false && directoryHasRole(row, 'SHIP_FROM'));
    return origins.find(row => String(row.dc || '').trim().toUpperCase() === 'DEFAULT-SHIP-FROM')
      || origins.find(row => normalizeStorefront(row.storefront).toLowerCase() === 'bakell')
      || origins[0]
      || {};
  }

  function getSelectedB2BShipFrom() {
    const selected = getSelectedB2BDirectory();
    if (String(b2bRunFields.order_number || '').trim() && (selected.ship_from || selected.ship_from_name)) {
      return {
        name: selected.ship_from_name || selected.name || '',
        address: selected.ship_from || '',
      };
    }
    const wantedCustomer = normalizeStorefront(selected.storefront || b2bSelectedCustomer).toLowerCase();
    const origins = mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.is_active !== false && directoryHasRole(row, 'SHIP_FROM'));
    return origins.find(row => normalizeStorefront(row.storefront).toLowerCase() === wantedCustomer)
      || getDefaultB2BShipFrom();
  }

  function getSelectedB2BTemplate() {
    return b2bLabelTemplates.find(template => String(template.template_id || '') === b2bSelectedTemplateId) || null;
  }

  function b2bTemplateIdsForJob(job = null) {
    if (job) return window.LabelKitB2BOrderJobs.selectedTemplateIds(job);
    return [...new Set([...(b2bSelectedTemplateIds || []), b2bSelectedTemplateId]
      .map(value => String(value || '').trim())
      .filter(Boolean))];
  }

  function isB2BTemplateGalleryMode() {
    return selectedKit === 'operations'
      && typeof orderDocumentsState === 'object'
      && orderDocumentsState.customMode === 'labels'
      && !String(b2bRunFields.order_number || '').trim();
  }

  function b2bTemplateGalleryType(template = {}) {
    const value = `${template.name || ''} ${template.template_id || ''} ${template.renderer_key || ''}`.toLowerCase();
    if (value.includes('pallet') || value.includes('placard')) return 'pallet';
    if (value.includes('inner')) return 'inner';
    if (value.includes('case') || value.includes('pack') || value.includes('srd')) return 'case';
    return 'other';
  }

  function b2bTemplateGallerySize(template = {}) {
    return `${template.physical_width_in || '?'} × ${template.physical_height_in || '?'} in`;
  }

  function renderB2BTemplateGallery() {
    const gallery = document.getElementById('b2b-template-gallery');
    const grid = document.getElementById('b2b-template-gallery-grid');
    if (!gallery || !grid) return;
    const active = isB2BTemplateGalleryMode();
    gallery.classList.toggle('hidden', !active);
    if (!active) return;

    const search = String(document.getElementById('b2b-template-gallery-search')?.value || '').trim().toLowerCase();
    const customerSelect = document.getElementById('b2b-template-gallery-customer');
    const typeSelect = document.getElementById('b2b-template-gallery-type');
    const sizeSelect = document.getElementById('b2b-template-gallery-size');
    const selectedCustomerFilter = String(customerSelect?.value || '');
    const selectedType = String(typeSelect?.value || '');
    const selectedSize = String(sizeSelect?.value || '');
    const activeTemplates = (b2bLabelTemplates || []).filter(template => String(template.status || 'ACTIVE').toUpperCase() !== 'INACTIVE');
    const customers = uniqueTextValues(activeTemplates.map(template => template.customer).filter(Boolean));
    const sizes = uniqueTextValues(activeTemplates.map(b2bTemplateGallerySize));
    if (customerSelect) {
      customerSelect.innerHTML = `<option value="">All customers</option>${customers.map(customer => `<option value="${escapeHtml(customer)}" ${customer === selectedCustomerFilter ? 'selected' : ''}>${escapeHtml(customer)}</option>`).join('')}`;
      customerSelect.value = customers.includes(selectedCustomerFilter) ? selectedCustomerFilter : '';
    }
    if (sizeSelect) {
      sizeSelect.innerHTML = `<option value="">All sizes</option>${sizes.map(size => `<option value="${escapeHtml(size)}" ${size === selectedSize ? 'selected' : ''}>${escapeHtml(size)}</option>`).join('')}`;
      sizeSelect.value = sizes.includes(selectedSize) ? selectedSize : '';
    }
    const customerFilter = String(customerSelect?.value || '');
    const sizeFilter = String(sizeSelect?.value || '');
    const templates = activeTemplates.filter(template => {
      const haystack = `${template.name || ''} ${template.template_id || ''} ${template.customer || ''} ${b2bTemplateGallerySize(template)}`.toLowerCase();
      return (!search || haystack.includes(search))
        && (!customerFilter || String(template.customer || '') === customerFilter)
        && (!selectedType || b2bTemplateGalleryType(template) === selectedType)
        && (!sizeFilter || b2bTemplateGallerySize(template) === sizeFilter);
    });
    const selectedIds = new Set(b2bTemplateIdsForJob());
    grid.innerHTML = templates.length ? templates.map(template => {
      const templateId = String(template.template_id || '');
      const selected = selectedIds.has(templateId);
      const editing = selected && templateId === b2bSelectedTemplateId;
      const type = b2bTemplateGalleryType(template);
      return `<label class="b2b-template-gallery-card ${selected ? 'selected' : ''} ${editing ? 'editing' : ''}">
        <input type="checkbox" ${selected ? 'checked' : ''} onchange="selectB2BGalleryTemplate('${jsString(templateId)}', this.checked)">
        <span class="b2b-template-gallery-preview b2b-template-gallery-preview-${escapeHtml(type)}" aria-hidden="true"><i></i><b></b><em></em></span>
        <span class="b2b-template-gallery-copy"><small>${escapeHtml(template.customer || 'General')}</small><strong>${escapeHtml(template.name || templateId)}</strong><span>${escapeHtml(b2bTemplateGallerySize(template))} · ${escapeHtml(type === 'case' ? 'Case / pack' : type === 'inner' ? 'Inner pack' : type === 'pallet' ? 'Pallet' : 'Other')}</span></span>
        <span class="b2b-template-gallery-state">${editing ? 'Editing' : selected ? 'Selected' : 'Select'}</span>
      </label>`;
    }).join('') : '<div class="b2b-template-gallery-empty">No templates match these filters. Clear one or more filters to see the full catalog.</div>';
    const count = document.getElementById('b2b-template-gallery-count');
    if (count) count.textContent = `${templates.length} shown · ${selectedIds.size} selected`;
  }

  function clearB2BTemplateGalleryFilters() {
    ['b2b-template-gallery-search', 'b2b-template-gallery-customer', 'b2b-template-gallery-type', 'b2b-template-gallery-size'].forEach(id => {
      const control = document.getElementById(id);
      if (control) control.value = '';
    });
    renderB2BTemplateGallery();
  }

  function selectB2BGalleryTemplate(templateId, selected = true) {
    const cleanId = String(templateId || '').trim();
    const template = b2bLabelTemplates.find(candidate => String(candidate.template_id || '') === cleanId);
    if (!template) return;
    const templateCustomer = String(template.customer || '').trim();
    const customerChanged = templateCustomer
      && normalizeStorefront(templateCustomer).toLowerCase() !== normalizeStorefront(b2bSelectedCustomer).toLowerCase();
    if (customerChanged) {
      b2bSelectedCustomer = templateCustomer;
      b2bSelectedGroupKey = '';
      b2bSelectedProductIndex = -1;
      b2bSelectedDirectoryIndex = -1;
      b2bSelectedTemplateIds = [];
      b2bTemplateRunFields = {};
    }
    const currentIds = b2bTemplateIdsForJob().filter(id => {
      const candidate = b2bLabelTemplates.find(item => String(item.template_id || '') === id);
      return !templateCustomer || normalizeStorefront(candidate?.customer).toLowerCase() === normalizeStorefront(templateCustomer).toLowerCase();
    });
    b2bSelectedTemplateIds = selected ? uniqueTextValues([...currentIds, cleanId]) : currentIds.filter(id => id !== cleanId);
    b2bSelectedTemplateId = selected ? cleanId : (b2bSelectedTemplateIds[0] || '');
    if (selected && !b2bTemplateRunFields[cleanId]) {
      b2bTemplateRunFields[cleanId] = { ...B2B_RUN_FIELD_DEFAULTS, copies: String(template.default_copies || 1) };
    }
    if (b2bSelectedTemplateId) loadB2BActiveRunFields(null, b2bSelectedTemplateId);
    clearB2BPreview();
    renderB2BCreator();
    if (selected && getSelectedB2BProduct()) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => focusB2BLabelEditor()));
    } else if (selected) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById('b2b-product-select')?.focus({ preventScroll: true })));
    }
  }

  function b2bTemplatePickerHtml(options, selectedIds, helpText, context = 'manual', jobIndex = null, autoOpen = true, rowKey = jobIndex, compatibleIds = []) {
    const selected = new Set((selectedIds || []).map(String));
    const selectedTemplates = (options || []).filter(template => selected.has(String(template.template_id)));
    const compatible = new Set((compatibleIds || []).map(String));
    const primaryTemplates = (options || []).filter(template => compatible.has(String(template.template_id)) || selected.has(String(template.template_id)));
    const otherTemplates = (options || []).filter(template => !primaryTemplates.includes(template));
    const summary = selectedTemplates.length
      ? `${selectedTemplates.length} template${selectedTemplates.length === 1 ? '' : 's'} selected`
      : 'Choose label templates';
    const jobIndexArg = jobIndex === null ? 'null' : String(jobIndex);
    const rowKeyArg = rowKey === null ? 'null' : `'${jsString(String(rowKey))}'`;
    const forceOpen = rowKey !== null && String(rowKey) === String(b2bOpenSkuRowIndex ?? '');
    const optionHtml = template => {
      const templateId = String(template.template_id || '');
      const checked = selected.has(templateId);
      const active = checked && templateId === b2bSelectedTemplateId && (jobIndex === null || jobIndex === b2bSelectedOrderJobIndex);
      const templateName = template.name || templateId;
      return `<div class="b2b-template-option ${checked ? 'selected' : ''} ${active ? 'active' : ''}"><label><input type="checkbox" aria-label="Select ${escapeHtml(templateName)}" ${checked ? 'checked' : ''} onchange="toggleB2BTemplate('${jsString(templateId)}', this.checked, '${context}', ${jobIndexArg})"><span><strong>${escapeHtml(templateName)}</strong><small>${escapeHtml(`${template.physical_width_in || '?'} × ${template.physical_height_in || '?'} in${active ? ' · open in editor' : ''}`)}</small></span></label>${checked ? `<button type="button" aria-label="Edit ${escapeHtml(templateName)}" ${active ? 'disabled' : ''} onclick="${jobIndex === null ? `selectB2BTemplate('${jsString(templateId)}', true)` : `reviewB2BProductMatch(${jobIndex}, '${jsString(templateId)}')`}">${active ? 'Editing' : 'Edit'}</button>` : ''}</div>`;
    };
    return `<details class="b2b-template-picker" data-b2b-row-key="${escapeHtml(String(rowKey ?? 'manual'))}" ${(forceOpen || (autoOpen && !selectedTemplates.length)) ? 'open' : ''} ontoggle="rememberB2BSkuRowOpenState(this, ${rowKeyArg})">
      <summary><span>${escapeHtml(summary)}</span><small>${escapeHtml(selectedTemplates.map(template => template.name || template.template_id).join(', ') || 'None selected')}</small></summary>
      <div class="b2b-template-picker-popover"><div class="b2b-template-picker-menu" role="group" aria-label="Available label templates">${primaryTemplates.length ? primaryTemplates.map(optionHtml).join('') : '<div class="b2b-template-empty">No customer-matched templates were found.</div>'}${otherTemplates.length ? `<div class="b2b-template-group-label"><span>Other available templates</span><small>${otherTemplates.length}</small></div>${otherTemplates.map(optionHtml).join('')}` : ''}</div>
      <p>${escapeHtml(helpText || 'Check every template required for this label job. The most recently checked template opens in the live editor.')}</p>
      </div></details>`;
  }

  function rememberB2BSkuRowOpenState(details, rowKey) {
    if (rowKey === null) return;
    b2bOpenSkuRowIndex = details.open ? rowKey : (b2bOpenSkuRowIndex === rowKey ? null : b2bOpenSkuRowIndex);
  }

  function resetB2BManualWorkspaceState() {
    b2bSelectedCustomer = '';
    b2bSelectedGroupKey = '';
    b2bSelectedProductIndex = -1;
    b2bSelectedDirectoryIndex = -1;
    b2bSelectedTemplateId = '';
    b2bSelectedTemplateIds = [];
    b2bTemplateRunFields = {};
    b2bOrderFallbackProducts = [];
    b2bOrderLabelJobs = [];
    b2bSelectedOrderJobIndex = -1;
    b2bOrderCustomerOverride = '';
    b2bOrderDestinationOverride = '';
    b2bOrderShipToName = '';
    b2bResolvedOrderContext = null;
    b2bResolvedDirectoryFallback = {};
    b2bCopiesTemplateId = '';
    b2bSettingsProductIndex = -1;
    b2bOpenSkuRowIndex = null;
    b2bRunFields = { ...B2B_RUN_FIELD_DEFAULTS };
    ['b2b-template-gallery-search', 'b2b-template-gallery-customer', 'b2b-template-gallery-type', 'b2b-template-gallery-size'].forEach(id => {
      const control = document.getElementById(id);
      if (control) control.value = '';
    });
  }

  function getB2BWorkItems() {
    if (b2bOrderLabelJobs.length && String(b2bRunFields.order_number || '').trim()) {
      return b2bOrderLabelJobs.flatMap((job, jobIndex) => b2bTemplateIdsForJob(job).map(templateId => ({
        job,
        jobIndex,
        templateId,
      })));
    }
    const product = getSelectedB2BProduct();
    return product ? b2bTemplateIdsForJob().map(templateId => ({ job: null, jobIndex: -1, templateId })) : [];
  }

  function persistB2BActiveRunFields() {
    const templateId = String(b2bSelectedTemplateId || '').trim();
    if (!templateId) return;
    // Read the visible controls before changing queue items. This makes label
    // navigation resilient even when a browser has not yet dispatched an
    // input/change event for the last edit.
    document.querySelectorAll('[data-b2b-run-field]').forEach(input => {
      if (input.disabled) return;
      b2bRunFields[input.dataset.b2bRunField] = input.type === 'checkbox'
        ? String(input.checked)
        : String(input.value ?? '');
    });
    const snapshot = { ...b2bRunFields };
    const selectedJob = b2bOrderLabelJobs[b2bSelectedOrderJobIndex];
    if (!selectedJob) {
      b2bTemplateRunFields[templateId] = snapshot;
      return;
    }
    const selectedGroupKey = b2bOrderReviewGroupKey(selectedJob);
    b2bOrderLabelJobs.forEach((job, index) => {
      if (b2bOrderReviewGroupKey(job) !== selectedGroupKey || !b2bTemplateIdsForJob(job).includes(templateId)) return;
      const existing = job.template_runs?.[templateId] || job.run || {};
      const nextRun = { ...existing, ...snapshot };
      if (index !== b2bSelectedOrderJobIndex) {
        ['carton_total', 'carton_start', 'carton_end'].forEach(field => {
          if (String(existing[field] ?? '').trim()) nextRun[field] = existing[field];
        });
      }
      job.template_runs = { ...(job.template_runs || {}), [templateId]: nextRun };
    });
  }

  function loadB2BActiveRunFields(job, templateId) {
    const saved = job
      ? job.template_runs?.[templateId] || job.run
      : b2bTemplateRunFields[templateId];
    // Reset first so a label without its own saved run never inherits
    // leftover edits from whichever SKU/template was active before it.
    Object.assign(b2bRunFields, B2B_RUN_FIELD_DEFAULTS);
    if (saved) Object.assign(b2bRunFields, saved);
    const template = b2bLabelTemplates.find(candidate => candidate.template_id === templateId);
    if (!saved && template) {
      b2bRunFields.copies = String(template.default_copies || 1);
      b2bRunFields.print_barcode = String(b2bBarcodeConfigured());
    }
  }

  function renderB2BLabelQueue() {
    const queue = document.getElementById('b2b-label-queue');
    if (!queue) return;
    const loadedOrder = !!String(b2bRunFields.order_number || '').trim();
    const items = getB2BWorkItems();
    const hasSkuList = loadedOrder ? b2bOrderLabelJobs.length > 0 : !!getSelectedB2BProduct();
    queue.classList.toggle('hidden', !hasSkuList);
    const productGroups = new Map();
    b2bOrderLabelJobs.forEach(job => {
      const key = b2bOrderReviewGroupKey(job);
      if (!productGroups.has(key)) productGroups.set(key, []);
      productGroups.get(key).push(job);
    });
    const unresolvedProducts = [...productGroups.values()].filter(group => group.some(job => !b2bTemplateIdsForJob(job).length)).length;
    const totalProducts = loadedOrder ? productGroups.size : (hasSkuList ? 1 : 0);
    const configuredProducts = Math.max(0, totalProducts - unresolvedProducts);
    const title = document.getElementById('b2b-label-queue-title');
    const help = document.getElementById('b2b-label-queue-help');
    const position = document.getElementById('b2b-label-queue-position');
    const navigator = document.getElementById('b2b-editor-navigator');
    const editorQueue = document.getElementById('b2b-editor-queue-track');
    const editorQueueName = document.getElementById('b2b-editor-queue-name');
    if (title) title.textContent = loadedOrder
      ? `${configuredProducts} of ${totalProducts} products configured · ${items.length} label job${items.length === 1 ? '' : 's'}`
      : `${items.length} selected label${items.length === 1 ? '' : 's'}`;
    if (help) help.textContent = unresolvedProducts
      ? `${unresolvedProducts} product${unresolvedProducts === 1 ? '' : 's'} still need a template. Open a row below to finish setup.`
      : 'Every product has a template. Use the editing queue below to review each label.';
    if (!items.length) {
      if (position) position.textContent = '0 of 0';
      if (editorQueueName) editorQueueName.textContent = 'Select a template to create the first label job';
      const editorTitle = document.getElementById('b2b-label-editor-title');
      const runTitle = document.getElementById('b2b-run-title');
      if (editorTitle) editorTitle.textContent = 'Edit the label';
      if (runTitle) runTitle.textContent = 'Carton range & copies';
      if (navigator) navigator.classList.add('hidden');
      if (editorQueue) {
        editorQueue.classList.add('hidden');
        editorQueue.innerHTML = '';
      }
      const previous = document.getElementById('b2b-label-previous');
      const next = document.getElementById('b2b-label-next');
      if (previous) previous.disabled = true;
      if (next) next.disabled = true;
      return;
    }
    let activeIndex = items.findIndex(item => item.jobIndex === b2bSelectedOrderJobIndex && item.templateId === b2bSelectedTemplateId);
    if (activeIndex < 0 && !b2bOrderLabelJobs.length) activeIndex = items.findIndex(item => item.templateId === b2bSelectedTemplateId);
    if (position) position.textContent = activeIndex >= 0 ? `Label ${activeIndex + 1} of ${items.length}` : `0 of ${items.length}`;
    if (navigator) navigator.classList.remove('hidden');
    if (editorQueue) {
      editorQueue.classList.remove('hidden');
      editorQueue.innerHTML = items.map((item, index) => {
        const itemProduct = item.job?.product || getSelectedB2BProduct() || {};
        const itemTemplate = b2bLabelTemplates.find(template => template.template_id === item.templateId) || {};
        const isActive = index === activeIndex;
        return `<button type="button" class="b2b-editor-queue-item ${isActive ? 'active' : ''}" aria-label="Edit label ${index + 1}: ${escapeHtml(itemProduct.sku || 'SKU')} using ${escapeHtml(itemTemplate.name || item.templateId)}" onclick="selectB2BWorkItem(${item.jobIndex}, '${jsString(item.templateId)}')"><span>${index + 1}</span><strong>${escapeHtml(itemProduct.sku || itemProduct.customer_item_number || 'SKU')}</strong><small>${escapeHtml(itemTemplate.name || item.templateId)}</small></button>`;
      }).join('');
      window.requestAnimationFrame(() => {
        const activeItem = editorQueue.querySelector('.active');
        if (!activeItem) return;
        const targetLeft = activeItem.offsetLeft - ((editorQueue.clientWidth - activeItem.offsetWidth) / 2);
        editorQueue.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
      });
    }
    const previous = document.getElementById('b2b-label-previous');
    const next = document.getElementById('b2b-label-next');
    if (previous) previous.disabled = activeIndex <= 0;
    if (next) next.disabled = activeIndex >= items.length - 1;
    const editorTitle = document.getElementById('b2b-label-editor-title');
    const runTitle = document.getElementById('b2b-run-title');
    const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
    const activeProduct = activeItem?.job?.product || getSelectedB2BProduct() || {};
    const activeTemplate = b2bLabelTemplates.find(template => template.template_id === activeItem?.templateId) || {};
    const activeName = activeItem
      ? `${activeProduct.sku || activeProduct.customer_item_number || 'SKU'} · ${activeTemplate.name || activeItem.templateId}`
      : 'Select a label from the queue';
    if (editorQueueName) editorQueueName.textContent = activeName;
    if (editorTitle) editorTitle.textContent = activeName;
    if (runTitle) runTitle.textContent = 'Carton range & copies';
  }

  function selectB2BWorkItem(jobIndex, templateId) {
    persistB2BActiveRunFields();
    if (jobIndex >= 0) selectB2BOrderJob(String(jobIndex), templateId);
    else {
      b2bSelectedTemplateId = String(templateId || '');
      loadB2BActiveRunFields(null, b2bSelectedTemplateId);
      clearB2BPreview();
      renderB2BCreator();
    }
  }

  function moveB2BWorkItem(direction) {
    const items = getB2BWorkItems();
    if (!items.length) return;
    let activeIndex = items.findIndex(item => item.jobIndex === b2bSelectedOrderJobIndex && item.templateId === b2bSelectedTemplateId);
    if (activeIndex < 0 && !b2bOrderLabelJobs.length) activeIndex = items.findIndex(item => item.templateId === b2bSelectedTemplateId);
    const nextIndex = Math.max(0, Math.min(items.length - 1, (activeIndex < 0 ? 0 : activeIndex) + Number(direction || 0)));
    const next = items[nextIndex];
    if (next) selectB2BWorkItem(next.jobIndex, next.templateId);
  }

  function resolveB2BTemplateOptions(job = {}, customer = '') {
    const product = normalizeProductRow(job.product || getSelectedB2BProduct() || {});
    return window.LabelKitB2BOrderJobs.resolveB2BTemplateChoice({
      templates: b2bLabelTemplates,
      customer: customer || product.storefront || b2bSelectedCustomer,
      currentTemplateId: job.template_id || b2bSelectedTemplateId,
      productTemplateId: product.label_template_id,
      directoryTemplateId: job.directory?.default_label_template_id || getSelectedB2BDirectory().default_label_template_id,
    });
  }

  function setNativeSelectOptions(select, options, selectedValue, blankLabel = '') {
    if (!select) return;
    select.innerHTML = selectOptionsHtml(options, selectedValue, blankLabel);
    select.value = selectedValue || '';
  }

  function b2bPreviewValue(product, directory, runFields, ...fields) {
    for (const source of [runFields || b2bRunFields, product || {}, directory || {}]) {
      for (const field of fields) {
        const value = String(source?.[field] ?? '').trim();
        if (value) return value.replace(/\\n/g, '\n');
      }
    }
    return '';
  }

  function b2bBarcodeConfigured(product = getSelectedB2BProduct()) {
    return !!String(product?.gtin || '').trim()
      && !['', 'NONE'].includes(String(product?.barcode_type || '').trim().toUpperCase());
  }

  function b2bPrintBarcodeEnabled(product = getSelectedB2BProduct(), runFields = b2bRunFields) {
    return parseBooleanLike(runFields?.print_barcode, false) && b2bBarcodeConfigured(product);
  }

  function b2bBarcodePreviewHtml(product, context = {}) {
    if (!b2bPrintBarcodeEnabled(product, context.runFields || b2bRunFields)) return '';
    return `<div class="b2b-label-barcode"><div class="b2b-label-bars"></div>${b2bEditableValue(product, 'gtin', 'GTIN / UPC', 'b2b-edit-barcode', context)}</div>`;
  }

  function b2bProductSettingMap() {
    return {
      description: 'b2b-product-description',
      sku: 'b2b-product-sku',
      customer_item_number: 'b2b-product-customer-item',
      gtin: 'b2b-product-gtin',
      case_qty: 'b2b-product-case-qty',
      each_net_weight_g: 'b2b-product-each-net',
      package_net_weight_g: 'b2b-product-package-net',
      gross_weight_lbs: 'b2b-product-gross',
      length_in: 'b2b-product-length',
      width_in: 'b2b-product-width',
      height_in: 'b2b-product-height',
    };
  }

  const B2B_FINAL_PRODUCT_FIELDS = new Set([
    'each_net_weight_g', 'package_net_weight_g', 'gross_weight_lbs',
    'length_in', 'width_in', 'height_in',
  ]);

  const B2B_RENDERER_PRODUCT_FIELDS = {
    decopac_case_4x6: ['customer_item_number', 'description', 'case_qty', 'each_net_weight_g', 'package_net_weight_g', 'length_in', 'width_in', 'height_in'],
    disney_case_3x3: ['customer_item_number', 'description'],
    compact_case_3x3: ['description', 'sku', 'customer_item_number', 'case_qty'],
    fancy_pallet_3x3: ['sku', 'customer_item_number', 'description'],
    mixed_case_3x1_5: ['description', 'sku', 'customer_item_number', 'case_qty'],
    standard_case_4x6: ['description', 'case_qty', 'sku', 'customer_item_number'],
    standard_case_vertical_4x6: ['description', 'case_qty', 'sku', 'customer_item_number'],
    bulk_further_processing_4x6: ['description', 'gross_weight_lbs', 'package_net_weight_g'],
  };

  function organizeB2BProductSettings(template, product) {
    const panel = document.getElementById('b2b-product-settings');
    const current = document.getElementById('b2b-product-settings-current');
    const additional = document.getElementById('b2b-product-settings-additional');
    if (!panel || !current || !additional) return;
    const required = new Set((template?.required_product_fields || []).map(String));
    const renderer = String(template?.renderer_key || '');
    const visible = new Set([...(B2B_RENDERER_PRODUCT_FIELDS[renderer] || []), ...required]);
    if (String(product?.sku || '').trim()) visible.delete('customer_item_number');
    else visible.delete('sku');
    const barcodePolicy = String(template?.barcode_policy || 'NONE').trim().toUpperCase();
    const barcodeRunRequested = parseBooleanLike(b2bRunFields.print_barcode, false);
    if (barcodePolicy === 'REQUIRED' || barcodeRunRequested || template?.renderer_options?.show_barcode) {
      visible.add('gtin');
      visible.add('barcode_type');
    }
    panel.querySelectorAll('[data-b2b-setting-field]').forEach(label => {
      const field = label.dataset.b2bSettingField;
      const target = visible.has(field) ? current : additional;
      target.appendChild(label);
      label.classList.toggle('b2b-setting-required-field', required.has(field));
      let role = label.querySelector('.b2b-setting-role');
      if (required.has(field)) {
        if (!role) {
          role = document.createElement('small');
          role.className = 'b2b-setting-role';
          label.appendChild(role);
        }
        role.textContent = 'Required for this label';
      } else if (role) {
        role.remove();
      }
      if (!label.dataset.b2bBaseLabel) {
        const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (textNode) label.dataset.b2bBaseLabel = textNode.textContent.trim();
      }
      const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
      if (textNode && label.dataset.b2bBaseLabel) {
        textNode.textContent = `${label.dataset.b2bBaseLabel}${required.has(field) ? ' · REQUIRED' : ''} `;
      }
    });
    const note = document.getElementById('b2b-settings-note');
    if (note) note.textContent = `${template?.name || 'This label'} uses the fields shown first. GTIN/barcode is optional unless enabled in the print run; other product data is kept for different labels and TI-HI.`;
  }

  function getSelectedB2BFinalCaseEntry() {
    if (b2bSelectedProductIndex <= -1000) return null;
    const entries = getB2BProductEntries().filter(entry => (
      mplProductGroupKey(entry.row, entry.index) === b2bSelectedGroupKey
    ));
    return mplProductOutermostEntry(entries) || null;
  }

  function getB2BOutputProduct(product = getSelectedB2BProduct()) {
    if (!product) return product;
    const finalCaseProduct = getSelectedB2BFinalCaseEntry()?.row;
    if (!finalCaseProduct) return product;
    const output = { ...product };
    B2B_FINAL_PRODUCT_FIELDS.forEach(field => {
      if (String(finalCaseProduct[field] ?? '').trim()) output[field] = finalCaseProduct[field];
    });
    return output;
  }

  function renderB2BProductSettings(product = getSelectedB2BProduct(), template = getSelectedB2BTemplate()) {
    const panel = document.getElementById('b2b-product-settings');
    const status = document.getElementById('b2b-settings-status');
    if (!panel) return;
    panel.classList.toggle('hidden', !product);
    if (!product) {
      b2bSettingsProductIndex = -1;
      return;
    }

    const isOrderFallback = b2bSelectedProductIndex <= -1000;
    const canEdit = isOrderFallback || hasPermission('table_crud');
    const finalCaseProduct = getSelectedB2BFinalCaseEntry()?.row || product;
    Object.entries(b2bProductSettingMap()).forEach(([field, id]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const source = B2B_FINAL_PRODUCT_FIELDS.has(field) ? finalCaseProduct : product;
      input.value = source[field] ?? '';
      input.disabled = !canEdit;
    });
    setNativeSelectOptions(document.getElementById('b2b-product-barcode-type'), B2B_BARCODE_TYPES, product.barcode_type || '', 'Select type');
    setNativeSelectOptions(document.getElementById('b2b-product-verification'), B2B_VERIFICATION_STATUSES, product.verification_status || '', 'Select status');
    ['b2b-product-barcode-type', 'b2b-product-verification'].forEach(id => {
      const select = document.getElementById(id);
      if (select) select.disabled = !canEdit;
    });
    const enabled = document.getElementById('b2b-product-enabled');
    if (enabled) {
      enabled.checked = !!product.label_enabled;
      enabled.disabled = !canEdit;
    }

    organizeB2BProductSettings(template, product);

    const requiredMissing = uniqueTextValues((template?.required_product_fields || []).map(String))
      .filter(field => !String(product[field] ?? '').trim());
    const barcodePolicy = String(template?.barcode_policy || 'NONE').toUpperCase();
    const barcodeConfigured = !!String(product.gtin || '').trim()
      && !['', 'NONE'].includes(String(product.barcode_type || '').toUpperCase());
    const barcodeRequested = parseBooleanLike(b2bRunFields.print_barcode, false);
    const needsAttention = requiredMissing.length > 0 || (barcodeRequested && !barcodeConfigured);
    if (status) {
      if (isOrderFallback && requiredMissing.length) status.textContent = `Order data loaded · ${requiredMissing.length} field${requiredMissing.length === 1 ? '' : 's'} to review`;
      else if (isOrderFallback) status.textContent = 'Order data loaded for this label';
      else if (requiredMissing.length) status.textContent = `${requiredMissing.length} required field${requiredMissing.length === 1 ? '' : 's'} missing`;
      else if (!barcodeRequested) status.textContent = 'Barcode is optional and currently off';
      else if (!barcodeConfigured) status.textContent = 'Barcode selected but not configured';
      else status.textContent = 'Setup complete';
      status.className = `b2b-settings-status ${needsAttention ? 'review' : barcodeRequested ? 'ready' : 'neutral'}`;
    }
    if (b2bSettingsProductIndex !== b2bSelectedProductIndex) b2bSettingsProductIndex = b2bSelectedProductIndex;
  }

  function b2bEditableValue(product, field, placeholder, className = '', context = {}) {
    const value = String(product?.[field] ?? '').trim();
    const isPartnerEditor = Number.isInteger(context.partnerIndex);
    const editable = !!product && (isPartnerEditor || b2bSelectedProductIndex <= -1000 || hasPermission('table_crud'));
    const fieldAttribute = isPartnerEditor ? 'data-partner-product-edit' : 'data-b2b-product-edit';
    const partnerAttribute = isPartnerEditor ? `data-partner-label-index="${context.partnerIndex}"` : '';
    const commitHandler = isPartnerEditor ? 'commitPartnerProductLabelEdit(this)' : 'commitB2BLabelEdit(this)';
    return `<span class="b2b-label-editable ${className} ${value ? '' : 'is-empty'} ${editable ? '' : 'is-readonly'}"
      ${fieldAttribute}="${escapeHtml(field)}"
      ${partnerAttribute}
      data-placeholder="${escapeHtml(placeholder)}"
      contenteditable="${editable ? 'true' : 'false'}"
      role="textbox"
      aria-label="Edit ${escapeHtml(field.replace(/_/g, ' '))}"
      spellcheck="false"
      onkeydown="handleB2BEditorKeydown(event)"
      onfocus="this.classList.remove('is-empty')"
      onblur="${commitHandler}">${escapeHtml(value)}</span>`;
  }

  function b2bEditableRunValue(field, placeholder, className = '', context = {}) {
    const runFields = context.runFields || b2bRunFields;
    const value = String(runFields?.[field] ?? '').trim();
    const isPartnerEditor = Number.isInteger(context.partnerIndex);
    const fieldAttribute = isPartnerEditor ? 'data-partner-run-edit' : 'data-b2b-run-edit';
    const partnerAttribute = isPartnerEditor ? `data-partner-label-index="${context.partnerIndex}"` : '';
    const commitHandler = isPartnerEditor ? 'commitPartnerRunLabelEdit(this)' : 'commitB2BRunLabelEdit(this)';
    return `<span class="b2b-label-editable b2b-label-run-editable ${className} ${value ? '' : 'is-empty'}"
      ${fieldAttribute}="${escapeHtml(field)}"
      ${partnerAttribute}
      data-placeholder="${escapeHtml(placeholder)}"
      contenteditable="true"
      role="textbox"
      aria-label="Edit ${escapeHtml(field.replace(/_/g, ' '))} for this print run"
      spellcheck="false"
      onkeydown="handleB2BEditorKeydown(event)"
      onfocus="this.classList.remove('is-empty')"
      onblur="${commitHandler}">${escapeHtml(value)}</span>`;
  }

  function b2bLabelEditorHtml(template, product, directory, context = {}) {
    const renderer = String(template?.renderer_key || '');
    const runFields = context.runFields || b2bRunFields;
    const runValue = (...fields) => escapeHtml(b2bPreviewValue(product, directory, runFields, ...fields));
    const edit = (field, placeholder, className = '') => b2bEditableValue(product, field, placeholder, className, context);
    const runEdit = (field, placeholder, className = '') => b2bEditableRunValue(field, placeholder, className, context);
    const skuField = String(product?.sku || '').trim() ? 'sku' : 'customer_item_number';
    const customer = runValue('name', 'storefront') || escapeHtml(template?.customer || 'Customer');
    const carton = runValue('carton_start') || '1';
    const total = runValue('carton_total') || '1';
    const box = `Box ${carton} of ${total}`;
    const dimensions = [
      edit('length_in', 'Length'),
      edit('width_in', 'Width'),
      edit('height_in', 'Height'),
    ].join('<span class="b2b-label-dimension-times">×</span>');
    const options = template?.renderer_options || {};
    const barcodeVisible = b2bPrintBarcodeEnabled(product, runFields);
    const barcodeHtml = b2bBarcodePreviewHtml(product, context);

    if (renderer === 'decopac_case_4x6') {
      const manufacturer = runValue('manufacturer_name', 'name') || 'DECOPAC, INC';
      const destination = runValue('delivery_address') || 'ANOKA, MN USA';
      const common = `<div class="b2b-label-topline"><strong>${manufacturer.toUpperCase()}</strong><span>${destination.replace(/\n/g, ' ')}</span></div><div class="b2b-label-rule"></div><div class="b2b-label-row"><b>ITEM #:</b>${edit('customer_item_number', 'Customer item number')}</div><div class="b2b-label-row b2b-label-description"><b>DESCRIPTION:</b>${edit('description', 'Product description', 'b2b-edit-wide')}</div><div class="b2b-label-row"><b>QTY:</b><span>Master Carton of ${edit('case_qty', 'Quantity')}</span></div>`;
      return `<div class="b2b-label-sheet b2b-label-dual b2b-label-dual-stacked ${barcodeVisible ? 'has-barcode' : ''}">
        <div class="b2b-label-panel b2b-label-decocpac">${common}<div class="b2b-label-split"><div><b>PO #:</b> ${runEdit('po_number', 'Enter PO number')}</div><div><b>LOT #:</b> ${runEdit('lot_number', 'Enter lot number')}</div><strong>${box}</strong></div><strong class="b2b-label-origin">MADE IN USA</strong></div>
        <div class="b2b-label-panel b2b-label-decocpac">${common}<div class="b2b-label-details"><div><b>NET ITEM:</b> ${edit('each_net_weight_g', 'Weight')} g</div><div><b>NET CASE:</b> ${edit('package_net_weight_g', 'Weight')} g</div><div><b>DIMENSIONS:</b> <span class="b2b-label-dimensions">${dimensions}</span> in</div></div><strong class="b2b-label-box-count">${box}</strong></div>
      </div>`;
    }

    if (renderer === 'disney_case_3x3') {
      return `<div class="b2b-label-sheet b2b-label-square b2b-label-disney ${barcodeVisible ? 'has-barcode' : ''}">
        <strong class="b2b-label-customer">${customer.toUpperCase()}</strong>
        <div class="b2b-label-rule"></div>
        <div class="b2b-label-hero-description">${edit('customer_item_number', 'Customer item')}<span>—</span>${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-center-row"><b>PO #</b> ${runEdit('po_number', 'Enter PO number')}</div>
        <strong class="b2b-label-box-count">${box}</strong>
        <div class="b2b-label-date-caption">EXPECTED DELIVERY BY</div>
        <strong class="b2b-label-date">${runEdit('expected_delivery_date', 'YYYY-MM-DD')}</strong>
        ${barcodeHtml}
      </div>`;
    }

    if (renderer === 'compact_case_3x3') {
      const showInvoice = !!options.show_invoice;
      const showBarcode = !!options.show_barcode || barcodeVisible;
      const panel = `<div class="b2b-label-panel b2b-label-square b2b-label-compact ${showBarcode ? 'has-barcode' : ''}">
        <strong class="b2b-label-customer">${customer.toUpperCase()}</strong>
        <div class="b2b-label-rule"></div>
        <div class="b2b-label-hero-description">${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-row"><b>SKU:</b>${edit(skuField, 'SKU')}</div>
        <div class="b2b-label-row"><b>PO:</b>${runEdit('po_number', 'Enter PO number')}</div>
        ${showInvoice ? `<div class="b2b-label-row"><b>INV:</b>${runEdit('invoice_number', 'Enter invoice number')}</div>` : ''}
        <div class="b2b-label-row"><b>PACK:</b>${edit('case_qty', 'Pack quantity')}</div>
        <strong class="b2b-label-box-count">${box}</strong>
        ${showBarcode ? barcodeHtml : ''}
      </div>`;
      return `<div class="b2b-label-sheet b2b-label-dual b2b-label-dual-side">${panel}${panel}</div>`;
    }

    if (renderer === 'fancy_pallet_3x3') {
      return `<div class="b2b-label-sheet b2b-label-square b2b-label-fancy-pallet">
        <strong class="b2b-label-customer">FANCY SPRINKLES</strong>
        <div class="b2b-label-rule"></div>
        <div class="b2b-label-row"><b>DATE:</b>${runEdit('ship_date', 'YYYY-MM-DD')}</div>
        <div class="b2b-label-row"><b>SKU:</b>${edit(skuField, 'SKU')}</div>
        <div class="b2b-label-row b2b-label-description"><b>NAME:</b>${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-row"><b>QUANTITY:</b>${runEdit('quantity_label', 'Quantity')}</div>
        <div class="b2b-label-row"><b>LOT CODE:</b>${runEdit('lot_number', 'Lot code')}</div>
        <div class="b2b-label-row"><b>BB DATE:</b>${runEdit('best_before', 'Best-before date')}</div>
        <strong class="b2b-label-box-count">Pallet ${carton} of ${total}</strong>
      </div>`;
    }

    if (renderer === 'mixed_case_3x1_5') {
      return `<div class="b2b-label-sheet b2b-label-strip ${barcodeVisible ? 'has-barcode' : ''}">
        <div class="b2b-label-topline"><strong>${customer.toUpperCase()}</strong><strong>${box}</strong></div>
        <div class="b2b-label-hero-description">${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-strip-footer"><span>SKU: ${edit(skuField, 'SKU')}</span><span>${edit('case_qty', 'Qty')} units</span></div>
        <div class="b2b-label-strip-po">PO: ${runEdit('po_number', 'Enter PO number')}</div>
        ${barcodeHtml}
      </div>`;
    }

    if (renderer === 'standard_case_4x6') {
      const panel = `<div class="b2b-label-panel b2b-label-standard ${barcodeVisible ? 'has-barcode' : ''}">
        <strong class="b2b-label-box-count">${box}</strong>
        <div class="b2b-label-rule"></div>
        <strong class="b2b-label-standard-po">PO # ${runEdit('po_number', 'Enter PO number')}</strong>
        <div class="b2b-label-standard-description">${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <strong class="b2b-label-standard-pack">${edit('case_qty', 'Quantity')} units per case</strong>
        <div class="b2b-label-standard-sku">SKU: ${edit(skuField, 'SKU')}</div>
        ${barcodeHtml}
      </div>`;
      return `<div class="b2b-label-sheet b2b-label-dual b2b-label-dual-side">${panel}${panel}</div>`;
    }

    if (renderer === 'standard_case_vertical_4x6') {
      const panel = `<div class="b2b-label-panel b2b-label-standard ${barcodeVisible ? 'has-barcode' : ''}"><strong class="b2b-label-box-count">${box}</strong><div class="b2b-label-rule"></div><strong class="b2b-label-standard-po">PO # ${runEdit('po_number', 'Enter PO number')}</strong><div class="b2b-label-standard-description">${edit('description', 'Product description', 'b2b-edit-wide')}</div><strong class="b2b-label-standard-pack">${edit('case_qty', 'Quantity')} units per case</strong><div class="b2b-label-standard-sku">SKU: ${edit(skuField, 'SKU')}</div>${barcodeHtml}</div>`;
      return `<div class="b2b-label-sheet b2b-label-dual b2b-label-dual-stacked">${panel}${panel}</div>`;
    }

    if (renderer === 'bulk_further_processing_4x6') {
      const manufacturer = [runValue('ship_from_name'), runValue('ship_from')].filter(Boolean).join('<br>') || 'Ship From details';
      const weightField = String(product?.gross_weight_lbs || '').trim() ? 'gross_weight_lbs' : 'package_net_weight_g';
      const weightUnit = weightField === 'gross_weight_lbs' ? 'lb' : 'g';
      return `<div class="b2b-label-sheet b2b-label-bulk ${barcodeVisible ? 'has-barcode' : ''}">
        <strong class="b2b-label-customer">${runEdit('project_name', runValue('name') || 'BULK PACKAGED ITEM', 'b2b-run-project')}</strong>
        <div class="b2b-label-row"><b>ORDER #:</b>${runEdit('order_number', 'Enter order number')}</div>
        <div class="b2b-label-row"><b>PO #:</b>${runEdit('po_number', 'Enter PO number')}</div>
        <div class="b2b-label-row"><b>LOT #:</b>${runEdit('lot_number', 'Enter lot number')}</div>
        <div class="b2b-label-row b2b-label-description"><b>DESCRIPTION:</b>${edit('description', 'Product description', 'b2b-edit-wide')}</div>
        <div class="b2b-label-row"><b>ALLERGENS:</b>${runEdit('allergens', 'NONE')}</div>
        <div class="b2b-label-row"><b>NET WT:</b><span>${edit(weightField, 'Weight')} ${weightUnit}</span></div>
        <div class="b2b-label-manufacturer"><b>MANUFACTURED BY:</b><span>${manufacturer}</span></div>
        <div class="b2b-label-statement">${runEdit('required_statement', 'Bulk Packaged Item – Further Processing and / or Labeling Needed for Retail Sale', 'b2b-edit-wide')}</div>
        <strong class="b2b-label-box-count">${box}</strong>
        ${barcodeHtml}
      </div>`;
    }

    return '<div class="b2b-section-empty">This label renderer does not have an editable canvas yet.</div>';
  }

  function fitB2BLabelPreview(canvas) {
    const sheet = canvas?.querySelector('.b2b-label-sheet');
    if (!sheet) return;
    sheet.style.removeProperty('font-size');
    let sheetSize = Number.parseFloat(window.getComputedStyle(sheet).fontSize) || 14;
    while ((sheet.scrollHeight > sheet.clientHeight + 1 || sheet.scrollWidth > sheet.clientWidth + 1) && sheetSize > 8) {
      sheetSize -= 0.5;
      sheet.style.fontSize = `${sheetSize}px`;
    }
    sheet.querySelectorAll('.b2b-label-editable, .b2b-label-topline > *, .b2b-label-customer, .b2b-label-standard-po, .b2b-label-box-count, .b2b-label-date').forEach(element => {
      element.style.removeProperty('font-size');
      let size = Number.parseFloat(window.getComputedStyle(element).fontSize) || sheetSize;
      const availableWidth = Math.max(24, element.parentElement?.clientWidth || element.clientWidth || 24);
      while (element.scrollWidth > availableWidth + 1 && size > 7) {
        size -= 0.5;
        element.style.fontSize = `${size}px`;
      }
    });
  }

  function renderB2BLabelEditor(product = getSelectedB2BProduct(), template = getSelectedB2BTemplate()) {
    const canvas = document.getElementById('b2b-label-editor-canvas');
    const stage = document.getElementById('b2b-label-editor-stage');
    const empty = document.getElementById('b2b-label-editor-empty');
    const meta = document.getElementById('b2b-label-editor-meta');
    if (!canvas || !stage || !empty) return;
    const ready = !!product && !!template;
    stage.classList.toggle('hidden', !ready);
    empty.classList.toggle('hidden', ready);
    if (!ready) {
      canvas.innerHTML = '';
      if (meta) meta.textContent = 'Select a packaging level to load its print layout.';
      return;
    }
    const width = Number(template.physical_width_in || 4);
    const height = Number(template.physical_height_in || 6);
    const sheetWidth = width <= 3 && height >= 3 ? 440 : width <= 3 ? 640 : 720;
    canvas.style.setProperty('--b2b-label-ratio', `${width} / ${height}`);
    canvas.style.setProperty('--b2b-label-max-width', `${sheetWidth}px`);
    canvas.innerHTML = b2bLabelEditorHtml(template, getB2BOutputProduct(product), getSelectedB2BDirectory());
    window.requestAnimationFrame(() => fitB2BLabelPreview(canvas));
    if (meta) {
      const productNote = b2bSelectedProductIndex <= -1000
        ? 'Order-derived product text stays with this job'
        : 'Product text saves automatically';
      meta.innerHTML = `<span>${escapeHtml(template.name || template.template_id)}</span><span>${width} × ${height} in</span><span class="b2b-meta-product">${escapeHtml(productNote)}</span><span class="b2b-meta-run">Print-run text stays with this job</span>`;
    }
  }

  function handleB2BEditorKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function commitB2BLabelEdit(element) {
    const field = String(element?.dataset?.b2bProductEdit || '');
    if (!field || (b2bSelectedProductIndex > -1000 && !hasPermission('table_crud'))) return;
    const value = String(element.innerText || '').replace(/\s+/g, ' ').trim();
    element.classList.toggle('is-empty', !value);
    updateB2BProductField(field, value, false);
    window.requestAnimationFrame(() => fitB2BLabelPreview(document.getElementById('b2b-label-editor-canvas')));
  }

  function commitB2BRunLabelEdit(element) {
    const field = String(element?.dataset?.b2bRunEdit || '');
    if (!field) return;
    const value = String(element.innerText || '').replace(/\s+/g, ' ').trim();
    element.classList.toggle('is-empty', !value);
    updateB2BRunField(field, value, false);
    window.requestAnimationFrame(() => fitB2BLabelPreview(document.getElementById('b2b-label-editor-canvas')));
  }

  function b2bRunFieldNames(template) {
    if (!template) return [];
    return uniqueTextValues([
      ...((template.required_run_fields || []).map(String)),
      ...((template.optional_run_fields || []).map(String)),
      'copies',
      'print_barcode',
    ]);
  }

  function setB2BSelectorVisibility(name, visible) {
    const wrapper = document.querySelector(`[data-b2b-selector-wrap="${name}"]`);
    if (wrapper) wrapper.classList.toggle('hidden', !visible);
  }

  function visibleB2BRunFields(template) {
    const visible = new Set(b2bRunFieldNames(template));
    const required = new Set((template?.required_run_fields || []).map(String));
    document.querySelectorAll('[data-b2b-run-wrap]').forEach(wrapper => {
      const field = wrapper.dataset.b2bRunWrap;
      const isVisible = visible.has(field);
      wrapper.classList.toggle('hidden', !isVisible);
      wrapper.classList.toggle('b2b-run-required', isVisible && required.has(field));
      wrapper.classList.toggle('b2b-run-optional', isVisible && field !== 'copies' && !required.has(field));
      const input = wrapper.querySelector('[data-b2b-run-field]');
      if (input) {
        input.disabled = !isVisible;
        input.required = isVisible && required.has(field);
      }
    });
    const empty = document.getElementById('b2b-run-fields-empty');
    if (empty) empty.classList.toggle('hidden', !!template);
  }

  function showB2BOrderInstancePicker(orderNumber, orderInstances = []) {
    const picker = document.getElementById('b2b-order-instance-picker');
    const count = document.getElementById('b2b-order-instance-count');
    const button = document.getElementById('btn-load-selected-b2b-order');
    const body = document.getElementById('b2b-order-instance-body');
    if (!picker || !body) return;
    renderOrderInstanceTableRows(body, orderInstances, selectB2BOrderInstance);
    picker.dataset.salesOrderNumber = String(orderNumber || '').trim();
    delete picker.dataset.ecomdashId;
    if (count) count.textContent = `${orderInstances.length} unique order${orderInstances.length === 1 ? '' : 's'}`;
    if (button) button.disabled = true;
    picker.classList.remove('hidden');
  }

  function hideB2BOrderInstancePicker() {
    const picker = document.getElementById('b2b-order-instance-picker');
    if (picker) picker.classList.add('hidden');
  }

  function selectB2BOrderInstance(selectedCheckbox) {
    const picker = document.getElementById('b2b-order-instance-picker');
    const button = document.getElementById('btn-load-selected-b2b-order');
    const help = document.getElementById('b2b-order-instance-selection-help');
    if (!picker || !selectedCheckbox) return;
    picker.querySelectorAll('.mpl-order-instance-checkbox').forEach(checkbox => {
      if (checkbox !== selectedCheckbox) checkbox.checked = false;
    });
    const ecomdashId = selectedCheckbox.checked ? String(selectedCheckbox.value || '').trim() : '';
    if (ecomdashId) picker.dataset.ecomdashId = ecomdashId;
    else delete picker.dataset.ecomdashId;
    if (button) button.disabled = !ecomdashId;
    if (help) help.textContent = ecomdashId ? `Order record ${ecomdashId} selected.` : 'Check one order to continue.';
  }

  function loadSelectedB2BOrderInstance() {
    const picker = document.getElementById('b2b-order-instance-picker');
    const orderNumber = String(picker?.dataset.salesOrderNumber || '').trim();
    const ecomdashId = String(picker?.dataset.ecomdashId || '').trim();
    if (!orderNumber || !ecomdashId) {
      setStatus('Select an order record before loading the order.', 'error');
      return;
    }
    loadB2BOrderFromAnalytics(null, ecomdashId, orderNumber);
  }

  function detectB2BOrderCustomer(payload, matchedProduct) {
    const details = payload?.order_details || {};
    const resolvedCustomer = String(payload?.detected_customer?.name || '').trim();
    if (resolvedCustomer) return resolvedCustomer;
    const backendCustomerId = String(payload?.detected_partner_customer || '').trim();
    if (backendCustomerId && PARTNER_WORKFLOW_CONFIG[backendCustomerId]?.label) {
      return PARTNER_WORKFLOW_CONFIG[backendCustomerId].label;
    }
    const signals = [
      details.storefront,
      details.supplier,
      details.billing_customer_name,
      details.ship_to_name,
      details.email_id,
      details.email,
    ].map(value => String(value || '').trim()).filter(Boolean);
    const partnerId = typeof partnerCustomerIdFromText === 'function'
      ? partnerCustomerIdFromText(signals.join(' | '))
      : '';
    if (partnerId && PARTNER_WORKFLOW_CONFIG[partnerId]?.label) return PARTNER_WORKFLOW_CONFIG[partnerId].label;

    const normalizedSignals = signals.map(value => normalizeStorefront(value).toLowerCase().replace(/[^a-z0-9]+/g, ''));
    const matchingTemplate = b2bLabelTemplates.find(template => {
      const customer = normalizeStorefront(template?.customer || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      return customer && normalizedSignals.some(signal => signal && (signal === customer || signal.includes(customer) || customer.includes(signal)));
    });
    if (matchingTemplate?.customer) return normalizeStorefront(matchingTemplate.customer);
    return String(matchedProduct?.storefront || details.billing_customer_name || details.ship_to_name || details.storefront || '').trim()
      || 'Order Customer';
  }

  function completeB2BOrderLoad(payload, orderNumber) {
    const orderDetails = payload?.order_details || {};
    const analyticsItems = Array.isArray(payload?.items) ? payload.items : [];
    const summary = payload?.summary || {};
    const matchedProducts = Number(summary.matched_products || 0);
    const unmatchedProducts = Number(summary.unmatched_products || 0);
    const ambiguousProducts = Number(summary.ambiguous_products || 0);
    const defaultedLevelSkus = Number(summary.defaulted_level_skus || 0);
    const firstMatched = analyticsItems.find(item => item?.product && item.match_status === 'matched');
    const matchedProduct = firstMatched?.product ? normalizeProductRow(firstMatched.product) : null;
    const preliminaryCustomer = detectB2BOrderCustomer(payload, matchedProduct);
    b2bResolvedOrderContext = resolveOrderContext(payload, { customer: preliminaryCustomer });
    b2bResolvedOrderContext.customerResolution = payload?.detected_customer || {
      name: preliminaryCustomer,
      source: matchedProduct?.storefront ? 'product_master' : 'order_fallback',
      confidence: matchedProduct?.storefront ? 'exact' : 'review',
    };
    const orderCustomer = b2bResolvedOrderContext.customer || preliminaryCustomer;
    b2bOrderFallbackProducts = analyticsItems.map((item, index) => normalizeProductRow({
      ...(item?.product || {}),
      storefront: item?.product?.storefront || orderCustomer,
      config_id: item?.product?.config_id || `ORDER-${String(orderNumber || 'SO').trim()}-${String(item?.sku || index + 1).trim()}`,
      packaging_level: item?.product?.packaging_level || 'Case',
      sku: String(item?.product?.sku || item?.sku || '').trim(),
      customer_item_number: String(item?.product?.customer_item_number || item?.customer_item_number || item?.item_number || item?.sku || '').trim(),
      description: String(item?.product?.description || item?.description || item?.sku || 'Order item').trim(),
      gtin: String(item?.product?.gtin || item?.gtin || '').trim(),
      gross_weight_lbs: String(item?.product?.gross_weight_lbs || item?.unit_weight_lbs || '').trim(),
      case_qty: item?.product?.case_qty || '',
      label_template_id: item?.product?.label_template_id || '',
      barcode_type: item?.product?.barcode_type || (item?.gtin ? 'GTIN_14' : 'NONE'),
      verification_status: item?.product?.verification_status || 'NEEDS_REVIEW',
      label_enabled: true,
      is_active: true,
    }));

    b2bSelectedCustomer = orderCustomer;
    b2bOrderCustomerOverride = '';
    const resolvedShipToRow = b2bResolvedOrderContext.directoryShipTo?.row || {};
    const resolvedShipFromRow = getDefaultB2BShipFrom();
    b2bOrderDestinationOverride = analyticsMplAddress(orderDetails, 'shipping')
      || b2bResolvedOrderContext.shipTo?.address
      || resolvedShipToRow.address
      || resolvedShipToRow.delivery_address
      || '';
    b2bOrderShipToName = String(orderDetails.ship_to_name || '').trim()
      || String(resolvedShipToRow.name || '').trim()
      || String(resolvedShipToRow.dc || '').trim();
    b2bSelectedDirectoryIndex = -1;
    const orderBillTo = analyticsMplAddress(orderDetails, 'billing')
      || b2bResolvedOrderContext.billTo?.address
      || '';
    b2bResolvedDirectoryFallback = {
      ...resolvedShipToRow,
      storefront: orderCustomer,
      name: resolvedShipToRow.name || orderDetails.ship_to_name || orderDetails.billing_customer_name || orderCustomer,
      dc: resolvedShipToRow.dc || '',
      address: b2bResolvedOrderContext.shipTo?.address || '',
      delivery_address: b2bResolvedOrderContext.shipTo?.address || '',
      billing_address: orderBillTo,
      ship_from_name: resolvedShipFromRow.name || '',
      ship_from: resolvedShipFromRow.address || resolvedShipFromRow.ship_from || '',
      record_type: 'SHIP_TO',
      address_roles: ['SHIP_TO'],
      default_label_template_id: resolvedShipToRow.default_label_template_id || '',
      is_active: true,
    };
    b2bRunFields.order_number = String(orderNumber || '');
    b2bRunFields.po_number = String(orderDetails?.purchase_order_number || orderDetails?.po_number || '');
    b2bRunFields.invoice_number = String(orderDetails?.invoice_number || '');
    b2bRunFields.ship_date = String(orderDetails?.ship_date || orderDetails?.expected_delivery_date || '');
    b2bRunFields.expected_delivery_date = String(orderDetails?.expected_delivery_date || orderDetails?.ship_date || '');
    b2bRunFields.quantity_label = String(analyticsItems.reduce((sum, item) => sum + (Number(item?.quantity_ordered) || 0), 0) || '');
    const selectedOrderItem = firstMatched || analyticsItems[0] || {};
    const selectedOrderProduct = matchedProduct || selectedOrderItem?.product || b2bOrderFallbackProducts[0] || {};
    const orderCartons = resolvedOrderUnitCount(selectedOrderItem, selectedOrderProduct);
    b2bRunFields.carton_total = String(orderCartons);
    b2bRunFields.carton_start = '1';
    b2bRunFields.carton_end = String(orderCartons);
    b2bTemplateRunFields = {};
    b2bOrderLabelJobs = buildB2BOrderLabelJobs(analyticsItems);
    b2bOrderFallbackProducts = [];
    b2bOrderLabelJobs.forEach(job => {
      const index = b2bOrderFallbackProducts.length;
      job.order_only_product_index = index;
      b2bOrderFallbackProducts.push(normalizeProductRow({ ...job.product }));
    });
    const selectedSku = String(selectedOrderProduct?.sku || selectedOrderItem?.sku || '').trim().toLowerCase();
    b2bSelectedOrderJobIndex = Math.max(0, b2bOrderLabelJobs.findIndex(job => String(job.product?.sku || '').trim().toLowerCase() === selectedSku));
    const selectedOrderJob = b2bOrderLabelJobs[b2bSelectedOrderJobIndex];
    const selectedFallbackIndex = Number(selectedOrderJob?.order_only_product_index);
    const selectedFallbackProduct = b2bOrderFallbackProducts[selectedFallbackIndex];
    if (selectedFallbackProduct) {
      b2bSelectedProductIndex = -1000 - selectedFallbackIndex;
      b2bSelectedGroupKey = mplProductGroupKey(selectedFallbackProduct, b2bSelectedProductIndex);
      b2bSelectedTemplateId = selectedOrderJob.template_id || '';
      b2bSelectedTemplateIds = b2bTemplateIdsForJob(selectedOrderJob);
    }
    clearB2BPreview();
    renderB2BCreator();
    const overridePanel = document.getElementById('b2b-selection-overrides');
    if (overridePanel) {
      overridePanel.open = false;
      delete overridePanel.dataset.userOpened;
    }
    setStatus(
      `Sales Order ${orderNumber} loaded · ${analyticsItems.length} line item(s) · ${b2bOrderLabelJobs.length} label job(s) calculated · ${matchedProducts} matched${unmatchedProducts || ambiguousProducts || defaultedLevelSkus ? ` · ${unmatchedProducts + ambiguousProducts + defaultedLevelSkus} need review` : ''}. Review the batch, then generate all labels.`,
      unmatchedProducts || ambiguousProducts || defaultedLevelSkus ? 'info' : 'success'
    );
  }

  function buildB2BOrderLabelJobs(orderItems) {
    const destination = { ...(b2bResolvedDirectoryFallback || {}) };
    const shipFrom = getSelectedB2BShipFrom();
    destination.ship_from_name = String(shipFrom.name || '').trim();
    destination.ship_from = String(shipFrom.address || shipFrom.ship_from || '').replace(/\\n/g, '\n').trim();
    return window.LabelKitB2BOrderJobs.buildB2BOrderLabelJobs({
      orderItems,
      fallbackProducts: b2bOrderFallbackProducts,
      productRows: mplProductMasterRows,
      templates: b2bLabelTemplates,
      destination,
      runFields: b2bRunFields,
      customer: b2bSelectedCustomer,
      normalizeProduct: normalizeProductRow,
      normalizeLevel: normalizePackagingLevel,
      productGroupKey: mplProductGroupKey,
      getLabelEnabled: level => (
        Object.prototype.hasOwnProperty.call(level || {}, 'label_enabled')
          ? !!level.label_enabled
          : !!level?.label_available
      ),
    });
  }

  function renderB2BAutomaticResolution() {
    const container = document.getElementById('b2b-auto-resolution');
    const details = document.getElementById('b2b-selection-overrides');
    if (!container) return;
    const product = getSelectedB2BProduct();
    const directory = getSelectedB2BDirectory();
    const loadedOrder = String(b2bRunFields.order_number || '').trim();
    if (!loadedOrder) {
      container.innerHTML = isB2BTemplateGalleryMode()
        ? '<div><span>Manual label</span><strong>Choose a template, then a product</strong><small>The selected Product Master record auto-fills the editable label.</small></div>'
        : '<div><span>Manual setup</span><strong>Choose a customer and product below</strong><small>Loading a sales order will make these selections automatically.</small></div>';
      container.classList.remove('is-resolved');
      if (details) details.open = true;
      return;
    }
    const destinationRow = directory || b2bResolvedOrderContext?.directoryShipTo?.row || {};
    const destinationName = b2bOrderShipToName || destinationRow.name || destinationRow.dc || 'Destination not found';
    const destinationAddress = b2bOrderDestinationOverride
      || String(destinationRow.address || destinationRow.delivery_address || '').trim();
    const reviewGroups = b2bOrderLabelJobs.reduce((groups, job, index) => {
      const key = b2bOrderReviewGroupKey(job);
      if (!groups.has(key)) groups.set(key, { key, firstIndex: index, jobs: [] });
      groups.get(key).jobs.push({ job, index });
      return groups;
    }, new Map());
    const uniqueGroups = [...reviewGroups.values()];
    const selectedTemplateJobCount = b2bOrderLabelJobs.reduce((total, job) => total + b2bTemplateIdsForJob(job).length, 0);
    const incompleteGroupCount = uniqueGroups.filter(group => group.jobs.some(({ job }) => !b2bTemplateIdsForJob(job).length || job.template_selection_required)).length;
    const configuredGroupCount = Math.max(0, uniqueGroups.length - incompleteGroupCount);
    const selectedReviewGroup = uniqueGroups.find(group => group.jobs.some(item => item.index === b2bSelectedOrderJobIndex)) || uniqueGroups[0];
    const selectedReviewJob = selectedReviewGroup?.jobs[0]?.job || b2bOrderLabelJobs[b2bSelectedOrderJobIndex] || {};
    const selectedReviewIndex = selectedReviewGroup?.firstIndex ?? b2bSelectedOrderJobIndex;
    const selectedReviewProduct = selectedReviewJob.product || product || {};
    const selectedIssue = (selectedReviewGroup?.jobs || []).some(({ job }) => (
      job.match_status !== 'matched'
      || job.needs_label_review
      || job.template_selection_required
      || !b2bTemplateIdsForJob(job).length
    ));
    const customerOptions = uniqueTextValues([...b2bCustomerOptions(b2bSelectedCustomer), b2bSelectedCustomer]);
    const customerResolution = b2bResolvedOrderContext?.customerResolution || {};
    const customerSourceLabels = {
      email: 'Email',
      product_master: 'Product Master',
      storefront: 'order storefront',
      billing_customer_name: 'billing customer',
      ship_to_name: 'Ship To',
      supplier: 'supplier',
      order_fallback: 'order data',
      manual: 'your selection',
    };
    const detectedFrom = customerSourceLabels[customerResolution.source] || 'order data';
    const customerPicker = `<label class="b2b-order-customer-picker"><span>Customer · detected from ${escapeHtml(detectedFrom)}</span><select id="b2b-order-customer-select" onchange="selectB2BOrderCustomer(this.value)">${customerOptions.map(customer => `<option value="${escapeHtml(customer)}" ${customer === b2bSelectedCustomer ? 'selected' : ''}>${escapeHtml(customer)}</option>`).join('')}</select><small>${customerResolution.confidence === 'review' ? 'Please confirm this customer before printing.' : 'Change only if the detected customer is wrong.'}</small></label>`;
    const selectedShipFrom = getSelectedB2BShipFrom();
    const shipFromAddress = String(selectedShipFrom.address || selectedShipFrom.ship_from || '').trim();
    const shipFromName = String(selectedShipFrom.name || destinationRow.ship_from_name || '').trim();
    const billToAddress = String(destinationRow.billing_address || '').trim();
    const destinationEditor = `<details class="b2b-order-addresses"><summary><span><strong>Order addresses</strong><small>${escapeHtml(destinationName)} · Bill To and Ship To came from this order. Ship From uses the saved default.</small></span><span>Review addresses</span></summary><div class="b2b-order-address-grid"><label class="b2b-order-destination"><span>Ship To · from order${destinationName ? ` · ${escapeHtml(destinationName)}` : ''}</span><textarea id="b2b-order-destination-input" rows="2" placeholder="No Ship To found on this order" oninput="updateB2BOrderDestination(this.value)">${escapeHtml(destinationAddress)}</textarea><small>Order-only override; Product Master and Directory remain unchanged.</small></label><label class="b2b-order-destination"><span>Bill To · from order</span><textarea id="b2b-order-bill-to-input" rows="2" placeholder="No Bill To found on this order" onchange="updateB2BOrderAddress('billing_address', this.value)">${escapeHtml(billToAddress)}</textarea><small>Loaded from the order; changes stay with this run.</small></label><details class="b2b-order-origin"><summary><span>Ship From · saved default</span><strong>${escapeHtml(shipFromName || 'Default origin missing')}</strong><small>${shipFromAddress ? escapeHtml(firstLine(shipFromAddress)) : 'Add an active default Ship From in Customer Directory.'}</small><em>Change for this order</em></summary><div class="b2b-order-origin-fields"><label class="b2b-order-destination"><span>Ship From name</span><input id="b2b-order-ship-from-name" value="${escapeHtml(shipFromName)}" placeholder="Ship-from name" onchange="updateB2BOrderShipFrom('ship_from_name', this.value)"></label><label class="b2b-order-destination"><span>Ship From address</span><textarea id="b2b-order-ship-from-input" rows="2" placeholder="Ship-from address" onchange="updateB2BOrderShipFrom('ship_from', this.value)">${escapeHtml(shipFromAddress)}</textarea><small>Optional run-only override; the saved default is not changed.</small></label></div></details></div></details>`;
    const reviewReason = selectedReviewJob.match_reason
      || (selectedReviewJob.match_status === 'matched' ? 'Exact Product Master match.' : 'Product Master review required.');
    const selectedOutputCount = (selectedReviewGroup?.jobs || []).reduce((total, item) => total + (Number(item.job?.run?.carton_total) || 0), 0);
    const selectedTemplateIds = b2bTemplateIdsForJob(selectedReviewJob);
    const editActionLabel = selectedTemplateIds.length ? 'Edit active label' : 'Choose templates';
    const selectedTemplateCount = selectedTemplateIds.length;
    const selectedLabelCard = uniqueGroups.length
      ? `<section class="b2b-selected-label-card ${selectedIssue ? 'review' : 'ready'}"><div class="b2b-selected-label-copy"><span>Selected label</span><strong>${escapeHtml(selectedReviewProduct.description || selectedReviewProduct.sku || 'Order label')}</strong><small>${escapeHtml(selectedReviewProduct.sku || 'SKU not set')} · ${escapeHtml(selectedReviewProduct.packaging_level || 'Level not set')} · ${escapeHtml(reviewReason)}</small></div><div class="b2b-selected-label-facts"><div><span>Output</span><strong>${escapeHtml((selectedOutputCount || 0) * selectedTemplateCount)} label unit(s)</strong></div><div><span>Status</span><strong class="b2b-selected-label-state">${selectedIssue ? 'Needs review' : 'Ready'}</strong></div></div><button class="btn-secondary b2b-edit-order-label" type="button" onclick="reviewB2BProductMatch(${selectedReviewIndex})">${escapeHtml(editActionLabel)}</button></section>`
      : '<section class="b2b-selected-label-card review"><div class="b2b-selected-label-copy"><span>Order label batch</span><strong>No enabled labels found</strong><small>Add or enable the required packaging-level label in Product Master, then reload this order.</small></div></section>';
    container.innerHTML = `<div class="b2b-resolution-top"><div class="b2b-resolution-heading"><span>Loaded Sales Order ${escapeHtml(loadedOrder)}</span><strong>${uniqueGroups.length || 1} product${uniqueGroups.length === 1 ? '' : 's'} · ${configuredGroupCount} configured · ${incompleteGroupCount} incomplete · ${selectedTemplateJobCount} label job${selectedTemplateJobCount === 1 ? '' : 's'}</strong><small>Assign templates in Batch Setup, then review every selected label in the editor queue.</small></div>${customerPicker}</div>${selectedLabelCard}${destinationEditor}`;
    container.classList.add('is-resolved');
    if (details && !details.dataset.userOpened) details.open = false;
    renderB2BSkuTemplateList(uniqueGroups, selectedReviewIndex);
  }

  function renderB2BSkuTemplateList(uniqueGroups, selectedReviewIndex) {
    const listEl = document.getElementById('b2b-sku-template-list');
    if (!listEl) return;
    if (!uniqueGroups.length) {
      listEl.innerHTML = '<div class="b2b-section-empty">No enabled labels found for this order.</div>';
      return;
    }
    listEl.innerHTML = uniqueGroups.map(group => {
      const job = group.jobs[0].job;
      const jobProduct = job.product || {};
      const review = group.jobs.some(({ job: rowJob }) => (
        rowJob.match_status !== 'matched'
        || rowJob.needs_label_review
        || rowJob.template_selection_required
        || !b2bTemplateIdsForJob(rowJob).length
      ));
      const active = group.firstIndex === selectedReviewIndex;
      const selectedCustomer = b2bSelectedCustomer || jobProduct.storefront;
      const templateResolution = resolveB2BTemplateOptions(job, selectedCustomer);
      const compatibleTemplateIds = new Set(templateResolution.compatible.map(candidate => candidate.template_id));
      const selectedTemplateIds = b2bTemplateIdsForJob(job);
      const orderedTemplateOptions = [...templateResolution.options].sort((left, right) => {
        const leftRank = compatibleTemplateIds.has(left.template_id) ? 0 : 1;
        const rightRank = compatibleTemplateIds.has(right.template_id) ? 0 : 1;
        return leftRank - rightRank;
      });
      const templateHelp = selectedTemplateIds.length ? '' : 'Check every template required for this SKU and level.';
      const templatePickerHtml = b2bTemplatePickerHtml(
        orderedTemplateOptions,
        selectedTemplateIds,
        templateHelp,
        'order',
        group.firstIndex,
        false,
        group.firstIndex,
        [...compatibleTemplateIds]
      );
      return `<div class="b2b-sku-row ${active ? 'active' : ''} ${review ? 'review' : ''}">
        <button type="button" class="b2b-sku-row-label" onclick="reviewB2BProductMatch(${group.firstIndex})">
          <strong>${escapeHtml(jobProduct.sku || jobProduct.customer_item_number || 'SKU not set')}</strong>
          <small>${escapeHtml(jobProduct.packaging_level || 'Level not set')}${review ? ' · needs review' : ''}</small>
        </button>
        <div class="b2b-sku-row-templates">${templatePickerHtml}</div>
      </div>`;
    }).join('');
  }

  function renderB2BManualSkuRow(product, templateResolution) {
    const listEl = document.getElementById('b2b-sku-template-list');
    if (!listEl) return;
    if (!product) {
      listEl.innerHTML = '<div class="b2b-section-empty">Choose a customer, product, and packaging level above to pick templates.</div>';
      return;
    }
    const selectedTemplateIds = b2bSelectedTemplateIds;
    const templateHelp = selectedTemplateIds.length ? '' : 'Check every label template required for this packaging level.';
    const templatePickerHtml = b2bTemplatePickerHtml(
      templateResolution.options,
      selectedTemplateIds,
      templateHelp,
      'manual',
      null,
      false,
      'manual',
      templateResolution.compatible.map(template => template.template_id)
    );
    listEl.innerHTML = `<div class="b2b-sku-row active">
      <div class="b2b-sku-row-label">
        <strong>${escapeHtml(product.sku || product.customer_item_number || 'SKU not set')}</strong>
        <small>${escapeHtml(product.packaging_level || 'Level not set')}</small>
      </div>
      <div class="b2b-sku-row-templates">${templatePickerHtml}</div>
    </div>`;
  }

  function reviewB2BProductMatch(index, templateId = '') {
    const job = b2bOrderLabelJobs[Number(index)];
    if (!job) return;
    selectB2BOrderJob(index, templateId);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (!b2bTemplateIdsForJob(job).length) {
        const picker = document.querySelector('.b2b-sku-row.active .b2b-sku-row-templates .b2b-template-picker');
        if (picker) picker.open = true;
        picker?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setStatus(`Choose one or more templates for ${job.product?.sku || 'this order item'} to open its live label editor.`, 'info');
        return;
      }
      focusB2BLabelEditor(job);
    }));
  }

  function focusB2BLabelEditor(job = b2bOrderLabelJobs[b2bSelectedOrderJobIndex]) {
    const editor = document.getElementById('b2b-label-editor-card');
    if (!editor || !job?.template_id) return;
    editor.classList.add('b2b-editor-attention');
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => editor.classList.remove('b2b-editor-attention'), 1200);
    const editable = editor.querySelector('.b2b-label-editable');
    if (editable) editable.focus({ preventScroll: true });
    setStatus(`${job.product?.sku || 'Order item'} is open in the live label editor. Changes apply only to this order batch.`, 'info');
  }

  function selectB2BOrderJob(value, requestedTemplateId = '') {
    const index = Number(value);
    const job = b2bOrderLabelJobs[index];
    if (!Number.isInteger(index) || !job) return;
    if (index !== b2bSelectedOrderJobIndex || (requestedTemplateId && requestedTemplateId !== b2bSelectedTemplateId)) {
      persistB2BActiveRunFields();
    }
    const product = normalizeProductRow(job.product || {});
    let fallbackIndex = -1;
    if (Number.isInteger(job.order_only_product_index)) {
      fallbackIndex = job.order_only_product_index;
      b2bSelectedProductIndex = -1000 - fallbackIndex;
      b2bSelectedGroupKey = mplProductGroupKey(b2bOrderFallbackProducts[fallbackIndex] || product, b2bSelectedProductIndex);
    } else if (b2bOrderCustomerOverride && Number.isInteger(job.customer_override_fallback_index)) {
      const fallbackIndex = job.customer_override_fallback_index;
      b2bSelectedProductIndex = -1000 - fallbackIndex;
      b2bSelectedGroupKey = mplProductGroupKey(b2bOrderFallbackProducts[fallbackIndex], b2bSelectedProductIndex);
    } else {
      fallbackIndex = b2bOrderFallbackProducts.length;
      b2bOrderFallbackProducts.push(product);
      job.order_only_product_index = fallbackIndex;
      b2bSelectedProductIndex = -1000 - fallbackIndex;
      b2bSelectedGroupKey = mplProductGroupKey(product, b2bSelectedProductIndex);
    }
    b2bSelectedCustomer = b2bOrderCustomerOverride || b2bResolvedOrderContext?.customer || product.storefront || b2bSelectedCustomer;
    b2bSelectedTemplateIds = b2bTemplateIdsForJob(job);
    b2bSelectedTemplateId = b2bSelectedTemplateIds.includes(requestedTemplateId)
      ? requestedTemplateId
      : b2bSelectedTemplateIds.includes(job.template_id) ? job.template_id : (b2bSelectedTemplateIds[0] || '');
    job.template_id = b2bSelectedTemplateId;
    b2bSelectedOrderJobIndex = index;
    b2bResolvedDirectoryFallback = { ...(job.directory || b2bResolvedDirectoryFallback) };
    loadB2BActiveRunFields(job, b2bSelectedTemplateId);
    b2bSettingsProductIndex = -1;
    clearB2BPreview();
    renderB2BCreator();
  }

  function b2bOrderReviewGroupKey(job) {
    const product = normalizeProductRow(job?.product || {});
    return [
      normalizeStorefront(product.storefront).toLowerCase(),
      normalizePackagingLevel(product.packaging_level).toLowerCase(),
      String(product.config_id || product.sku || product.customer_item_number || '').trim().toLowerCase(),
    ].join('|');
  }

  function updateB2BOrderDestination(value) {
    if (!b2bOrderLabelJobs.length) return;
    b2bOrderDestinationOverride = String(value || '').trim();
    const name = b2bOrderShipToName
      || b2bResolvedOrderContext?.shipTo?.row?.name
      || b2bResolvedOrderContext?.directoryShipTo?.row?.name
      || 'Order Ship To';
    b2bResolvedDirectoryFallback = {
      ...(b2bResolvedDirectoryFallback || {}),
      name,
      address: b2bOrderDestinationOverride,
      delivery_address: b2bOrderDestinationOverride,
    };
    b2bOrderLabelJobs.forEach(job => {
      job.directory = {
        ...(job.directory || {}),
        name,
        address: b2bOrderDestinationOverride,
        delivery_address: b2bOrderDestinationOverride,
      };
    });
    clearB2BPreview();
    renderB2BLabelEditor();
    renderB2BValidation();
  }

  function updateB2BOrderShipFrom(field, value) {
    if (!b2bOrderLabelJobs.length || !['ship_from', 'ship_from_name'].includes(field)) return;
    const clean = String(value || '').trim();
    b2bResolvedDirectoryFallback = { ...(b2bResolvedDirectoryFallback || {}), [field]: clean };
    b2bOrderLabelJobs.forEach(job => {
      job.directory = { ...(job.directory || {}), [field]: clean };
    });
    clearB2BPreview();
    renderB2BLabelEditor();
    renderB2BValidation();
  }

  function updateB2BOrderAddress(field, value) {
    if (!b2bOrderLabelJobs.length || !['billing_address'].includes(field)) return;
    const clean = String(value || '').trim();
    b2bResolvedDirectoryFallback = { ...(b2bResolvedDirectoryFallback || {}), [field]: clean };
    b2bOrderLabelJobs.forEach(job => {
      job.directory = { ...(job.directory || {}), [field]: clean };
    });
    clearB2BPreview();
    renderB2BLabelEditor();
    renderB2BValidation();
  }

  function selectB2BOrderCustomer(value) {
    if (!b2bOrderLabelJobs.length || !String(b2bRunFields.order_number || '').trim()) {
      selectB2BCustomer(value);
      return;
    }
    const customer = normalizeStorefront(value);
    if (!customer) return;
    b2bOrderCustomerOverride = customer;
    b2bSelectedCustomer = customer;
    if (b2bResolvedOrderContext) {
      b2bResolvedOrderContext.customer = customer;
      b2bResolvedOrderContext.customerResolution = {
        name: customer,
        source: 'manual',
        confidence: 'exact',
      };
    }
    b2bOrderFallbackProducts = [];
    b2bOrderLabelJobs.forEach((job, index) => {
      const sourceProduct = normalizeProductRow(job.product || {});
      const templateResolution = window.LabelKitB2BOrderJobs.resolveB2BTemplateChoice({
        templates: b2bLabelTemplates,
        customer,
      });
      const templateId = String(templateResolution.selectedId || '').trim();
      const product = normalizeProductRow({
        ...sourceProduct,
        storefront: customer,
        label_template_id: templateId,
        label_enabled: true,
        is_active: true,
      });
      const fallbackIndex = b2bOrderFallbackProducts.length;
      b2bOrderFallbackProducts.push(product);
      job.product = product;
      job.template_id = templateId;
      job.template_ids = templateId ? [templateId] : [];
      job.order_only_product_index = fallbackIndex;
      job.template_selection_required = !templateId;
      if (!templateId) {
        job.needs_label_review = true;
        job.review_reasons = uniqueTextValues([...(job.review_reasons || []), `Choose a label template for ${product.packaging_level || 'this level'}.`]);
      }
      job.customer_override_fallback_index = fallbackIndex;
      job.match_status = 'customer_override';
      job.directory = { ...(job.directory || {}), storefront: customer };
    });
    b2bSelectedDirectoryIndex = -1;
    b2bSelectedOrderJobIndex = Math.max(0, Math.min(b2bSelectedOrderJobIndex, b2bOrderLabelJobs.length - 1));
    clearB2BPreview();
    selectB2BOrderJob(String(b2bSelectedOrderJobIndex));
    setStatus(`Customer changed to ${customer} for this order batch. Values are run-only and will not overwrite the original Product Master records.`, 'info');
  }

  function rememberB2BOverrideState(details) {
    if (!details) return;
    details.dataset.userOpened = details.open ? 'true' : '';
  }

  async function loadB2BOrderFromAnalytics(event, selectedEcomdashId = '', selectedOrderNumber = '') {
    if (event) event.preventDefault();
    const input = document.getElementById('b2b-sales-order-number');
    const orderNumber = String(selectedOrderNumber || input?.value || '').trim();
    const ecomdashId = String(selectedEcomdashId || '').trim();
    if (!orderNumber) {
      setStatus('Enter a Sales Order Number.', 'error');
      if (input) input.focus();
      return;
    }

    setStatus(`Searching order data for Sales Order ${orderNumber}…`, 'info');
    try {
      const response = await fetch('/api/b2b/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_order_number: orderNumber, ecomdash_id: ecomdashId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'The sales order could not be loaded.');
      if (payload.requires_order_selection) {
        showB2BOrderInstancePicker(orderNumber, payload.order_instances || []);
        setStatus(`Sales Order ${orderNumber} has multiple records. Select the correct customer order.`, 'info');
        return;
      }
      hideB2BOrderInstancePicker();
      completeB2BOrderLoad(payload, orderNumber);
    } catch (err) {
      setStatus('Error: ' + (err?.message || 'The sales order could not be loaded.'), 'error');
    }
  }

  function renderB2BLabelCoverage() {
    const body = document.getElementById('b2b-label-coverage-body');
    const summary = document.getElementById('b2b-coverage-summary');
    if (!body) return;
    const entries = getB2BProductEntries('');
    const allRows = b2bLabelTemplates.map(template => {
      const templateEntries = entries.filter(entry => entry.row.label_template_id === template.template_id);
      const configurations = new Set(templateEntries.map(entry => mplProductGroupKey(entry.row, entry.index)));
      const levels = uniqueTextValues(templateEntries.map(entry => entry.row.packaging_level));
      const customers = uniqueTextValues(templateEntries.map(entry => entry.row.storefront));
      return {
        template,
        configurations: configurations.size,
        levels,
        customer: customers.join(', ') || template.customer || 'Generic B2B',
      };
    });
    const search = String(document.getElementById('b2b-coverage-search')?.value || '').trim().toLowerCase();
    const status = String(document.getElementById('b2b-coverage-status-filter')?.value || '').trim().toLowerCase();
    const rows = allRows.filter(({ template, configurations, levels, customer }) => {
      const haystack = [customer, template.name, template.template_id, template.physical_width_in, template.physical_height_in, levels].join(' ').toLowerCase();
      return (!search || haystack.includes(search))
        && (!status || (status === 'configured' ? configurations > 0 : configurations === 0));
    });
    body.innerHTML = rows.length
      ? rows.map(({ template, configurations, levels, customer }) => `
          <tr>
            <td><strong>${escapeHtml(customer)}</strong></td>
            <td>${escapeHtml(template.name || template.template_id)}<br><small>${escapeHtml(template.template_id)}</small></td>
            <td>${escapeHtml(`${template.physical_width_in} × ${template.physical_height_in} in`)}</td>
            <td><span class="b2b-coverage-count">${configurations}</span></td>
            <td>${escapeHtml(levels.join(', ') || 'No SKU configured yet')}</td>
          </tr>`).join('')
      : `<tr><td colspan="5">${allRows.length ? 'No label templates match these filters.' : 'No B2B label templates are configured.'}</td></tr>`;
    const count = document.getElementById('b2b-coverage-filter-count');
    if (count) count.textContent = `${rows.length} of ${allRows.length} labels`;
    if (summary) {
      const configured = allRows.filter(row => row.configurations > 0).length;
      const configurationCount = allRows.reduce((total, row) => total + row.configurations, 0);
      summary.textContent = `${allRows.length} label types · ${configured} with product data · ${configurationCount} SKU configurations`;
    }
  }

  function renderB2BCreator() {
    if (!['b2b', 'operations'].includes(selectedKit)) return;
    const loadedOrder = !!String(b2bRunFields.order_number || '').trim();
    const galleryMode = isB2BTemplateGalleryMode();
    const overridePanel = document.getElementById('b2b-selection-overrides');
    if (overridePanel) {
      overridePanel.classList.toggle('hidden', loadedOrder);
      if (loadedOrder) overridePanel.open = false;
    }
    const configurationKicker = document.getElementById('b2b-configuration-kicker');
    const configurationTitle = document.getElementById('b2b-configuration-title');
    const templateSummary = document.getElementById('b2b-template-summary');
    if (configurationKicker) configurationKicker.textContent = loadedOrder ? 'Order label batch' : galleryMode ? 'Manual label creator' : 'Label configuration';
    if (configurationTitle) configurationTitle.textContent = loadedOrder ? 'Review this order' : galleryMode ? 'Choose a template, then a product' : 'Choose what to print';
    if (templateSummary) templateSummary.classList.toggle('hidden', loadedOrder);
    if (overridePanel && galleryMode) {
      overridePanel.open = true;
      const heading = overridePanel.querySelector('summary strong');
      const help = overridePanel.querySelector('summary small');
      const action = overridePanel.querySelector('.b2b-override-action');
      if (heading) heading.textContent = 'Build a custom label';
      if (help) help.textContent = 'Choose a template, then select the Product Master configuration to populate the label.';
      if (action) action.textContent = 'Template gallery';
    }
    renderB2BTemplateGallery();
    renderB2BLabelCoverage();
    const customers = uniqueTextValues([
      ...b2bLabelTemplates.map(template => template?.customer),
      ...getB2BProductEntries('').map(entry => entry.row.storefront),
      ...mplDirectoryRows.map(row => normalizeDcDirectoryRow(row).storefront).filter(storefront => !isKeheStorefront(storefront)),
    ]);
    if (!customers.includes(b2bSelectedCustomer)) {
      b2bSelectedCustomer = '';
      b2bSelectedGroupKey = '';
      b2bSelectedProductIndex = -1;
      b2bSelectedDirectoryIndex = -1;
      b2bSelectedTemplateId = '';
      b2bSelectedTemplateIds = [];
    }
    setNativeSelectOptions(document.getElementById('b2b-customer-select'), customers, b2bSelectedCustomer, customers.length ? 'Select customer' : 'No customers available');
    setB2BSelectorVisibility('customer', !loadedOrder && !galleryMode);

    const hasCustomer = !!b2bSelectedCustomer;
    const groups = hasCustomer ? getB2BProductGroups() : [];
    if (b2bSelectedGroupKey && !groups.some(group => group.key === b2bSelectedGroupKey)) {
      b2bSelectedGroupKey = '';
      b2bSelectedProductIndex = -1;
      if (!galleryMode) {
        b2bSelectedTemplateId = '';
        b2bSelectedTemplateIds = [];
      }
    }
    const productSelect = document.getElementById('b2b-product-select');
    if (productSelect) {
      productSelect.innerHTML = groups.length
        ? `<option value="">Select product / configuration</option>${groups.map(group => {
            const primary = group.entries.find(entry => entry.row.packaging_level === 'Case')?.row || group.entries[0]?.row || {};
            const label = [primary.description || primary.sku || primary.customer_item_number || 'Unnamed product', primary.config_id || primary.sku || 'No Product SKU'].join(' — ');
            return `<option value="${escapeHtml(group.key)}" ${group.key === b2bSelectedGroupKey ? 'selected' : ''}>${escapeHtml(label)}</option>`;
          }).join('')}`
        : '<option value="">No configurations for this customer</option>';
      productSelect.value = b2bSelectedGroupKey;
    }
    setB2BSelectorVisibility('product', hasCustomer && !loadedOrder);

    const selectedGroup = groups.find(group => group.key === b2bSelectedGroupKey);
    const groupEntries = selectedGroup?.entries || [];
    if (b2bSelectedProductIndex >= 0 && !groupEntries.some(entry => entry.index === b2bSelectedProductIndex)) {
      b2bSelectedProductIndex = -1;
      if (!galleryMode) {
        b2bSelectedTemplateId = '';
        b2bSelectedTemplateIds = [];
      }
    }
    const product = getSelectedB2BProduct();
    const levels = uniqueTextValues(groupEntries.map(entry => entry.row.packaging_level));
    setNativeSelectOptions(document.getElementById('b2b-level-select'), levels, product?.packaging_level || '', levels.length ? 'Select packaging level' : 'No levels');
    setB2BSelectorVisibility('level', !!selectedGroup && !loadedOrder);

    const directoryEntries = product ? getB2BDirectoryEntries() : [];
    if (!directoryEntries.some(entry => entry.index === b2bSelectedDirectoryIndex)) {
      b2bSelectedDirectoryIndex = b2bResolvedOrderContext
        ? -1
        : ((directoryEntries.find(entry => entry.row.record_type === 'CUSTOMER_DEFAULT') || directoryEntries[0])?.index ?? -1);
    }
    const directorySelect = document.getElementById('b2b-directory-select');
    if (directorySelect) {
      const orderAddressOption = b2bResolvedDirectoryFallback?.delivery_address
        ? `<option value="" ${b2bSelectedDirectoryIndex < 0 ? 'selected' : ''}>Order address — ${escapeHtml(firstLine(b2bResolvedDirectoryFallback.delivery_address))}</option>`
        : '';
      directorySelect.innerHTML = directoryEntries.length
        ? `${orderAddressOption}${directoryEntries.map(entry => `<option value="${entry.index}" ${entry.index === b2bSelectedDirectoryIndex ? 'selected' : ''}>${escapeHtml(`${entry.row.name || entry.row.storefront} — ${entry.row.dc || entry.row.record_type}`)}</option>`).join('')}`
        : '<option value="">No directory record; label values remain editable</option>';
    }
    setB2BSelectorVisibility('directory', !loadedOrder && !!product && (directoryEntries.length > 0 || !!b2bResolvedDirectoryFallback?.delivery_address));

    const directory = getSelectedB2BDirectory();
    const selectedOrderJob = b2bOrderLabelJobs[b2bSelectedOrderJobIndex];
    const orderTemplateEditable = !!String(b2bRunFields.order_number || '').trim() && !!selectedOrderJob;
    const templateResolution = product ? window.LabelKitB2BOrderJobs.resolveB2BTemplateChoice({
      templates: b2bLabelTemplates,
      customer: product.storefront || b2bSelectedCustomer,
      currentTemplateId: b2bSelectedTemplateId,
      productTemplateId: product.label_template_id,
      directoryTemplateId: directory.default_label_template_id,
    }) : galleryMode ? {
      selectedId: b2bSelectedTemplateId,
      compatible: b2bLabelTemplates.filter(template => !b2bSelectedCustomer || normalizeStorefront(template.customer).toLowerCase() === normalizeStorefront(b2bSelectedCustomer).toLowerCase()),
      options: b2bLabelTemplates,
    } : { selectedId: '', options: [] };
    const templateChoices = templateResolution.options.map(template => template.template_id);
    if (!templateChoices.includes(b2bSelectedTemplateId) && !orderTemplateEditable) {
      b2bSelectedTemplateId = templateResolution.selectedId || '';
    }
    if (!orderTemplateEditable && !galleryMode) {
      b2bSelectedTemplateIds = b2bTemplateIdsForJob()
        .filter(templateId => templateChoices.includes(templateId));
      if (!b2bSelectedTemplateIds.length && b2bSelectedTemplateId) b2bSelectedTemplateIds = [b2bSelectedTemplateId];
      if (!b2bSelectedTemplateIds.includes(b2bSelectedTemplateId)) b2bSelectedTemplateId = b2bSelectedTemplateIds[0] || '';
    }
    const manualTemplatePicker = document.getElementById('b2b-template-picker');
    if (manualTemplatePicker) manualTemplatePicker.innerHTML = '';
    setB2BSelectorVisibility('template', false);
    if (!loadedOrder) renderB2BManualSkuRow(product, templateResolution);

    const template = getSelectedB2BTemplate();
    if (!loadedOrder && template && b2bCopiesTemplateId !== template.template_id) {
      b2bRunFields.copies = String(template.default_copies || 1);
      b2bRunFields.print_barcode = String(b2bBarcodeConfigured(product));
      b2bCopiesTemplateId = template.template_id;
    }
    if (!template) b2bCopiesTemplateId = '';
    document.querySelectorAll('[data-b2b-run-field]').forEach(input => {
      const value = b2bRunFields[input.dataset.b2bRunField] ?? '';
      if (input.type === 'checkbox') input.checked = parseBooleanLike(value, false);
      else input.value = value;
    });
    visibleB2BRunFields(template);
    renderB2BProductSettings(product, template);
    renderB2BLabelEditor(product, template);
    renderB2BLabelQueue();

    const summary = document.getElementById('b2b-template-summary');
    if (summary) {
      if (galleryMode && !b2bSelectedTemplateIds.length) summary.textContent = 'Start by choosing a label template from the gallery.';
      else if (!hasCustomer) summary.textContent = 'Start by selecting a customer.';
      else if (galleryMode && !selectedGroup) summary.textContent = `${b2bSelectedTemplateIds.length} template${b2bSelectedTemplateIds.length === 1 ? '' : 's'} selected. Now choose a product to populate the label.`;
      else if (!selectedGroup) summary.textContent = 'Now select the product or configuration for this customer.';
      else if (!product) summary.textContent = 'Choose the packaging level to load its exact product data and label requirements.';
      else if (!template) summary.textContent = 'Choose one or more label templates for this packaging level.';
      else summary.textContent = `${b2bSelectedTemplateIds.length} template${b2bSelectedTemplateIds.length === 1 ? '' : 's'} selected · ${template.name || template.template_id} is open in the editor · ${template.physical_width_in} × ${template.physical_height_in} in.`;
    }
    renderB2BAutomaticResolution();
    const title = document.getElementById('b2b-preview-title');
    if (title) {
      const selectedCount = loadedOrder
        ? b2bOrderLabelJobs.reduce((total, job) => total + b2bTemplateIdsForJob(job).length, 0)
        : b2bSelectedTemplateIds.length;
      title.textContent = template ? `Generate ${selectedCount} label job${selectedCount === 1 ? '' : 's'}` : 'Generate print-ready PDF';
    }
    renderB2BValidation();
    if (selectedKit === 'operations'
      && typeof orderDocumentsState === 'object'
      && !orderDocumentsState.rendering
      && typeof renderOperationsWorkspace === 'function') {
      renderOperationsWorkspace();
    }
  }

  function selectB2BCustomer(value) {
    b2bOrderCustomerOverride = '';
    b2bSelectedCustomer = String(value || '');
    b2bSelectedGroupKey = '';
    b2bSelectedProductIndex = -1;
    b2bSelectedDirectoryIndex = -1;
    b2bSelectedTemplateId = '';
    b2bSelectedTemplateIds = [];
    b2bTemplateRunFields = {};
    b2bResolvedOrderContext = null;
    b2bResolvedDirectoryFallback = {};
    clearB2BPreview();
    renderB2BCreator();
  }

  function selectB2BProduct(value) {
    b2bSelectedGroupKey = String(value || '');
    if (isB2BTemplateGalleryMode() && b2bSelectedGroupKey) {
      const group = getB2BProductGroups().find(candidate => candidate.key === b2bSelectedGroupKey);
      const selectedIds = new Set(b2bTemplateIdsForJob());
      const preferred = group?.entries.find(entry => selectedIds.has(String(entry.row.label_template_id || '')))
        || group?.entries.find(entry => entry.row.label_enabled && normalizePackagingLevel(entry.row.packaging_level) === 'Case')
        || group?.entries.find(entry => entry.row.label_enabled)
        || group?.entries[0];
      b2bSelectedProductIndex = preferred?.index ?? -1;
    } else {
      b2bSelectedProductIndex = -1;
      b2bSelectedTemplateId = '';
      b2bSelectedTemplateIds = [];
      b2bTemplateRunFields = {};
    }
    clearB2BPreview();
    renderB2BCreator();
    if (isB2BTemplateGalleryMode() && getSelectedB2BProduct()) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => focusB2BLabelEditor()));
    }
  }

  function selectB2BLevel(value) {
    const entry = getB2BProductEntries().find(candidate => (
      mplProductGroupKey(candidate.row, candidate.index) === b2bSelectedGroupKey
      && normalizePackagingLevel(candidate.row.packaging_level) === normalizePackagingLevel(value)
    ));
    b2bSelectedProductIndex = entry?.index ?? -1;
    if (!isB2BTemplateGalleryMode()) {
      b2bSelectedTemplateId = entry?.row?.label_template_id || b2bSelectedTemplateId;
      b2bSelectedTemplateIds = b2bSelectedTemplateId ? [b2bSelectedTemplateId] : [];
      b2bTemplateRunFields = {};
    }
    clearB2BPreview();
    renderB2BCreator();
  }

  function selectB2BTemplate(value, openEditor = false) {
    persistB2BActiveRunFields();
    b2bSelectedTemplateId = String(value || '');
    if (b2bSelectedTemplateId && !b2bSelectedTemplateIds.includes(b2bSelectedTemplateId)) {
      b2bSelectedTemplateIds = [...b2bSelectedTemplateIds, b2bSelectedTemplateId];
    }
    const template = getSelectedB2BTemplate();
    b2bRunFields.copies = String(template?.default_copies || 1);
    b2bRunFields.print_barcode = String(b2bBarcodeConfigured());
    const selectedOrderJob = b2bOrderLabelJobs[b2bSelectedOrderJobIndex];
    if (String(b2bRunFields.order_number || '').trim() && selectedOrderJob && template) {
      const selectedGroupKey = b2bOrderTemplateSelectionGroupKey(selectedOrderJob);
      b2bOrderLabelJobs.forEach(job => {
        const jobGroupKey = b2bOrderTemplateSelectionGroupKey(job);
        if (jobGroupKey !== selectedGroupKey) return;
        job.template_id = template.template_id;
        job.template_ids = [...b2bSelectedTemplateIds];
        job.product = { ...job.product, label_template_id: template.template_id };
        job.template_selection_required = false;
        job.review_reasons = (job.review_reasons || []).filter(reason => !String(reason).startsWith('Choose a label template for '));
        job.needs_label_review = job.review_reasons.length > 0;
      });
    }
    loadB2BActiveRunFields(selectedOrderJob, b2bSelectedTemplateId);
    clearB2BPreview();
    renderB2BCreator();
    if (openEditor && template) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => focusB2BLabelEditor(selectedOrderJob)));
    }
  }

  function applyB2BTemplateSelection(nextIds, context = 'manual', preferredActiveId = '', jobIndex = null) {
    const targetIndex = jobIndex === null ? b2bSelectedOrderJobIndex : jobIndex;
    const selectedOrderJob = context === 'order' ? b2bOrderLabelJobs[targetIndex] : null;
    const isActiveRow = context !== 'order' || targetIndex === b2bSelectedOrderJobIndex;
    if (isActiveRow) persistB2BActiveRunFields();
    const nextActiveId = preferredActiveId && nextIds.includes(preferredActiveId)
      ? preferredActiveId
      : (nextIds.includes(b2bSelectedTemplateId) ? b2bSelectedTemplateId : (nextIds[0] || ''));
    if (isActiveRow) {
      b2bSelectedTemplateIds = nextIds;
      b2bSelectedTemplateId = nextActiveId;
    }

    if (selectedOrderJob) {
      const selectedGroupKey = b2bOrderTemplateSelectionGroupKey(selectedOrderJob);
      b2bOrderLabelJobs.forEach(job => {
        if (b2bOrderTemplateSelectionGroupKey(job) !== selectedGroupKey) return;
        job.template_ids = [...nextIds];
        job.template_id = nextActiveId;
        nextIds.forEach(id => {
          if (job.template_runs?.[id]) return;
          const selectedTemplate = b2bLabelTemplates.find(candidate => candidate.template_id === id) || {};
          job.template_runs = {
            ...(job.template_runs || {}),
            [id]: {
              ...(job.run || {}),
              copies: String(selectedTemplate.default_copies || job.run?.copies || 1),
            },
          };
        });
        job.product = { ...job.product, label_template_id: nextActiveId };
        job.template_selection_required = nextIds.length === 0;
        job.review_reasons = (job.review_reasons || []).filter(reason => !String(reason).startsWith('Choose a label template for '));
        if (!nextIds.length) job.review_reasons.push(`Choose at least one label template for ${job.product?.packaging_level || 'this level'}.`);
        job.review_reasons = uniqueTextValues(job.review_reasons);
        job.needs_label_review = job.review_reasons.length > 0;
      });
    } else {
      nextIds.forEach(id => {
        if (b2bTemplateRunFields[id]) return;
        const selectedTemplate = b2bLabelTemplates.find(candidate => candidate.template_id === id) || {};
        b2bTemplateRunFields[id] = {
          ...b2bRunFields,
          copies: String(selectedTemplate.default_copies || b2bRunFields.copies || 1),
        };
      });
    }

    const template = getSelectedB2BTemplate();
    if (isActiveRow && template) {
      loadB2BActiveRunFields(selectedOrderJob, nextActiveId);
      b2bRunFields.print_barcode = b2bRunFields.print_barcode ?? String(b2bBarcodeConfigured());
      b2bCopiesTemplateId = template.template_id;
    }
    clearB2BPreview();
    renderB2BCreator();
  }

  function toggleB2BTemplate(templateId, selected, context = 'manual', jobIndex = null) {
    const cleanId = String(templateId || '').trim();
    if (!cleanId) return;
    const targetIndex = jobIndex === null ? b2bSelectedOrderJobIndex : jobIndex;
    const selectedOrderJob = context === 'order' ? b2bOrderLabelJobs[targetIndex] : null;
    const currentIds = selectedOrderJob ? b2bTemplateIdsForJob(selectedOrderJob) : b2bTemplateIdsForJob();
    const nextIds = selected
      ? uniqueTextValues([...currentIds, cleanId])
      : currentIds.filter(id => id !== cleanId);
    const openRowKey = jobIndex === null ? 'manual' : jobIndex;
    b2bOpenSkuRowIndex = openRowKey;
    applyB2BTemplateSelection(nextIds, context, selected ? cleanId : '', jobIndex);
    window.requestAnimationFrame(() => {
      const picker = [...document.querySelectorAll('.b2b-sku-row-templates .b2b-template-picker')]
        .find(candidate => candidate.dataset.b2bRowKey === String(openRowKey));
      if (picker) picker.open = true;
    });
  }

  function b2bOrderTemplateSelectionGroupKey(job) {
    const product = normalizeProductRow(job?.product || {});
    return [
      normalizeStorefront(product.storefront).toLowerCase(),
      normalizePackagingLevel(product.packaging_level).toLowerCase(),
      String(product.config_id || product.sku || product.customer_item_number || '').trim().toLowerCase(),
    ].join('|');
  }

  function selectB2BDirectory(value) {
    const parsed = String(value || '').trim() ? Number(value) : -1;
    b2bSelectedDirectoryIndex = Number.isInteger(parsed) ? parsed : -1;
    if (String(b2bRunFields.order_number || '').trim()) {
      const selectedAddress = b2bSelectedDirectoryIndex >= 0
        ? normalizeDcDirectoryRow(mplDirectoryRows[b2bSelectedDirectoryIndex] || {}).address
        : String(b2bResolvedDirectoryFallback?.delivery_address || '');
      updateB2BOrderDestination(selectedAddress);
    }
    clearB2BPreview();
    renderB2BLabelEditor();
    renderB2BValidation();
  }

  function updateB2BProductField(field, value, rerenderEditor = true) {
    const fallbackIndex = b2bSelectedProductIndex <= -1000 ? -1000 - b2bSelectedProductIndex : -1;
    if (fallbackIndex >= 0) {
      if (!b2bOrderFallbackProducts[fallbackIndex]) return;
      b2bOrderFallbackProducts[fallbackIndex][field] = value;
      b2bOrderLabelJobs.forEach(job => {
        if (job.order_only_product_index !== fallbackIndex) return;
        job.product = { ...job.product, [field]: value };
      });
    } else {
      if (b2bSelectedProductIndex < 0 || !hasPermission('table_crud')) return;
      const targetIndex = B2B_FINAL_PRODUCT_FIELDS.has(field)
        ? (getSelectedB2BFinalCaseEntry()?.index ?? b2bSelectedProductIndex)
        : b2bSelectedProductIndex;
      updateMplProductRow(targetIndex, field, value);
    }
    const state = document.getElementById('b2b-product-save-state');
    if (state) state.textContent = fallbackIndex >= 0 ? 'Updated for this order only' : 'Saving to Product Master…';
    clearB2BPreview();
    renderB2BProductSettings(getSelectedB2BProduct(), getSelectedB2BTemplate());
    if (rerenderEditor) renderB2BLabelEditor();
    renderB2BValidation();
    window.setTimeout(() => {
      if (state) state.textContent = fallbackIndex >= 0 ? 'Order-only values · Product Master unchanged' : 'Saved automatically';
    }, 750);
  }

  function updateB2BRunField(field, value, rerenderEditor = true) {
    b2bRunFields[field] = String(value ?? '');
    persistB2BActiveRunFields();
    clearB2BPreview();
    if (rerenderEditor) renderB2BLabelEditor();
    renderB2BValidation();
  }

  function buildB2BPayload(templateId = b2bSelectedTemplateId) {
    const product = getB2BOutputProduct();
    const template = b2bLabelTemplates.find(candidate => candidate.template_id === templateId) || null;
    const directory = Object.fromEntries(Object.entries(getSelectedB2BDirectory()).map(([field, value]) => [
      field,
      typeof value === 'string' ? value.replace(/\\n/g, '\n') : value,
    ]));
    const shipFrom = getSelectedB2BShipFrom();
    directory.ship_from_name = String(shipFrom.name || '').trim();
    directory.ship_from = String(shipFrom.address || shipFrom.ship_from || '').replace(/\\n/g, '\n').trim();
    const selectedOrderJob = b2bOrderLabelJobs[b2bSelectedOrderJobIndex];
    const runSource = selectedOrderJob
      ? selectedOrderJob.template_runs?.[templateId] || b2bRunFields
      : b2bTemplateRunFields[templateId] || b2bRunFields;
    const run = {};
    b2bRunFieldNames(template).forEach(field => {
      run[field] = runSource[field] ?? '';
    });
    return {
      template_id: templateId,
      template_ids: templateId ? [templateId] : [],
      product: { ...(product || {}), label_template_id: templateId },
      directory,
      run,
    };
  }

  function b2bJobValue(payload, field) {
    for (const source of [payload.run || {}, payload.product || {}, payload.directory || {}]) {
      const value = source[field];
      if (String(value ?? '').trim()) return String(value).trim();
    }
    return '';
  }

  function getB2BValidationWarnings() {
    const payload = buildB2BPayload();
    const product = getSelectedB2BProduct();
    const warnings = [];
    if (isB2BTemplateGalleryMode() && !b2bTemplateIdsForJob().length) return ['Select a label template from the gallery.'];
    if (!b2bSelectedCustomer) return ['Select a customer.'];
    if (!b2bSelectedGroupKey) return ['Select a product configuration.'];
    if (!product) return ['Select a packaging level.'];
    const selectedOrderJob = b2bOrderLabelJobs[b2bSelectedOrderJobIndex];
    const selectedTemplateIds = selectedOrderJob ? b2bTemplateIdsForJob(selectedOrderJob) : b2bTemplateIdsForJob();
    const selectedTemplates = selectedTemplateIds
      .map(templateId => b2bLabelTemplates.find(candidate => candidate.template_id === templateId))
      .filter(Boolean);
    if (!selectedTemplates.length) warnings.push('Select at least one supported label template.');
    const shipFrom = getSelectedB2BShipFrom();
    if (!String(shipFrom.address || shipFrom.ship_from || '').trim()) {
      warnings.push('Default Ship From address is missing. Add or select an active Ship From before printing.');
    }
    selectedTemplates.forEach(template => {
      const templatePayload = buildB2BPayload(template.template_id);
      (template.required_product_fields || []).forEach(field => {
        if (!b2bJobValue(templatePayload, field)) warnings.push(`${String(field).replace(/_/g, ' ')} is blank for ${template.name || template.template_id}.`);
      });
      (template.required_run_fields || []).forEach(field => {
        if (!b2bJobValue(templatePayload, field)) warnings.push(`${String(field).replace(/_/g, ' ')} is blank for ${template.name || template.template_id}.`);
      });
    });
    if (selectedTemplates.some(template => ['carton_start', 'carton_end', 'carton_total'].every(field => b2bRunFieldNames(template).includes(field)))) {
      const start = Number(payload.run.carton_start || 0);
      const end = Number(payload.run.carton_end || 0);
      const total = Number(payload.run.carton_total || 0);
      if (!(start >= 1 && end >= start && total >= end)) warnings.push('Carton range must be Start ≥ 1, End ≥ Start, and Total ≥ End.');
    }
    if (product && String(product.verification_status || '').toUpperCase() !== 'VERIFIED') {
      warnings.push(`Data status is ${product.verification_status || 'not set'}. Admin preview and printing remain available.`);
    }
    if (product && !product.label_enabled) {
      warnings.push('Available in Label Creator is off. You can still preview or print this row as an Admin.');
    }
    (selectedOrderJob?.review_reasons || []).forEach(reason => warnings.push(reason));
    return uniqueTextValues(warnings);
  }

  function renderB2BValidation() {
    const warnings = getB2BValidationWarnings();
    const loadedOrder = !!String(b2bRunFields.order_number || '').trim();
    const hasTechnicalSelection = loadedOrder
      ? b2bOrderLabelJobs.length > 0 && b2bOrderLabelJobs.every(job => b2bTemplateIdsForJob(job).length > 0 && !job.template_selection_required)
      : !!getSelectedB2BProduct() && b2bTemplateIdsForJob().length > 0;
    const selectionPrompt = isB2BTemplateGalleryMode() && !b2bTemplateIdsForJob().length
      ? 'Select template'
      : !b2bSelectedCustomer
      ? 'Select customer'
      : !b2bSelectedGroupKey
        ? 'Select product'
        : !getSelectedB2BProduct()
          ? 'Select level'
          : !b2bTemplateIdsForJob().length
            ? 'Select templates'
            : '';
    const validation = document.getElementById('b2b-validation');
    if (validation) {
      validation.innerHTML = warnings.length
        ? warnings.map(warning => `<div class="warning">${escapeHtml(warning)}</div>`).join('')
        : '<div class="ready">Configuration is ready to print.</div>';
      if (!b2bPreviewUrl && hasTechnicalSelection) {
        validation.insertAdjacentHTML('beforeend', '<div class="preview-stale-warning">Preview has changed or has not been rendered. Generate the PDF before printing.</div>');
      }
    }
    const badge = document.getElementById('b2b-configuration-status');
    if (badge) {
      badge.textContent = selectionPrompt || (warnings.length ? `${warnings.length} review item${warnings.length === 1 ? '' : 's'}` : 'Ready to print');
      badge.className = `b2b-state-badge ${selectionPrompt ? '' : warnings.length ? 'review' : 'ready'}`;
    }
    const renderButton = document.getElementById('b2b-render-button');
    if (renderButton) {
      renderButton.disabled = !hasTechnicalSelection;
      const incompleteCount = loadedOrder
        ? new Set(b2bOrderLabelJobs
          .filter(job => !b2bTemplateIdsForJob(job).length || job.template_selection_required)
          .map(job => b2bOrderReviewGroupKey(job))).size
        : 0;
      renderButton.textContent = loadedOrder && !b2bOrderLabelJobs.length
        ? 'No Enabled Labels for This Order'
        : loadedOrder && incompleteCount
          ? `${incompleteCount} Product${incompleteCount === 1 ? '' : 's'} Need Templates`
        : b2bOrderLabelJobs.length && loadedOrder
        ? (() => {
          const count = b2bOrderLabelJobs.reduce((total, job) => total + b2bTemplateIdsForJob(job).length, 0);
          return `Generate ${count} Label Job${count === 1 ? '' : 's'} & Open PDF`;
        })()
        : b2bTemplateIdsForJob().length > 1
          ? `Generate ${b2bTemplateIdsForJob().length} Templates & Open PDF`
          : 'Generate & Open PDF';
    }
  }

  function clearB2BPreview() {
    if (b2bPreviewUrl) {
      if (blobUrl === b2bPreviewUrl) blobUrl = null;
      URL.revokeObjectURL(b2bPreviewUrl);
    }
    b2bPreviewUrl = null;
    if (selectedKit === 'operations' && typeof orderDocumentsState === 'object'
      && orderDocumentsState.reviewedDocuments?.labels && !orderDocumentsState.finalizing) {
      orderDocumentsState.reviewedDocuments.labels = false;
      window.clearGeneratedOutputs?.('operations-labels-review', 'operations-labels');
    }
    setDownloadReady(false);
    renderB2BValidation();
  }

  function estimateB2BOrderPages(jobs) {
    return (jobs || []).reduce((total, job) => {
      if (!job || job.print_selected === false) return total;
      const start = Number(job.run?.carton_start || 1);
      const end = Number(job.run?.carton_end || start);
      const copies = Number(job.run?.copies || 1);
      if (![start, end, copies].every(Number.isSafeInteger) || start < 1 || end < start || copies < 1) return NaN;
      return total + (end - start + 1) * copies;
    }, 0);
  }

  async function generateB2BPreview(openFullPreview = false, options = {}) {
    if (openFullPreview && typeof openFullPreview === 'object') {
      options = openFullPreview;
      openFullPreview = !!options.openFullPreview;
    }
    const outputScope = options.scope || (selectedKit === 'operations' ? 'operations' : 'b2b');
    const outputKey = options.outputKey || (selectedKit === 'operations' ? 'operations-labels' : 'b2b-labels');
    persistB2BActiveRunFields();
    const loadedOrder = !!String(b2bRunFields.order_number || '').trim();
    const orderBatch = b2bOrderLabelJobs.length > 0 && loadedOrder;
    const product = getSelectedB2BProduct();
    const template = getSelectedB2BTemplate();
    const manualTemplateIds = b2bTemplateIdsForJob();
    if (loadedOrder && !b2bOrderLabelJobs.length) {
      setStatus('This order has no enabled packaging-level labels. Enable the required levels in Product Master before generating.', 'error');
      return false;
    }
    if (!orderBatch && (!product || !manualTemplateIds.length)) {
      setStatus('Select a product configuration and at least one label template first.', 'error');
      return false;
    }
    if (!options.skipReadiness && !(await confirmDocumentReadiness('b2b'))) return false;
    const baseJobs = orderBatch
      ? b2bOrderLabelJobs.map(row => JSON.parse(JSON.stringify(row)))
      : manualTemplateIds.map(templateId => ({ ...buildB2BPayload(templateId), template_ids: [templateId], print_selected: true }));
    if (orderBatch) {
      const unresolvedCount = baseJobs.filter(row => !b2bTemplateIdsForJob(row).length || row.template_selection_required).length;
      if (unresolvedCount) {
        setStatus(`Choose at least one saved template for each enabled label level before generating (${unresolvedCount} unresolved).`, 'error');
        return false;
      }
      const currentJob = buildB2BPayload();
      const selectedLevel = normalizePackagingLevel(product?.packaging_level);
      const selectedBatchJob = b2bOrderLabelJobs[b2bSelectedOrderJobIndex];
      if (selectedBatchJob && normalizePackagingLevel(selectedBatchJob.product?.packaging_level) === selectedLevel) {
        const selectedGroupKey = b2bOrderReviewGroupKey(selectedBatchJob);
        b2bOrderLabelJobs.forEach((sourceJob, sourceIndex) => {
          if (b2bOrderReviewGroupKey(sourceJob) !== selectedGroupKey) return;
          const batchJob = baseJobs[sourceIndex];
          const cartonFields = Object.fromEntries(['carton_total', 'carton_start', 'carton_end'].map(field => [field, batchJob.run?.[field]]));
          batchJob.product = { ...currentJob.product, label_template_id: b2bSelectedTemplateId };
          batchJob.template_id = b2bSelectedTemplateId;
          batchJob.template_ids = b2bTemplateIdsForJob(sourceJob);
          batchJob.directory = { ...currentJob.directory };
          batchJob.run = { ...batchJob.run, ...currentJob.run, ...cartonFields };
        });
      }
    }
    const jobs = window.LabelKitB2BOrderJobs.expandB2BTemplateJobs(baseJobs);
    const batchMode = orderBatch || jobs.length > 1;
    const job = jobs[0] || null;
    const estimatedPages = estimateB2BOrderPages(jobs);
    if (!Number.isSafeInteger(estimatedPages) || estimatedPages < 1) {
      setStatus('The requested label count is invalid. Check carton ranges and copies.', 'error');
      return false;
    }
    const needsArchive = estimatedPages > 1000;
    if (needsArchive) {
      const partCount = Math.ceil(estimatedPages / 1000);
      const proceed = window.confirm(
        `This run will generate ${estimatedPages.toLocaleString()} label pages, exceeding the 1,000-page limit per PDF. `
        + `LabelKit will split the run into ${partCount} numbered PDFs inside one ZIP file. Continue?`
      );
      if (!proceed) return false;
    }
    const button = document.getElementById('b2b-render-button');
    if (button) button.disabled = true;
    setStatus(needsArchive ? 'Splitting the large B2B label run into numbered PDFs…' : batchMode ? 'Rendering every selected label template…' : 'Rendering B2B label PDF…', 'info');
    showWorkflowProgress(3, needsArchive ? `Preparing ${estimatedPages.toLocaleString()} pages across ${Math.ceil(estimatedPages / 1000)} PDFs…` : batchMode ? `Preparing ${jobs.length} selected template jobs…` : 'Preparing the selected label job…');
    try {
      const endpoint = needsArchive
        ? '/api/b2b/render-batch-archive'
        : batchMode ? '/api/b2b/render-batch' : '/api/b2b/render';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(needsArchive
          ? { jobs, order_number: b2bRunFields.order_number || 'b2b_labels' }
          : batchMode ? { jobs } : job),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || 'Could not render B2B labels.');
      }
      const outputBlob = await response.blob();
      const pages = response.headers.get('X-B2B-Page-Count') || String(estimatedPages);
      const partCount = Number(response.headers.get('X-B2B-Part-Count') || 0);
      const filenameBase = String(b2bRunFields.order_number || 'order').replace(/[^a-z0-9_-]+/gi, '_');
      const filename = needsArchive
        ? `${filenameBase}_case_labels.zip`
        : batchMode ? `${filenameBase}_case_labels.pdf` : `${b2bSelectedTemplateId.toLowerCase()}.pdf`;
      if (needsArchive) {
        clearB2BPreview();
        const archiveUrl = URL.createObjectURL(outputBlob);
        const download = document.getElementById('btn-download');
        download.download = filename;
        document.getElementById('btn-download-label').textContent = 'Download ZIP';
        setDownloadReady(true, archiveUrl);
        setPreviewReady(false);
        download.click();
        window.setTimeout(() => URL.revokeObjectURL(archiveUrl), 60000);
      } else {
        clearB2BPreview();
        b2bPreviewUrl = URL.createObjectURL(outputBlob);
        blobUrl = b2bPreviewUrl;
        document.getElementById('btn-download').download = filename;
        document.getElementById('btn-download-label').textContent = 'Save PDF';
        setDownloadReady(true, b2bPreviewUrl);
        setActivePreviewFormat('rollo');
      }
      if (!needsArchive) {
        await recordGeneratedOutput(outputKey, {
          scope: outputScope,
          name: filename,
          labelType: batchMode ? 'Selected B2B label templates' : (template.name || b2bSelectedTemplateId),
          labels: jobs.reduce((total, row) => total + Math.max(1, Number(row.run?.copies || 1)) * Math.max(1, Number(row.run?.carton_total || 1)), 0),
          pages,
          blob: outputBlob,
        });
      }
      updateWorkflowProgress(needsArchive ? 'Complete' : 'Opening preview', needsArchive ? 'The numbered PDF parts are ready in the downloaded ZIP.' : 'Opening the completed label preview…');
      renderB2BValidation();
      setStatus(needsArchive
        ? `B2B labels ready: ${Number(pages).toLocaleString()} pages split into ${partCount} numbered PDFs in ${filename}.`
        : `${batchMode ? `All ${jobs.length} selected template job(s) included. ` : ''}B2B label PDF ready${pages ? ` · ${pages} page${pages === '1' ? '' : 's'}` : ''}. Review warnings are advisory for Admin printing.`, 'success');
      if (openFullPreview && !needsArchive) {
        resetPreviewSurface();
        await openPreview();
      }
      closeWorkflowProgress();
      if (!needsArchive && options.showSummary !== false) showPrintSummary(outputScope);
      return true;
    } catch (err) {
      closeWorkflowProgress();
      setStatus(`B2B label generation failed: ${err.message || 'unknown error'}`, 'error');
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function downloadB2BLabels() {
    if (!b2bPreviewUrl && !(await generateB2BPreview(false))) return;
    const link = document.createElement('a');
    link.href = b2bPreviewUrl;
    link.download = document.getElementById('btn-download')?.download || `${(b2bSelectedTemplateId || 'b2b_case_pack').toLowerCase()}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function printB2BLabels() {
    if (!b2bPreviewUrl && !(await generateB2BPreview(false))) return;
    printActivePreview();
  }
