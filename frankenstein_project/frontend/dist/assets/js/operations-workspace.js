/* Unified order-document workspace. The existing B2B, MPL, Ti-Hi, and pallet
   generators remain the single owners of their document formats. */
  function initialOperationsState() {
    return {
    payload: null,
    reviewedOrder: null,
    orderNumber: '',
    ecomdashId: '',
    customerId: '',
    customerName: '',
    mplDraft: null,
    palletDraft: null,
    activeTab: 'labels',
    loading: false,
    initializingOrder: false,
    selectingOrderInstance: false,
    rendering: false,
    initialized: false,
    customMode: '',
    manualPalletCount: 1,
    manualPalletCopies: 1,
    reviewedDocuments: { labels: false, mpl: false, pallets: false },
    labelPreviewReady: false,
    pendingReviewDocument: '',
    documentSelection: null,
    finalizing: false,
    approvingDocument: '',
  };
  }
  const orderDocumentsState = (globalThis.__labelKitState ||= Object.create(null)).orderDocuments ||= initialOperationsState();

  function resetOperationsWorkspaceState() {
    mplDraftSync?.discard();
    Object.assign(orderDocumentsState, initialOperationsState(), { initialized: orderDocumentsState.initialized });
    resetOperationsReviewState();
    resetB2BManualWorkspaceState();
    const orderInput = document.getElementById('operations-sales-order-number');
    if (orderInput) orderInput.value = '';
    clearB2BPreview();
    window.clearGeneratedOutputs?.('operations-labels', 'operations-mpl', 'operations-pallets');
  }

  function markOperationsMplChanged() {
    if (selectedKit !== 'operations' || activeKeheDocumentType !== 'masterPackingList' || !activeKeheDocumentDraft) return;
    orderDocumentsState.mplDraft = activeKeheDocumentDraft;
    activeKeheDocumentDraft.review_status = 'DRAFT';
    (activeKeheDocumentDraft.packing_lists || []).forEach(mpl => { mpl.review_status = 'DRAFT'; });
    orderDocumentsState.palletDraft = null;
    orderDocumentsState.reviewedDocuments.mpl = false;
    orderDocumentsState.reviewedDocuments.pallets = false;
    window.clearGeneratedOutputs?.('operations-mpl-review', 'operations-pallets-review', 'operations-mpl', 'operations-pallets');
  }

  function markOperationsPalletsChanged() {
    if (selectedKit !== 'operations') return;
    orderDocumentsState.palletDraft = activeKeheDocumentDraft;
    activeKeheDocumentDraft.review_status = 'DRAFT';
    orderDocumentsState.reviewedDocuments.pallets = false;
    window.clearGeneratedOutputs?.('operations-pallets-review', 'operations-pallets');
  }

  function clearOperationsDocumentReview() {
    orderDocumentsState.pendingReviewDocument = '';
    delete document.body.dataset.operationsReview;
    for (const id of ['btn-operations-review-continue', 'btn-operations-review-top', 'btn-operations-review-back']) {
      document.getElementById(id)?.classList.add('hidden');
    }
  }

  async function completeOperationsDocumentReview(documentType) {
    orderDocumentsState.reviewedDocuments[documentType] = true;
    if (orderDocumentsState.pendingReviewDocument === documentType) clearOperationsDocumentReview();
    if (documentType === 'labels') closePreview(false);
    else closeDocumentEditor(false);
    const tab = { labels: 'labels', mpl: 'packing', pallets: 'pallets' }[documentType];
    await navigateToRoute(`operations/${tab}`);
    renderOperationsWorkspace();
    setStatus({
      labels: 'Labels approved and added to Finished Files. Continue to the next selected section.',
      mpl: 'Packing list and Ti-Hi approved and added to Finished Files.',
      pallets: 'Pallet labels approved and added to Finished Files.',
    }[documentType], 'success');
    return true;
  }

  function resetOperationsReviewState() {
    orderDocumentsState.reviewedDocuments = { labels: false, mpl: false, pallets: false };
    orderDocumentsState.labelPreviewReady = false;
    orderDocumentsState.documentSelection = null;
    clearOperationsDocumentReview();
    renderOperationsApprovalActions();
  }

  function renderOperationsApprovalActions() {
    const enabled = selectedKit === 'operations' && operationsSelectedDocuments().labels;
    const approved = !!orderDocumentsState.reviewedDocuments.labels;
    const ready = enabled && !!orderDocumentsState.labelPreviewReady;
    const section = document.getElementById('btn-approve-operations-labels');
    if (section) {
      section.classList.toggle('hidden', !enabled);
      section.disabled = !ready || approved;
      section.textContent = approved ? 'Labels Approved' : 'Approve Labels';
      section.title = ready ? '' : 'Preview the current labels before approving them.';
    }
    const preview = document.getElementById('btn-approve-preview-labels');
    if (preview) preview.classList.toggle('hidden', !ready || approved || !b2bPreviewUrl || blobUrl !== b2bPreviewUrl);
    const backLabel = document.getElementById('operations-preview-back-label');
    if (backLabel) backLabel.textContent = selectedKit === 'operations' ? 'Go Back' : 'Close';
  }

  async function approveOperationsLabels() {
    if (!operationsSelectedDocuments().labels || !orderDocumentsState.labelPreviewReady) {
      setStatus('Preview the current labels before approving them.', 'info');
      return false;
    }
    const output = window.getGeneratedOutputs?.('operations-review')
      .find(([key]) => key === 'operations-labels-review')?.[1];
    if (!output?.blob) {
      setStatus('Generate a label preview before approving the labels.', 'error');
      return false;
    }
    const previewRevision = b2bPreviewRevision;
    const isCurrent = () => b2bPreviewRevision === previewRevision && orderDocumentsState.labelPreviewReady;
    const approved = await runDocumentPipeline({ kind: 'labels', draft: output.documentSnapshot,
      isCurrent, skipReadiness: true, output: { ...output, key: 'operations-labels', scope: 'operations' },
      render: async () => ({ blob: output.blob, pages: output.pages }),
    });
    if (!approved) return false;
    if (!isCurrent()) return false;
    return completeOperationsDocumentReview('labels');
  }

  function operationsPalletCount(draft = orderDocumentsState.mplDraft) {
    const mpl = draft?.packing_lists?.[0];
    if (!mpl) return 0;
    ensureMplPalletState(mpl);
    return window.LabelKitOrderDocuments.assignedPalletCount(draft);
  }

  function operationsSelectedDocuments() {
    return window.LabelKitOrderDocuments.selectedDocuments(document);
  }

  function operationsUsesManualPalletCount(selected = operationsSelectedDocuments()) {
    return window.LabelKitOrderDocuments.usesManualPalletCount({
      selected,
      hasOrderOrDraft: !!(orderDocumentsState.payload || orderDocumentsState.mplDraft),
    });
  }

  function operationsEffectivePalletCount(selected = operationsSelectedDocuments()) {
    return window.LabelKitOrderDocuments.effectivePalletCount({
      selected,
      hasOrderOrDraft: !!(orderDocumentsState.payload || orderDocumentsState.mplDraft),
      manualCount: orderDocumentsState.manualPalletCount,
      mplDraft: orderDocumentsState.mplDraft,
    });
  }

  function updateOperationsManualPallets(field, value) {
    const amount = Math.max(1, Number.parseInt(value, 10) || 1);
    if (field === 'copies') orderDocumentsState.manualPalletCopies = amount;
    else orderDocumentsState.manualPalletCount = amount;
    orderDocumentsState.palletDraft = null;
    orderDocumentsState.reviewedDocuments.pallets = false;
    window.clearGeneratedOutputs?.('operations-pallets');
    renderOperationsWorkspace();
  }

  function beginOperationsDocumentReview(documentType) {
    orderDocumentsState.pendingReviewDocument = documentType;
    orderDocumentsState.activeTab = documentType === 'mpl' ? 'packing' : 'pallets';
    orderDocumentsState.reviewedDocuments[documentType] = false;
    document.body.dataset.operationsReview = documentType;
    document.getElementById('btn-operations-review-back')?.classList.remove('hidden');
    for (const id of ['btn-operations-review-continue', 'btn-operations-review-top']) {
      const action = document.getElementById(id);
      if (!action) continue;
      action.textContent = documentType === 'mpl' ? 'Approve Packing List & Ti-Hi' : 'Approve Pallet Labels';
      action.classList.remove('hidden');
    }
  }

  async function finishOperationsDocumentReview() {
    const documentType = orderDocumentsState.pendingReviewDocument;
    if (!['mpl', 'pallets'].includes(documentType) || orderDocumentsState.approvingDocument) return;
    const expectedType = documentType === 'mpl' ? 'masterPackingList' : 'palletLabel';
    if (activeKeheDocumentType !== expectedType || !activeKeheDocumentDraft) return;
    const reviewDraft = activeKeheDocumentDraft;
    const isCurrent = () => activeKeheDocumentDraft === reviewDraft && activeKeheDocumentType === expectedType
      && orderDocumentsState.pendingReviewDocument === documentType && reviewDraft.review_status === 'APPROVED';
    orderDocumentsState.approvingDocument = reviewDraft;
    const buttons = ['btn-operations-review-continue', 'btn-operations-review-top', 'btn-operations-review-back']
      .map(id => document.getElementById(id)).filter(Boolean);
    buttons.forEach(button => { button.disabled = true; });
    try {
      if (documentType === 'mpl') {
        finalizeMplPalletDraft();
        if (operationsSelectedDocuments().pallets && operationsPalletCount(activeKeheDocumentDraft) < 1) {
          setStatus('Assign at least one pallet before approving the packing list and Ti-Hi for pallet labels.', 'error');
          return;
        }
        window.setMplReviewStatus?.('APPROVED');
        orderDocumentsState.mplDraft = activeKeheDocumentDraft;
        orderDocumentsState.palletDraft = null;
        orderDocumentsState.reviewedDocuments.pallets = false;
        window.clearGeneratedOutputs?.('operations-mpl-review', 'operations-pallets-review', 'operations-mpl', 'operations-pallets');
      } else {
        reviewDraft.review_status = 'APPROVED';
        orderDocumentsState.palletDraft = activeKeheDocumentDraft;
        window.clearGeneratedOutputs?.('operations-pallets-review', 'operations-pallets');
      }
      const ok = await renderEditedKeheDocument({
        isCurrent,
        saveMplDraft: documentType === 'mpl', skipReadiness: true,
        keepEditorOpen: true,
        openPreview: false, showSummary: false, scope: 'operations',
        outputKey: documentType === 'mpl' ? 'operations-mpl' : 'operations-pallets',
      });
      if (ok !== true || !isCurrent()) {
        if (activeKeheDocumentDraft === reviewDraft) {
          if (documentType === 'mpl') window.setMplReviewStatus?.('DRAFT');
          clearGeneratedOutputs(documentType === 'mpl' ? 'operations-mpl' : 'operations-pallets');
        }
        return false;
      }
      return await completeOperationsDocumentReview(documentType);
    } catch (error) {
      orderDocumentsState.reviewedDocuments[documentType] = false;
      if (documentType === 'mpl') window.setMplReviewStatus?.('DRAFT');
      window.clearGeneratedOutputs?.(documentType === 'mpl' ? 'operations-mpl' : 'operations-pallets');
      setStatus(`Approval failed: ${error?.message || 'Could not prepare the PDF.'}`, 'error');
      return false;
    } finally {
      if (orderDocumentsState.approvingDocument === reviewDraft) {
        orderDocumentsState.approvingDocument = '';
        buttons.forEach(button => { button.disabled = false; });
      }
    }
  }

  async function goBackFromOperationsReview() {
    if (orderDocumentsState.approvingDocument) return;
    const tab = orderDocumentsState.pendingReviewDocument === 'pallets' ? 'pallets' : 'packing';
    clearOperationsDocumentReview();
    closeDocumentEditor(false);
    await navigateToRoute(`operations/${tab}`);
    renderOperationsWorkspace();
    setStatus('Returned to the order. This section has not been approved or added to Finished Files.', 'info');
  }

  function buildOperationsManualPalletDraft() {
    const mpl = orderDocumentsState.mplDraft?.packing_lists?.[0] || {};
    return window.LabelKitOrderDocuments.buildManualPalletDraft({
      mpl,
      count: orderDocumentsState.manualPalletCount,
      copies: orderDocumentsState.manualPalletCopies,
    });
  }

  function operationsGenerationBlocker(selected = operationsSelectedDocuments(), finalizing = false) {
    if (!Object.values(selected).some(Boolean)) {
      return { message: 'Select at least one document to generate.', elementId: 'operations-generate-labels' };
    }
    if (selected.labels) {
      if (orderDocumentsState.customMode === 'labels') {
        if (!b2bTemplateIdsForJob().length) return { message: 'Select at least one label template from the gallery.', elementId: 'b2b-template-gallery-search', tab: 'labels' };
        if (!b2bSelectedCustomer) return { message: 'Select a customer before generating labels.', elementId: 'b2b-customer-select', tab: 'labels' };
        if (!b2bSelectedGroupKey) return { message: 'Select a product configuration before generating labels.', elementId: 'b2b-product-select', tab: 'labels' };
        if (!getSelectedB2BProduct?.()) return { message: 'Select a packaging level before generating labels.', elementId: 'b2b-level-select', tab: 'labels' };
      } else {
        if (!b2bOrderLabelJobs.length) return { message: 'This order has no enabled customer-label jobs.', tab: 'labels' };
        const unresolved = b2bOrderLabelJobs.filter(job => !b2bTemplateIdsForJob(job).length || job.template_selection_required);
        if (unresolved.length) return { message: `Choose templates for ${unresolved.length} label job${unresolved.length === 1 ? '' : 's'} before generating.`, elementId: 'b2b-sku-template-list', tab: 'labels' };
      }
    }
    if (selected.mpl && !orderDocumentsState.mplDraft) {
      return { message: 'Create or load a packing-list draft before generating it.', tab: 'packing' };
    }
    if (selected.pallets && !operationsUsesManualPalletCount(selected) && operationsPalletCount() < 1
      && (finalizing || !selected.mpl || !orderDocumentsState.mplDraft)) {
      return { message: 'Assign at least one pallet in the packing list before generating pallet labels.', tab: 'packing' };
    }
    return null;
  }

  function operationsNextReviewStage(selected = operationsSelectedDocuments()) {
    return window.LabelKitOrderDocuments.nextReviewStage({
      selected,
      reviewed: orderDocumentsState.reviewedDocuments,
      palletCount: operationsPalletCount(),
    });
  }

  function operationsDocumentSelectionChanged() {
    const selected = operationsSelectedDocuments();
    const previous = orderDocumentsState.documentSelection;
    if (previous) {
      if (previous.labels !== selected.labels) {
        orderDocumentsState.reviewedDocuments.labels = false;
        orderDocumentsState.labelPreviewReady = false;
        window.clearGeneratedOutputs?.('operations-labels-review', 'operations-labels');
      }
      if (previous.mpl !== selected.mpl) {
        orderDocumentsState.reviewedDocuments.mpl = false;
        orderDocumentsState.reviewedDocuments.pallets = false;
        orderDocumentsState.palletDraft = null;
        window.clearGeneratedOutputs?.('operations-mpl-review', 'operations-pallets-review', 'operations-mpl', 'operations-pallets');
      }
      if (previous.pallets !== selected.pallets) {
        orderDocumentsState.reviewedDocuments.pallets = false;
        window.clearGeneratedOutputs?.('operations-pallets-review', 'operations-pallets');
      }
    }
    orderDocumentsState.documentSelection = { ...selected };
    renderOperationsWorkspace();
  }

  function setOperationsOrderPickerBlocking(blocking) {
    const page = document.getElementById('operations-workspace-page');
    const backdrop = document.getElementById('operations-order-instance-backdrop');
    const picker = document.getElementById('operations-order-instance-picker');
    const background = [
      document.querySelector('body > header'),
      document.querySelector('.operations-hero-actions'),
      document.querySelector('#operations-order-card .operations-order-copy'),
      document.querySelector('#operations-order-card .operations-order-form'),
      document.getElementById('operations-empty-state'),
      document.getElementById('operations-session'),
    ].filter(Boolean);
    if (page) {
      if (blocking) page.dataset.selectingOrder = 'true';
      else delete page.dataset.selectingOrder;
    }
    backdrop?.classList.toggle('hidden', !blocking);
    if (picker) {
      if (blocking) picker.setAttribute('aria-modal', 'true');
      else picker.removeAttribute('aria-modal');
    }
    background.forEach(element => { element.inert = !!blocking; });
  }

  function focusOperationsBlocker(blocker) {
    if (!blocker) return;
    if (blocker.tab) orderDocumentsState.activeTab = blocker.tab;
    renderOperationsWorkspace();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const setup = document.getElementById('b2b-selection-overrides');
      if (blocker.tab === 'labels' && orderDocumentsState.customMode === 'labels' && setup) setup.open = true;
      const target = blocker.elementId ? document.getElementById(blocker.elementId) : null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus?.({ preventScroll: true });
    }));
  }

  function scrollOperationsTo(elementId) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function operationsCustomerName(payload = orderDocumentsState.payload) {
    return String(
      payload?.detected_customer?.name
      || (orderDocumentsState.customerId ? partnerCustomerLabel(orderDocumentsState.customerId) : '')
      || b2bSelectedCustomer
      || payload?.order_details?.billing_customer_name
      || payload?.order_details?.ship_to_name
      || payload?.order_details?.storefront
      || 'Customer needs review'
    ).trim();
  }

  function operationsMatchSummary(payload = orderDocumentsState.payload) {
    const summary = payload?.summary || {};
    const matched = Number(summary.matched_products || 0);
    const review = Number(summary.unmatched_products || 0) + Number(summary.ambiguous_products || 0) + Number(summary.defaulted_level_skus || 0);
    return review ? `${matched} matched · ${review} need review` : `${matched} matched`;
  }

  function renderOperationsFiles() {
    const target = document.getElementById('operations-files-list');
    if (!target) return;
    const approvedKeys = {
      'operations-labels': orderDocumentsState.reviewedDocuments.labels,
      'operations-mpl': orderDocumentsState.reviewedDocuments.mpl,
      'operations-pallets': orderDocumentsState.reviewedDocuments.pallets,
    };
    const outputs = typeof getGeneratedOutputs === 'function'
      ? getGeneratedOutputs('operations').filter(([key]) => approvedKeys[key]) : [];
    const state = document.getElementById('operations-files-tab-state');
    if (state) state.textContent = `${outputs.length} ready`;
    target.innerHTML = outputs.length ? outputs.map(([key, output]) => `
      <article class="operations-file-row">
        <span class="operations-file-type">${output.kind === 'zip' ? 'ZIP' : 'PDF'}</span>
        <div><strong>${escapeHtml(output.name || 'Document.pdf')}</strong><small>${escapeHtml(output.labelType || 'Generated document')} · ${escapeHtml(String(output.pages || 0))} page(s)</small></div>
        <button class="btn-secondary" type="button" onclick="openGeneratedOutput('${jsString(key)}')">${output.kind === 'zip' ? 'Download ZIP' : 'Open PDF'}</button>
      </article>`).join('') : '<div class="operations-file-empty">Generate a selected document to see it here.</div>';
  }

  function renderOperationsWorkspace() {
    if (orderDocumentsState.initializingOrder) return;
    const loaded = !!orderDocumentsState.payload || !!orderDocumentsState.customMode || !!orderDocumentsState.mplDraft;
    document.getElementById('operations-empty-state')?.classList.toggle('hidden', loaded);
    document.getElementById('operations-session')?.classList.toggle('hidden', !loaded);

    const payload = orderDocumentsState.payload || {};
    const packingCheckbox = document.getElementById('operations-customize-packing');
    if (packingCheckbox && !packingCheckbox.disabled && !document.getElementById('operations-packing-modal')?.classList.contains('visible')) {
      packingCheckbox.checked = !!orderDocumentsState.mplDraft?.packing_lists?.some(list => list.items?.some(item => item.order_packaging));
    }
    const mpl = orderDocumentsState.mplDraft?.packing_lists?.[0];
    const palletCount = operationsPalletCount();
    const selected = operationsSelectedDocuments();
    if (!orderDocumentsState.documentSelection) orderDocumentsState.documentSelection = { ...selected };
    const nextReviewStage = operationsNextReviewStage(selected);
    const finalizing = nextReviewStage === 'generate';
    const manualPalletMode = operationsUsesManualPalletCount(selected);
    const effectivePalletCount = operationsEffectivePalletCount(selected);
    const labelJobs = Array.isArray(b2bOrderLabelJobs) ? b2bOrderLabelJobs : [];
    const selectedLabelCount = labelJobs.reduce((total, job) => total + b2bTemplateIdsForJob(job).length, 0);
    const unresolvedLabelCount = labelJobs.filter(job => !b2bTemplateIdsForJob(job).length).length;
    const customLabels = orderDocumentsState.customMode === 'labels';
    const customMpl = ['mpl', 'saved-mpl'].includes(orderDocumentsState.customMode);
    const mode = customLabels ? 'custom-labels' : customMpl ? 'custom-mpl' : 'order';
    const page = document.getElementById('operations-workspace-page');
    if (page) page.dataset.operationsMode = mode;
    document.getElementById('operations-order-card')?.classList.toggle('hidden', customLabels);
    setOperationsOrderPickerBlocking(orderDocumentsState.selectingOrderInstance);
    const session = document.getElementById('operations-session');
    const outputSelector = document.querySelector('.operations-output-selector');
    const tabs = document.querySelector('.operations-tabs');
    if (session && outputSelector && tabs) {
      if (customLabels || customMpl) session.appendChild(outputSelector);
      else session.insertBefore(outputSelector, tabs);
    }
    const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
    const summary = document.querySelector('.operations-order-summary');
    if (summary && customLabels) {
      const product = getSelectedB2BProduct?.();
      const templates = b2bTemplateIdsForJob();
      const level = String(product?.packaging_level || '').trim();
      const setupReadiness = !templates.length
        ? 'Template required'
        : !b2bSelectedCustomer
        ? 'Customer required'
        : !b2bSelectedGroupKey
          ? 'Product required'
          : !product
            ? 'Packaging level required'
            : 'Ready to generate';
      const labelWarnings = setupReadiness === 'Ready to generate' && typeof getB2BValidationWarnings === 'function'
        ? getB2BValidationWarnings()
        : [];
      const readiness = labelWarnings.length ? 'Review required fields' : setupReadiness;
      summary.dataset.mode = 'custom-labels';
      summary.innerHTML = `
        <div><span>Mode</span><strong>Manual label</strong><small>No sales order required</small></div>
        <div><span>Customer</span><strong>${escapeHtml(b2bSelectedCustomer || 'Not selected')}</strong><small>${escapeHtml(b2bSelectedCustomer ? 'Manual selection' : 'Choose in Label Setup')}</small></div>
        <div><span>Product / SKU</span><strong>${escapeHtml(product?.sku || product?.customer_item_number || 'Not selected')}</strong><small>${escapeHtml(product?.description || 'Choose in Label Setup')}</small></div>
        <div><span>Packaging level</span><strong>${escapeHtml(level || 'Not selected')}</strong><small>${escapeHtml(level ? 'Selected label level' : 'Choose in Label Setup')}</small></div>
        <div><span>Selected templates</span><strong>${templates.length}</strong><small>${templates.length ? 'Label outputs' : 'Choose at least one template'}</small></div>
        <div class="operations-readiness"><span>Readiness</span><strong data-ready="${readiness === 'Ready to generate'}">${escapeHtml(readiness)}</strong><small>${escapeHtml(labelWarnings[0] || (readiness === 'Ready to generate' ? 'Required selections and label fields are complete' : 'Generation is blocked until setup is complete'))}</small></div>`;
    } else if (summary && customMpl) {
      summary.dataset.mode = 'custom-mpl';
      summary.innerHTML = `
        <div><span>Mode</span><strong>Manual packing list</strong><small>No sales order required</small></div>
        <div><span>Customer</span><strong id="operations-customer">${escapeHtml(orderDocumentsState.customerName || mpl?.customer_name || 'Not selected')}</strong><small id="operations-customer-source">Editable in the packing list</small></div>
        <div><span>Order lines</span><strong id="operations-line-count">${escapeHtml(String(mpl?.items?.length || 0))}</strong><small id="operations-match-summary">Manual document</small></div>
        <div><span>Pallets</span><strong id="operations-pallet-count">${escapeHtml(String(palletCount))}</strong><small>From the reviewed Ti-Hi plan</small></div>`;
    } else if (summary) {
      delete summary.dataset.mode;
      summary.innerHTML = `
        <div><span>Customer</span><strong id="operations-customer">${escapeHtml(orderDocumentsState.customerName || operationsCustomerName(payload))}</strong><small id="operations-customer-source">${escapeHtml(payload?.detected_customer?.source ? `Detected from ${String(payload.detected_customer.source).replaceAll('_', ' ')}` : 'Automatic detection')}</small></div>
        <div><span>Sales order</span><strong id="operations-order-number">${escapeHtml(orderDocumentsState.orderNumber || '—')}</strong><small id="operations-record-id">${escapeHtml(orderDocumentsState.ecomdashId ? `Record ${orderDocumentsState.ecomdashId}` : 'One shared session')}</small></div>
        <div><span>Order lines</span><strong id="operations-line-count">${escapeHtml(String(payload?.items?.length || 0))}</strong><small id="operations-match-summary">${escapeHtml(payload?.items?.length ? operationsMatchSummary(payload) : 'Matching SKUs')}</small></div>
        <div><span>Pallets</span><strong id="operations-pallet-count">${escapeHtml(String(effectivePalletCount))}</strong><small>${manualPalletMode ? 'Entered manually for this run' : 'From MPL and Ti-Hi'}</small></div>`;
    }
    setText('operations-label-count', customLabels
      ? (b2bTemplateIdsForJob().length ? `${b2bTemplateIdsForJob().length} template(s) selected` : 'Complete Label Setup below')
      : labelJobs.length
        ? `${labelJobs.length} product job(s) · ${selectedLabelCount} selected output(s)${unresolvedLabelCount ? ` · ${unresolvedLabelCount} need templates` : ''}`
        : 'No automatic label jobs');
    setText('operations-mpl-status', mpl
      ? `${mpl.items?.length || 0} line(s) · ${palletCount} pallet(s)`
      : customMpl ? 'Create the packing-list draft below' : 'No packing-list draft');
    setText('operations-pallet-status', manualPalletMode
      ? `${effectivePalletCount} manually entered pallet(s) · ${orderDocumentsState.manualPalletCopies} copy/copies each`
      : selected.pallets && selected.mpl
        ? (palletCount ? `${palletCount} pallet(s) calculated from the reviewed packing list` : 'Pallet count will be calculated from the packing list')
        : (palletCount ? `${palletCount} pallet label group(s) available from the active MPL` : 'Select Pallet Labels to enter a manual count'));
    setText('operations-label-tab-state', selected.labels ? (orderDocumentsState.reviewedDocuments.labels ? 'Approved' : orderDocumentsState.labelPreviewReady ? 'Approval required' : 'Preview required') : (selectedLabelCount ? `${selectedLabelCount} output(s)` : (labelJobs.length ? 'Templates needed' : 'Set up')));
    setText('operations-mpl-tab-state', mpl ? `${mpl.items?.length || 0} line(s) · ${orderDocumentsState.reviewedDocuments.mpl ? 'Approved' : 'Approval required'}` : 'Not ready');
    setText('operations-pallet-tab-state', effectivePalletCount ? `${effectivePalletCount} pallet(s) · ${orderDocumentsState.reviewedDocuments.pallets ? 'Approved' : 'Approval required'}` : 'Not ready');
    setText('operations-pallet-review-kicker', manualPalletMode ? 'Manual pallet run' : 'Shared pallet plan');
    setText('operations-pallet-review-description', manualPalletMode
      ? `Review ${effectivePalletCount} manually requested pallet label group(s). Item allocation and Ti-Hi are not calculated when Packing List & Ti-Hi is excluded.`
      : 'Pallet labels are derived from the active packing list. Changes to MPL pallet assignments remain the source of truth.');
    setText('operations-mpl-item-count', String(mpl?.items?.length || 0));
    setText('operations-mpl-review-pallets', String(palletCount));
    setText('operations-mpl-review-state', !mpl ? 'Not created' : mpl?.warnings?.length ? `${mpl.warnings.length} warning(s) to review` : 'Ready to review');
    setText('operations-pallet-label-count', String(effectivePalletCount));

    const labelsCheckbox = document.getElementById('operations-generate-labels');
    const mplCheckbox = document.getElementById('operations-generate-mpl');
    const palletsCheckbox = document.getElementById('operations-generate-pallets');
    const reviewMplButton = document.getElementById('operations-review-mpl');
    const reviewPalletButton = document.getElementById('operations-review-pallet-labels');
    const manualPalletPanel = document.getElementById('operations-manual-pallets');
    const manualPalletCountInput = document.getElementById('operations-manual-pallet-count');
    const manualPalletCopiesInput = document.getElementById('operations-manual-pallet-copies');
    const orderInput = document.getElementById('operations-sales-order-number');
    const loadOrderButton = document.getElementById('btn-load-operations-order');
    const customMode = customLabels || customMpl;
    document.getElementById('operations-box-actions')?.classList.toggle('hidden', customMode || !payload.items?.length);
    setText('operations-order-kicker', customMode ? 'Optional order autofill' : 'Sales order');
    setText('operations-order-title', customLabels
      ? 'Optional: load an order to auto-fill this label'
      : customMpl
        ? 'Optional: load an order to auto-fill this packing list'
        : 'What are you preparing today?');
    setText('operations-order-description', customMode
      ? 'You can continue manually below. Enter a sales order only when you want to replace this custom document with automatically matched customer, product, quantity, and address data.'
      : 'Enter the sales order once. LabelKit detects the customer, matches Product Master records, converts quantities, and builds one shared document session.');
    setText('operations-order-label', customMode ? 'Optional Sales Order Number' : 'Sales Order Number');
    setText('operations-output-kicker', customMode ? 'Production' : 'Documents');
    setText('operations-output-title', nextReviewStage === 'labels'
      ? 'Preview customer labels'
      : nextReviewStage === 'mpl'
        ? 'Review packing list & Ti-Hi'
        : nextReviewStage === 'pallets'
          ? 'Preview & edit pallet labels'
          : 'Approved files are ready');
    setText('operations-output-description', nextReviewStage === 'labels'
      ? 'Inspect the selected label PDF before moving on to the packing list.'
      : nextReviewStage === 'mpl'
        ? 'Edit the packing list and pallet assignments. Pallet counts are taken from this reviewed draft.'
        : nextReviewStage === 'pallets'
          ? 'Review pallet placards derived from the packing-list assignments.'
          : 'All selected sections have been approved and saved as separate PDFs in Finished Files.');
    if (orderInput) {
      orderInput.required = !customMode;
      orderInput.placeholder = customMode ? 'Optional — enter an order to auto-fill' : 'Enter order number';
    }
    if (loadOrderButton && !orderDocumentsState.loading) loadOrderButton.textContent = customMode ? 'Load & Auto-fill' : 'Load Order';
    const optionalOrderStep = document.querySelector('#operations-order-card .operations-step');
    const outputStep = document.querySelector('.operations-output-heading .operations-step');
    optionalOrderStep?.classList.toggle('hidden', customMode);
    if (outputStep) outputStep.textContent = customLabels ? '03' : customMpl ? '02' : '02';
    if (labelsCheckbox) {
      labelsCheckbox.disabled = !labelJobs.length && orderDocumentsState.customMode !== 'labels';
      if (labelsCheckbox.disabled) labelsCheckbox.checked = false;
    }
    if (mplCheckbox) {
      mplCheckbox.disabled = !mpl;
      if (mplCheckbox.disabled) mplCheckbox.checked = false;
    }
    if (palletsCheckbox) {
      palletsCheckbox.disabled = !orderDocumentsState.payload && !mpl;
      if (palletsCheckbox.disabled) palletsCheckbox.checked = false;
    }
    manualPalletPanel?.classList.toggle('hidden', !manualPalletMode);
    if (manualPalletCountInput && document.activeElement !== manualPalletCountInput) manualPalletCountInput.value = String(orderDocumentsState.manualPalletCount);
    if (manualPalletCopiesInput && document.activeElement !== manualPalletCopiesInput) manualPalletCopiesInput.value = String(orderDocumentsState.manualPalletCopies);
    if (reviewMplButton) reviewMplButton.disabled = !mpl;
    if (reviewPalletButton) reviewPalletButton.disabled = manualPalletMode ? effectivePalletCount < 1 : (!mpl || palletCount < 1);
    document.querySelectorAll('[data-operations-option]').forEach(option => {
      const type = option.dataset.operationsOption;
      option.classList.toggle('hidden', customLabels ? type !== 'labels' : customMpl ? !['packing', 'pallets'].includes(type) : false);
    });
    const generate = document.getElementById('btn-generate-operations-documents');
    const blocker = operationsGenerationBlocker(selected, finalizing);
    if (generate) {
      generate.disabled = orderDocumentsState.loading || orderDocumentsState.selectingOrderInstance || !!blocker;
      generate.textContent = nextReviewStage === 'labels'
        ? (orderDocumentsState.labelPreviewReady ? 'Approve Labels' : 'Continue to Label Preview')
        : nextReviewStage === 'mpl'
          ? 'Continue to Packing List Review'
          : nextReviewStage === 'pallets'
            ? 'Continue to Pallet Label Review'
            : 'View Finished Files';
      generate.title = blocker?.message || '';
    }
    const tabAvailability = {
      labels: customMpl ? false : customLabels || labelJobs.length > 0,
      packing: customLabels ? false : !!mpl,
      pallets: !customLabels && (manualPalletMode ? effectivePalletCount > 0 : !!mpl && palletCount > 0),
      files: true,
    };
    document.querySelectorAll('[data-operations-tab]').forEach(button => {
      const tab = button.dataset.operationsTab;
      const relevant = customLabels ? ['labels', 'files'].includes(tab) : customMpl ? ['packing', 'pallets', 'files'].includes(tab) : true;
      button.classList.toggle('hidden', !relevant);
      button.disabled = !tabAvailability[tab];
      button.setAttribute('aria-disabled', String(!tabAvailability[tab]));
      button.classList.toggle('is-active', button.dataset.operationsTab === orderDocumentsState.activeTab);
    });
    document.querySelectorAll('[data-operations-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.operationsPanel !== orderDocumentsState.activeTab));
    orderDocumentsState.rendering = true;
    try {
      renderB2BCreator();
    } finally {
      orderDocumentsState.rendering = false;
    }
    renderOperationsFiles();
    renderOperationsApprovalActions();
  }

  async function selectOperationsWorkspace(updateHistory = true) {
    const entering = selectedKit !== 'operations';
    selectedKit = 'operations';
    document.body.dataset.module = 'operations';
    document.title = 'Order Documents · LabelKit';
    document.getElementById('kit-selection').classList.add('hidden');
    document.getElementById('upload-page').classList.add('hidden');
    document.getElementById('operations-workspace-page').classList.remove('hidden');
    document.getElementById('btn-change-kit').classList.add('visible');
    document.getElementById('header-app-name').textContent = 'Order Documents';
    document.getElementById('header-app-sub').textContent = '';
    document.getElementById('header-app-sub').classList.add('hidden');
    if (updateHistory) setHistoryPage('operations');
    hideAllRouteViews();
    if (!orderDocumentsState.initialized) {
      mplProductMasterRows = loadMplProductMasterFromStorage();
      mplDirectoryRows = loadMplDirectoryFromStorage();
      mplProductMasterLoadPromise = loadMplProductMasterFromBackend();
      mplDirectoryLoadPromise = loadMplDirectoryFromBackend();
      await Promise.allSettled([mplProductMasterLoadPromise, mplDirectoryLoadPromise, loadB2BLabelTemplates()]);
      orderDocumentsState.initialized = true;
    }
    const routeTab = routeSubpath(getRouteFromHash()).split('/')[0];
    if (['labels', 'packing', 'pallets', 'files'].includes(routeTab)) orderDocumentsState.activeTab = routeTab;
    renderOperationsWorkspace();
    if (entering) setStatus('', '');
  }

  function selectOperationsTab(tab, updateHistory = true) {
    if (!['labels', 'packing', 'pallets', 'files'].includes(tab)) return;
    const button = document.querySelector(`[data-operations-tab="${tab}"]`);
    if (button?.disabled) {
      setStatus(tab === 'pallets'
        ? 'Review the packing list and assign at least one pallet before opening Pallet Labels.'
        : `The ${button?.querySelector('span')?.textContent || tab} workspace is not available in this document session.`, 'info');
      return;
    }
    orderDocumentsState.activeTab = tab;
    renderOperationsWorkspace();
    if (updateHistory && selectedKit === 'operations') setHistoryRoute(`operations/${tab}`);
  }

  function setOperationsOrderBusy(busy) {
    orderDocumentsState.loading = !!busy;
    const input = document.getElementById('operations-sales-order-number');
    const button = document.getElementById('btn-load-operations-order');
    if (input) input.disabled = !!busy;
    if (button) { button.disabled = !!busy; button.textContent = busy ? 'Loading…' : 'Load Order'; }
    renderOperationsWorkspace();
  }

  function showOperationsOrderInstances(orderNumber, instances = []) {
    const picker = document.getElementById('operations-order-instance-picker');
    const body = document.getElementById('operations-order-instance-body');
    if (!picker || !body) return;
    renderOrderInstanceTableRows(body, instances, selectOperationsOrderInstance);
    orderDocumentsState.selectingOrderInstance = true;
    picker.dataset.salesOrderNumber = String(orderNumber || '').trim();
    delete picker.dataset.ecomdashId;
    document.getElementById('operations-order-instance-count').textContent = `${instances.length} unique order${instances.length === 1 ? '' : 's'}`;
    const recommendedIndex = (instances || []).findIndex(instance => instance?.recommended && String(instance?.ecomdash_id || '').trim());
    const checkboxes = [...body.querySelectorAll('.mpl-order-instance-checkbox')];
    const recommended = recommendedIndex >= 0 ? checkboxes[recommendedIndex] : null;
    if (recommended) {
      recommended.checked = true;
      selectOperationsOrderInstance(recommended);
    } else {
      document.getElementById('btn-load-selected-operations-order').disabled = true;
    }
    [...body.querySelectorAll('tr')].forEach(row => row.addEventListener('click', event => {
      if (event.target.closest('input, button, a')) return;
      const checkbox = row.querySelector('.mpl-order-instance-checkbox:not(:disabled)');
      if (!checkbox) return;
      checkbox.checked = true;
      selectOperationsOrderInstance(checkbox);
    }));
    picker.classList.remove('hidden');
    setOperationsOrderPickerBlocking(true);
    renderOperationsWorkspace();
    window.requestAnimationFrame(() => (picker.querySelector('.mpl-order-instance-checkbox:checked') || picker.querySelector('.mpl-order-instance-checkbox'))?.focus({ preventScroll: true }));
  }

  function cancelOperationsOrderSelection() {
    const picker = document.getElementById('operations-order-instance-picker');
    if (picker) {
      picker.classList.add('hidden');
      delete picker.dataset.salesOrderNumber;
      delete picker.dataset.ecomdashId;
    }
    orderDocumentsState.selectingOrderInstance = false;
    setOperationsOrderPickerBlocking(false);
    renderOperationsWorkspace();
    document.getElementById('operations-sales-order-number')?.focus({ preventScroll: true });
    setStatus(orderDocumentsState.payload || orderDocumentsState.customMode
      ? 'Order selection cancelled. Your current document session is unchanged.'
      : 'Order selection cancelled.', 'info');
  }

  function selectOperationsOrderInstance(selectedCheckbox) {
    const picker = document.getElementById('operations-order-instance-picker');
    if (!picker || !selectedCheckbox) return;
    picker.querySelectorAll('.mpl-order-instance-checkbox').forEach(checkbox => {
      if (checkbox !== selectedCheckbox) checkbox.checked = false;
      checkbox.closest('tr')?.classList.toggle('selected', checkbox.checked);
    });
    const id = selectedCheckbox.checked ? String(selectedCheckbox.value || '').trim() : '';
    if (id) picker.dataset.ecomdashId = id; else delete picker.dataset.ecomdashId;
    document.getElementById('btn-load-selected-operations-order').disabled = !id;
    document.getElementById('operations-order-instance-help').textContent = id ? `Order record ${id} selected.` : 'Select one order record to continue.';
  }

  function loadSelectedOperationsOrder() {
    const picker = document.getElementById('operations-order-instance-picker');
    const order = String(picker?.dataset.salesOrderNumber || '').trim();
    const id = String(picker?.dataset.ecomdashId || '').trim();
    if (!order || !id) return setStatus('Select an order record before continuing.', 'error');
    orderDocumentsState.selectingOrderInstance = false;
    loadOperationsOrder(null, id, order);
  }

  function appendPartnerOnlyLabelJobs(payload, customerId, context) {
    if (!customerId) return;
    const specialJobs = buildPartnerLabelJobs(payload, customerId, context).filter(isPartnerPalletLabelJob);
    specialJobs.forEach(job => {
      const duplicate = b2bOrderLabelJobs.some(candidate => candidate.template_id === job.template_id && String(candidate.product?.sku || '') === String(job.product?.sku || ''));
      if (duplicate) return;
      const fallbackIndex = b2bOrderFallbackProducts.length;
      job.order_only_product_index = fallbackIndex;
      b2bOrderFallbackProducts.push(normalizeProductRow({ ...job.product }));
      b2bOrderLabelJobs.push(job);
    });
  }

  async function completeOperationsOrderLoad(payload, orderNumber, ecomdashId = '') {
    mplDraftSync?.discard();
    orderDocumentsState.initializingOrder = true;
    const replacedCurrentSession = !!(orderDocumentsState.payload || orderDocumentsState.customMode || orderDocumentsState.mplDraft);
    orderDocumentsState.payload = payload;
    orderDocumentsState.orderNumber = orderNumber;
    orderDocumentsState.ecomdashId = ecomdashId || payload?.source?.ecomdash_id || '';
    orderDocumentsState.customerId = detectPartnerCustomer(payload);
    orderDocumentsState.customerName = operationsCustomerName(payload);
    orderDocumentsState.customMode = '';
    orderDocumentsState.manualPalletCount = 1;
    orderDocumentsState.manualPalletCopies = 1;

    resetB2BManualWorkspaceState();
    payload = JSON.parse(JSON.stringify(payload));
    orderDocumentsState.payload = payload;
    const context = resolveOrderContext(payload, { customer: orderDocumentsState.customerName });
    completeB2BOrderLoad(payload, orderNumber, context);
    appendPartnerOnlyLabelJobs(payload, orderDocumentsState.customerId, context);

    const draft = orderDocumentsState.customerId
      ? buildPartnerMplDraft(payload, orderDocumentsState.customerId, context)
      : buildAnalyticsOrderMplDraft(payload, 'standard', context);
    orderDocumentsState.mplDraft = draft;
    orderDocumentsState.palletDraft = null;
    initializeReviewedOrder(payload, context, draft);
    activeKeheDocumentType = 'masterPackingList';
    activeKeheDocumentDraft = draft;
    keheLastMplDraft = draft;
    updateWorkflowProgress('Planning pallets', 'Calculating pallet assignments and Ti-Hi layouts…');
    const palletization = await autoPalletizeMpl(0, { render: false, showStatus: false }) || {};
    orderDocumentsState.mplDraft = activeKeheDocumentDraft;
    document.getElementById('operations-order-instance-picker')?.classList.add('hidden');
    orderDocumentsState.selectingOrderInstance = false;
    setOperationsOrderPickerBlocking(false);
    ['operations-generate-labels', 'operations-generate-mpl', 'operations-generate-pallets'].forEach(id => {
      const checkbox = document.getElementById(id); if (checkbox) checkbox.checked = true;
    });
    resetOperationsReviewState();
    orderDocumentsState.documentSelection = operationsSelectedDocuments();
    orderDocumentsState.activeTab = b2bOrderLabelJobs.length ? 'labels' : 'packing';
    setHistoryRoute(`operations/${orderDocumentsState.activeTab}`, true);
    clearGeneratedOutputs('operations-labels', 'operations-mpl', 'operations-pallets');
    orderDocumentsState.initializingOrder = false;
    renderOperationsWorkspace();
    scrollOperationsTo('operations-session');
    const reviewCount = Number(payload?.summary?.unmatched_products || 0) + Number(payload?.summary?.ambiguous_products || 0) + Number(payload?.summary?.defaulted_level_skus || 0);
    const selectedLabelCount = b2bOrderLabelJobs.reduce((total, job) => total + b2bTemplateIdsForJob(job).length, 0);
    setStatus(`Sales Order ${orderNumber} is ready${replacedCurrentSession ? ' · previous document session replaced' : ''} · ${payload?.items?.length || 0} line(s) · ${selectedLabelCount} selected label output(s) · ${Number(palletization.palletCount || operationsPalletCount())} assigned pallet(s)${reviewCount ? ` · ${reviewCount} item(s) need review` : ''}.`, reviewCount ? 'info' : 'success');
  }

  async function loadOperationsOrder(event, selectedEcomdashId = '', selectedOrderNumber = '') {
    event?.preventDefault();
    const input = document.getElementById('operations-sales-order-number');
    const orderNumber = String(selectedOrderNumber || input?.value || '').trim();
    if (!orderNumber) { setStatus('Enter a Sales Order Number.', 'error'); input?.focus(); return; }
    setOperationsOrderBusy(true);
    setStatus(`Loading Sales Order ${orderNumber}…`, 'info');
    showWorkflowProgress(0, `Loading Sales Order ${orderNumber}…`);
    try {
      const payload = await window.LabelKitAPI.json('/api/order-documents/orders/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_order_number: orderNumber, ecomdash_id: String(selectedEcomdashId || '') }),
      });
      if (payload.requires_order_selection) {
        closeWorkflowProgress();
        showOperationsOrderInstances(orderNumber, payload.order_instances || []);
        setStatus(`Sales Order ${orderNumber} has multiple records. Select the correct customer order.`, 'info');
        return;
      }
      updateWorkflowProgress('Matching SKUs', 'Matching order lines to Product Master and customer templates…');
      await completeOperationsOrderLoad(payload, orderNumber, selectedEcomdashId);
      closeWorkflowProgress();
    } catch (error) {
      closeWorkflowProgress();
      setStatus(`Order load failed: ${error?.message || 'unknown error'}`, 'error');
    } finally {
      orderDocumentsState.initializingOrder = false;
      setOperationsOrderBusy(false);
    }
  }

  function restoreOperationsMplDraft() {
    if (!orderDocumentsState.mplDraft) return false;
    activeKeheDocumentType = 'masterPackingList';
    activeKeheDocumentDraft = orderDocumentsState.mplDraft;
    keheLastMplDraft = orderDocumentsState.mplDraft;
    return true;
  }

  function openOperationsMplEditor() {
    if (!restoreOperationsMplDraft()) return setStatus('Load an order or create a packing list first.', 'info');
    beginOperationsDocumentReview('mpl');
    renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
    openDocumentEditor();
  }

  function openOperationsPalletLabels() {
    const selected = operationsSelectedDocuments();
    if (operationsUsesManualPalletCount(selected)) {
      const palletDraft = orderDocumentsState.palletDraft || buildOperationsManualPalletDraft();
      beginOperationsDocumentReview('pallets');
      keheLastMplDraft = orderDocumentsState.mplDraft;
      keheLastPalletLabelDraft = palletDraft;
      kehePalletLabelSource = 'Manual';
      activeKeheDocumentType = 'palletLabel';
      activeKeheDocumentDraft = palletDraft;
      orderDocumentsState.palletDraft = palletDraft;
      renderDocumentEditor('palletLabel', palletDraft);
      openDocumentEditor();
      return;
    }
    if (!restoreOperationsMplDraft()) return setStatus('Load an order or create a packing list first.', 'info');
    if (operationsPalletCount() < 1) {
      setStatus('Assign the packing-list items to at least one pallet before opening pallet labels.', 'info');
      return;
    }
    beginOperationsDocumentReview('pallets');
    openMplPalletLabels(orderDocumentsState.mplDraft);
    orderDocumentsState.palletDraft = activeKeheDocumentDraft;
  }

  async function openOperationsCustomMpl() {
    mplDraftSync?.discard();
    window.clearGeneratedOutputs?.('operations-labels', 'operations-mpl', 'operations-pallets');
    orderDocumentsState.reviewedOrder = null;
    orderDocumentsState.customMode = 'mpl';
    resetOperationsReviewState();
    orderDocumentsState.payload = null;
    orderDocumentsState.orderNumber = '';
    orderDocumentsState.customerName = 'Custom packing list';
    const orderInput = document.getElementById('operations-sales-order-number');
    if (orderInput) orderInput.value = '';
    resetB2BManualWorkspaceState();
    clearB2BPreview();
    orderDocumentsState.activeTab = 'packing';
    setHistoryRoute('operations/packing', true);
    beginOperationsDocumentReview('mpl');
    await openManualMasterPackingList();
    orderDocumentsState.mplDraft = activeKeheDocumentDraft;
    initializeManualReviewedOrder(activeKeheDocumentDraft);
    orderDocumentsState.palletDraft = null;
    const labels = document.getElementById('operations-generate-labels');
    const mpl = document.getElementById('operations-generate-mpl');
    const pallets = document.getElementById('operations-generate-pallets');
    if (labels) labels.checked = false;
    if (mpl) mpl.checked = true;
    if (pallets) pallets.checked = false;
    orderDocumentsState.documentSelection = operationsSelectedDocuments();
    renderOperationsWorkspace();
    scrollOperationsTo('operations-session');
  }

  function openOperationsOrderLookup() {
    resetOperationsWorkspaceState();
    setHistoryPage('operations');
    renderOperationsWorkspace();
    setStatus('Enter a Sales Order Number to automatically prepare the available labels, packing list, Ti-Hi plan, and pallet labels.', 'info');
    scrollOperationsTo('operations-order-card');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById('operations-sales-order-number')?.focus({ preventScroll: true })));
  }

  function openOperationsCustomLabels() {
    mplDraftSync?.discard();
    window.clearGeneratedOutputs?.('operations-labels', 'operations-mpl', 'operations-pallets');
    orderDocumentsState.reviewedOrder = null;
    orderDocumentsState.customMode = 'labels';
    orderDocumentsState.payload = null;
    orderDocumentsState.orderNumber = '';
    orderDocumentsState.customerName = 'Custom labels';
    orderDocumentsState.mplDraft = null;
    orderDocumentsState.palletDraft = null;
    orderDocumentsState.activeTab = 'labels';
    resetOperationsReviewState();
    const orderInput = document.getElementById('operations-sales-order-number');
    if (orderInput) orderInput.value = '';
    resetB2BManualWorkspaceState();
    const labels = document.getElementById('operations-generate-labels');
    const mpl = document.getElementById('operations-generate-mpl');
    const pallets = document.getElementById('operations-generate-pallets');
    if (labels) labels.checked = true;
    if (mpl) mpl.checked = false;
    if (pallets) pallets.checked = false;
    orderDocumentsState.documentSelection = operationsSelectedDocuments();
    clearB2BPreview();
    renderOperationsWorkspace();
    const setup = document.getElementById('b2b-selection-overrides');
    if (setup) {
      setup.open = true;
      setup.dataset.userOpened = 'true';
    }
    setHistoryRoute('operations/labels', true);
    setStatus('Manual label mode is ready. Choose a template from the gallery, then select a Product Master record to auto-fill it.', 'info');
    scrollOperationsTo('operations-labels-mount');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById('b2b-template-gallery-search')?.focus({ preventScroll: true })));
  }

  function openOperationsSavedMpl() { navigateToRoute('operations/saved'); }

  function adoptSavedMplIntoOperations(draft) {
    resetB2BManualWorkspaceState();
    clearB2BPreview();
    orderDocumentsState.mplDraft = draft;
    resetOperationsReviewState();
    orderDocumentsState.palletDraft = null;
    orderDocumentsState.payload = null;
    orderDocumentsState.customMode = 'saved-mpl';
    initializeManualReviewedOrder(draft);
    orderDocumentsState.orderNumber = String(draft?.summary?.sales_order_number || draft?.packing_lists?.[0]?.order_no || '').trim();
    orderDocumentsState.customerName = String(draft?.storefront || draft?.packing_lists?.[0]?.customer_name || draft?.packing_lists?.[0]?.dc_name || 'Saved packing list').trim();
    orderDocumentsState.activeTab = 'packing';
    const labels = document.getElementById('operations-generate-labels');
    const mpl = document.getElementById('operations-generate-mpl');
    const pallets = document.getElementById('operations-generate-pallets');
    if (labels) labels.checked = false;
    if (mpl) mpl.checked = true;
    if (pallets) pallets.checked = false;
    orderDocumentsState.documentSelection = operationsSelectedDocuments();
    renderOperationsWorkspace();
  }

  async function generateOperationsDocuments() {
    const selected = operationsSelectedDocuments();
    if (operationsNextReviewStage(selected) !== 'generate') return advanceOperationsDocuments();
    const blocker = operationsGenerationBlocker(selected, true);
    if (blocker) {
      setStatus(blocker.message, 'error');
      focusOperationsBlocker(blocker);
      return false;
    }
    const outputs = new Map(window.getGeneratedOutputs?.('operations') || []);
    for (const [type, key] of [['labels', 'operations-labels'], ['mpl', 'operations-mpl'], ['pallets', 'operations-pallets']]) {
      if (selected[type] && !outputs.get(key)?.blob) {
        orderDocumentsState.reviewedDocuments[type] = false;
        if (type === 'labels') orderDocumentsState.labelPreviewReady = false;
        renderOperationsWorkspace();
        setStatus('An approved file is no longer available. Preview and approve that section again.', 'error');
        return false;
      }
    }
    orderDocumentsState.activeTab = 'files';
    renderOperationsWorkspace();
    setHistoryRoute('operations/files');
    setStatus('Approved documents are ready as separate PDFs in Finished Files.', 'success');
    showPrintSummary('operations');
    return true;
  }

  async function advanceOperationsDocuments() {
    const selected = operationsSelectedDocuments();
    const blocker = operationsGenerationBlocker(selected, false);
    if (blocker) {
      setStatus(blocker.message, 'error');
      focusOperationsBlocker(blocker);
      return false;
    }
    const stage = operationsNextReviewStage(selected);
    if (stage === 'labels') {
      if (orderDocumentsState.labelPreviewReady) return approveOperationsLabels();
      orderDocumentsState.activeTab = 'labels';
      renderOperationsWorkspace();
      const previewed = await generateB2BPreview(true, {
        showSummary: false,
        scope: 'operations-review',
        outputKey: 'operations-labels-review',
      });
      if (previewed) {
        orderDocumentsState.labelPreviewReady = true;
        orderDocumentsState.pendingReviewDocument = 'labels';
        renderOperationsWorkspace();
        setStatus('Label preview is ready. Click Approve Labels after checking it; closing the preview does not approve it.', 'success');
      }
      return !!previewed;
    }
    if (stage === 'mpl') {
      orderDocumentsState.activeTab = 'packing';
      renderOperationsWorkspace();
      setStatus(selected.pallets && operationsPalletCount() < 1
        ? 'Review the packing list and assign pallets. Pallet labels will use those assignments.'
        : 'Review and edit the packing list and Ti-Hi plan before continuing.', 'info');
      openOperationsMplEditor();
      return true;
    }
    if (stage === 'pallets') {
      if (operationsEffectivePalletCount(selected) < 1) {
        setStatus('Enter or assign at least one pallet before reviewing pallet labels.', 'error');
        orderDocumentsState.activeTab = selected.mpl ? 'packing' : 'pallets';
        renderOperationsWorkspace();
        return false;
      }
      orderDocumentsState.activeTab = 'pallets';
      renderOperationsWorkspace();
      openOperationsPalletLabels();
      return true;
    }
    return generateOperationsDocuments();
  }
