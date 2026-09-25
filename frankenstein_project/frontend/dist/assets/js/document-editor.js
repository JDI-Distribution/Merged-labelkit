/* Shared KeHE, MPL, pack-label, pallet-label, and PDF editor logic. */
  function showDocumentEditorView() {
    if (!activeKeheDocumentDraft) return;
    document.getElementById('document-editor-panel').classList.add('visible');
  }

  function openDocumentEditor() {
    navigateToRoute(`${getCurrentPage()}/document-editor`);
  }

  function closeDocumentEditor(useHistory = false) {
    if (useHistory && activeKeheDocumentType === 'masterPackingList' && mplDraftSync?.hasUnsavedChanges()) {
      if (!window.confirm('This MPL has unsaved changes. Close the editor without saving them?')) return;
      mplDraftSync.discard();
    }
    if (useHistory) {
      closeCurrentRouteView(getCurrentPage());
      return;
    }
    if (activeKeheDocumentDraft && Array.isArray(activeKeheDocumentDraft.packing_lists)) {
      activeKeheDocumentDraft.packing_lists.forEach(mpl => {
        mpl._show_tihi = false;
      });
    }
    document.getElementById('document-editor-panel').classList.remove('visible');
  }

  function jsString(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function getMpl(mplIndex) {
    return activeKeheDocumentDraft?.packing_lists?.[mplIndex] || null;
  }

  function normalizePalletId(value) {
    return String(value ?? '').trim();
  }

  function shouldDefaultXmlMplToPalletOne(mpl) {
    if (!mpl || mpl.manual_mpl) return false;
    const source = String(mpl.palletization_source || '').trim().toLowerCase();
    const note = String(mpl.palletization_note || '').trim().toLowerCase();
    if (source === 'unassigned') return true;
    return note.includes('no item-to-pallet assignment found in xml');
  }

  function ensureMplPalletState(mpl) {
    if (!mpl) return;
    mpl.items = Array.isArray(mpl.items) ? mpl.items : [];
    mpl.items.forEach((item, index) => {
      item.line = item.line || index + 1;
      item.location_on_pallet = normalizePalletId(item.location_on_pallet);
    });

    const assignedIds = [];
    mpl.items.forEach(item => {
      const id = normalizePalletId(item.location_on_pallet);
      if (id && !assignedIds.includes(id)) assignedIds.push(id);
    });

    if (!assignedIds.length && mpl.items.length && shouldDefaultXmlMplToPalletOne(mpl)) {
      mpl.items.forEach(item => {
        item.location_on_pallet = '1';
        if (!String(item.pallet_weight || '').trim() && mpl._pallet_weights && mpl._pallet_weights['1']) {
          item.pallet_weight = mpl._pallet_weights['1'];
        }
      });
      assignedIds.push('1');
      mpl.palletization_source = 'XML';
      mpl.palletization_note = 'XML did not include item-to-pallet assignment, so all line items were placed on Pallet 1 by default.';
    }

    if (!Array.isArray(mpl._pallet_ids)) {
      mpl._pallet_ids = assignedIds.length ? [...assignedIds] : ['1'];
    }
    mpl._pallet_ids = mpl._pallet_ids.map(normalizePalletId).filter(Boolean)
      .filter((id, index, arr) => arr.indexOf(id) === index);
    assignedIds.forEach(id => {
      if (!mpl._pallet_ids.includes(id)) mpl._pallet_ids.push(id);
    });

    if (!mpl._pallet_weights || typeof mpl._pallet_weights !== 'object') {
      mpl._pallet_weights = {};
    }
    if (!mpl._pallet_dimensions || typeof mpl._pallet_dimensions !== 'object') {
      mpl._pallet_dimensions = {};
    }
    if (!mpl._pallet_tihi || typeof mpl._pallet_tihi !== 'object') {
      mpl._pallet_tihi = {};
    }
    mpl._pallet_ids.forEach(id => {
      const weightedItem = mpl.items.find(item => normalizePalletId(item.location_on_pallet) === id && String(item.pallet_weight || '').trim());
      if (weightedItem && !mpl._pallet_weights[id]) {
        mpl._pallet_weights[id] = weightedItem.pallet_weight;
      }
      if (!Object.prototype.hasOwnProperty.call(mpl._pallet_dimensions, id)) mpl._pallet_dimensions[id] = '48 x 40 in';
      if (!Object.prototype.hasOwnProperty.call(mpl._pallet_tihi, id)) mpl._pallet_tihi[id] = '';
    });

    const assignedPalletCount = mpl._pallet_ids.length || assignedIds.length || 1;
    mpl.total_pallets = String(assignedPalletCount);
  }

  function syncMplLineNumbers(mpl) {
    if (!mpl || !Array.isArray(mpl.items)) return;
    mpl.items.forEach((item, index) => { item.line = index + 1; });
  }

  function editorPdfInput(path, value, className = '', placeholder = '', ariaLabel = '') {
    const aria = ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : '';
    return `<input class="${escapeHtml(className)}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" data-draft-path="${escapeHtml(path)}" onfocus="captureMplHistoryCheckpoint()" oninput="updateDraftValue(this)"${aria}>`;
  }

  function renderCopiesControl(path, value, helpText = 'Number of labels to generate.', minCopies = 1) {
    return `
      <div class="label-copy-control">
        <div>
          <div class="label-copy-title">Copies</div>
          <div class="label-copy-help">${escapeHtml(helpText)}</div>
        </div>
        <input type="number" min="${escapeHtml(String(minCopies))}" step="1" inputmode="numeric" class="label-copy-input" value="${escapeHtml(value ?? minCopies)}" placeholder="${escapeHtml(String(minCopies))}" data-draft-path="${escapeHtml(path)}" onfocus="captureMplHistoryCheckpoint()" oninput="updateDraftValue(this)">
      </div>`;
  }

  function editorPdfTextarea(path, value, className = '', placeholder = '') {
    return `<textarea class="${escapeHtml(className)}" placeholder="${escapeHtml(placeholder)}" data-draft-path="${escapeHtml(path)}" onfocus="captureMplHistoryCheckpoint()" oninput="updateDraftValue(this)">${escapeHtml(value ?? '')}</textarea>`;
  }

  function pdfStatusBadge(status) {
    return status === 'Needs Review'
      ? '<span class="status-tag needs-review">Needs Review</span>'
      : '<span class="status-tag success">Ready</span>';
  }

  function renderPalletLabelToolbar() {
    return `
      <div class="pallet-label-editor-tools">
        <div>
          <div class="pallet-label-editor-tools-title">Pallet Placard Groups</div>
          <div class="pallet-label-editor-tools-subtitle">Add another pallet placard group if the XML/MPL is missing a pallet. New pallets default to 2 copies.</div>
        </div>
        <div class="pallet-label-toolbar-right">
          <button class="btn-secondary" type="button" onclick="addPalletLabelPallet()">Add Pallet</button>
        </div>
      </div>`;
  }

  function renderPalletLabelEditor(draft) {
    const pallets = draft.pallets || [];
    const isTablePreview = !!draft.table_preview;
    const sourceNote = draft.source_note || `Using palletization from Master Packing List preview. Source: ${palletSourceLabel(draft.palletization_source || kehePalletLabelSource)}.`;
    if (!pallets.length) {
      return `
        <div class="palletization-source-note warning">${escapeHtml(sourceNote || 'No MPL palletization found. Use Auto Palletize or generate MPL first.')}</div>
        ${isTablePreview ? '' : renderPalletLabelToolbar()}`;
    }

    return `
      ${isTablePreview ? '' : `<div class="palletization-source-note${String(sourceNote).toLowerCase().includes('no mpl') ? ' warning' : ''}">${escapeHtml(sourceNote)}</div>`}
      ${isTablePreview ? '' : renderPalletLabelToolbar()}
      ${pallets.map((pallet, index) => `
        <div class="pdf-document-shell" data-pallet-label-index="${index}">
          ${isTablePreview ? '' : `
            <div class="pdf-sheet-toolbar">
              <span>${escapeHtml(pallet.id || `Pallet ${index + 1}`)}</span>
              <span style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                ${pdfStatusBadge(pallet.status)}
                <button class="btn-mini-danger" type="button" onclick="removePalletLabelPallet(${index})">Remove Pallet</button>
              </span>
            </div>`}
          ${Array.isArray(pallet.warnings) && pallet.warnings.length
            ? `<div class="editor-warning" style="width:min(100%, 920px)">${pallet.warnings.map(escapeHtml).join('<br>')}</div>`
            : ''}
          <div class="pdf-sheet placard-sheet">
            <div class="placard-title">PALLET PLACARD</div>

            <div class="placard-field-row">
              <div class="placard-label">DATE:</div>
              <div class="placard-box">${editorPdfInput(`pallets.${index}.date`, pallet.date, 'placard-date-input')}</div>
            </div>

            <div class="placard-field-row placard-address">
              <div class="placard-label" style="align-self:start; padding-top:10px;">SHIP FROM:</div>
              <div class="placard-box">${editorPdfTextarea(`pallets.${index}.ship_from`, pallet.ship_from)}</div>
            </div>

            <div class="placard-field-row placard-address">
              <div class="placard-label" style="align-self:start; padding-top:10px;">SHIP TO:</div>
              <div class="placard-box">${editorPdfTextarea(`pallets.${index}.ship_to`, pallet.ship_to)}</div>
            </div>

            <div class="placard-pallet-row">
              <div>PALLET #</div>
              <div class="placard-mini-box">${editorPdfInput(`pallets.${index}.pallet_number`, pallet.pallet_number || '1')}</div>
              <div>OF</div>
              <div class="placard-mini-box">${editorPdfInput(`pallets.${index}.total_pallets`, pallet.total_pallets || '1')}</div>
              <div>TOTAL PALLETS</div>
            </div>

            <div class="placard-po-header">KEHE PO#S ON THIS PALLET:</div>

            <div class="placard-po-row">
              <div class="placard-po-label">PO#</div>
              <div class="placard-po-box">${editorPdfTextarea(`pallets.${index}.customer_po_numbers`, pallet.customer_po_numbers)}</div>
            </div>
          </div>
          ${renderCopiesControl(`pallets.${index}.copies`, pallet.copies || 2, 'Number of pallet placards to generate.')}
        </div>`).join('')}`;
  }

  function renderMplInfoCell(path, label, value, placeholder = '') {
    return `
      <div class="mpl-info-cell">
        <div class="mpl-info-cell-label">${escapeHtml(label)}</div>
        ${editorPdfInput(path, value, '', placeholder)}
      </div>`;
  }

  function renderMplShipCell(path, label, value, placeholder = '') {
    return `
      <div class="mpl-ship-cell">
        <div class="mpl-ship-label">${escapeHtml(label)}</div>
        ${editorPdfInput(path, value, '', placeholder)}
      </div>`;
  }

  function renderMplAddressBox(path, label, value) {
    return `
      <div class="mpl-address-box">
        <div class="mpl-address-label">${escapeHtml(label)}</div>
        ${editorPdfTextarea(path, value)}
      </div>`;
  }

  function renderMplItemRow(mplIndex, itemIndex, item) {
    const base = `packing_lists.${mplIndex}.items.${itemIndex}`;
    const qty = item.qty_on_pallet || item.total_shipped || item.qty || '';
    const showSecondaryDetails = !['kehe', 'standard'].includes(mplTemplateId(getMpl(mplIndex) || {}));
    return `
      <tr class="mpl-pallet-item-row" data-mpl-index="${mplIndex}" data-item-index="${itemIndex}">
        <td style="width:16%">${editorPdfInput(`${base}.item_number`, item.item_number || item.sku || '')}</td>
        <td style="width:37%">
          <div class="mpl-description-edit">
            ${renderMplProductSelect(mplIndex, itemIndex, item)}
            ${editorPdfTextarea(`${base}.description`, item.description)}
            <div class="mpl-exp-edit"><span>EXP:</span>${editorPdfInput(`${base}.expiration_date`, item.expiration_date)}</div>
          </div>
        </td>
        <td style="width:9%">${editorPdfInput(`${base}.uom`, item.uom || 'CASES')}</td>
        <td style="width:10%">${editorPdfInput(`${base}.qty_on_pallet`, qty)}</td>
        <td style="width:10%">${editorPdfInput(`${base}.total_ordered`, item.total_ordered || qty)}</td>
        <td style="width:10%">${editorPdfInput(`${base}.total_shipped`, item.total_shipped || qty)}</td>
        <td class="mpl-row-actions-cell">
          <button class="btn-mini-danger" type="button" onclick="deleteMplItem(${mplIndex}, ${itemIndex})">Delete</button>
        </td>
        <td class="mpl-row-drag-cell">
          <button class="mpl-drag-handle-btn" type="button" draggable="true" ondragstart="dragMplItem(event, ${mplIndex}, ${itemIndex})" title="Drag line item to another pallet" aria-label="Drag line item">⋮⋮</button>
        </td>
      </tr>
      ${showSecondaryDetails ? `<tr class="mpl-item-details-row" data-mpl-index="${mplIndex}" data-item-index="${itemIndex}">
        <td colspan="8">
          <div class="mpl-line-meta-grid">
            <label><span>Invoice / PO</span>${editorPdfInput(`${base}.invoice_po_number`, item.invoice_po_number || '')}</label>
            <label><span>Lot</span>${editorPdfInput(`${base}.lot`, item.lot || '')}</label>
            <label><span>Color</span>${editorPdfInput(`${base}.color`, item.color || '')}</label>
            <label><span>Product Size</span>${editorPdfInput(`${base}.product_size`, item.product_size || '')}</label>
            <label><span>Qty / Case</span>${editorPdfInput(`${base}.quantity_per_case`, item.quantity_per_case || '')}</label>
            <label><span>Balance Owed</span>${editorPdfInput(`${base}.balance_owed`, item.balance_owed || '')}</label>
          </div>
        </td>
      </tr>` : ''}`;
  }

  function renderMplDropZone(mplIndex, palletId, items, emptyText) {
    const safePallet = jsString(palletId);
    return `
      <div class="mpl-pdf-table-wrap"
           ondragover="event.preventDefault(); this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="dropMplItem(event, ${mplIndex}, '${safePallet}')">
        ${items.length ? `
          <table class="mpl-pdf-table">
            <thead>
              <tr>
                <th>Item Number</th>
                <th>Pallet Weight &amp;<br>Item Description</th>
                <th>UOM</th>
                <th>Qty On<br>Pallet</th>
                <th>Total<br>Ordered</th>
                <th>Total<br>Shipped</th>
                <th>Action</th>
                <th>Move</th>
              </tr>
            </thead>
            <tbody>${items.map(({ item, itemIndex }) => renderMplItemRow(mplIndex, itemIndex, item)).join('')}</tbody>
          </table>`
          : `<div class="mpl-pdf-empty">${escapeHtml(emptyText)}</div>`}
      </div>`;
  }

  function renderMplPalletBox(mplIndex, mpl, palletId) {
    const items = (mpl.items || [])
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => normalizePalletId(item.location_on_pallet) === palletId);
    const weight = (mpl._pallet_weights && mpl._pallet_weights[palletId]) || '';
    return `
      <div class="mpl-pallet-live-row">
        <div class="mpl-pdf-pallet-section" data-mpl-index="${mplIndex}" data-pallet-id="${escapeHtml(palletId)}">
          <div class="mpl-pdf-pallet-heading">
            <div>Pallet: ${escapeHtml(palletId)}</div>
            <div class="mpl-pallet-weight-edit">
              <span>Weight</span>
              <input value="${escapeHtml(weight)}" placeholder="ex: 820 LBS" oninput="setMplPalletWeight(${mplIndex}, '${jsString(palletId)}', this.value)">
            </div>
            <div class="mpl-pallet-heading-actions">
              <button class="btn-secondary" type="button" onclick="addMplItem(${mplIndex}, '${jsString(palletId)}')">Add Line Item</button>
            </div>
          </div>
          ${renderMplDropZone(mplIndex, palletId, items, 'Drop line items here')}
        </div>
        ${renderMplLiveTiHiPanel(mplIndex, palletId)}
      </div>`;
  }

  function renderMplItemsEditor(mplIndex, items) {
    const mpl = getMpl(mplIndex) || { items: items || [] };
    ensureMplPalletState(mpl);
    captureXmlPalletSnapshot(mpl);
    const unassigned = (mpl.items || [])
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => !normalizePalletId(item.location_on_pallet));
    const palletIds = mpl._pallet_ids || [];
    const source = palletSourceLabel(mpl.palletization_source || keheMplPalletizationSource);
    const sourceClass = String(mpl.palletization_note || '').toLowerCase().includes('does not match') ? ' warning' : '';
    return `
      <div class="palletization-source-note${sourceClass}">Palletization Source: ${escapeHtml(source)}. ${escapeHtml(mpl.palletization_note || 'How to reorder: Click and hold the six-dot icon at the end of the row to drag the line item to another pallet.')}</div>
      <div class="mpl-pdf-editor-tools">
        <div>
          <div class="mpl-pdf-editor-tools-title">Line Item / Pallet Assignment</div>
          <div class="mpl-pallet-toolbar-subtitle">How to reorder: Click and hold the six-dot icon at the end of the row to drag the line item to another pallet.</div>
        </div>
        <div class="mpl-pdf-editor-tools-actions">
          <button class="btn-secondary" type="button" onclick="addMplPallet(${mplIndex})">Add Pallet</button>
          <button class="btn-secondary" type="button" onclick="autoPalletizeMpl(${mplIndex})">Auto Palletize</button>
          <button class="btn-secondary" type="button" onclick="openMplTiHiSettings(${mplIndex})">Ti-Hi Settings</button>
          ${canReverseMplToXml(mpl) ? `<button class="btn-secondary" type="button" onclick="reverseMplToXmlPalletization(${mplIndex})">Reverse to XML Palletization</button>` : ''}
          <button class="btn-secondary" type="button" onclick="recalculateMplWeights(${mplIndex})">Recalculate Weights</button>
        </div>
      </div>
      ${unassigned.length ? `
        <div class="mpl-pdf-pallet-section mpl-unassigned-section">
          <div class="mpl-pdf-pallet-heading">
            <div>Unassigned</div>
            <div>Drag these rows into a pallet before final printing.</div>
            <span>${unassigned.length} line${unassigned.length === 1 ? '' : 's'}</span>
          </div>
          ${renderMplDropZone(mplIndex, '', unassigned, 'No unassigned line items')}
        </div>` : ''}
      ${palletIds.map(id => renderMplPalletBox(mplIndex, mpl, id)).join('')}`;
  }

  function renderStandaloneMplLogo(brand) {
    return `<div class="mpl-brand-logo-wrap">
      <img class="mpl-brand-logo ${escapeHtml(brand.logoClass || '')}" src="${escapeHtml(brand.logo)}" alt="${escapeHtml(brand.label)} logo">
    </div>`;
  }

  function mplItemUnits(item) {
    if (String(item?.units_on_pallet || '').trim()) return item.units_on_pallet;
    const cases = Number(item?.qty_on_pallet ?? item?.total_shipped);
    const unitsPerCase = Number(item?.quantity_per_case);
    return Number.isFinite(cases) && Number.isFinite(unitsPerCase) ? String(cases * unitsPerCase) : '';
  }

  const PARTNER_MPL_DEFAULT_COLUMNS = [
    ['location_on_pallet', 'Pallet #', 0.075],
    ['invoice_po_number', 'Invoice / PO #', 0.105],
    ['item_number', 'Item #', 0.085],
    ['lot', 'Lot #', 0.075],
    ['color', 'Color', 0.075],
    ['description', 'Description', 0.180],
    ['product_size', 'Product Size', 0.090],
    ['quantity_per_case', 'Quantity Per Case', 0.090],
    ['qty_on_pallet', '# of Cases', 0.075],
    ['units_on_pallet', 'Units on This Pallet', 0.095],
    ['balance_owed', 'Balance Owed', 0.055],
  ];

  function ensurePartnerMplColumns(mpl) {
    const saved = Array.isArray(mpl?.column_config) ? mpl.column_config : [];
    const savedByKey = new Map(saved.filter(column => column?.key).map(column => [String(column.key), column]));
    const defaults = PARTNER_MPL_DEFAULT_COLUMNS.map(([key, label, width]) => ({
      key,
      label: String(savedByKey.get(key)?.label || label),
      width,
      visible: savedByKey.get(key)?.visible !== false,
      custom: false,
    }));
    const custom = saved.filter(column => column?.custom && column?.key).map(column => ({
      key: String(column.key),
      label: String(column.label || 'Custom Column'),
      width: Number(column.width) || 0.09,
      visible: column.visible !== false,
      custom: true,
    }));
    const orderedKeys = saved.map(column => String(column?.key || '')).filter(Boolean);
    const all = [...defaults, ...custom];
    all.sort((left, right) => {
      const leftIndex = orderedKeys.indexOf(left.key);
      const rightIndex = orderedKeys.indexOf(right.key);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    });
    mpl.column_config = all;
    return all;
  }

  function partnerMplColumnValue(item, mpl, column) {
    if (column.key === 'units_on_pallet') return mplItemUnits(item);
    if (column.key === 'invoice_po_number') return item.invoice_po_number || mpl.customer_po_number || '';
    if (column.key === 'item_number') return item.item_number || item.sku || '';
    if (column.key === 'qty_on_pallet') return item.qty_on_pallet || item.total_shipped || '';
    return item[column.key] || '';
  }

  function refreshPartnerMplColumns(mplIndex, keepModal = false) {
    mplDraftSync?.schedule();
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    if (keepModal) window.requestAnimationFrame(() => openMplColumnManager(mplIndex));
  }

  function openMplColumnManager(mplIndex) {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    const columns = ensurePartnerMplColumns(mpl);
    let modal = document.getElementById('mpl-column-manager-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mpl-column-manager-modal';
      modal.className = 'editor-panel workflow-popup-panel';
      document.body.appendChild(modal);
    }
    modal.dataset.mplIndex = String(mplIndex);
    modal.innerHTML = `<div class="editor-dialog workflow-popup-dialog mpl-column-manager-dialog">
      <div class="editor-toolbar"><div><div class="editor-title">Packing List Columns</div><div class="kehe-product-master-subtitle">Show, rename, reorder, or add columns. This layout is saved with this MPL and used in its PDF.</div></div><button class="btn-secondary" type="button" onclick="closeMplColumnManager()">Close</button></div>
      <div class="editor-body">
        <div class="mpl-column-manager-list">${columns.map((column, index) => `<div class="mpl-column-manager-row">
          <label class="mpl-column-visible"><input type="checkbox" ${column.visible ? 'checked' : ''} onchange="setMplColumnVisible(${mplIndex}, ${index}, this.checked)"><span>Show</span></label>
          <label><span>Column name</span><input value="${escapeHtml(column.label)}" onchange="renameMplColumn(${mplIndex}, ${index}, this.value)"></label>
          <div class="mpl-column-order"><button class="btn-secondary" type="button" ${index === 0 ? 'disabled' : ''} onclick="moveMplColumn(${mplIndex}, ${index}, -1)">↑</button><button class="btn-secondary" type="button" ${index === columns.length - 1 ? 'disabled' : ''} onclick="moveMplColumn(${mplIndex}, ${index}, 1)">↓</button></div>
          ${column.custom ? `<button class="btn-mini-danger" type="button" onclick="removeMplColumn(${mplIndex}, ${index})">Remove</button>` : '<span class="mpl-column-standard">Standard</span>'}
        </div>`).join('')}</div>
        <div class="mpl-column-add"><label><span>New custom column</span><input id="mpl-new-column-name" placeholder="Example: Warehouse Notes"></label><button class="btn-generate" type="button" onclick="addMplCustomColumn(${mplIndex})">Add column</button></div>
      </div>
      <div class="editor-footer"><button class="btn-generate" type="button" onclick="closeMplColumnManager()">Done</button></div>
    </div>`;
    modal.classList.add('visible');
  }

  function closeMplColumnManager() { document.getElementById('mpl-column-manager-modal')?.classList.remove('visible'); }
  function setMplColumnVisible(mplIndex, columnIndex, visible) {
    const columns = ensurePartnerMplColumns(getMpl(mplIndex));
    if (!columns[columnIndex]) return;
    columns[columnIndex].visible = !!visible;
    if (!columns.some(column => column.visible)) columns[columnIndex].visible = true;
    refreshPartnerMplColumns(mplIndex, true);
  }
  function renameMplColumn(mplIndex, columnIndex, label) {
    const columns = ensurePartnerMplColumns(getMpl(mplIndex));
    if (!columns[columnIndex]) return;
    columns[columnIndex].label = String(label || '').trim() || 'Column';
    refreshPartnerMplColumns(mplIndex, true);
  }
  function moveMplColumn(mplIndex, columnIndex, direction) {
    const columns = ensurePartnerMplColumns(getMpl(mplIndex));
    const next = columnIndex + Number(direction || 0);
    if (!columns[columnIndex] || next < 0 || next >= columns.length) return;
    [columns[columnIndex], columns[next]] = [columns[next], columns[columnIndex]];
    refreshPartnerMplColumns(mplIndex, true);
  }
  function removeMplColumn(mplIndex, columnIndex) {
    const columns = ensurePartnerMplColumns(getMpl(mplIndex));
    if (!columns[columnIndex]?.custom) return;
    columns.splice(columnIndex, 1);
    refreshPartnerMplColumns(mplIndex, true);
  }
  function addMplCustomColumn(mplIndex) {
    const mpl = getMpl(mplIndex);
    const input = document.getElementById('mpl-new-column-name');
    const label = String(input?.value || '').trim();
    if (!mpl || !label) { input?.focus(); return; }
    const columns = ensurePartnerMplColumns(mpl);
    let key = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'column'}`;
    let suffix = 2;
    while (columns.some(column => column.key === key)) key = `${key.replace(/_\d+$/, '')}_${suffix++}`;
    columns.push({ key, label, width: 0.09, visible: true, custom: true });
    (mpl.items || []).forEach(item => { if (!(key in item)) item[key] = ''; });
    refreshPartnerMplColumns(mplIndex, true);
  }

  function renderStandaloneMplToolbar(mpl, mplIndex, label) {
    return `<div class="standalone-mpl-toolbar">
      <div><strong>${escapeHtml(label)}</strong><span>Every displayed value can be edited before PDF generation.</span></div>
      <div>
        <button class="btn-secondary" type="button" onclick="addMplPallet(${mplIndex})">Add Pallet</button>
        <button class="btn-secondary" type="button" onclick="addMplItem(${mplIndex}, '${jsString((mpl._pallet_ids || ['1'])[0] || '1')}')">Add Line Item</button>
        <button class="btn-secondary" type="button" onclick="autoPalletizeMpl(${mplIndex})">Auto Palletize</button>
        <button class="btn-secondary" type="button" onclick="openMplTiHiSettings(${mplIndex})">Ti-Hi Settings</button>
        <button class="btn-secondary" type="button" onclick="recalculateMplWeights(${mplIndex})">Recalculate Weights</button>
        ${['decopac', 'dutch_bros', 'fancy'].includes(mplTemplateId(mpl)) ? `<button class="btn-secondary" type="button" onclick="openMplColumnManager(${mplIndex})">Manage Columns</button>` : ''}
      </div>
    </div>`;
  }

  function mplTiHiSummaryValue(mpl, palletId) {
    const manual = String(mpl?._pallet_tihi?.[palletId] || '').trim();
    if (manual) return manual;
    try {
      const { entries } = buildMplTiHiEntries(mpl);
      const entry = entries.find(row => normalizePalletId(row.palletLabel) === normalizePalletId(palletId));
      return entry ? `${entry.ti} x ${entry.hi}` : '';
    } catch (_err) {
      return '';
    }
  }

  function renderMplLiveTiHiPanel(mplIndex, palletId, extraClass = '') {
    return `<aside class="mpl-live-tihi-panel ${escapeHtml(extraClass)}" data-mpl-live-tihi="${mplIndex}" data-pallet-id="${escapeHtml(palletId)}">
      <div class="mpl-live-tihi-head">
        <div>
          <strong>Pallet ${escapeHtml(palletId)} Ti-Hi Preview</strong>
          <span>Live layout from Product Master case dimensions and weight</span>
        </div>
        <div class="mpl-live-tihi-actions">
          <span class="mpl-live-tihi-badge">Auto</span>
          <button class="btn-secondary" type="button" onclick="openMplPalletTiHi(${mplIndex}, '${jsString(palletId)}')">Edit Ti-Hi</button>
        </div>
      </div>
      <div class="mpl-live-tihi-body">${mplLiveTiHiLoadingMarkup()}</div>
    </aside>`;
  }

  function renderBreakdownTable(mpl, mplIndex, palletId) {
    const base = `packing_lists.${mplIndex}`;
    const columns = ensurePartnerMplColumns(mpl).filter(column => column.visible);
    const rows = (mpl.items || [])
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => normalizePalletId(item.location_on_pallet) === palletId);
    return `<div class="decopac-table-wrap">
      <table class="decopac-table">
        <thead><tr>${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map(({ item, itemIndex }) => {
          const itemBase = `${base}.items.${itemIndex}`;
          return `<tr data-mpl-index="${mplIndex}" data-item-index="${itemIndex}">
            ${columns.map((column, columnIndex) => `<td>${column.key === 'description' ? `<div class="decopac-description-cell">${renderMplProductSelect(mplIndex, itemIndex, item)}${editorPdfTextarea(`${itemBase}.description`, item.description)}</div>` : editorPdfInput(`${itemBase}.${column.key}`, partnerMplColumnValue(item, mpl, column))}${columnIndex === 0 ? `<button class="decopac-delete" type="button" onclick="deleteMplItem(${mplIndex}, ${itemIndex})" title="Delete row">×</button>` : ''}</td>`).join('')}
          </tr>`;
        }).join('') : `<tr><td colspan="${columns.length}" class="decopac-empty">No products assigned to this pallet.</td></tr>`}</tbody>
      </table>
    </div>`;
  }

  function renderBreakdownPalletFlow(mpl, mplIndex, palletId) {
    const rowCount = (mpl.items || []).filter(item => normalizePalletId(item.location_on_pallet) === palletId).length;
    return `<section class="decopac-pallet-flow" data-mpl-index="${mplIndex}" data-pallet-id="${escapeHtml(palletId)}">
      <div class="decopac-pallet-flow-head">
        <div><span>Pallet</span><strong>${escapeHtml(palletId)}</strong><small>${rowCount} line${rowCount === 1 ? '' : 's'}</small></div>
        <div class="decopac-pallet-flow-actions">
          <label><span>Weight</span><input value="${escapeHtml(mpl._pallet_weights?.[palletId] || '')}" placeholder="ex: 589 LBS" oninput="setMplPalletWeight(${mplIndex}, '${jsString(palletId)}', this.value)"></label>
          <button class="btn-secondary" type="button" onclick="addMplItem(${mplIndex}, '${jsString(palletId)}')">Add Line Item</button>
        </div>
      </div>
      ${renderBreakdownTable(mpl, mplIndex, palletId)}
      ${renderMplLiveTiHiPanel(mplIndex, palletId, 'decopac-tihi-panel')}
    </section>`;
  }

  function renderDecopacMplSheet(mpl, mplIndex, brand, customerHeading = 'DECOPAC') {
    ensureMplPalletState(mpl);
    const items = mpl.items || [];
    const base = `packing_lists.${mplIndex}`;
    const palletIds = mpl._pallet_ids || ['1'];
    return `
      <div class="decopac-customer-heading">${escapeHtml(customerHeading)}</div>
      <div class="decopac-document-header">
        <div class="decopac-delivery-block">
          ${editorPdfInput(`${base}.pallet_heading`, mpl.pallet_heading || 'PALLET 1', 'decopac-pallet-heading')}
          <label><span>Delivery From</span>${editorPdfInput(`${base}.delivery_from_name`, mpl.delivery_from_name || firstLine(mpl.supplier_info))}</label>
          <label><span>Shipping Date</span>${editorPdfInput(`${base}.est_ship_date`, mpl.est_ship_date)}</label>
          <label><span>Ship To Address</span>${editorPdfTextarea(`${base}.ship_to`, mpl.ship_to)}</label>
          <label><span>Phone #</span>${editorPdfInput(`${base}.phone_number`, mpl.phone_number || '')}</label>
          <label><span>Customer PO(s)</span>${editorPdfInput(`${base}.customer_po_number`, mpl.customer_po_number)}</label>
        </div>
        ${renderStandaloneMplLogo(brand)}
      </div>
      <div class="decopac-breakdown-title">${editorPdfInput(`${base}.title`, mpl.title || 'Pallet Breakdown', 'mpl-title-input')}</div>
      ${renderStandaloneMplToolbar(mpl, mplIndex, `${customerHeading} pallet breakdown`)}
      <div class="decopac-pallet-flow-stack">
        ${palletIds.map(palletId => renderBreakdownPalletFlow(mpl, mplIndex, palletId)).join('')}
      </div>
      <div class="decopac-summary-title">Pallet Summary</div>
      <div class="decopac-summary-wrap"><table class="decopac-summary-table">
        <thead><tr><th>Pallet Number</th><th>Dimensions</th><th>Weight</th><th>Total Weight</th><th>TIHI</th><th>Settings</th></tr></thead>
        <tbody>${palletIds.map((palletId, palletIndex) => `<tr data-mpl-index="${mplIndex}" data-pallet-id="${escapeHtml(palletId)}">
          <td>${editorPdfInput(`${base}._pallet_ids.${palletIndex}`, palletId)}</td>
          <td>${editorPdfInput(`${base}._pallet_dimensions.${palletId}`, mpl._pallet_dimensions[palletId] || '48 x 40 in')}</td>
          <td><input value="${escapeHtml(mpl._pallet_weights[palletId] || '')}" placeholder="ex: 589 LBS" oninput="setMplPalletWeight(${mplIndex}, '${jsString(palletId)}', this.value)"></td>
          <td>${palletIndex === 0 ? editorPdfInput(`${base}.total_weight`, mpl.total_weight || '') : ''}</td>
          <td>${editorPdfInput(`${base}._pallet_tihi.${palletId}`, mplTiHiSummaryValue(mpl, palletId))}</td>
          <td></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }


  function renderDutchBrosMplSheet(mpl, mplIndex, brand) {
    return renderDecopacMplSheet(mpl, mplIndex, brand, 'DUTCH BROS');
  }

  function renderStandardMplSheet(mpl, mplIndex, template, brand, standaloneBranding) {
    return `
      ${standaloneBranding ? `<header class="standard-mpl-letterhead">
        <div class="standard-mpl-letterhead-copy">
          ${editorPdfInput(
            `packing_lists.${mplIndex}.standard_heading`,
            mpl.standard_heading || 'Packing List',
            'standard-mpl-heading',
            'Packing List',
            'Standard document heading'
          )}
          ${editorPdfInput(
            `packing_lists.${mplIndex}.standard_subheading`,
            mpl.standard_subheading || 'Shipment and Pallet Detail',
            'standard-mpl-subheading',
            'Shipment and Pallet Detail',
            'Standard document subtitle'
          )}
        </div>
        ${renderStandaloneMplLogo(brand)}
      </header>` : ''}
      <div class="mpl-pdf-title">${editorPdfInput(`packing_lists.${mplIndex}.title`, mpl.title || template.title, 'mpl-title-input')}</div>
      <div class="mpl-info-grid two">
        ${renderMplInfoCell(`packing_lists.${mplIndex}.customer_po_number`, 'Customer PO Number', mpl.customer_po_number)}
        ${renderMplInfoCell(`packing_lists.${mplIndex}.pro_number`, 'Pro No', mpl.pro_number)}
      </div>
      <div class="mpl-info-grid four">
        ${renderMplInfoCell(`packing_lists.${mplIndex}.order_no`, 'Order No', mpl.order_no)}
        ${renderMplInfoCell(`packing_lists.${mplIndex}.po_date`, 'PO Date', mpl.po_date)}
        ${renderMplInfoCell(`packing_lists.${mplIndex}.bol_number`, 'BOL No', mpl.bol_number)}
        <div class="mpl-info-cell"><div class="mpl-info-cell-label">Page No</div><input value="Auto" disabled></div>
      </div>
      <div class="mpl-info-grid three">
        ${renderMplInfoCell(`packing_lists.${mplIndex}.total_weight`, 'Total Weight', mpl.total_weight)}
        ${renderMplInfoCell(`packing_lists.${mplIndex}.ship_via`, 'Ship Via', mpl.ship_via)}
        ${renderMplInfoCell(`packing_lists.${mplIndex}.total_pallets`, 'Total Pallets', mpl.total_pallets)}
      </div>
      <div class="mpl-address-grid">
        ${renderMplAddressBox(`packing_lists.${mplIndex}.supplier_info`, 'SUPPLIER INFO:', mpl.supplier_info)}
        ${renderMplAddressBox(`packing_lists.${mplIndex}.bill_to`, 'BILL TO:', mpl.bill_to)}
        ${renderMplAddressBox(`packing_lists.${mplIndex}.ship_to`, 'SHIP TO:', mpl.ship_to)}
      </div>
      <div class="mpl-ship-bar">
        ${renderMplShipCell(`packing_lists.${mplIndex}.customer_no`, 'Customer No', mpl.customer_no || mpl.customer_po_number)}
        ${renderMplShipCell(`packing_lists.${mplIndex}.est_ship_date`, 'Ship Date', mpl.est_ship_date)}
        ${renderMplShipCell(`packing_lists.${mplIndex}.shipping_instructions`, 'Shipping Instructions', mpl.shipping_instructions)}
      </div>
      ${renderMplItemsEditor(mplIndex, mpl.items || [])}`;
  }

  function renderMasterPackingListEditor(draft) {
    const lists = draft.packing_lists || [];
    if (!lists.length) {
      return '<div class="pdf-editor-note">No Master Packing Lists were returned from the XML.</div>';
    }

    return `
      ${lists.map((mpl, index) => {
        const templateId = mplTemplateId(mpl);
        const template = MPL_TEMPLATE_CONFIG[templateId] || MPL_TEMPLATE_CONFIG.kehe;
        const standaloneBranding = isStandaloneMplReferenceMode() && templateId !== 'kehe';
        const brandId = standaloneBranding ? mplBrandId(mpl) : '';
        const brand = MPL_BRAND_CONFIG[brandId] || MPL_BRAND_CONFIG[MPL_DEFAULT_BRAND_ID];
        return `
        <div class="pdf-document-shell" data-pack-label-index="${index}">
          <div class="pdf-sheet-toolbar">
            <span>${escapeHtml(mpl.id || `MPL ${index + 1}`)}</span>
            ${pdfStatusBadge(mpl.status)}
          </div>
          ${renderMplTemplateSelector(mpl, index)}
          ${renderMplBrandSelector(mpl, index)}
          ${renderManualMplTools(mpl, index)}
          ${Array.isArray(mpl.warnings) && mpl.warnings.length
            ? `<div class="editor-warning" style="width:min(100%, 920px)">${mpl.warnings.map(escapeHtml).join('<br>')}</div>`
            : ''}
          <div class="pdf-sheet mpl-sheet${standaloneBranding ? ' mpl-branded' : ''}${['decopac', 'dutch_bros', 'fancy'].includes(templateId) ? ' mpl-breakdown-layout' : ''} mpl-template-${escapeHtml(templateId)}"${standaloneBranding ? ` style="${escapeHtml(mplBrandCssVars(brandId))}"` : ''}>
            ${templateId === 'decopac'
              ? renderDecopacMplSheet(mpl, index, brand)
              : (templateId === 'dutch_bros'
                ? renderDutchBrosMplSheet(mpl, index, brand)
                : (templateId === 'fancy'
                  ? renderDecopacMplSheet(mpl, index, brand, 'FANCY SPRINKLES')
                  : renderStandardMplSheet(mpl, index, template, brand, standaloneBranding)))}
          </div>
        </div>`;
      }).join('')}
        ${lists.map((mpl, index) => renderMplTiHiPopup(mpl, index)).join('')}`;
  }

  function packLevelPrefix(level) {
    return normalizePackagingLevel(level) === 'Inner Pack' ? 'IP' : 'MP';
  }

  const ITF14_DIGIT_PATTERNS = {
    '0': 'nnwwn',
    '1': 'wnnnw',
    '2': 'nwnnw',
    '3': 'wwnnn',
    '4': 'nnwnw',
    '5': 'wnwnn',
    '6': 'nwwnn',
    '7': 'nnnww',
    '8': 'wnnwn',
    '9': 'nwnwn'
  };

  function packLabelDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function packLabelGtin14(value) {
    const digits = packLabelDigits(value);
    if (digits.length === 14) return digits;
    if (digits.length > 14) return digits.slice(-14);
    if (digits.length === 13) return `0${digits}`;
    return digits;
  }

  function buildItf14Runs(value, wideRatio = 2.5) {
    const digits = packLabelGtin14(value);
    const encoded = digits.length % 2 ? `0${digits}` : digits;
    const runs = [];
    const add = (isBar, code = 'n') => runs.push({ isBar, units: code === 'w' ? wideRatio : 1 });
    [true, false, true, false].forEach(isBar => add(isBar, 'n'));
    for (let index = 0; index < encoded.length; index += 2) {
      const bars = ITF14_DIGIT_PATTERNS[encoded[index]] || ITF14_DIGIT_PATTERNS['0'];
      const spaces = ITF14_DIGIT_PATTERNS[encoded[index + 1]] || ITF14_DIGIT_PATTERNS['0'];
      for (let i = 0; i < 5; i += 1) {
        add(true, bars[i]);
        add(false, spaces[i]);
      }
    }
    add(true, 'w');
    add(false, 'n');
    add(true, 'n');
    return { runs, totalUnits: runs.reduce((sum, run) => sum + run.units, 0), digits };
  }

  function renderPackLabelBarcodeSvg(value) {
    const width = 760;
    const height = 260;
    const quiet = 70;
    const panelX = 0;
    const panelY = 0;
    const panelW = width;
    const panelH = height;
    const { runs, totalUnits, digits } = buildItf14Runs(value);
    const unitW = totalUnits ? (panelW - (quiet * 2)) / totalUnits : 0;
    let cursor = panelX + quiet;
    const bars = runs.map(run => {
      const runW = run.units * unitW;
      const x = cursor;
      cursor += runW;
      if (!run.isBar || runW <= 0) return '';
      return `<rect x="${x.toFixed(3)}" y="${panelY}" width="${runW.toFixed(3)}" height="${panelH}" fill="#000000"/>`;
    }).join('');
    const invalidText = digits.length === 14 ? '' : `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" fill="#991b1b">GTIN-14 REQUIRED</text>`;
    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="GTIN-14 ITF-14 barcode preview">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
        ${digits.length === 14 ? bars : invalidText}
      </svg>`;
  }

  function renderPackLabelBarcodePreview(value, index) {
    return `<div class="pack-label-barcode-inner" data-pack-barcode-index="${index}">${renderPackLabelBarcodeSvg(value)}</div>`;
  }

  function refreshPackLabelBarcodePreview(index, value) {
    const target = document.querySelector(`[data-pack-barcode-index="${index}"]`);
    if (target) target.innerHTML = renderPackLabelBarcodeSvg(value);
  }

  function renderPackLabelEditor(draft) {
    const labels = draft.pack_labels || [];
    if (!labels.length) {
      return '<div class="pdf-editor-note">No Case or Inner Pack rows were found. Set Packaging Level to Case or Inner Pack in the GTIN table, then generate Pack Labels again.</div>';
    }
    const showSelectionControls = !draft.table_preview;
    return `
      <div class="pack-label-editor-grid${showSelectionControls ? '' : ' table-preview'}">
      ${labels.map((label, index) => {
        const base = `pack_labels.${index}`;
        const prefix = label.pack_prefix || packLevelPrefix(label.packaging_level);
        const selected = !!label.print_selected;
        const cardClass = showSelectionControls
          ? `pack-label-select-card ${selected ? 'selected' : 'not-selected'}`
          : 'pack-label-preview-card';
        return `
        <div class="pdf-document-shell" data-pack-label-index="${index}">
          ${showSelectionControls ? `
            <div class="pack-label-card-toolbar">
              <span class="pack-label-card-id">${escapeHtml(label.id || `Pack Label ${index + 1}`)}</span>
              ${pdfStatusBadge(label.status)}
            </div>` : ''}
          ${Array.isArray(label.warnings) && label.warnings.length
            ? `<div class="editor-warning">${label.warnings.map(escapeHtml).join('<br>')}</div>`
            : ''}
          <div class="${cardClass}" ${showSelectionControls ? `onclick="togglePackLabelSelection(${index}, event)" title="Click the dotted border area to include or exclude this label from the PDF."` : ''}>
            ${showSelectionControls ? `
              <div class="pack-label-selection-chip">
                <span class="pack-label-selection-box">${selected ? '✓' : ''}</span>
                <span>${selected ? 'Selected for PDF' : 'Not selected'}</span>
              </div>` : ''}
            <div class="pack-label-sheet">
              <div class="pack-label-title">${editorPdfTextarea(`${base}.description`, label.description)}</div>
              <div class="pack-label-meta">
                <label>
                  <span>LOT#</span>
                  ${editorPdfInput(`${base}.lot`, label.lot)}
                </label>
                <label>
                  <span>Best Before:</span>
                  ${editorPdfInput(`${base}.best_before`, label.best_before)}
                </label>
              </div>
              <div class="pack-label-line">
                <div><strong>WEIGHT:</strong></div>
                <div>${editorPdfInput(`${base}.gross_weight_lbs`, label.gross_weight_lbs ?? label.weight_lbs ?? '')}</div>
              </div>
              <div class="pack-label-line">
                <div><strong>${escapeHtml(prefix)} Case Qty:</strong></div>
                <div>${editorPdfInput(`${base}.case_qty`, label.case_qty)}</div>
              </div>
              <div class="pack-label-barcode-box">${renderPackLabelBarcodePreview(label.gtin, index)}</div>
              <div class="pack-label-gtin">${editorPdfInput(`${base}.gtin`, label.gtin)}</div>
            </div>
          </div>
          ${renderCopiesControl(`${base}.copies`, label.copies || 2, 'Minimum 2 copies for two-side case placement.', 2)}
        </div>`;
      }).join('')}
      </div>`;
  }

  function fitPdfEditorInputText(root) {
    root?.querySelectorAll('input, textarea').forEach(input => {
      input.style.removeProperty('font-size');
      let size = Number.parseFloat(window.getComputedStyle(input).fontSize) || 16;
      const minimum = input.tagName === 'TEXTAREA' ? 10 : 8;
      while ((input.scrollWidth > input.clientWidth + 2 || input.scrollHeight > input.clientHeight + 2) && size > minimum) {
        size -= 0.5;
        input.style.fontSize = `${size}px`;
      }
    });
  }

  function togglePackLabelSelection(index, event) {
    if (!activeKeheDocumentDraft || !Array.isArray(activeKeheDocumentDraft.pack_labels)) return;
    if (event && event.target && event.target.closest('input, textarea, select, button, a')) return;
    const label = activeKeheDocumentDraft.pack_labels[index];
    if (!label) return;
    label.print_selected = !label.print_selected;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  }

  function setPalletLabelManualSource(note = '') {
    if (!activeKeheDocumentDraft) return;
    activeKeheDocumentDraft.palletization_source = 'Manual';
    activeKeheDocumentDraft.source_note = note || `Pallet Label edited manually. MPL source: ${palletSourceLabel(keheMplPalletizationSource)}.`;
    kehePalletLabelSource = 'Manual';
    keheLastPalletLabelDraft = activeKeheDocumentDraft;
  }

  function refreshPalletLabelTotals(draft) {
    const pallets = draft?.pallets || [];
    const total = String(pallets.length || 1);
    pallets.forEach((pallet, index) => {
      if (!String(pallet.pallet_number || '').trim()) pallet.pallet_number = String(index + 1);
      pallet.total_pallets = total;
      pallet.copies = pallet.copies || 2;
      pallet.id = pallet.id || `PALLET-${index + 1}`;
    });
  }

  function nextPalletLabelNumber(pallets) {
    const nums = (pallets || []).map(p => Number(String(p.pallet_number || '').replace(/\D/g, ''))).filter(n => Number.isFinite(n) && n > 0);
    return nums.length ? Math.max(...nums) + 1 : ((pallets || []).length + 1);
  }

  function addPalletLabelPallet() {
    if (!activeKeheDocumentDraft) return;
    activeKeheDocumentDraft.pallets = Array.isArray(activeKeheDocumentDraft.pallets) ? activeKeheDocumentDraft.pallets : [];
    const pallets = activeKeheDocumentDraft.pallets;
    const base = pallets[pallets.length - 1] || {};
    const next = String(nextPalletLabelNumber(pallets));
    const newIndex = pallets.length;
    pallets.push({
      id: `PALLET-${pallets.length + 1}`,
      status: 'Needs Review',
      dc: base.dc || '',
      title: 'PALLET PLACARD',
      date: base.date || '',
      ship_from: base.ship_from || '',
      ship_to: base.ship_to || '',
      billing: base.billing || '',
      customer_po_numbers: '',
      bol_number: base.bol_number || '',
      pro_number: base.pro_number || '',
      carrier: base.carrier || '',
      pallet_number: next,
      total_pallets: String(pallets.length + 1),
      carton_count: '',
      placement_note: 'Place one placard on the front and one placard on the back of the pallet.',
      copies: 2,
      source_files: base.source_files || [],
      warnings: ['Manual pallet added. Verify PO numbers and pallet count before printing.']
    });
    refreshPalletLabelTotals(activeKeheDocumentDraft);
    setPalletLabelManualSource();
    renderKeheUnifiedReport(keheLastMplDraft || activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    focusAndScrollIntoView(`[data-pallet-label-index="${newIndex}"]`, 'input, textarea');
    setStatus('Pallet Label pallet group added. Source now shows Manual.', 'info');
  }

  function removePalletLabelPallet(index) {
    if (!activeKeheDocumentDraft || !Array.isArray(activeKeheDocumentDraft.pallets)) return;
    activeKeheDocumentDraft.pallets.splice(index, 1);
    refreshPalletLabelTotals(activeKeheDocumentDraft);
    setPalletLabelManualSource();
    renderKeheUnifiedReport(keheLastMplDraft || activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    setStatus('Pallet Label pallet group removed. Source now shows Manual.', 'info');
  }

  function renderDocumentEditor(type, draft) {
    const cfg = KEHE_DOCUMENT_CONFIG[type];
    const isPartnerLabelEditor = type === 'partnerPackLabels' || type === 'partnerPalletLabels';
    document.getElementById('document-editor-title').textContent = `Review & Edit ${cfg.label}`;
    if (type === 'masterPackingList') {
      const nameInput = document.getElementById('mpl-draft-name-input');
      const nextName = defaultMplDraftName(draft);
      if (nameInput && String(nameInput.value || '').trim() !== nextName) {
        nameInput.value = nextName;
      }
      if (!draft?._saved_draft_id) updateMplSaveState('unsaved');
    }
    updateMplSaveButtonState(type);
    const isMplEditor = type === 'masterPackingList';
    document.getElementById('mpl-history-actions')?.classList.toggle('hidden', !isMplEditor);
    document.getElementById('mpl-review-status-wrap')?.classList.toggle('hidden', !isMplEditor);
    if (isMplEditor) {
      initializeMplHistory(draft);
      const reviewStatus = String(draft?.review_status || draft?.packing_lists?.[0]?.review_status || 'DRAFT').toUpperCase();
      const reviewSelect = document.getElementById('mpl-review-status');
      if (reviewSelect) reviewSelect.value = ['DRAFT', 'REVIEWED', 'APPROVED'].includes(reviewStatus) ? reviewStatus : 'DRAFT';
    }
    const renderBtn = document.getElementById('btn-render-edited-document');
    if (renderBtn) {
      renderBtn.classList.toggle('hidden', type === 'masterPackingList');
      renderBtn.textContent = 'Generate PDF';
    }
    const body = document.getElementById('document-editor-body');
    const dialog = document.querySelector('#document-editor-panel .editor-dialog');
    if (dialog) dialog.classList.add('pdf-editor-dialog');
    body.className = `editor-body pdf-editor-body ${isPartnerLabelEditor ? 'partner-label-pdf-editor-body' : (type === 'palletLabel' ? 'pallet-pdf-editor-body' : (type === 'packLabels' ? 'pack-label-pdf-editor-body' : 'mpl-pdf-editor-body'))}`;
    if (isPartnerLabelEditor) {
      body.innerHTML = renderPartnerLabelsEditor(type === 'partnerPalletLabels' ? 'palletLabel' : 'packLabels');
    } else if (type === 'palletLabel') {
      body.innerHTML = renderPalletLabelEditor(draft);
    } else if (type === 'packLabels') {
      body.innerHTML = renderPackLabelEditor(draft);
    } else {
      body.innerHTML = renderMasterPackingListEditor(draft);
    }
    window.requestAnimationFrame(() => {
      fitPdfEditorInputText(body);
      if (isPartnerLabelEditor) body.querySelectorAll('.partner-label-editor-canvas').forEach(fitB2BLabelPreview);
    });
    enhanceSearchableSelects(body);
    if (type === 'masterPackingList') {
      scheduleAllMplLiveTiHiRefresh();
      renderWorkflowWarningsInEditor();
    }
  }

  function updateDraftValue(input) {
    if (!activeKeheDocumentDraft) return;
    const path = input.getAttribute('data-draft-path');
    if (!path) return;
    const parts = path.split('.');
    let ref = activeKeheDocumentDraft;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
      ref = ref[key];
      if (ref == null) return;
    }
    const last = parts[parts.length - 1];
    ref[last] = input.value;
    const packCopiesMatch = path.match(/^pack_labels\.(\d+)\.copies$/);
    if (packCopiesMatch) {
      const copies = normalizeManualCopies(input.value);
      ref[last] = copies;
      input.value = String(copies);
    }
    const packGtinMatch = path.match(/^pack_labels\.(\d+)\.gtin$/);
    if (packGtinMatch) {
      refreshPackLabelBarcodePreview(Number(packGtinMatch[1]), input.value);
    }
    window.requestAnimationFrame(() => fitPdfEditorInputText(document.getElementById('document-editor-body')));
    if (activeKeheDocumentType === 'palletLabel' && /^pallets\.\d+\.(pallet_number|total_pallets|customer_po_numbers)$/.test(path)) {
      setPalletLabelManualSource();
      renderKeheUnifiedReport(keheLastMplDraft || activeKeheDocumentDraft);
    }
    if (activeKeheDocumentType === 'masterPackingList' && /^packing_lists\.\d+\./.test(path)) {
      const mplMatch = path.match(/^packing_lists\.(\d+)\./);
      const mpl = mplMatch ? getMpl(Number(mplMatch[1])) : null;
      if (mpl) {
        if (mpl.manual_mpl) {
          markMplPalletizationSource(
            mpl,
            'Manual',
            isStandaloneMplReferenceMode()
              ? 'Manual MPL created from standalone Product Master Table and Directory.'
              : 'Manual MPL created from GTIN / Packaging Master Table and KeHE DC Directory.'
          );
        }
        keheLastMplDraft = activeKeheDocumentDraft;
        renderKeheUnifiedReport(activeKeheDocumentDraft);
        if (path.includes('.items.') || path.includes('._tihi_')) {
          scheduleMplLiveTiHiRefresh(Number(mplMatch[1]));
        }
      }
      captureMplHistoryCheckpoint();
      if (selectedKit === 'partners') markPartnerPreviewStale('masterPackingList');
    }
  }

  function dragMplItem(event, mplIndex, itemIndex) {
    event.dataTransfer.setData('text/plain', JSON.stringify({ mplIndex, itemIndex }));
    event.dataTransfer.effectAllowed = 'move';
  }

  function dropMplItem(event, targetMplIndex, palletId) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    let payload = null;
    try {
      payload = JSON.parse(event.dataTransfer.getData('text/plain') || '{}');
    } catch (_err) {
      payload = null;
    }
    if (!payload || Number(payload.mplIndex) !== Number(targetMplIndex)) return;
    moveMplItemToPallet(targetMplIndex, Number(payload.itemIndex), palletId);
  }

  function moveMplItemToPallet(mplIndex, itemIndex, palletId) {
    const mpl = getMpl(mplIndex);
    if (!mpl || !Array.isArray(mpl.items) || !mpl.items[itemIndex]) return;
    ensureMplPalletState(mpl);
    captureXmlPalletSnapshot(mpl);
    const cleanPalletId = normalizePalletId(palletId);
    mpl.items[itemIndex].location_on_pallet = cleanPalletId;
    if (cleanPalletId) {
      if (!mpl._pallet_ids.includes(cleanPalletId)) mpl._pallet_ids.push(cleanPalletId);
      mpl.items[itemIndex].pallet_weight = (mpl._pallet_weights && mpl._pallet_weights[cleanPalletId]) || mpl.items[itemIndex].pallet_weight || '';
    } else {
      mpl.items[itemIndex].pallet_weight = '';
    }
    setMplManualSource(mpl);
    syncMplLineNumbers(mpl);
    captureMplHistoryCheckpoint();
    if (selectedKit === 'partners') markPartnerPreviewStale('masterPackingList');
    keheLastMplDraft = activeKeheDocumentDraft;
    renderKeheUnifiedReport(activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  }

  function addMplPallet(mplIndex) {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    ensureMplPalletState(mpl);
    captureXmlPalletSnapshot(mpl);
    const numericIds = (mpl._pallet_ids || []).map(id => Number(id)).filter(n => Number.isFinite(n));
    let next = numericIds.length ? Math.max(...numericIds) + 1 : 1;
    while ((mpl._pallet_ids || []).includes(String(next))) next += 1;
    const nextPalletId = String(next);
    mpl._pallet_ids.push(nextPalletId);
    mpl.total_pallets = String(mpl._pallet_ids.length || 1);
    setMplManualSource(mpl);
    captureMplHistoryCheckpoint();
    if (selectedKit === 'partners') markPartnerPreviewStale('masterPackingList');
    keheLastMplDraft = activeKeheDocumentDraft;
    renderKeheUnifiedReport(activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    focusAndScrollIntoView(`[data-mpl-index="${mplIndex}"][data-pallet-id="${cssEscape(nextPalletId)}"]`, 'input, button');
  }

  function setMplPalletWeight(mplIndex, palletId, value) {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    ensureMplPalletState(mpl);
    const cleanPalletId = normalizePalletId(palletId);
    mpl._pallet_weights[cleanPalletId] = value;
    (mpl.items || []).forEach(item => {
      if (normalizePalletId(item.location_on_pallet) === cleanPalletId) {
        item.pallet_weight = value;
      }
    });
    captureMplHistoryCheckpoint();
    if (selectedKit === 'partners') markPartnerPreviewStale('masterPackingList');
  }

  function addMplItem(mplIndex, palletId = '') {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    ensureMplPalletState(mpl);
    captureXmlPalletSnapshot(mpl);
    mpl.items = mpl.items || [];
    const cleanPalletId = normalizePalletId(palletId);
    if (cleanPalletId && !mpl._pallet_ids.includes(cleanPalletId)) mpl._pallet_ids.push(cleanPalletId);
    const defaultPallet = cleanPalletId || (mpl.manual_mpl ? ((mpl._pallet_ids && mpl._pallet_ids[0]) || '1') : '');
    const newIndex = mpl.items.length;
    mpl.items.push({
      ...blankManualMplItem(mpl.items.length + 1, defaultPallet),
      item_number: '',
    });
    mpl.total_pallets = String(mpl._pallet_ids.length || 1);
    setMplManualSource(mpl);
    captureMplHistoryCheckpoint();
    if (selectedKit === 'partners') markPartnerPreviewStale('masterPackingList');
    keheLastMplDraft = activeKeheDocumentDraft;
    renderKeheUnifiedReport(activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    focusAndScrollIntoView(`[data-mpl-index="${mplIndex}"][data-item-index="${newIndex}"]`, 'select, input, textarea');
  }

  function deleteMplItem(mplIndex, itemIndex) {
    const mpl = getMpl(mplIndex);
    if (!mpl || !Array.isArray(mpl.items)) return;
    captureXmlPalletSnapshot(mpl);
    mpl.items.splice(itemIndex, 1);
    setMplManualSource(mpl);
    syncMplLineNumbers(mpl);
    captureMplHistoryCheckpoint();
    if (selectedKit === 'partners') markPartnerPreviewStale('masterPackingList');
    keheLastMplDraft = activeKeheDocumentDraft;
    renderKeheUnifiedReport(activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  }


  function collectMplPalletIds(mpl) {
    ensureMplPalletState(mpl);
    const ids = [];
    (mpl.items || []).forEach(item => {
      const id = normalizePalletId(item.location_on_pallet);
      if (id && !ids.includes(id)) ids.push(id);
    });
    (mpl._pallet_ids || []).forEach(id => {
      const clean = normalizePalletId(id);
      if (clean && !ids.includes(clean)) ids.push(clean);
    });
    return ids.sort((a, b) => Number(a) - Number(b));
  }

  function poNumbersForMplPallet(mpl, palletId) {
    const values = [];
    (mpl.items || []).forEach(item => {
      if (normalizePalletId(item.location_on_pallet) !== palletId) return;
      const raw = item.customer_po_number || item.po || mpl.customer_po_number || '';
      String(raw).split(/[;,\n]/).map(v => v.trim()).filter(Boolean).forEach(v => {
        if (!values.includes(v)) values.push(v);
      });
    });
    if (!values.length && mpl.customer_po_number) values.push(mpl.customer_po_number);
    return values.join('\n');
  }

  function buildPalletLabelDraftFromMplDraft(mplDraft) {
    const pallets = [];
    const warnings = [];
    const lists = mplDraft?.packing_lists || [];
    lists.forEach((mpl, mplIndex) => {
      const palletIds = collectMplPalletIds(mpl);
      const total = String(palletIds.length || 1);
      palletIds.forEach(palletId => {
        pallets.push({
          id: `PALLET-${pallets.length + 1}`,
          status: mpl.status || 'Ready',
          dc: mpl.dc || '',
          title: 'PALLET PLACARD',
          date: mpl.est_ship_date || '',
          ship_from: mpl.supplier_info || '',
          ship_to: mpl.ship_to || '',
          billing: mpl.bill_to || '',
          customer_po_numbers: poNumbersForMplPallet(mpl, palletId),
          bol_number: mpl.bol_number || '',
          pro_number: mpl.pro_number || '',
          carrier: mpl.ship_via || '',
          pallet_number: palletId,
          total_pallets: total,
          carton_count: '',
          placement_note: 'Place one placard on the front and one placard on the back of the pallet.',
          copies: 2,
          source_files: mpl.source_files || [],
          source_mpl: mpl.id || `MPL-${mplIndex + 1}`,
          warnings: []
        });
      });
    });
    if (!pallets.length) {
      warnings.push('No MPL palletization found. Use Auto Palletize or generate MPL first.');
    }
    const source = palletSourceLabel(keheMplPalletizationSource || lists[0]?.palletization_source || 'MPL');
    return {
      document_type: 'kehe_pallet_label',
      version: 3,
      summary: { groups: pallets.length, from_mpl: true },
      warnings,
      palletization_source: source,
      source_note: pallets.length
        ? `Using palletization from Master Packing List preview. Source: ${source}.`
        : 'No MPL palletization found. Use Auto Palletize or generate MPL first.',
      pallets
    };
  }

  async function prepareKeheDocument(type) {
    if (selectedKit !== 'kehe' || !xmlFiles.length) return;
    const cfg = KEHE_DOCUMENT_CONFIG[type];
    activeKeheDocumentType = type;
    activeKeheDocumentDraft = null;

    setStatus(`Preparing editable ${cfg.label} draft\u2026`, 'info');
    try {
      if (selectedKit === 'kehe') {
        try {
          if (keheProductMasterLoadPromise) await keheProductMasterLoadPromise;
          if (!getKeheProductMasterRows().length) {
            keheProductMasterLoadPromise = loadKeheProductMasterFromBackend();
            await keheProductMasterLoadPromise;
          }
        } catch (_err) {}
      }

      const form = new FormData();
      xmlFiles.forEach(f => form.append('xml_files', f));
      if (selectedKit === 'kehe') {
        form.append('product_master_json', JSON.stringify(getKeheProductMasterRows()));
      }

      if (type === 'palletLabel' && keheLastMplDraft) {
        activeKeheDocumentDraft = buildPalletLabelDraftFromMplDraft(keheLastMplDraft);
        keheLastPalletLabelDraft = activeKeheDocumentDraft;
        kehePalletLabelSource = activeKeheDocumentDraft.palletization_source || 'MPL';
        renderKeheUnifiedReport(keheLastMplDraft);
        renderDocumentEditor(type, activeKeheDocumentDraft);
        openDocumentEditor();
        setStatus('Pallet Label draft ready from Master Packing List palletization.', 'info');
        return;
      }

      const res = await fetchWithTimeout(cfg.prepareEndpoint, { method: 'POST', body: form }, 120000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus('Error: ' + (payload.detail || `Could not prepare ${cfg.label}.`), 'error');
        return;
      }
      activeKeheDocumentDraft = payload;
      activeKeheDocumentDraft.product_master = getKeheProductMasterRows();
      if (type === 'palletLabel' && !keheLastMplDraft) {
        activeKeheDocumentDraft.source_note = 'No MPL palletization found. Use Auto Palletize or generate MPL first.';
        activeKeheDocumentDraft.palletization_source = 'XML';
        keheLastPalletLabelDraft = activeKeheDocumentDraft;
        kehePalletLabelSource = 'XML';
      }
      applyProductMasterToDraft(activeKeheDocumentDraft, false);
      if (type === 'masterPackingList') {
        captureXmlPalletSnapshots(activeKeheDocumentDraft);
        const firstMpl = activeKeheDocumentDraft.packing_lists?.[0] || {};
        keheLastMplDraft = activeKeheDocumentDraft;
        keheMplPalletizationSource = firstMpl.palletization_source || 'XML';
      }
      if (selectedKit === 'kehe') {
        renderKeheUnifiedReport(activeKeheDocumentDraft);
      }
      renderDocumentEditor(type, payload);
      openDocumentEditor();
      setStatus(`${cfg.label} draft ready. Review/edit fields before generating PDF.`, 'info');
    } catch (err) {
      console.error('KeHE document prepare failed', err);
      setStatus('Error: ' + (err.message || `Could not prepare ${cfg.label}.`), 'error');
    }
  }

  function humanizeKey(key) {
    return String(key || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function normalizeKeheExtractedSource(source) {
    if (!source) return { headers: [], items: [] };

    if (Array.isArray(source.extracted_headers) || Array.isArray(source.extracted_items)) {
      return {
        headers: source.extracted_headers || [],
        items: source.extracted_items || []
      };
    }

    if (Array.isArray(source.pallets)) {
      return {
        headers: source.pallets.map(p => ({
          document_type: 'Pallet Placard',
          id: p.id || '',
          status: p.status || '',
          source_file: (p.source_files || [''])[0],
          dc: p.dc || '',
          customer_po_numbers: p.customer_po_numbers || '',
          ship_date: p.date || '',
          carrier: p.carrier || '',
          pro_number: p.pro_number || '',
          bol_number: p.bol_number || '',
          carton_count: p.carton_count || '',
          pack_count: p.pack_count || p.carton_count || '',
          item_rows: p.item_rows || '',
          pallet_number: p.pallet_number || '',
          total_pallets: p.total_pallets || '',
          copies: p.copies || '',
          ship_from: p.ship_from || '',
          ship_to: p.ship_to || '',
          billing: p.billing || '',
          placement_note: p.placement_note || '',
          warnings: (p.warnings || []).join('; ')
        })),
        items: []
      };
    }

    if (Array.isArray(source.pack_labels)) {
      const headers = (source.extracted_headers || []).length ? source.extracted_headers : [{
        document_type: 'Pack Labels',
        status: 'Ready',
        source_file: (source.pack_labels[0] || {}).source_file || '',
        item_rows: source.pack_labels.length,
        warnings: (source.warnings || []).join('; ')
      }];
      const items = (source.extracted_items || []).slice();
      source.pack_labels.forEach(label => {
        items.push({
          source_file: label.source_file || '',
          gtin: label.gtin || '',
          item_number: label.sku || '',
          description: label.description || '',
          packaging_level: label.packaging_level || '',
          lot: label.lot || '',
          expiration_date: label.best_before || '',
          qty: label.case_qty || '',
          pallet_weight: label.weight_lbs || '',
          notes: (label.warnings || []).join('; ')
        });
      });
      return { headers, items };
    }

    if (Array.isArray(source.packing_lists)) {
      const headers = [];
      const items = [];
      source.packing_lists.forEach(m => {
        headers.push({
          document_type: 'Master Packing List',
          id: m.id || '',
          status: m.status || '',
          source_file: (m.source_files || [''])[0],
          dc: m.dc || '',
          customer_po_numbers: m.customer_po_number || '',
          po_date: m.po_date || '',
          order_no: m.order_no || '',
          pro_number: m.pro_number || '',
          bol_number: m.bol_number || '',
          ship_date: m.est_ship_date || '',
          expected_delivery_date: m.expected_delivery_date || '',
          ship_via: m.ship_via || '',
          total_weight: m.total_weight || '',
          carton_count: m.carton_count || '',
          pack_count: m.pack_count || m.carton_count || '',
          total_pallets: m.total_pallets || '',
          supplier_info: m.supplier_info || '',
          bill_to: m.bill_to || '',
          ship_to: m.ship_to || '',
          shipping_instructions: m.shipping_instructions || '',
          item_rows: (m.items || []).length,
          warnings: (m.warnings || []).join('; ')
        });
        (m.items || []).forEach(item => {
          items.push({
            source_file: (m.source_files || [''])[0],
            dc: m.dc || '',
            po: m.customer_po_number || '',
            line: item.line || '',
            location_on_pallet: item.location_on_pallet || '',
            item_number: item.item_number || '',
            upc: item.upc || '',
            case_upc: item.case_upc || '',
            gtin: item.gtin || '',
            sku: item.sku || '',
            description: item.description || '',
            packaging_level: item.packaging_level || '',
            dimensions_in: item.dimensions_in || '',
            unit_weight_lbs: item.unit_weight_lbs || '',
            calculated_weight_lbs: item.calculated_weight_lbs || '',
            lot: item.lot || '',
            expiration_date: item.expiration_date || '',
            uom: item.uom || '',
            qty_on_pallet: item.qty_on_pallet || '',
            total_ordered: item.total_ordered || '',
            total_shipped: item.total_shipped || '',
            pallet_weight: item.pallet_weight || '',
            notes: item.notes || ''
          });
        });
      });
      return { headers, items };
    }

    return { headers: [], items: [] };
  }

  function renderKeheFieldCard(row, index) {
    const preferred = [
      'document_type', 'source_file', 'status', 'dc', 'dc_name', 'ship_to_gln',
      'customer_po_numbers', 'po_date', 'order_no', 'vendor_number', 'bsn', 'bsn_date',
      'ship_date', 'expected_delivery_date', 'carrier', 'scac', 'pro_number', 'bol_number',
      'carton_count', 'pack_count', 'item_rows', 'total_weight', 'cube', 'total_pallets',
      'ship_via', 'ship_from', 'xml_ship_to', 'final_ship_to', 'ship_to', 'bill_to',
      'billing', 'supplier_info', 'copies', 'placement_note', 'warnings'
    ];
    const keys = [...preferred.filter(k => Object.prototype.hasOwnProperty.call(row, k))];
    Object.keys(row || {}).forEach(k => { if (!keys.includes(k)) keys.push(k); });

    return `
      <div class="kehe-extracted-card">
        <div class="kehe-extracted-card-title">Extracted Header ${index + 1}</div>
        <div class="kehe-field-grid">
          ${keys.map(key => `
            <div class="kehe-field">
              <strong>${escapeHtml(humanizeKey(key))}</strong>
              <span>${escapeHtml(row[key] || '—')}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function renderKeheItemsTable(items) {
    if (!items.length) return '';
    const keys = [
      'source_file', 'dc', 'po', 'carton', 'sscc', 'line', 'location_on_pallet',
      'item_number', 'upc', 'case_upc', 'gtin', 'sku', 'description', 'packaging_level', 'dimensions_in', 'unit_weight_lbs', 'calculated_weight_lbs', 'qty', 'qty_on_pallet',
      'total_ordered', 'total_shipped', 'uom', 'lot', 'expiration_date',
      'manufacture_date', 'plant', 'pallet_weight', 'notes'
    ].filter(key => items.some(row => Object.prototype.hasOwnProperty.call(row, key)));

    return `
      <div class="kehe-extracted-card">
        <div class="kehe-extracted-card-title">Extracted Item Rows (${items.length})</div>
        <div class="kehe-items-table-wrap">
          <table class="kehe-items-table">
            <thead><tr>${keys.map(key => `<th>${escapeHtml(humanizeKey(key))}</th>`).join('')}</tr></thead>
            <tbody>
              ${items.map(row => `<tr>${keys.map(key => `<td>${escapeHtml(row[key] || '—')}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function renderKeheExtractedTable(source) {
    if (selectedKit !== 'kehe') return;
    const panel = document.getElementById('kehe-extracted-panel');
    const scroll = document.getElementById('kehe-extracted-scroll');
    if (!panel || !scroll) return;
    panel.classList.add('visible');

    const extracted = normalizeKeheExtractedSource(source);
    const headers = extracted.headers || [];
    const items = extracted.items || [];
    correctSingleHeaderCounts(headers, items);

    if (!headers.length && !items.length) {
      scroll.innerHTML = '<div class="empty-row">No extracted KeHE data available yet.</div>';
      return;
    }

    scroll.innerHTML = [
      ...headers.map((row, index) => renderKeheFieldCard(row, index)),
      renderKeheItemsTable(items)
    ].filter(Boolean).join('');
  }

  function getKeheSourceScore(source) {
    const extracted = normalizeKeheExtractedSource(source);
    return (extracted.headers || []).length * 10 + (extracted.items || []).length;
  }

  function rememberKeheExtractedSource(source) {
    if (source && source.summary && source.summary.generated_labels) {
      keheGeneratedLabelCount = Number(source.summary.generated_labels) || keheGeneratedLabelCount;
    }
    const score = getKeheSourceScore(source);
    if (!score) return;
    if (!keheCurrentExtractedSource || score >= getKeheSourceScore(keheCurrentExtractedSource)) {
      keheCurrentExtractedSource = source;
    }
  }

  function firstLine(value) {
    return String(value || '').split('\n').find(Boolean) || '';
  }

  function keheCellValue(row, key) {
    if (!row) return '';
    if (key === 'ship_to_name') {
      return row.ship_to_name || firstLine(row.final_ship_to) || firstLine(row.ship_to) || firstLine(row.xml_ship_to);
    }
    return row[key] ?? '';
  }

  function toNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function getActualCartonPackCount(headers) {
    const generatedCount = toNumber(keheGeneratedLabelCount);
    if (generatedCount) return generatedCount;
    const packCount = headers.reduce((sum, row) => sum + toNumber(row.pack_count), 0);
    if (packCount) return packCount;
    return headers.reduce((sum, row) => sum + toNumber(row.carton_count), 0);
  }

  function getActualItemRowCount(headers, items) {
    if (items && items.length) return items.length;
    return headers.reduce((sum, row) => sum + toNumber(row.item_rows), 0);
  }

  function correctSingleHeaderCounts(headers, items) {
    // Prevent the UI from showing aggregated MPL item-line count as cartons.
    // For a one-XML run, generated label count equals the actual SSCC/carton count.
    const generatedCount = toNumber(keheGeneratedLabelCount);
    if (!generatedCount || headers.length !== 1) return;
    const row = headers[0];
    row.pack_count = String(generatedCount);
    row.carton_count = String(generatedCount);
    if (!row.item_rows) {
      const itemRows = getActualItemRowCount(headers, items);
      if (itemRows) row.item_rows = String(itemRows);
    }
  }

  function renderKeheOutputSummary(headers, items) {
    correctSingleHeaderCounts(headers, items);
    const headerCount = headers.length;
    const itemCount = getActualItemRowCount(headers, items);
    const actualCartonPacks = getActualCartonPackCount(headers);
    const outputCards = [
      ['XML Groups', headerCount || '—', 'output-count'],
      ['Cartons / Packs', actualCartonPacks || '—', 'output-count'],
      ['Item Rows', itemCount || '—', 'output-count'],
      ['KeHE Labels', kehePreviewUrls.labels ? 'Preview ready' : 'Not generated', kehePreviewUrls.labels ? 'output-ready' : 'output-pending'],
      ['Pallet Label', kehePreviewUrls.palletLabel ? 'Preview ready' : 'Not generated', kehePreviewUrls.palletLabel ? 'output-ready' : 'output-pending'],
      ['MPL', kehePreviewUrls.masterPackingList ? 'Preview ready' : 'Not generated', kehePreviewUrls.masterPackingList ? 'output-ready' : 'output-pending'],
      ['Pack Labels', kehePreviewUrls.packLabels ? 'Preview ready' : 'Not generated', kehePreviewUrls.packLabels ? 'output-ready' : 'output-pending'],
      ['MPL Palletization', palletSourceLabel(keheMplPalletizationSource), 'output-count'],
      ['Pallet Label Source', palletSourceLabel(kehePalletLabelSource), 'output-count'],
      ['Palletization Match', getPalletizationMismatchText(), getPalletizationMismatchText().startsWith('No') || getPalletizationMismatchText() === '—' ? 'output-ready' : 'output-pending']
    ];
    document.getElementById('match-summary').innerHTML = outputCards.map(([label, value, cls]) => {
      return `<div class="match-pill ${cls}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`;
    }).join('');
  }

  function renderKeheUnifiedReport(source) {
    if (selectedKit !== 'kehe') return;

    rememberKeheExtractedSource(source);
    const sourceToUse = keheCurrentExtractedSource || source;
    const extracted = normalizeKeheExtractedSource(sourceToUse);
    const headers = extracted.headers || [];
    const items = extracted.items || [];
    correctSingleHeaderCounts(headers, items);
    const columns = KEHE_UNIFIED_COLUMNS;

    document.getElementById('report-title').textContent = 'KeHE XML Data & Output Status';
    document.getElementById('match-rules').textContent = 'Extracted XML data stays visible here. Generate buttons only update output status and preview availability.';
    setReportTableMode('kehe');
    document.getElementById('match-table-head').innerHTML = '<tr>' + columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('') + '</tr>';

    currentReport = { rows: headers, extracted_items: items };
    currentCsvColumns = KEHE_UNIFIED_CSV_COLUMNS;
    currentCsvName = 'kehe_extracted_headers.csv';

    renderKeheOutputSummary(headers, items);
    renderKeheExtractedTable(sourceToUse);

    const bodyEl = document.getElementById('match-table-body');
    if (!headers.length) {
      bodyEl.innerHTML = `<tr><td class="empty-row" colspan="${columns.length}">Upload KeHE XML, then generate labels or prepare a document to see extracted shipment data.</td></tr>`;
      setExportReady(false);
      return;
    }

    bodyEl.innerHTML = headers.map(rawRow => {
      const row = rawRow || {};
      return '<tr>' + columns.map(([key]) => {
        const value = keheCellValue(row, key);
        if (key === 'status') return `<td>${formatStatusCell(value || 'Ready')}</td>`;
        return `<td>${escapeHtml(value || '—')}</td>`;
      }).join('') + '</tr>';
    }).join('');
    setExportReady(true);
  }

  function finalizeMplPalletDraft() {
    if (!activeKeheDocumentDraft || !Array.isArray(activeKeheDocumentDraft.packing_lists)) return;
    activeKeheDocumentDraft.packing_lists.forEach(mpl => {
      ensureMplPalletState(mpl);
      mpl._tihi_constraints = normalizeTiHiConstraints(mpl._tihi_constraints || {});
      if (!mpl._tihi_pallet_constraints || typeof mpl._tihi_pallet_constraints !== 'object') {
        mpl._tihi_pallet_constraints = {};
      }
      Object.keys(mpl._tihi_pallet_constraints).forEach(palletId => {
        mpl._tihi_pallet_constraints[palletId] = normalizeTiHiConstraints(mpl._tihi_pallet_constraints[palletId] || {});
      });
      const assignedIds = [];
      (mpl.items || []).forEach(item => {
        const id = normalizePalletId(item.location_on_pallet);
        if (id && !assignedIds.includes(id)) assignedIds.push(id);
        if (id && mpl._pallet_weights && mpl._pallet_weights[id]) {
          item.pallet_weight = mpl._pallet_weights[id];
        }
      });
      mpl.total_pallets = String((mpl._pallet_ids && mpl._pallet_ids.length) || assignedIds.length || 1);
    });
  }

  async function renderEditedKeheDocument(options = {}) {
    if (!activeKeheDocumentType || !activeKeheDocumentDraft) return;
    if (selectedKit === 'partners' && ['partnerPackLabels', 'partnerPalletLabels'].includes(activeKeheDocumentType)) {
      const kind = activeKeheDocumentType === 'partnerPalletLabels' ? 'palletLabel' : 'packLabels';
      const btn = document.getElementById('btn-render-edited-document');
      if (btn) btn.disabled = true;
      try {
        if (!(await confirmDocumentReadiness('partners'))) return;
        showWorkflowProgress(3, `Preparing ${partnerLabelKindName(kind).toLowerCase()}…`);
        setStatus(`Generating ${partnerLabelKindName(kind)} from your edited label layouts…`, 'info');
        await renderPartnerLabelsPreview(kind);
        updateWorkflowProgress('Opening preview', 'Opening the edited label preview…');
        closeDocumentEditor(false);
        await openPartnerPreview(kind);
        setStatus(`${partnerLabelKindName(kind)} PDF is ready.`, 'success');
        closeWorkflowProgress();
        showPrintSummary('partners');
      } catch (err) {
        closeWorkflowProgress();
        setStatus(`Label generation failed: ${err?.message || 'unknown error'}`, 'error');
      } finally {
        partnerEditingLabelKind = '';
        if (btn) btn.disabled = false;
      }
      return;
    }
    if (selectedKit === 'partners' && partnerEditingMpl && activeKeheDocumentType === 'masterPackingList') {
      const btn = document.getElementById('btn-render-edited-document');
      const saveGenerateBtn = document.getElementById('btn-save-mpl-draft');
      const workingButtons = [btn, saveGenerateBtn].filter(Boolean);
      workingButtons.forEach(button => { button.disabled = true; });
      const saveBeforeGenerate = !!options.saveMplDraft;
      try {
        if (!(await confirmDocumentReadiness('partners'))) return;
        showWorkflowProgress(4, 'Rendering the packing list and Ti-Hi…');
        partnerMplDraft = activeKeheDocumentDraft;
        setStatus('Rendering the packing-list preview from your edited values…', 'info');
        await renderPartnerMplPreview();
        if (saveBeforeGenerate) {
          updateWorkflowProgress('Saving MPL', 'Saving the generated MPL draft…');
          const saved = await saveActiveMplDraft({ savingMessage: 'Saving MPL draft...', successMessage: 'MPL draft saved.' });
          if (!saved) { closeWorkflowProgress(); return; }
        }
        updateWorkflowProgress('Opening preview', 'Opening the packing-list preview…');
        closeDocumentEditor(false);
        await openPartnerPreview('masterPackingList');
        setStatus(saveBeforeGenerate ? 'Packing list saved and PDF preview is ready.' : 'Edited packing-list preview is ready.', 'success');
        closeWorkflowProgress();
        showPrintSummary('partners');
      } catch (err) {
        closeWorkflowProgress();
        setStatus(`Packing-list generation failed: ${err?.message || 'unknown error'}`, 'error');
      } finally {
        partnerEditingMpl = false;
        workingButtons.forEach(button => { button.disabled = false; });
      }
      return;
    }
    const cfg = KEHE_DOCUMENT_CONFIG[activeKeheDocumentType];
    const btn = document.getElementById('btn-render-edited-document');
    const saveGenerateBtn = document.getElementById('btn-save-mpl-draft');
    const saveBeforeGenerate = !!options.saveMplDraft && activeKeheDocumentType === 'masterPackingList';
    const workingButtons = [btn, saveGenerateBtn].filter(Boolean);
    workingButtons.forEach(button => { button.disabled = true; });
    try {
      const readinessScope = activeKeheDocumentType === 'masterPackingList' ? 'mpl' : 'kehe';
      if (!(await confirmDocumentReadiness(readinessScope))) return;
      showWorkflowProgress(activeKeheDocumentType === 'masterPackingList' ? 4 : 3, `Preparing ${cfg.label}…`);
      activeKeheDocumentDraft.product_master = getActiveAllProductMasterRows();
      applyProductMasterToDraft(activeKeheDocumentDraft, true);
      if (activeKeheDocumentType === 'masterPackingList') {
        const storefrontCheck = validateMplStorefrontConsistency(activeKeheDocumentDraft);
        if (!storefrontCheck.ok) {
          throw new Error(`MPL generation blocked: ${storefrontCheck.message}`);
        }
        finalizeMplPalletDraft();
        setStatus('Preparing TI-HI preview snapshot for MPL...', 'info');
        await captureCurrentMplTiHiSnapshots(activeKeheDocumentDraft);
      }
      setStatus(`Generating ${cfg.label} PDF from edited values\u2026`, 'info');
      closeDocumentEditor();
      // Clear any previously rendered preview so the new PDF always renders fresh
      closePreview();
      resetPreviewSurface();
      setDownloadReady(false);
      // Keep the KeHE XML data/report visible while the PDF is generated.
      const res = await fetch(cfg.renderEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeKeheDocumentDraft)
      });
      const resultIdFromHeader = res.headers.get('X-Result-Id');
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.detail || `Could not start ${cfg.label} generation.`);
      }
      currentResultId = resultIdFromHeader || payload.result_id;
      if (!currentResultId) throw new Error('Generation could not be started.');

      document.getElementById('btn-download').download = cfg.outputName;
      const status = await waitForGeneration(currentResultId);

      const fileRes = await fetch(`/results/${encodeURIComponent(currentResultId)}/file`);
      if (!fileRes.ok) {
        const fileErr = await fileRes.json().catch(() => ({ detail: fileRes.statusText }));
        throw new Error(fileErr.detail || 'Generated PDF could not be downloaded.');
      }
      const blob = await fileRes.blob();
      await recordGeneratedOutput(`${selectedKit || 'kehe'}-${activeKeheDocumentType}`, {
        scope: activeKeheDocumentType === 'masterPackingList' ? 'mpl' : 'kehe',
        name: cfg.outputName,
        labelType: cfg.label,
        labels: activeKeheDocumentType === 'packLabels'
          ? (activeKeheDocumentDraft.pack_labels || []).reduce((total, label) => total + Math.max(1, Number(label.copies || 1)), 0)
          : activeKeheDocumentType === 'palletLabel'
            ? (activeKeheDocumentDraft.pallets || []).reduce((total, pallet) => total + Math.max(1, Number(pallet.copies || 1)), 0)
            : 0,
        pallets: activeKeheDocumentType === 'masterPackingList'
          ? (activeKeheDocumentDraft.packing_lists || []).reduce((total, mpl) => total + Math.max(1, Number(mpl.total_pallets || 1)), 0)
          : Number(activeKeheDocumentDraft.pallets?.length || 0),
        blob,
      });
      blobUrl = URL.createObjectURL(blob);
      setDownloadReady(true, blobUrl);
      setKehePreviewReady(activeKeheDocumentType, true, blobUrl);
      setActivePreviewFormat(KEHE_PREVIEW_CONFIG[activeKeheDocumentType]?.format || 'rollo');
      if (activeKeheDocumentType === 'masterPackingList') {
        keheLastMplDraft = activeKeheDocumentDraft;
        keheMplPalletizationSource = activeKeheDocumentDraft.packing_lists?.[0]?.palletization_source || keheMplPalletizationSource || 'Manual';
      }
      if (activeKeheDocumentType === 'palletLabel') {
        keheLastPalletLabelDraft = activeKeheDocumentDraft;
        kehePalletLabelSource = activeKeheDocumentDraft.palletization_source || kehePalletLabelSource || 'MPL';
      }

      renderKeheUnifiedReport(activeKeheDocumentDraft);
      if (saveBeforeGenerate) {
        updateWorkflowProgress('Saving MPL', 'Saving the generated MPL draft…');
        const saved = await saveActiveMplDraft({ savingMessage: 'Saving MPL draft...', successMessage: 'MPL draft saved.' });
        if (!saved) { closeWorkflowProgress(); return; }
      }
      updateWorkflowProgress('Opening preview', 'Opening the completed PDF preview…');
      resetPreviewSurface();
      await openPreview();
      setStatus(saveBeforeGenerate ? `${cfg.label} saved and generated successfully.` : `${cfg.label} generated successfully.`, 'success');
      closeWorkflowProgress();
      showPrintSummary(activeKeheDocumentType === 'masterPackingList' ? 'mpl' : 'kehe');
    } catch (err) {
      closeWorkflowProgress();
      setStatus('Error: ' + (err.message || 'Generation failed.'), 'error');
    } finally {
      if (btn) btn.disabled = false;
      updateMplSaveButtonState(activeKeheDocumentType);
    }
  }
