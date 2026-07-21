
  /* =======================================================================
     FRONTEND: Workflow state and backend routing.
     Michaels and KeHE are separated here so each kit calls the correct backend.
     ======================================================================= */
  const KIT_CONFIG = {
    michaels: {
      headerName: 'Michaels DTS · LabelKit',
      headerSub: 'ASN XML + ShipStation shipping labels',
      titleHtml: 'Michaels DTS · <span>LabelKit</span>',
      description: 'Upload your ASN XML from Infocon and your shipping labels from ShipStation to generate a single print-ready PDF. After each run, a match report appears below the button and the combined UPS Shipping Label, GS1 Label with SSCC-18 barcode, and Packing List preview opens in a popup.',
      generateTitle: 'Generate Michaels Documents',
      generateSubtitle: 'Create Michaels labels and packing documents from the uploaded ASN XML and shipping-label PDF.',
      noteHtml: '<strong>Note:</strong> Keep US and CAN orders separate. Print shipping labels separately, and use separate XML files for each group.',
      xmlTitle: 'ASN File — XML',
      xmlHintHtml: 'Upload your <strong>EDI 856 ASN XML</strong> file exported from <strong>Infocon</strong>',
      requiresPdf: true,
      endpoint: '/generate/michaels',
      outputName: 'michaels_dts_output.pdf',
      generateLabel: 'Generate Labels',
      reportTitle: 'Matching Report',
      reportRules: 'Matching order: Tracking → Store. The results for each shipping label page appear here after every run.',
      waitingText: 'Generate labels to see how each shipping label matched the XML.',
      summaryLabels: [
        ['shipping_pages', 'Shipping Pages'],
        ['xml_packs', 'XML Packs'],
        ['matched_pages', 'Matched'],
        ['unmatched_pages', 'Needs Review']
      ],
      columns: [
        ['label_page', 'Page'],
        ['status', 'Status'],
        ['match_method', 'Method'],
        ['ocr_tracking', 'OCR Tracking'],
        ['ocr_po', 'OCR PO'],
        ['ocr_store', 'OCR Store'],
        ['matched_xml', 'Matched XML'],
        ['note', 'Note']
      ],
      csvColumns: [
        ['label_page', 'Label Page'],
        ['status', 'Status'],
        ['match_method', 'Match Method'],
        ['ocr_tracking', 'OCR Tracking'],
        ['ocr_po', 'OCR PO'],
        ['ocr_store', 'OCR Store'],
        ['xml_tracking', 'XML Tracking'],
        ['xml_po', 'XML PO'],
        ['xml_store', 'XML Store'],
        ['sscc', 'SSCC'],
        ['note', 'Note']
      ],
      csvName: 'michaels_match_report.csv'
    },
    kehe: {
      headerName: 'KeHE GS1 · LabelKit',
      headerSub: 'ASN XML-only SSCC-18 / GS1-128 labels',
      titleHtml: 'KeHE GS1 · <span>LabelKit</span>',
      description: 'Upload your KeHE ASN XML from Infocon to generate a print-ready PDF with one 4 × 6 GS1-128 label per pallet/carton. After each run, the generation report appears below the button and the label preview opens in a popup.',
      generateTitle: 'Generate KeHE Documents',
      generateSubtitle: 'Create KeHE labels and documents from the uploaded XML.',
      noteHtml: '<strong>Note:</strong> Upload multiple XML files only when multiple POs are being shipped together in the same shipment. Otherwise, upload a single XML file for the individual PO.',
      xmlTitle: 'KeHE ASN File — XML',
      xmlHintHtml: 'Upload your <strong>KeHE EDI 856 ASN XML</strong> file. The backend extracts SSCC-18 carton data and renders GS1 labels.',
      requiresPdf: false,
      endpoint: '/generate/kehe',
      outputName: 'kehe_gs1_labels.pdf',
      generateLabel: 'GS1 Labels',
      reportTitle: 'Generation Report',
      reportRules: 'XML-only workflow. Each report row represents one generated KeHE GS1 label/carton from the ASN XML.',
      waitingText: 'Generate labels to see each KeHE carton and SSCC label result.',
      summaryLabels: [
        ['generated_labels', 'Generated Labels'],
        ['xml_files', 'XML Files']
      ],
      columns: [
        ['source_file',             'Source File'],
        ['customer_po_numbers',     'Customer PO'],
        ['pro_number',              'Pro No'],
        ['bol_number',              'BOL'],
        ['ship_date',               'Ship Date'],
        ['expected_delivery_date',  'Delivery Date'],
        ['carrier',                 'Carrier'],
        ['total_weight',            'Total Weight'],
        ['carton_count',            'Cartons'],
        ['total_pallets',           'Total Pallets'],
        ['ship_via',                'Ship Via'],
        ['dc',                      'DC'],
        ['ship_to_name',            'Ship To']
      ],
      csvColumns: [
        ['source_file',             'Source File'],
        ['customer_po_numbers',     'Customer PO'],
        ['pro_number',              'Pro No'],
        ['bol_number',              'BOL'],
        ['ship_date',               'Ship Date'],
        ['expected_delivery_date',  'Delivery Date'],
        ['carrier',                 'Carrier'],
        ['total_weight',            'Total Weight'],
        ['carton_count',            'Cartons'],
        ['total_pallets',           'Total Pallets'],
        ['ship_via',                'Ship Via'],
        ['dc',                      'DC'],
        ['ship_to_name',            'Ship To']
      ],
      csvName: 'kehe_generation_report.csv'
    },
    mpl: {
      headerName: 'Packing List & Ti-Hi · LabelKit',
      headerSub: 'Standalone MPL workspace',
      titleHtml: 'Packing List &amp; <span>Ti-Hi</span>',
      description: '',
      noteHtml: '',
      xmlTitle: '',
      xmlHintHtml: '',
      requiresPdf: false,
      endpoint: '',
      outputName: 'master_packing_list.pdf',
      generateLabel: 'Create MPL',
      reportTitle: 'Master Packing List',
      reportRules: '',
      waitingText: 'Create MPL to open the editor.',
      summaryLabels: [],
      columns: [
        ['document', 'Document'],
        ['status', 'Status'],
        ['note', 'Note']
      ],
      csvColumns: [
        ['document', 'Document'],
        ['status', 'Status'],
        ['note', 'Note']
      ],
      csvName: 'master_packing_list.csv'
    }
  };

  const KEHE_DOCUMENT_CONFIG = {
    palletLabel: {
      label: 'Pallet Label',
      prepareEndpoint: '/prepare/kehe/pallet-label',
      renderEndpoint: '/render/kehe/pallet-label',
      outputName: 'kehe_pallet_labels.pdf',
      reportTitle: 'Pallet Label Report',
      csvName: 'kehe_pallet_label_report.csv',
      columns: [
        ['document', 'Document'],
        ['status', 'Status'],
        ['dc', 'DC'],
        ['po', 'PO'],
        ['pallet', 'Pallet'],
        ['copies', 'Copies'],
        ['ship_to', 'Ship To'],
        ['note', 'Note']
      ]
    },
    masterPackingList: {
      label: 'Master Packing List',
      prepareEndpoint: '/prepare/kehe/master-packing-list',
      renderEndpoint: '/render/kehe/master-packing-list',
      outputName: 'kehe_master_packing_list.pdf',
      reportTitle: 'Master Packing List Report',
      csvName: 'kehe_master_packing_list_report.csv',
      columns: [
        ['document', 'Document'],
        ['status', 'Status'],
        ['dc', 'DC'],
        ['po', 'PO'],
        ['items', 'Items'],
        ['total_weight', 'Total Weight'],
        ['ship_to', 'Ship To'],
        ['note', 'Note']
      ]
    },
    packLabels: {
      label: 'Pack Labels',
      prepareEndpoint: '/prepare/kehe/pack-labels',
      renderEndpoint: '/render/kehe/pack-labels',
      outputName: 'kehe_pack_labels.pdf',
      reportTitle: 'Pack Label Report',
      csvName: 'kehe_pack_label_report.csv',
      columns: [
        ['document', 'Document'],
        ['status', 'Status'],
        ['gtin', 'GTIN'],
        ['description', 'Description'],
        ['packaging_level', 'Packaging Level'],
        ['weight_lbs', 'Weight'],
        ['case_qty', 'Case Qty'],
        ['copies', 'Copies'],
        ['note', 'Note']
      ]
    }
  };

  const KEHE_PREVIEW_CONFIG = {
    labels: {
      buttonId: 'btn-preview-kehe-labels',
      outputName: 'kehe_gs1_labels.pdf',
      format: 'rollo'
    },
    palletLabel: {
      buttonId: 'btn-preview-pallet-label',
      outputName: 'kehe_pallet_labels.pdf',
      format: 'rollo'
    },
    masterPackingList: {
      buttonId: 'btn-preview-mpl',
      outputName: 'kehe_master_packing_list.pdf',
      format: 'a4'
    },
    packLabels: {
      buttonId: 'btn-preview-pack-labels',
      outputName: 'kehe_pack_labels.pdf',
      format: 'rollo'
    }
  };

  const KEHE_UNIFIED_COLUMNS = [
    ['status', 'Status'],
    ['source_file', 'Source File'],
    ['dc', 'DC'],
    ['customer_po_numbers', 'Customer PO'],
    ['ship_date', 'Ship Date'],
    ['expected_delivery_date', 'Delivery Date'],
    ['carrier', 'Carrier'],
    ['pro_number', 'Pro No'],
    ['bol_number', 'BOL'],
    ['carton_count', 'Cartons'],
    ['pack_count', 'Packs'],
    ['item_rows', 'Item Rows'],
    ['total_weight', 'Weight'],
    ['ship_to_name', 'Ship To'],
    ['warnings', 'Warnings']
  ];

  const KEHE_UNIFIED_CSV_COLUMNS = [
    ['source_file', 'Source File'],
    ['status', 'Status'],
    ['dc', 'DC'],
    ['dc_name', 'DC Name'],
    ['ship_to_gln', 'Ship To GLN'],
    ['customer_po_numbers', 'Customer PO'],
    ['po_date', 'PO Date'],
    ['order_no', 'Order No'],
    ['vendor_number', 'Vendor Number'],
    ['bsn', 'BSN'],
    ['bsn_date', 'BSN Date'],
    ['ship_date', 'Ship Date'],
    ['expected_delivery_date', 'Expected Delivery Date'],
    ['carrier', 'Carrier'],
    ['scac', 'SCAC'],
    ['pro_number', 'Pro No'],
    ['bol_number', 'BOL'],
    ['carton_count', 'Carton Count'],
    ['pack_count', 'Pack Count'],
    ['item_rows', 'Item Rows'],
    ['total_weight', 'Total Weight'],
    ['cube', 'Cube'],
    ['total_pallets', 'Total Pallets'],
    ['ship_via', 'Ship Via'],
    ['ship_from', 'Ship From'],
    ['xml_ship_to', 'XML Ship To'],
    ['final_ship_to', 'Final Ship To'],
    ['ship_to', 'Ship To'],
    ['bill_to', 'Bill To'],
    ['billing', 'Billing'],
    ['supplier_info', 'Supplier Info'],
    ['copies', 'Copies'],
    ['placement_note', 'Placement Note'],
    ['warnings', 'Warnings']
  ];

  let selectedKit = null;
  let xmlFiles = [];
  let pdfFiles = [];
  let blobUrl = null;
  let currentResultId = null;
  let currentReport = null;
  let activeKeheDocumentType = null;
  let activeKeheDocumentDraft = null;
  let currentCsvName = null;
  let currentCsvColumns = null;
  let savedMplDrafts = [];
  let activeExcelImportPreview = null;
  let activePreviewFormat = 'rollo';
  let kehePreviewUrls = { labels: null, palletLabel: null, masterPackingList: null, packLabels: null };
  let keheCurrentExtractedSource = null;
  let keheGeneratedLabelCount = 0;
  let keheLastMplDraft = null;
  let keheLastPalletLabelDraft = null;
  let keheMplPalletizationSource = 'Not generated';
  let kehePalletLabelSource = 'Not generated';
  let appRuntimeConfig = {
    app_env: 'local',
    auth_required: false,
    auth_mode: 'none',
    authenticated: true,
    allow_local_json_fallback: true,
    allow_browser_local_cache: true,
    user: { authenticated: true, name: 'Local user', role: 'Admin', role_name: 'Local Admin' },
    permissions: {
      view: true,
      generate: true,
      table_crud: true,
      save_mpl: true,
      delete_mpl: true,
      audit_view: true,
      admin: true
    }
  };
  const KEHE_PRODUCT_MASTER_STORAGE_KEY = 'jdi_kehe_product_master_rows_v2';
  let keheProductMasterRows = loadKeheProductMasterFromStorage();
  let keheProductMasterLoadPromise = null;
  const KEHE_DC_DIRECTORY_STORAGE_KEY = 'jdi_kehe_dc_directory_rows_v1';
  const MPL_PRODUCT_MASTER_STORAGE_KEY = 'jdi_mpl_product_master_rows_v1';
  const MPL_DIRECTORY_STORAGE_KEY = 'jdi_mpl_directory_rows_v1';
  const DEFAULT_KEHE_SHIP_FROM = 'BAKELL LLC\n1967 ESSEX CT\nREDLANDS, CA 92373\nUSA';
  let keheDcDirectoryRows = loadKeheDcDirectoryFromStorage();
  let keheDcDirectoryLoadPromise = null;
  let mplProductMasterRows = loadMplProductMasterFromStorage();
  let mplProductMasterLoadPromise = null;
  let mplProductMasterSaveTimer = null;
  let mplDirectoryRows = loadMplDirectoryFromStorage();
  let mplDirectoryLoadPromise = null;
  let mplDirectorySaveTimer = null;
  let keheExtractedLoadTimer = null;
  let keheExtractionRequestId = 0;
  let embeddedAuthMounted = false;
  const pages = ['home', 'michaels', 'kehe', 'mpl'];

  fetch('/health').catch(() => {});

  function hasPermission(permission) {
    return !!appRuntimeConfig?.permissions?.[permission];
  }

  function allowBrowserLocalCache() {
    return appRuntimeConfig?.allow_browser_local_cache !== false;
  }

  function allowLocalFallback() {
    return appRuntimeConfig?.allow_local_json_fallback !== false;
  }

  function authUserLabel() {
    const user = appRuntimeConfig?.user || {};
    return user.email || user.name || 'Signed in';
  }

  async function loadAppRuntimeConfig() {
    try {
      const res = await fetchWithTimeout('/api/auth/session', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load app session.');
      appRuntimeConfig = { ...appRuntimeConfig, ...payload };
    } catch (_err) {
      appRuntimeConfig = {
        ...appRuntimeConfig,
        auth_required: true,
        auth_mode: 'embedded',
        authenticated: false,
        user: { authenticated: false, role: 'User', role_name: 'Unknown' },
        permissions: {}
      };
    }
    if (!allowBrowserLocalCache()) {
      keheProductMasterRows = [];
      keheDcDirectoryRows = [];
      mplProductMasterRows = [];
      mplDirectoryRows = [];
    }
    renderAuthState();
    return appRuntimeConfig;
  }

  function renderAuthState() {
    const gate = document.getElementById('auth-gate');
    const appShell = document.getElementById('app-shell');
    const header = document.querySelector('header');
    const userChip = document.getElementById('auth-user-chip');
    const userName = document.getElementById('auth-user-name');
    const userRole = document.getElementById('auth-user-role');
    const logoutButton = document.getElementById('auth-logout-btn');
    const loginHint = document.getElementById('auth-login-hint');
    const needsLogin = !!appRuntimeConfig.auth_required && !appRuntimeConfig.authenticated;

    if (gate) gate.classList.toggle('visible', needsLogin);
    if (appShell) appShell.classList.toggle('auth-locked', needsLogin);
    if (header) header.classList.toggle('auth-locked', needsLogin);

    if (userChip) userChip.classList.toggle('hidden', !appRuntimeConfig.authenticated);
    if (userName) userName.textContent = authUserLabel();
    if (userRole) userRole.textContent = appRuntimeConfig?.user?.role_name || appRuntimeConfig?.user?.role || 'User';
    if (logoutButton) logoutButton.classList.toggle('hidden', !appRuntimeConfig.authenticated);
    if (loginHint) {
      loginHint.textContent = needsLogin
        ? 'Use your invited Catalyst account below.'
        : 'Signed in.';
    }
    renderEmbeddedAuth(needsLogin);
    applyPermissionUi();
  }

  function renderEmbeddedAuth(needsLogin) {
    const frame = document.getElementById('embedded-auth-frame');
    const status = document.getElementById('embedded-auth-status');
    if (!frame || !needsLogin) return;
    if (appRuntimeConfig.auth_mode !== 'embedded') {
      if (status) status.textContent = 'Authentication is not enabled for this environment.';
      return;
    }
    if (embeddedAuthMounted) return;
    if (!window.catalyst?.auth?.signIn) {
      if (status) status.textContent = 'Embedded Authentication is available after Catalyst initializes this app.';
      return;
    }
    try {
      embeddedAuthMounted = true;
      frame.innerHTML = '';
      window.catalyst.auth.signIn('embedded-auth-frame', {
        service_url: window.location.pathname + window.location.search + window.location.hash
      });
      if (status) status.classList.add('hidden');
    } catch (err) {
      embeddedAuthMounted = false;
      if (status) status.textContent = err?.message || 'Embedded Authentication could not be loaded.';
    }
  }

  function handleAuthLogout() {
    try {
      if (window.catalyst?.auth?.signOut) {
        window.catalyst.auth.signOut('/');
        return;
      }
    } catch (_err) {
      // Fall back to a reload if the Catalyst SDK is unavailable.
    }
    window.location.reload();
  }

  function applyPermissionUi() {
    const tableCrud = hasPermission('table_crud');
    const auditView = hasPermission('audit_view');
    document.querySelectorAll('button[onclick="addMplProductRow()"], button[onclick="addMplDirectoryRow()"], button[onclick^="triggerExcelImport"]').forEach(btn => {
      btn.classList.toggle('hidden', !tableCrud);
      btn.disabled = !tableCrud;
    });
    document.querySelectorAll('button[onclick^="openKeheAuditModal"]').forEach(btn => {
      btn.classList.toggle('hidden', !auditView);
      btn.disabled = !auditView;
    });
    updateMplSaveButtonState();
  }

  function updateMplSaveButtonState(type = activeKeheDocumentType) {
    const nameWrap = document.getElementById('mpl-draft-name-wrap');
    const nameInput = document.getElementById('mpl-draft-name-input');
    const saveDraft = document.getElementById('btn-save-mpl-draft');
    const isMplEditor = type === 'masterPackingList';
    if (nameWrap) nameWrap.classList.toggle('hidden', !isMplEditor);
    if (isMplEditor && nameInput && activeKeheDocumentDraft && !String(nameInput.value || '').trim()) {
      nameInput.value = defaultMplDraftName(activeKeheDocumentDraft);
    }
    if (!saveDraft) return;
    const canSave = hasPermission('save_mpl');
    saveDraft.classList.toggle('hidden', !isMplEditor);
    saveDraft.disabled = !isMplEditor || !canSave;
    saveDraft.textContent = 'Save & Generate PDF';
    saveDraft.title = isMplEditor && !canSave
      ? 'Admin or Editor role required to save MPL drafts.'
      : '';
  }

  async function bootstrapLabelKit() {
    await loadAppRuntimeConfig();
    if (appRuntimeConfig.auth_required && !appRuntimeConfig.authenticated) {
      return;
    }
    const initialRoute = getRouteFromHash();
    setHistoryRoute(initialRoute, true);
    await applyRouteFromNavigation(initialRoute);
  }

  async function fetchWithTimeout(resource, options = {}, timeoutMs = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(resource, { ...options, signal: controller.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizePageName(pageName) {
    return pages.includes(pageName) ? pageName : 'home';
  }

  function normalizeAppRoute(route = '') {
    const clean = String(route || '')
      .replace(/^#/, '')
      .replace(/^\/+|\/+$/g, '')
      .trim();
    if (!clean) return 'home';
    const [page, ...rest] = clean.split('/').filter(Boolean);
    const normalizedPage = normalizePageName(page);
    return [normalizedPage, ...rest].join('/');
  }

  function getRouteFromHash() {
    return normalizeAppRoute(window.location.hash || '#home');
  }

  function routePage(route = '') {
    return normalizePageName(normalizeAppRoute(route).split('/')[0]);
  }

  function routeSubpath(route = '') {
    return normalizeAppRoute(route).split('/').slice(1).join('/');
  }

  function getCurrentPage() {
    return selectedKit || 'home';
  }

  function getPageFromHash() {
    return routePage(getRouteFromHash());
  }

  function setHistoryRoute(route, replace = false) {
    const normalized = normalizeAppRoute(route);
    const nextHash = `#${normalized}`;
    const state = {
      page: routePage(normalized),
      route: normalized,
      isOverlayRoute: !!routeSubpath(normalized),
      pushedOverlayRoute: !replace && !!routeSubpath(normalized)
    };
    const currentHash = window.location.hash || '#home';

    if (replace) {
      history.replaceState(state, '', nextHash);
      return;
    }

    if (currentHash !== nextHash) {
      history.pushState(state, '', nextHash);
      return;
    }

    if (!history.state || history.state.route !== normalized) {
      history.replaceState(state, '', nextHash);
    }
  }

  async function navigateToRoute(route, replace = false) {
    const normalized = normalizeAppRoute(route);
    setHistoryRoute(normalized, replace);
    await applyRouteFromNavigation(normalized);
  }

  function setHistoryPage(pageName, replace = false) {
    setHistoryRoute(normalizePageName(pageName), replace);
  }

  async function applyPageFromNavigation(pageName) {
    const normalized = normalizePageName(pageName);
    if (normalized === 'home') {
      resetToSelection(false);
    } else if (normalized === 'mpl') {
      await selectMplWorkspace(false);
    } else {
      selectKit(normalized, false);
    }
  }

  function hideAllRouteViews(options = {}) {
    [
      'kehe-product-master-modal',
      'kehe-dc-directory-modal',
      'mpl-product-master-modal',
      'mpl-directory-modal',
      'saved-mpl-modal',
      'excel-import-modal',
      'audit-history-modal',
      'document-editor-panel',
      'preview-panel'
    ].forEach(id => document.getElementById(id)?.classList.remove('visible'));
    if (!options.keepTiHi && activeKeheDocumentDraft && Array.isArray(activeKeheDocumentDraft.packing_lists)) {
      activeKeheDocumentDraft.packing_lists.forEach(mpl => { mpl._show_tihi = false; });
    }
  }

  async function closeCurrentRouteView(basePage = getCurrentPage()) {
    const current = getRouteFromHash();
    if (routeSubpath(current)) {
      if (history.state?.pushedOverlayRoute) {
        history.back();
      } else {
        await navigateToRoute(basePage || 'home', true);
      }
    } else {
      hideAllRouteViews();
    }
  }

  function goBackFromWindow() {
    closeCurrentRouteView(getCurrentPage());
  }

  async function applyRouteFromNavigation(route = getRouteFromHash()) {
    const normalized = normalizeAppRoute(route);
    const page = routePage(normalized);
    if (page !== getCurrentPage()) {
      await applyPageFromNavigation(page);
    }
    hideAllRouteViews({ keepTiHi: routeSubpath(normalized).startsWith('tihi/') });
    await showRouteView(normalized);
  }

  async function showRouteView(route = getRouteFromHash()) {
    const normalized = normalizeAppRoute(route);
    const subpath = routeSubpath(normalized);
    if (!subpath) return;

    if (normalized === 'kehe/product-master') {
      showKeheProductMasterView();
      return;
    }
    if (normalized === 'kehe/dc-directory') {
      showKeheDcDirectoryView();
      return;
    }
    if (normalized === 'mpl/product-master') {
      showMplProductMasterView();
      return;
    }
    if (normalized === 'mpl/directory') {
      showMplDirectoryView();
      return;
    }
    if (normalized === 'mpl/saved') {
      await showSavedMplView();
      return;
    }
    if (subpath === 'preview') {
      await showPreviewView();
      return;
    }
    if (subpath === 'document-editor') {
      showDocumentEditorView();
      return;
    }
    if (subpath.startsWith('audit/')) {
      await showKeheAuditView(decodeURIComponent(subpath.slice('audit/'.length)));
      return;
    }
    if (subpath.startsWith('import/')) {
      showExcelImportView();
      return;
    }
    if (subpath.startsWith('tihi/')) {
      showMplTiHiRoute(subpath);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function displayMultiline(value) {
    const text = Array.isArray(value) ? value.join('\n') : value;
    return escapeHtml(text || '—').replace(/\n/g, '<br>');
  }

  function focusAndScrollIntoView(selector, focusSelector = '') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = document.querySelector(selector);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        if (!focusSelector) return;
        const focusTarget = target.querySelector(focusSelector);
        if (focusTarget && typeof focusTarget.focus === 'function') {
          focusTarget.focus({ preventScroll: true });
        }
      });
    });
  }

  function scrollTableRowIntoView(bodyId, rowIndex, focusSelector = 'input, select, textarea') {
    focusAndScrollIntoView(`#${bodyId} tr:nth-child(${Number(rowIndex) + 1})`, focusSelector);
  }

  function cssEscape(value) {
    const text = String(value ?? '');
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(text);
    return text.replace(/["\\]/g, '\\$&');
  }

  let activeSearchableSelect = null;
  let searchableSelectMenu = null;

  function searchableOptionLabel(option) {
    return String(option?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function searchableSelectLabel(select) {
    return searchableOptionLabel(select?.selectedOptions?.[0]) || '';
  }

  function scoreSearchableOption(query, label) {
    const needle = String(query || '').trim().toLowerCase();
    const haystack = String(label || '').trim().toLowerCase();
    if (!needle) return 1;
    if (!haystack) return -1;
    if (haystack === needle) return 120;
    if (haystack.startsWith(needle)) return 100;
    const containsAt = haystack.indexOf(needle);
    if (containsAt >= 0) return 85 - Math.min(containsAt, 50) / 10;
    const terms = needle.split(/\s+/).filter(Boolean);
    if (terms.length && terms.every(term => haystack.includes(term))) return 72;
    let pos = 0;
    for (const char of needle) {
      pos = haystack.indexOf(char, pos);
      if (pos < 0) return -1;
      pos += 1;
    }
    return 45;
  }

  function searchableSelectOptions(select, query) {
    return Array.from(select.options || [])
      .map((option, index) => ({
        option,
        index,
        label: searchableOptionLabel(option),
        score: option.disabled ? -1 : scoreSearchableOption(query, searchableOptionLabel(option))
      }))
      .filter(item => item.score >= 0)
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .slice(0, 80);
  }

  function ensureSearchableSelectMenu() {
    if (searchableSelectMenu) return searchableSelectMenu;
    searchableSelectMenu = document.createElement('div');
    searchableSelectMenu.className = 'searchable-select-menu';
    searchableSelectMenu.setAttribute('role', 'listbox');
    document.body.appendChild(searchableSelectMenu);
    searchableSelectMenu.addEventListener('mousedown', event => event.preventDefault());
    searchableSelectMenu.addEventListener('click', event => {
      const optionEl = event.target.closest('[data-option-index]');
      if (!optionEl || !activeSearchableSelect) return;
      selectSearchableOption(Number(optionEl.getAttribute('data-option-index')));
    });
    return searchableSelectMenu;
  }

  function positionSearchableSelectMenu() {
    if (!activeSearchableSelect || !searchableSelectMenu) return;
    const { input } = activeSearchableSelect;
    if (!input || !document.body.contains(input)) {
      closeSearchableSelect();
      return;
    }
    const rect = input.getBoundingClientRect();
    const gap = 6;
    const viewportGap = 10;
    const below = window.innerHeight - rect.bottom - viewportGap;
    const above = rect.top - viewportGap;
    const openUp = below < 170 && above > below;
    const maxHeight = Math.max(120, Math.min(280, openUp ? above - gap : below - gap));
    const top = openUp
      ? Math.max(viewportGap, rect.top - gap - maxHeight)
      : Math.min(window.innerHeight - viewportGap, rect.bottom + gap);
    searchableSelectMenu.style.left = `${Math.max(viewportGap, rect.left)}px`;
    searchableSelectMenu.style.top = `${top}px`;
    searchableSelectMenu.style.width = `${Math.max(rect.width, 180)}px`;
    searchableSelectMenu.style.maxHeight = `${maxHeight}px`;
  }

  function renderSearchableSelectMenu() {
    if (!activeSearchableSelect) return;
    const menu = ensureSearchableSelectMenu();
    const { select, input } = activeSearchableSelect;
    const options = searchableSelectOptions(select, input.value);
    activeSearchableSelect.options = options;
    if (activeSearchableSelect.activeIndex >= options.length) activeSearchableSelect.activeIndex = 0;
    menu.innerHTML = options.length
      ? options.map((item, visibleIndex) => `
          <button type="button" class="searchable-select-option ${visibleIndex === activeSearchableSelect.activeIndex ? 'active' : ''}" data-option-index="${item.index}" role="option" aria-selected="${visibleIndex === activeSearchableSelect.activeIndex ? 'true' : 'false'}">
            ${escapeHtml(item.label || 'Select option')}
          </button>
        `).join('')
      : '<div class="searchable-select-empty">No matching options</div>';
    menu.classList.add('visible');
    positionSearchableSelectMenu();
  }

  function openSearchableSelect(select, input, resetActive = false) {
    if (!select || select.disabled) return;
    if (activeSearchableSelect && activeSearchableSelect.select !== select) {
      closeSearchableSelect(false);
    }
    activeSearchableSelect = {
      select,
      input,
      activeIndex: resetActive ? 0 : (activeSearchableSelect?.activeIndex || 0),
      options: []
    };
    input.setAttribute('aria-expanded', 'true');
    renderSearchableSelectMenu();
  }

  function closeSearchableSelect(restoreLabel = true) {
    if (activeSearchableSelect) {
      const { select, input } = activeSearchableSelect;
      if (restoreLabel && input && document.body.contains(input)) {
        input.value = searchableSelectLabel(select);
      }
      if (input) input.setAttribute('aria-expanded', 'false');
    }
    activeSearchableSelect = null;
    if (searchableSelectMenu) {
      searchableSelectMenu.classList.remove('visible');
      searchableSelectMenu.innerHTML = '';
    }
  }

  function selectSearchableOption(optionIndex) {
    if (!activeSearchableSelect) return;
    const { select, input } = activeSearchableSelect;
    const option = select.options[optionIndex];
    if (!option || option.disabled) return;
    select.selectedIndex = optionIndex;
    input.value = searchableOptionLabel(option);
    closeSearchableSelect(false);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function moveSearchableActive(delta) {
    if (!activeSearchableSelect) return;
    const options = activeSearchableSelect.options || [];
    if (!options.length) return;
    activeSearchableSelect.activeIndex = (activeSearchableSelect.activeIndex + delta + options.length) % options.length;
    renderSearchableSelectMenu();
    const activeEl = searchableSelectMenu?.querySelector('.searchable-select-option.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function enhanceSearchableSelects(scope = document) {
    if (!scope) return;
    const selects = Array.from(scope.querySelectorAll('select:not([data-search-enhanced])'));
    selects.forEach(select => {
      if (select.disabled) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'searchable-select';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'searchable-select-input';
      input.value = searchableSelectLabel(select);
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      const label = select.closest('.manual-mpl-field, .mpl-product-picker, .editor-field')?.querySelector('label')?.textContent?.trim();
      input.setAttribute('aria-label', label ? `Search ${label}` : 'Search options');
      input.placeholder = searchableSelectLabel(select) || 'Search options';

      select.dataset.searchEnhanced = 'true';
      select.classList.add('native-search-select');
      select.setAttribute('aria-hidden', 'true');
      select.tabIndex = -1;
      select.parentNode.insertBefore(wrapper, select);
      wrapper.appendChild(select);
      wrapper.appendChild(input);

      select.addEventListener('change', () => {
        input.value = searchableSelectLabel(select);
        input.placeholder = searchableSelectLabel(select) || 'Search options';
      });
      input.addEventListener('focus', () => {
        input.placeholder = searchableSelectLabel(select) || 'Search options';
        input.value = '';
        openSearchableSelect(select, input, true);
      });
      input.addEventListener('click', () => openSearchableSelect(select, input, true));
      input.addEventListener('input', () => openSearchableSelect(select, input, true));
      input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openSearchableSelect(select, input);
          moveSearchableActive(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          openSearchableSelect(select, input);
          moveSearchableActive(-1);
        } else if (event.key === 'Enter') {
          if (!activeSearchableSelect || activeSearchableSelect.select !== select) return;
          event.preventDefault();
          const item = activeSearchableSelect.options?.[activeSearchableSelect.activeIndex];
          if (item) selectSearchableOption(item.index);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeSearchableSelect();
        }
      });
    });
  }

  document.addEventListener('mousedown', event => {
    if (!activeSearchableSelect) return;
    const wrapper = activeSearchableSelect.input?.closest('.searchable-select');
    if (wrapper?.contains(event.target) || searchableSelectMenu?.contains(event.target)) return;
    closeSearchableSelect();
  });
  window.addEventListener('scroll', positionSearchableSelectMenu, true);
  window.addEventListener('resize', positionSearchableSelectMenu);

  function toggleKeheProductMasterPanel(isVisible) {
    const actions = document.getElementById('kehe-reference-actions');
    if (!actions) return;
    actions.classList.toggle('visible', !!isVisible);
  }

  function showKeheProductMasterView() {
    renderKeheProductMasterTable();
    document.getElementById('kehe-product-master-modal').classList.add('visible');
  }

  function openKeheProductMasterModal() {
    navigateToRoute('kehe/product-master');
  }

  function hideKeheProductMasterView() {
    document.getElementById('kehe-product-master-modal').classList.remove('visible');
  }

  function closeKeheProductMasterModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView('kehe');
    } else {
      hideKeheProductMasterView();
    }
  }

  function loadKeheProductMasterFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(KEHE_PRODUCT_MASTER_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeProductRow);
    } catch (_err) {
      return [];
    }
  }

  function saveKeheProductMasterToStorage() {
    if (!allowBrowserLocalCache()) return;
    try {
      localStorage.setItem(
        KEHE_PRODUCT_MASTER_STORAGE_KEY,
        JSON.stringify(getKeheProductMasterRows())
      );
    } catch (_err) {}
  }


  async function loadKeheProductMasterFromBackend() {
    try {
      const res = await fetchWithTimeout('/api/kehe/product-master', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load product master.');
      if (Array.isArray(payload.rows)) {
        keheProductMasterRows = payload.rows.map(normalizeProductRow);
        saveKeheProductMasterToStorage();
        renderKeheProductMasterTable();
      }
      return payload;
    } catch (_err) {
      keheProductMasterRows = allowLocalFallback() ? loadKeheProductMasterFromStorage() : [];
      renderKeheProductMasterTable();
      return { rows: keheProductMasterRows, source: allowLocalFallback() ? 'localStorage' : 'unavailable' };
    }
  }

  function normalizePackagingLevel(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const compact = raw.replace(/\s+/g, '');
    if (raw === 'case' || raw === 'cases' || raw === 'master pack' || raw === 'master packs' || raw === 'mp' || compact === 'casepack') return 'Case';
    if (raw === 'inner pack' || raw === 'inner packs' || raw === 'inner' || raw === 'ip' || compact === 'innerpack' || compact === 'innerpacks') return 'Inner Pack';
    if (raw === 'each' || raw === 'ea') return 'Each';
    if (raw === 'shipper contents' || raw === 'shipper content' || raw === 'shipper' || compact === 'shippercontents') return 'Shipper Contents';
    return 'Other';
  }

  function isCasePackagingLevel(value) {
    return normalizePackagingLevel(value) === 'Case';
  }

  function parseBooleanLike(value, defaultValue = false) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return defaultValue;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return defaultValue;
    if (['1', 'true', 'yes', 'y', 'on', 'checked', '✅', 'x'].includes(raw)) return true;
    if (['0', 'false', 'no', 'n', 'off', 'unchecked', 'barcode on product'].includes(raw)) return false;
    if (raw.includes('barcode') && raw.includes('product')) return false;
    return defaultValue;
  }

  function normalizeStorefront(value) {
    const clean = String(value ?? '').trim();
    return clean || 'KeHE';
  }

  function isKeheStorefront(value) {
    return normalizeStorefront(value).toLowerCase() === 'kehe';
  }

  function normalizeInPackingList(row, packagingLevel) {
    if (!isCasePackagingLevel(packagingLevel)) return false;
    if (row && Object.prototype.hasOwnProperty.call(row, 'in_packing_list')) {
      return parseBooleanLike(row.in_packing_list, true);
    }
    if (row && Object.prototype.hasOwnProperty.call(row, 'IN_PACKING_LIST')) {
      return parseBooleanLike(row.IN_PACKING_LIST, true);
    }
    if (row && Object.prototype.hasOwnProperty.call(row, 'In Packing List')) {
      return parseBooleanLike(row['In Packing List'], true);
    }
    if (row && Object.prototype.hasOwnProperty.call(row, 'label_required')) {
      return parseBooleanLike(row.label_required, true);
    }
    if (row && Object.prototype.hasOwnProperty.call(row, 'Label Required')) {
      return parseBooleanLike(row['Label Required'], true);
    }
    if (row && Object.prototype.hasOwnProperty.call(row, 'LABEL REQUIRED')) {
      return parseBooleanLike(row['LABEL REQUIRED'], true);
    }
    return true;
  }

  function isProductInPackingList(row) {
    return !!row && isCasePackagingLevel(row.packaging_level) && !!row.in_packing_list;
  }

  function defaultLabelsPerUnitForLevel(level) {
    const normalized = normalizePackagingLevel(level);
    if (normalized === 'Inner Pack') return '6';
    if (normalized === 'Case') return '2';
    return '';
  }

  function defaultCaseQtyForLevel(level) {
    const normalized = normalizePackagingLevel(level);
    if (normalized === 'Inner Pack') return '6';
    if (normalized === 'Case') return '1';
    return '';
  }

  function normalizeLabelsPerUnit(value, level) {
    const raw = String(value ?? '').trim();
    if (!raw) return defaultLabelsPerUnitForLevel(level);
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultLabelsPerUnitForLevel(level);
    return ['Case', 'Inner Pack'].includes(normalizePackagingLevel(level)) ? String(Math.max(2, parsed)) : String(parsed);
  }

  function normalizeCaseQty(value, level) {
    const raw = String(value ?? '').trim();
    if (!raw) return defaultCaseQtyForLevel(level);
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : defaultCaseQtyForLevel(level);
  }

  function normalizeProductRow(row = {}) {
    const packagingLevel = normalizePackagingLevel(row.packaging_level ?? row.packging_level ?? row['PACKGING LEVEL'] ?? row['PACKAGING LEVEL']);
    const inPackingList = normalizeInPackingList(row, packagingLevel);
    return {
      storefront: normalizeStorefront(row.storefront ?? row.STOREFRONT ?? row['Storefront']),
      in_packing_list: inPackingList,
      label_required: inPackingList ? '1' : '0',
      gtin: String(row.gtin ?? row.GTIN ?? row.case_upc ?? row.upc ?? '').trim(),
      description: String(row.description ?? row.DESCRIPTION ?? '').trim(),
      packaging_level: packagingLevel,
      dimensions_in: String(row.dimensions_in ?? row['L X W X H (in)'] ?? row.lwh_in ?? '').trim(),
      weight_lbs: String(row.weight_lbs ?? row['WEIGHT(lbs)'] ?? row.weight ?? '').trim(),
      case_qty: normalizeCaseQty(row.case_qty ?? row['Case Qty'] ?? row.case_quantity ?? row.units_per_case, packagingLevel),
      labels_per_unit: normalizeLabelsPerUnit(row.labels_per_unit ?? row['Labels / Unit'] ?? row.labels_to_print_per_unit ?? row.label_copies_per_unit, packagingLevel),
      sku: String(row.sku ?? row.SKU ?? row.item_number ?? '').trim()
    };
  }

  function isPackLabelLevel(row) {
    const level = normalizePackagingLevel(row?.packaging_level);
    return level === 'Case' || level === 'Inner Pack';
  }

  function canPrintProductMasterLabel(row) {
    return !!row && isPackLabelLevel(row) && !!String(row.gtin || '').trim();
  }

  function getKeheProductMasterRows() {
    return keheProductMasterRows
      .map(normalizeProductRow)
      .filter(row => isKeheStorefront(row.storefront))
      .filter(row => row.in_packing_list || row.gtin || row.description || row.dimensions_in || row.weight_lbs || row.case_qty || row.labels_per_unit || row.sku);
  }

  function getMplProductMasterRows() {
    return mplProductMasterRows
      .map(normalizeProductRow)
      .filter(isProductInPackingList);
  }

  function getAllMplProductMasterRows() {
    return mplProductMasterRows
      .map(normalizeProductRow)
      .filter(row => row.gtin || row.description || row.dimensions_in || row.weight_lbs || row.case_qty || row.labels_per_unit || row.sku);
  }

  function isStandaloneMplReferenceMode() {
    return selectedKit === 'mpl' || !!activeKeheDocumentDraft?.standalone_mpl;
  }

  function getActiveProductMasterRows() {
    return isStandaloneMplReferenceMode() ? getMplProductMasterRows() : getKeheProductMasterRows();
  }

  function loadMplProductMasterFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(MPL_PRODUCT_MASTER_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeProductRow);
    } catch (_err) {
      return [];
    }
  }

  function saveMplProductMasterToStorage() {
    if (!allowBrowserLocalCache()) return;
    try {
      localStorage.setItem(MPL_PRODUCT_MASTER_STORAGE_KEY, JSON.stringify(getAllMplProductMasterRows()));
    } catch (_err) {}
  }

  async function loadMplProductMasterFromBackend() {
    const localRows = allowLocalFallback() ? loadMplProductMasterFromStorage() : [];
    try {
      const res = await fetchWithTimeout('/api/mpl/product-master', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load MPL product master.');
      const backendRows = Array.isArray(payload.rows) ? payload.rows.map(normalizeProductRow) : [];
      if (backendRows.length) {
        mplProductMasterRows = backendRows;
        saveMplProductMasterToStorage();
      } else if (allowLocalFallback() && localRows.length) {
        mplProductMasterRows = localRows;
        await saveMplProductMasterToBackend();
      } else {
        mplProductMasterRows = [];
      }
      renderMplProductMasterTable();
      return payload;
    } catch (_err) {
      mplProductMasterRows = allowLocalFallback() ? localRows : [];
      renderMplProductMasterTable();
      return { rows: mplProductMasterRows, source: allowLocalFallback() ? 'localStorage' : 'unavailable' };
    }
  }

  function saveMplProductMasterToBackendDebounced() {
    clearTimeout(mplProductMasterSaveTimer);
    mplProductMasterSaveTimer = setTimeout(saveMplProductMasterToBackend, 500);
  }

  async function saveMplProductMasterToBackend() {
    if (!hasPermission('table_crud')) return;
    const rows = getAllMplProductMasterRows();
    try {
      const res = await fetch('/api/mpl/product-master', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not save Product Master.');
      if (Array.isArray(payload.rows)) {
        const savedRows = payload.rows.map(normalizeProductRow);
        const wasMerged = savedRows.length < rows.length;
        if (wasMerged) {
          mplProductMasterRows = savedRows;
          saveMplProductMasterToStorage();
          renderMplProductMasterTable();
          setStatus('Product Master duplicate key merged. Unique key is Storefront + Packaging Level + SKU.', 'info');
        } else {
          saveMplProductMasterToStorage();
        }
      } else {
        saveMplProductMasterToStorage();
      }
    } catch (_err) {
      // Browser cache remains available if backend persistence is temporarily unavailable.
      saveMplProductMasterToStorage();
    }
  }

  function showMplProductMasterView() {
    renderMplProductMasterTable();
    document.getElementById('mpl-product-master-modal').classList.add('visible');
  }

  function openMplProductMasterModal() {
    navigateToRoute('mpl/product-master');
  }

  function hideMplProductMasterView() {
    document.getElementById('mpl-product-master-modal').classList.remove('visible');
  }

  function closeMplProductMasterModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView('mpl');
    } else {
      hideMplProductMasterView();
    }
  }

  function renderMplProductMasterTable() {
    const body = document.getElementById('mpl-product-master-body');
    if (!body) return;
    const canEdit = hasPermission('table_crud');
    const rows = mplProductMasterRows
      .map((raw, index) => ({ row: normalizeProductRow(raw), index }));
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="11">No product rows yet. Add manually or upload data.</td></tr>';
      return;
    }
    const levelOptions = ['Case', 'Inner Pack', 'Each', 'Shipper Contents', 'Other'];
    body.innerHTML = rows.map(({ row, index }) => {
      const printable = canPrintProductMasterLabel(row);
      const disabledReason = !isPackLabelLevel(row) ? 'Only Case/MP and Inner Pack/IP labels can be printed here.' : 'GTIN is required.';
      const editDisabled = canEdit ? '' : 'disabled';
      return `
      <tr>
        <td><input ${editDisabled} value="${escapeHtml(row.storefront)}" placeholder="KeHE" oninput="updateMplProductRow(${index}, 'storefront', this.value)"></td>
        <td><input ${editDisabled} value="${escapeHtml(row.gtin)}" oninput="updateMplProductRow(${index}, 'gtin', this.value)"></td>
        <td><input ${editDisabled} value="${escapeHtml(row.description)}" oninput="updateMplProductRow(${index}, 'description', this.value)"></td>
        <td><select ${editDisabled} onchange="updateMplProductRow(${index}, 'packaging_level', this.value)">
          ${levelOptions.map(opt => `<option value="${escapeHtml(opt)}" ${row.packaging_level === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}
        </select></td>
        <td><input ${editDisabled} value="${escapeHtml(row.dimensions_in)}" placeholder="ex: 12 x 8 x 6" oninput="updateMplProductRow(${index}, 'dimensions_in', this.value)"></td>
        <td><input ${editDisabled} value="${escapeHtml(row.weight_lbs)}" placeholder="ex: 16" oninput="updateMplProductRow(${index}, 'weight_lbs', this.value)"></td>
        <td><input ${editDisabled} type="number" min="1" step="1" value="${escapeHtml(row.case_qty)}" placeholder="1" oninput="updateMplProductRow(${index}, 'case_qty', this.value)"></td>
        <td><input ${editDisabled} type="number" min="2" step="1" value="${escapeHtml(row.labels_per_unit)}" placeholder="2" oninput="updateMplProductRow(${index}, 'labels_per_unit', this.value)"></td>
        <td><input ${editDisabled} value="${escapeHtml(row.sku)}" oninput="updateMplProductRow(${index}, 'sku', this.value)"></td>
        <td><button class="btn-table-preview" type="button" ${printable ? '' : 'disabled'} title="${escapeHtml(printable ? 'Open editable pack-label preview.' : disabledReason)}" onclick="openManualMplProductPackLabel(${index})">Preview</button></td>
        <td>${canEdit ? `<button class="btn-mini-danger" type="button" onclick="deleteMplProductRow(${index})">Delete</button>` : ''}</td>
      </tr>`;
    }).join('');
    applyPermissionUi();
    enhanceSearchableSelects(body);
  }

  function addMplProductRow(seed = {}) {
    if (!hasPermission('table_crud')) return;
    mplProductMasterRows.push(normalizeProductRow({ storefront: 'KeHE', packaging_level: 'Case', in_packing_list: true, ...seed }));
    const newIndex = mplProductMasterRows.length - 1;
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
    scrollTableRowIntoView('mpl-product-master-body', newIndex);
  }

  function deleteMplProductRow(index) {
    if (!hasPermission('table_crud')) return;
    mplProductMasterRows.splice(index, 1);
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    renderMplProductMasterTable();
  }

  function updateMplProductRow(index, key, value) {
    if (!hasPermission('table_crud')) return;
    if (!mplProductMasterRows[index]) mplProductMasterRows[index] = normalizeProductRow({ storefront: 'KeHE' });
    if (key === 'packaging_level') {
      const nextLevel = normalizePackagingLevel(value);
      mplProductMasterRows[index][key] = nextLevel;
      mplProductMasterRows[index].in_packing_list = isCasePackagingLevel(nextLevel);
      mplProductMasterRows[index].label_required = mplProductMasterRows[index].in_packing_list ? '1' : '0';
      if (!String(mplProductMasterRows[index].labels_per_unit || '').trim()) {
        mplProductMasterRows[index].labels_per_unit = defaultLabelsPerUnitForLevel(nextLevel);
      }
      if (!String(mplProductMasterRows[index].case_qty || '').trim()) {
        mplProductMasterRows[index].case_qty = defaultCaseQtyForLevel(nextLevel);
      }
    } else if (key === 'labels_per_unit') {
      mplProductMasterRows[index][key] = normalizeLabelsPerUnit(value, mplProductMasterRows[index].packaging_level);
    } else if (key === 'case_qty') {
      mplProductMasterRows[index][key] = normalizeCaseQty(value, mplProductMasterRows[index].packaging_level);
    } else if (key === 'in_packing_list') {
      const checked = isCasePackagingLevel(mplProductMasterRows[index].packaging_level) && !!value;
      mplProductMasterRows[index].in_packing_list = checked;
      mplProductMasterRows[index].label_required = checked ? '1' : '0';
    } else if (key === 'storefront') {
      mplProductMasterRows[index][key] = normalizeStorefront(value);
    } else {
      mplProductMasterRows[index][key] = value;
    }
    saveMplProductMasterToStorage();
    saveMplProductMasterToBackendDebounced();
    if (key === 'packaging_level' || key === 'in_packing_list') {
      renderMplProductMasterTable();
    }
  }

  function renderKeheProductMasterTable() {
    const body = document.getElementById('kehe-product-master-body');
    if (!body) return;
    const rows = keheProductMasterRows
      .map((raw, index) => ({ row: normalizeProductRow(raw), index }))
      .filter(entry => isKeheStorefront(entry.row.storefront));
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="10">No KeHE rows yet. Add Storefront = KeHE rows from Packing List & Ti-Hi.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(({ row, index }) => {
      const printable = canPrintProductMasterLabel(row);
      const disabledReason = !isPackLabelLevel(row) ? 'Only Case/MP and Inner Pack/IP labels can be printed here.' : 'GTIN is required.';
      return `
      <tr>
        <td>${escapeHtml(row.storefront || '—')}</td>
        <td>${escapeHtml(row.gtin || '—')}</td>
        <td>${escapeHtml(row.description || '—')}</td>
        <td>${escapeHtml(row.packaging_level || '—')}</td>
        <td>${escapeHtml(row.dimensions_in || '—')}</td>
        <td>${escapeHtml(row.weight_lbs || '—')}</td>
        <td>${escapeHtml(row.case_qty || '—')}</td>
        <td>${escapeHtml(row.labels_per_unit || '—')}</td>
        <td>${escapeHtml(row.sku || '—')}</td>
        <td><button class="btn-table-preview" type="button" ${printable ? '' : 'disabled'} title="${escapeHtml(printable ? 'Open editable pack-label preview.' : disabledReason)}" onclick="openManualProductPackLabel(${index})">Preview</button></td>
      </tr>`;
    }).join('');
  }

  function normalizeManualCopies(value) {
    const parsed = parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.max(2, parsed) : 2;
  }

  function openManualProductPackLabelFromRow(rawRow, productRows, closeModal) {
    const row = normalizeProductRow(rawRow || {});
    if (!canPrintProductMasterLabel(row)) {
      alert('Only Case/MP and Inner Pack/IP rows with a GTIN can be printed from this table.');
      return;
    }

    const labelsPerUnit = normalizeManualCopies(normalizeLabelsPerUnit(row.labels_per_unit || defaultLabelsPerUnitForLevel(row.packaging_level) || '2', row.packaging_level));
    const caseQty = normalizeCaseQty(row.case_qty || defaultCaseQtyForLevel(row.packaging_level), row.packaging_level);
    const prefix = packLevelPrefix(row.packaging_level);

    if (typeof closeModal === 'function') closeModal();
    activeKeheDocumentType = 'packLabels';
    activeKeheDocumentDraft = {
      document_type: 'kehe_pack_labels',
      version: 2,
      table_preview: true,
      summary: { labels: 1, selected_labels: 1, manual_labels: 1 },
      warnings: [],
      product_master: productRows,
      extracted_headers: [],
      extracted_items: [],
      pack_labels: [{
        id: `MANUAL-${prefix}-1`,
        status: 'Ready',
        print_selected: true,
        matched_in_xml: false,
        manual_label: true,
        gtin: row.gtin,
        description: row.description,
        brand: '',
        packaging_level: row.packaging_level,
        pack_prefix: prefix,
        dimensions_in: row.dimensions_in,
        weight_lbs: row.weight_lbs,
        case_qty: String(caseQty),
        labels_per_unit: labelsPerUnit,
        sku: row.sku,
        lot: '',
        best_before: '',
        copies: labelsPerUnit,
        warnings: []
      }]
    };
    renderDocumentEditor('packLabels', activeKeheDocumentDraft);
    openDocumentEditor();
    setStatus('Pack Label preview ready. Minimum 2 copies are printed for two-side case placement.', 'info');
  }

  function openManualProductPackLabel(index) {
    openManualProductPackLabelFromRow(
      keheProductMasterRows[index],
      getKeheProductMasterRows(),
      () => closeKeheProductMasterModal(false)
    );
  }

  function openManualMplProductPackLabel(index) {
    openManualProductPackLabelFromRow(
      mplProductMasterRows[index],
      getAllMplProductMasterRows(),
      () => closeMplProductMasterModal(false)
    );
  }

  function showKeheDcDirectoryView() {
    renderKeheDcDirectoryTable();
    document.getElementById('kehe-dc-directory-modal').classList.add('visible');
  }

  function openKeheDcDirectoryModal() {
    navigateToRoute('kehe/dc-directory');
  }

  function hideKeheDcDirectoryView() {
    document.getElementById('kehe-dc-directory-modal').classList.remove('visible');
  }

  function closeKeheDcDirectoryModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView('kehe');
    } else {
      hideKeheDcDirectoryView();
    }
  }

  function hideSavedMplView() {
    document.getElementById('saved-mpl-modal').classList.remove('visible');
  }

  function closeSavedMplModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView('mpl');
    } else {
      hideSavedMplView();
    }
  }

  function showExcelImportView() {
    if (!activeExcelImportPreview) return;
    renderExcelImportPreview();
    document.getElementById('excel-import-modal').classList.add('visible');
  }

  function hideExcelImportView(options = {}) {
    if (options.clearPreview !== false) {
      activeExcelImportPreview = null;
    }
    document.getElementById('excel-import-modal').classList.remove('visible');
  }

  function closeExcelImportModal(useHistory = true) {
    if (useHistory) {
      activeExcelImportPreview = null;
      closeCurrentRouteView('mpl');
      return;
    }
    hideExcelImportView();
  }

  function hideKeheAuditView() {
    document.getElementById('audit-history-modal').classList.remove('visible');
  }

  function closeKeheAuditModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView(getCurrentPage());
    } else {
      hideKeheAuditView();
    }
  }

  function parseDcMatchValues(value) {
    if (Array.isArray(value)) {
      return value.map(v => String(v || '').trim()).filter(Boolean);
    }

    const raw = String(value || '').trim();
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v || '').trim()).filter(Boolean);
      }
    } catch (_err) {}

    return raw.split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
  }

  function normalizeDcDirectoryRow(row = {}) {
    const shipFrom = String(row.ship_from ?? row.SHIP_FROM ?? row['SHIP FROM'] ?? DEFAULT_KEHE_SHIP_FROM).trim() || DEFAULT_KEHE_SHIP_FROM;
    return {
      storefront: normalizeStorefront(row.storefront ?? row.STOREFRONT ?? row['Storefront']),
      dc: String(row.dc ?? row.DC ?? '').trim(),
      name: String(row.name ?? row.NAME ?? '').trim(),
      ship_from: shipFrom,
      delivery_address: String(row.delivery_address ?? row.DELIVERY_ADDRESS ?? '').trim(),
      billing_address: String(row.billing_address ?? row.BILLING_ADDRESS ?? '').trim(),
      match_values: parseDcMatchValues(row.match_values ?? row.MATCH_VALUES ?? []),
    };
  }

  function getKeheDcDirectoryRows() {
    return keheDcDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => isKeheStorefront(row.storefront))
      .filter(row => row.dc || row.name || row.delivery_address || row.billing_address || row.match_values.length);
  }

  function getMplDirectoryRows() {
    return mplDirectoryRows
      .map(normalizeDcDirectoryRow)
      .filter(row => row.dc || row.name || row.delivery_address || row.billing_address || (row.ship_from && row.ship_from !== DEFAULT_KEHE_SHIP_FROM));
  }

  function getActiveDcDirectoryRows() {
    return isStandaloneMplReferenceMode() ? getMplDirectoryRows() : getKeheDcDirectoryRows();
  }

  function loadMplDirectoryFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(MPL_DIRECTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeDcDirectoryRow);
    } catch (_err) {
      return [];
    }
  }

  function saveMplDirectoryToStorage() {
    if (!allowBrowserLocalCache()) return;
    try {
      localStorage.setItem(MPL_DIRECTORY_STORAGE_KEY, JSON.stringify(getMplDirectoryRows()));
    } catch (_err) {}
  }

  async function loadMplDirectoryFromBackend() {
    const localRows = allowLocalFallback() ? loadMplDirectoryFromStorage() : [];
    try {
      const res = await fetchWithTimeout('/api/mpl/directory', { cache: 'no-store' }, 15000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load MPL directory.');
      const backendRows = Array.isArray(payload.rows) ? payload.rows.map(normalizeDcDirectoryRow) : [];
      if (backendRows.length) {
        mplDirectoryRows = backendRows;
        saveMplDirectoryToStorage();
      } else if (allowLocalFallback() && localRows.length) {
        mplDirectoryRows = localRows;
        await saveMplDirectoryToBackend();
      } else {
        mplDirectoryRows = [];
      }
      renderMplDirectoryTable();
      return payload;
    } catch (_err) {
      mplDirectoryRows = allowLocalFallback() ? localRows : [];
      renderMplDirectoryTable();
      return { rows: mplDirectoryRows, source: allowLocalFallback() ? 'localStorage' : 'unavailable' };
    }
  }

  function saveMplDirectoryToBackendDebounced() {
    clearTimeout(mplDirectorySaveTimer);
    mplDirectorySaveTimer = setTimeout(saveMplDirectoryToBackend, 500);
  }

  async function saveMplDirectoryToBackend() {
    if (!hasPermission('table_crud')) return;
    const rows = getMplDirectoryRows();
    try {
      const res = await fetch('/api/mpl/directory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not save Directory.');
      if (Array.isArray(payload.rows)) {
        const savedRows = payload.rows.map(normalizeDcDirectoryRow);
        const wasMerged = savedRows.length < rows.length;
        if (wasMerged) {
          mplDirectoryRows = savedRows;
          saveMplDirectoryToStorage();
          renderMplDirectoryTable();
          setStatus('Directory duplicate key merged. Unique key is Storefront + Code.', 'info');
        } else {
          saveMplDirectoryToStorage();
        }
      } else {
        saveMplDirectoryToStorage();
      }
    } catch (_err) {
      // Browser cache remains available if backend persistence is temporarily unavailable.
      saveMplDirectoryToStorage();
    }
  }

  function showMplDirectoryView() {
    renderMplDirectoryTable();
    document.getElementById('mpl-directory-modal').classList.add('visible');
  }

  function openMplDirectoryModal() {
    navigateToRoute('mpl/directory');
  }

  function hideMplDirectoryView() {
    document.getElementById('mpl-directory-modal').classList.remove('visible');
  }

  function closeMplDirectoryModal(useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView('mpl');
    } else {
      hideMplDirectoryView();
    }
  }

  function renderMplDirectoryTable() {
    const body = document.getElementById('mpl-directory-body');
    if (!body) return;
    const canEdit = hasPermission('table_crud');
    const editDisabled = canEdit ? '' : 'disabled';
    const rows = mplDirectoryRows.map(normalizeDcDirectoryRow);
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="9">No directory rows yet. Add a row manually.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((row, index) => `
      <tr>
        <td><input ${editDisabled} value="${escapeHtml(row.storefront)}" placeholder="KeHE" oninput="updateMplDirectoryRow(${index}, 'storefront', this.value)"></td>
        <td><input ${editDisabled} value="${escapeHtml(row.dc)}" placeholder="45" oninput="updateMplDirectoryRow(${index}, 'dc', this.value)"></td>
        <td><input ${editDisabled} value="${escapeHtml(row.name)}" placeholder="DC / Customer / Store" oninput="updateMplDirectoryRow(${index}, 'name', this.value)"></td>
        <td><textarea ${editDisabled} placeholder="Ship from address" oninput="updateMplDirectoryRow(${index}, 'ship_from', this.value)">${escapeHtml(row.ship_from)}</textarea></td>
        <td><textarea ${editDisabled} placeholder="Ship to / delivery address" oninput="updateMplDirectoryRow(${index}, 'delivery_address', this.value)">${escapeHtml(row.delivery_address)}</textarea></td>
        <td><textarea ${editDisabled} placeholder="Bill to address" oninput="updateMplDirectoryRow(${index}, 'billing_address', this.value)">${escapeHtml(row.billing_address)}</textarea></td>
        <td><textarea ${editDisabled} placeholder="One GLN/address/city/zip per line" oninput="updateMplDirectoryRow(${index}, 'match_values', this.value)">${escapeHtml(row.match_values.join('\n'))}</textarea></td>
        <td class="kehe-dc-print-cell"><button class="btn-table-preview" type="button" onclick="openManualMplDcPalletLabel(${index})">Preview</button></td>
        <td>${canEdit ? `<button class="btn-mini-danger" type="button" onclick="deleteMplDirectoryRow(${index})">Delete</button>` : ''}</td>
      </tr>
    `).join('');
    applyPermissionUi();
  }

  function addMplDirectoryRow(seed = {}) {
    if (!hasPermission('table_crud')) return;
    mplDirectoryRows.push(normalizeDcDirectoryRow({ storefront: 'KeHE', ...seed }));
    const newIndex = mplDirectoryRows.length - 1;
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryTable();
    scrollTableRowIntoView('mpl-directory-body', newIndex);
  }

  function deleteMplDirectoryRow(index) {
    if (!hasPermission('table_crud')) return;
    mplDirectoryRows.splice(index, 1);
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
    renderMplDirectoryTable();
  }

  function updateMplDirectoryRow(index, key, value) {
    if (!hasPermission('table_crud')) return;
    if (!mplDirectoryRows[index]) {
      mplDirectoryRows[index] = normalizeDcDirectoryRow({ storefront: 'KeHE' });
    }
    if (key === 'match_values') {
      mplDirectoryRows[index][key] = parseDcMatchValues(value);
    } else if (key === 'storefront') {
      mplDirectoryRows[index][key] = normalizeStorefront(value);
    } else {
      mplDirectoryRows[index][key] = value;
    }
    saveMplDirectoryToStorage();
    saveMplDirectoryToBackendDebounced();
  }

  function loadKeheDcDirectoryFromStorage() {
    if (!allowBrowserLocalCache()) return [];
    try {
      const raw = localStorage.getItem(KEHE_DC_DIRECTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeDcDirectoryRow);
    } catch (_err) {
      return [];
    }
  }

  function saveKeheDcDirectoryToStorage() {
    if (!allowBrowserLocalCache()) return;
    try {
      localStorage.setItem(
        KEHE_DC_DIRECTORY_STORAGE_KEY,
        JSON.stringify(getKeheDcDirectoryRows())
      );
    } catch (_err) {}
  }

  async function loadKeheDcDirectoryFromBackend() {
    try {
      const res = await fetch('/api/kehe/dc-directory', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not load DC directory.');

      if (Array.isArray(payload.rows)) {
        keheDcDirectoryRows = payload.rows.map(normalizeDcDirectoryRow);
        saveKeheDcDirectoryToStorage();
        renderKeheDcDirectoryTable();
      }

      return payload;
    } catch (_err) {
      keheDcDirectoryRows = allowLocalFallback() ? loadKeheDcDirectoryFromStorage() : [];
      renderKeheDcDirectoryTable();
      return { rows: keheDcDirectoryRows, source: allowLocalFallback() ? 'localStorage' : 'unavailable' };
    }
  }

  function renderKeheDcDirectoryTable() {
    const body = document.getElementById('kehe-dc-directory-body');
    if (!body) return;

    const rows = keheDcDirectoryRows
      .map((raw, index) => ({ row: normalizeDcDirectoryRow(raw), index }))
      .filter(entry => isKeheStorefront(entry.row.storefront));

    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="8">No KeHE directory rows yet. Add Storefront = KeHE rows from Packing List & Ti-Hi.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(({ row, index }) => `
      <tr>
        <td>${escapeHtml(row.storefront || '—')}</td>
        <td>${escapeHtml(row.dc || '—')}</td>
        <td>${escapeHtml(row.name || '—')}</td>
        <td>${displayMultiline(row.ship_from)}</td>
        <td>${displayMultiline(row.delivery_address)}</td>
        <td>${displayMultiline(row.billing_address)}</td>
        <td>${displayMultiline(row.match_values)}</td>
        <td class="kehe-dc-print-cell">
          <button class="btn-table-preview" type="button" onclick="openManualDcPalletLabel(${index})">Preview</button>
        </td>
      </tr>
    `).join('');
  }

  function openManualDcPalletLabelFromRow(rawRow, closeModal) {
    const row = normalizeDcDirectoryRow(rawRow || {});
    const chosenAddress = row.delivery_address;
    const addressLabel = 'Delivery';

    activeKeheDocumentType = 'palletLabel';
    activeKeheDocumentDraft = {
      document_type: 'kehe_pallet_label',
      version: 2,
      table_preview: true,
      summary: { pallets: 1, manual_labels: 1 },
      warnings: [],
      extracted_headers: [],
      extracted_items: [],
      pallets: [{
        id: `${row.dc || 'DC'} ${addressLabel} Pallet Label`,
        status: chosenAddress ? 'Ready' : 'Needs Review',
        dc: row.dc || '',
        date: '',
        expected_delivery_date: '',
        ship_from: row.ship_from || DEFAULT_KEHE_SHIP_FROM,
        ship_to: chosenAddress || '',
        pallet_number: '1',
        total_pallets: '1',
        customer_po_numbers: '',
        carrier: '',
        bol_number: '',
        pro_number: '',
        copies: 2,
        address_type: addressLabel,
        warnings: chosenAddress ? [] : [`${addressLabel} address is blank. Enter Ship To before printing.`]
      }]
    };

    renderDocumentEditor('palletLabel', activeKeheDocumentDraft);
    openDocumentEditor();
    if (typeof closeModal === 'function') closeModal();
    setStatus('Pallet label preview ready. Edit fields and Copies before generating PDF.', 'info');
  }

  function openManualDcPalletLabel(index) {
    openManualDcPalletLabelFromRow(keheDcDirectoryRows[index], () => closeKeheDcDirectoryModal(false));
  }

  function openManualMplDcPalletLabel(index) {
    openManualDcPalletLabelFromRow(mplDirectoryRows[index], () => closeMplDirectoryModal(false));
  }

  function canonicalId(value) {
    const digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
    return digits || String(value || '').trim().toLowerCase();
  }

  function seedKeheProductMasterFromItems(items) {
    // KeHE is read-only for master data. Add/edit products in Packing List & Ti-Hi.
    renderKeheProductMasterTable();
  }

  function parseWeight(value) {
    const m = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  function formatLbs(value) {
    if (!Number.isFinite(value)) return '';
    return Math.abs(value - Math.round(value)) < 0.005
      ? `${Math.round(value)} lbs`
      : `${String(Number(value.toFixed(2))).replace(/\.0+$/, '')} lbs`;
  }

  function matchProductMaster(item, options = {}) {
    const rows = getActiveProductMasterRows()
      .filter(row => !options.caseOnly || isProductInPackingList(row));
    const candidates = [item.gtin, item.case_upc, item.upc, item.item_number, item.sku].map(canonicalId).filter(Boolean);
    return rows.find(row => {
      const keys = [row.gtin, row.sku].map(canonicalId).filter(Boolean);
      return candidates.some(candidate => keys.includes(candidate));
    }) || rows.find(row => row.description && item.description && row.description.trim().toLowerCase() === String(item.description).trim().toLowerCase()) || null;
  }

  function getMplItemProductIndex(item) {
    const rows = getActiveProductMasterRows();
    const candidates = [item?.gtin, item?.case_upc, item?.upc, item?.item_number, item?.sku].map(canonicalId).filter(Boolean);
    let index = rows.findIndex(row => {
      if (!isCasePackagingLevel(row.packaging_level)) return false;
      const keys = [row.gtin, row.sku].map(canonicalId).filter(Boolean);
      return candidates.some(candidate => keys.includes(candidate));
    });
    if (index >= 0) return index;
    const desc = String(item?.description || '').trim().toLowerCase();
    if (!desc) return -1;
    index = rows.findIndex(row => isCasePackagingLevel(row.packaging_level) && String(row.description || '').trim().toLowerCase() === desc);
    return index;
  }

  function productMasterOptionLabel(row, index) {
    const parts = [
      row.storefront ? `[${row.storefront}]` : '',
      row.description || `Product ${index + 1}`,
      row.sku ? `SKU ${row.sku}` : '',
      row.gtin ? `GTIN ${row.gtin}` : '',
      row.packaging_level || ''
    ].filter(Boolean);
    return parts.join(' - ');
  }

  function applyProductRowToMplItem(item, product, options = {}) {
    if (!item || !product) return;
    const qtyFallback = options.defaultQty || '1';
    item.item_number = product.sku || product.gtin || item.item_number || '';
    item.upc = product.gtin || item.upc || '';
    item.case_upc = product.gtin || item.case_upc || '';
    item.gtin = product.gtin || item.gtin || '';
    item.sku = product.sku || item.sku || '';
    item.description = product.description || item.description || '';
    item.storefront = normalizeStorefront(product.storefront || item.storefront || '');
    item.packaging_level = product.packaging_level || item.packaging_level || '';
    item.dimensions_in = product.dimensions_in || item.dimensions_in || '';
    item.unit_weight_lbs = product.weight_lbs || item.unit_weight_lbs || '';
    item.uom = item.uom || 'CASES';
    if (!String(item.qty_on_pallet || '').trim()) item.qty_on_pallet = qtyFallback;
    if (!String(item.total_ordered || '').trim()) item.total_ordered = item.qty_on_pallet || qtyFallback;
    if (!String(item.total_shipped || '').trim()) item.total_shipped = item.qty_on_pallet || qtyFallback;
  }

  function getMplItemStorefront(item) {
    if (!item) return '';
    const explicit = String(item.storefront || '').trim();
    if (explicit) return normalizeStorefront(explicit);
    const product = matchProductMaster(item, { caseOnly: true });
    return product ? normalizeStorefront(product.storefront || '') : '';
  }

  function getMplSelectedStorefronts(mpl) {
    const seen = new Set();
    (mpl?.items || []).forEach(item => {
      const hasSkuData = [item.gtin, item.case_upc, item.upc, item.item_number, item.sku, item.description]
        .some(value => String(value || '').trim());
      if (!hasSkuData) return;
      const storefront = getMplItemStorefront(item);
      if (storefront) seen.add(storefront);
    });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }

  function validateMplStorefrontConsistency(draft = activeKeheDocumentDraft) {
    if (!draft?.standalone_mpl) return { ok: true, message: '' };
    const issues = [];
    (draft.packing_lists || []).forEach(mpl => {
      const skuStorefronts = getMplSelectedStorefronts(mpl);
      if (skuStorefronts.length > 1) {
        issues.push(`${mpl.id || 'MPL'} has selected SKUs from multiple storefronts: ${skuStorefronts.join(', ')}.`);
        return;
      }
      const directoryStorefront = normalizeStorefront(mpl.storefront || draft.storefront || '');
      if (skuStorefronts.length === 1 && directoryStorefront && skuStorefronts[0] !== directoryStorefront) {
        issues.push(`${mpl.id || 'MPL'} uses ${skuStorefronts[0]} SKU(s), but the selected directory storefront is ${directoryStorefront}.`);
      }
    });
    return {
      ok: issues.length === 0,
      message: issues.join(' ')
    };
  }

  function uniqueManualOptions(values) {
    const seen = new Set();
    return values.map(value => String(value || '').trim()).filter(value => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function dcDirectoryDisplayName(row, index) {
    const label = [
      row.dc ? `DC ${row.dc}` : '',
      row.name || ''
    ].filter(Boolean).join(' - ');
    return label || firstLine(row.delivery_address) || firstLine(row.billing_address) || `DC Row ${index + 1}`;
  }

  function manualMplAddressOptions(field) {
    const key = field === 'supplier_info'
      ? 'ship_from'
      : (field === 'bill_to' ? 'billing_address' : 'delivery_address');
    return uniqueManualOptions(getActiveDcDirectoryRows().map(row => row[key]));
  }

  function manualMplSelectedAddressIndex(field, value) {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) return -1;
    return manualMplAddressOptions(field).findIndex(option => option === cleanValue);
  }

  function blankManualMplItem(line = 1, palletId = '') {
    return {
      line,
      location_on_pallet: palletId,
      item_number: '',
      upc: '',
      case_upc: '',
      gtin: '',
      sku: '',
      storefront: '',
      description: '',
      packaging_level: '',
      dimensions_in: '',
      unit_weight_lbs: '',
      calculated_weight_lbs: '',
      lot: '',
      expiration_date: '',
      uom: 'CASES',
      qty_on_pallet: '',
      total_ordered: '',
      total_shipped: '',
      pallet_weight: '',
      notes: ''
    };
  }

  function buildManualMasterPackingListDraft(options = {}) {
    const standalone = selectedKit === 'mpl';
    const dcRows = getActiveDcDirectoryRows();
    const requestedStorefront = String(options.storefront || '').trim();
    const firstDc = (
      requestedStorefront
        ? dcRows.find(row => normalizeStorefront(row.storefront || '') === normalizeStorefront(requestedStorefront))
        : null
    ) || dcRows[0] || {};
    const firstItem = blankManualMplItem(1, '1');
    const storefront = normalizeStorefront(requestedStorefront || firstDc.storefront || 'KeHE');
    return {
      document_type: 'kehe_master_packing_list',
      version: 3,
      manual_mpl: true,
      standalone_mpl: standalone,
      storefront,
      summary: { packing_lists: 1, manual_mpl: true },
      warnings: [],
      product_master: getActiveProductMasterRows(),
      extracted_headers: [],
      extracted_items: [],
      packing_lists: [{
        id: 'MANUAL-MPL-1',
        title: 'MASTER PACKING LIST',
        status: firstDc.delivery_address ? 'Ready' : 'Needs Review',
        manual_mpl: true,
        storefront,
        dc: firstDc.dc || '',
        dc_name: firstDc.name || '',
        customer_po_number: '',
        pro_number: '',
        order_no: '',
        po_date: '',
        bol_number: '',
        total_weight: '',
        ship_via: '',
        total_pallets: '1',
        supplier_info: firstDc.ship_from || DEFAULT_KEHE_SHIP_FROM,
        bill_to: firstDc.billing_address || '',
        ship_to: firstDc.delivery_address || '',
        customer_no: '',
        est_ship_date: '',
        shipping_instructions: '',
        palletization_source: 'Manual',
        palletization_note: standalone
          ? 'Manual MPL created from standalone Product Master Table and Directory.'
          : 'Manual MPL created from GTIN / Packaging Master Table and KeHE DC Directory.',
        source_files: ['Manual Create MPL'],
        items: [firstItem],
        _pallet_ids: ['1'],
        _pallet_weights: {},
        _tihi_constraints: defaultTiHiConstraints(),
        _tihi_pallet_constraints: {},
        warnings: firstDc.delivery_address ? [] : ['Select a Ship To address from the DC Directory or enter it manually before printing.']
      }]
    };
  }

  function setMplOrderLookupBusy(busy) {
    const input = document.getElementById('mpl-sales-order-number');
    const button = document.getElementById('btn-load-mpl-order');
    if (input) input.disabled = !!busy;
    if (button) {
      button.disabled = !!busy;
      button.textContent = busy ? 'Loading…' : 'Load Order';
    }
  }

  function hideMplOrderInstancePicker() {
    const picker = document.getElementById('mpl-order-instance-picker');
    const select = document.getElementById('mpl-order-instance-select');
    if (picker) {
      picker.classList.add('hidden');
      delete picker.dataset.salesOrderNumber;
    }
    if (select) select.innerHTML = '';
  }

  function showMplOrderInstancePicker(orderNumber, instances) {
    const picker = document.getElementById('mpl-order-instance-picker');
    const select = document.getElementById('mpl-order-instance-select');
    if (!picker || !select) return;
    select.innerHTML = '';
    (Array.isArray(instances) ? instances : []).forEach(instance => {
      const option = document.createElement('option');
      option.value = String(instance?.ecomdash_id || '').trim();
      const parts = [
        `ECOMDASH ID ${option.value || 'missing'}`,
        String(instance?.storefront || '').trim(),
        String(instance?.billing_customer_name || '').trim(),
        String(instance?.invoice_date || '').trim(),
        `${Number(instance?.sku_count || 0)} SKU${Number(instance?.sku_count || 0) === 1 ? '' : 's'}`
      ].filter(Boolean);
      option.textContent = parts.join(' · ');
      option.disabled = !option.value;
      select.appendChild(option);
    });
    picker.dataset.salesOrderNumber = String(orderNumber || '').trim();
    picker.classList.remove('hidden');
  }

  function loadSelectedMplOrderInstance() {
    const picker = document.getElementById('mpl-order-instance-picker');
    const select = document.getElementById('mpl-order-instance-select');
    const orderNumber = String(picker?.dataset.salesOrderNumber || '').trim();
    const ecomdashId = String(select?.value || '').trim();
    if (!orderNumber || !ecomdashId) {
      setStatus('Select an ECOMDASH ID before loading the order.', 'error');
      return;
    }
    loadMplOrderFromAnalytics(null, ecomdashId, orderNumber);
  }

  function analyticsOrderQuantity(value) {
    const quantity = Number(String(value ?? '').replace(/,/g, ''));
    if (!Number.isFinite(quantity) || quantity <= 0) return '';
    return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(6)));
  }

  function analyticsMplAddress(details, type) {
    const source = details && typeof details === 'object' ? details : {};
    const billing = type === 'billing';
    const name = source[billing ? 'billing_customer_name' : 'ship_to_name'];
    const phone = source[billing ? 'bill_to_phone' : 'ship_to_phone'];
    const streetPrefix = billing ? 'billing_street' : 'shipping_street';
    const city = String(source[billing ? 'billing_city' : 'shipping_city'] || '').trim();
    const state = String(source[billing ? 'billing_state' : 'shipping_state'] || '').trim();
    const zip = String(source[billing ? 'billing_zip_code' : 'shipping_zip_code'] || '').trim();
    const country = source[billing ? 'billing_country' : 'shipping_country'];
    const locality = [city, state].filter(Boolean).join(', ') + (zip ? `${city || state ? ' ' : ''}${zip}` : '');
    return [
      name,
      source[`${streetPrefix}1`],
      source[`${streetPrefix}2`],
      source[`${streetPrefix}3`],
      locality,
      country,
      phone
    ].map(value => String(value || '').trim()).filter(Boolean).join('\n');
  }

  function buildAnalyticsOrderMplDraft(payload) {
    const orderNumber = String(payload?.sales_order_number || '').trim();
    const sourceItems = Array.isArray(payload?.items) ? payload.items : [];
    const matchedStorefronts = [...new Set(sourceItems
      .map(item => item?.product?.storefront)
      .filter(Boolean)
      .map(normalizeStorefront))];
    const draft = buildManualMasterPackingListDraft({
      storefront: matchedStorefronts.length === 1 ? matchedStorefronts[0] : ''
    });
    const mpl = draft.packing_lists[0];
    const warnings = [];
    const orderDetails = payload?.order_details && typeof payload.order_details === 'object'
      ? payload.order_details
      : {};
    const analyticsBillTo = analyticsMplAddress(orderDetails, 'billing');
    const analyticsShipTo = analyticsMplAddress(orderDetails, 'shipping');
    const localOrderFile = String(payload?.source?.local_file || '').toLowerCase();
    const orderSourceLabel = payload?.source?.service === 'local_file'
      ? (localOrderFile.endsWith('.csv') ? 'Local CSV' : 'Local Excel')
      : 'Zoho Analytics';

    mpl.id = orderNumber ? `SO-${orderNumber}` : mpl.id;
    mpl.customer_po_number = orderNumber;
    mpl.order_no = orderNumber;
    mpl.customer_no = orderNumber;
    if (analyticsBillTo) mpl.bill_to = analyticsBillTo;
    if (analyticsShipTo) mpl.ship_to = analyticsShipTo;
    mpl.shipping_instructions = String(orderDetails.order_notes || '').trim();
    mpl.source_files = [`${orderSourceLabel} · ${payload?.source?.view_name || 'Order Data'}`];
    mpl.palletization_source = `${orderSourceLabel} + Product Master`;
    mpl.palletization_note = `Order SKUs and quantities loaded from ${orderSourceLabel}; product details and weights matched from the saved Product Master.`;
    mpl.items = sourceItems.map((sourceItem, index) => {
      const quantity = analyticsOrderQuantity(sourceItem?.quantity_ordered) || '1';
      const sku = String(sourceItem?.sku || '').trim();
      const item = blankManualMplItem(index + 1, '1');
      item.item_number = sku;
      item.sku = sku;
      item.qty_on_pallet = quantity;
      item.total_ordered = quantity;
      item.total_shipped = quantity;

      if (sourceItem?.match_status === 'matched' && sourceItem.product) {
        applyProductRowToMplItem(item, normalizeProductRow(sourceItem.product), { defaultQty: quantity });
      } else if (sourceItem?.match_status === 'ambiguous') {
        const storefronts = Array.isArray(sourceItem.candidate_storefronts)
          ? sourceItem.candidate_storefronts.filter(Boolean).join(', ')
          : '';
        item.notes = `SKU ${sku} matches multiple Product Master rows${storefronts ? ` (${storefronts})` : ''}; select the correct product.`;
        warnings.push(item.notes);
      } else {
        item.notes = `SKU ${sku} was not found as an enabled Case row in Product Master.`;
        warnings.push(item.notes);
      }
      return item;
    });

    if (matchedStorefronts.length > 1) {
      warnings.push(`Order SKUs matched multiple storefronts: ${matchedStorefronts.join(', ')}. Select one storefront before generating the PDF.`);
    }
    if (!mpl.ship_to) {
      warnings.push('Select a Ship To address from the Directory before generating the PDF.');
    }

    mpl.warnings = [...new Set(warnings)];
    mpl.status = mpl.warnings.length ? 'Needs Review' : 'Ready';
    draft.warnings = [...mpl.warnings];
    draft.summary = {
      ...(draft.summary || {}),
      analytics_order: true,
      sales_order_number: orderNumber,
      line_items: sourceItems.length,
      matched_products: Number(payload?.summary?.matched_products || 0),
      unmatched_products: Number(payload?.summary?.unmatched_products || 0),
      ambiguous_products: Number(payload?.summary?.ambiguous_products || 0)
    };
    draft.analytics_order_source = payload?.source || {};
    draft.analytics_order_details = orderDetails;
    draft.extracted_headers = [{
      sales_order_number: orderNumber,
      ...orderDetails
    }];
    draft.extracted_items = sourceItems.map(item => ({
      sales_order_number: orderNumber,
      sku: item.sku || '',
      quantity_ordered: item.quantity_ordered ?? '',
      match_status: item.match_status || ''
    }));
    ensureMplPalletState(mpl);
    syncMplLineNumbers(mpl);
    applyProductMasterToDraft(draft, false);
    return draft;
  }

  async function loadMplOrderFromAnalytics(event, selectedEcomdashId = '', selectedOrderNumber = '') {
    if (event) event.preventDefault();
    if (selectedKit !== 'mpl') return;
    const input = document.getElementById('mpl-sales-order-number');
    const orderNumber = String(selectedOrderNumber || input?.value || '').trim();
    const ecomdashId = String(selectedEcomdashId || '').trim();
    if (!orderNumber) {
      setStatus('Enter a Sales Order Number.', 'error');
      if (input) input.focus();
      return;
    }

    setMplOrderLookupBusy(true);
    if (!ecomdashId) hideMplOrderInstancePicker();
    setStatus(`Searching Zoho Analytics for Sales Order ${orderNumber}…`, 'info');
    try {
      await ensureKeheReferenceDataLoaded();
      const response = await fetch('/api/mpl/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales_order_number: orderNumber,
          ecomdash_id: ecomdashId
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || 'The sales order could not be loaded.');
      }
      if (payload.requires_order_selection) {
        showMplOrderInstancePicker(orderNumber, payload.order_instances);
        setStatus(`Sales Order ${orderNumber} matches multiple ECOMDASH IDs. Select the correct storefront/customer order.`, 'info');
        return;
      }
      hideMplOrderInstancePicker();

      activeKeheDocumentType = 'masterPackingList';
      activeKeheDocumentDraft = buildAnalyticsOrderMplDraft(payload);
      keheLastMplDraft = activeKeheDocumentDraft;
      const palletization = autoPalletizeMpl(0, { render: false, showStatus: false }) || {};
      keheMplPalletizationSource = activeKeheDocumentDraft.packing_lists?.[0]?.palletization_source || 'Order Data + Product Master';
      renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
      openDocumentEditor();

      const summary = payload.summary || {};
      const matched = Number(summary.matched_products || 0);
      const needsReview = Number(summary.unmatched_products || 0) + Number(summary.ambiguous_products || 0);
      setStatus(
        `Sales Order ${orderNumber} loaded: ${payload.items?.length || 0} line item(s), ${matched} Product Master match(es), ${Number(palletization.palletCount || 0)} pallet(s)${needsReview ? `, ${needsReview} need review` : ''}.`,
        needsReview ? 'info' : 'success'
      );
    } catch (err) {
      setStatus('Error: ' + (err?.message || 'The sales order could not be loaded.'), 'error');
    } finally {
      setMplOrderLookupBusy(false);
    }
  }

  async function ensureKeheReferenceDataLoaded() {
    if (selectedKit === 'mpl') {
      try {
        if (mplProductMasterLoadPromise) await mplProductMasterLoadPromise;
        if (!getMplProductMasterRows().length) {
          mplProductMasterLoadPromise = loadMplProductMasterFromBackend();
          await mplProductMasterLoadPromise;
        }
      } catch (_err) {}

      try {
        if (mplDirectoryLoadPromise) await mplDirectoryLoadPromise;
        if (!getMplDirectoryRows().length) {
          mplDirectoryLoadPromise = loadMplDirectoryFromBackend();
          await mplDirectoryLoadPromise;
        }
      } catch (_err) {}
      return;
    }

    try {
      if (keheProductMasterLoadPromise) await keheProductMasterLoadPromise;
      if (!getKeheProductMasterRows().length) {
        keheProductMasterLoadPromise = loadKeheProductMasterFromBackend();
        await keheProductMasterLoadPromise;
      }
    } catch (_err) {}

    try {
      if (keheDcDirectoryLoadPromise) await keheDcDirectoryLoadPromise;
      if (!getKeheDcDirectoryRows().length) {
        keheDcDirectoryLoadPromise = loadKeheDcDirectoryFromBackend();
        await keheDcDirectoryLoadPromise;
      }
    } catch (_err) {}
  }

  async function openManualMasterPackingList() {
    if (selectedKit !== 'kehe' && selectedKit !== 'mpl') return;
    setStatus('Preparing manual Create MPL draft...', 'info');
    await ensureKeheReferenceDataLoaded();

    activeKeheDocumentType = 'masterPackingList';
    activeKeheDocumentDraft = buildManualMasterPackingListDraft();
    keheLastMplDraft = activeKeheDocumentDraft;
    keheMplPalletizationSource = 'Manual';

    if (selectedKit === 'kehe') {
      renderKeheUnifiedReport(activeKeheDocumentDraft);
    }
    renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
    openDocumentEditor();
    setStatus('Create MPL draft ready. Use the dropdowns, pallet tools, and Save & Generate PDF or Generate PDF Only when finished.', 'info');
  }

  function defaultMplDraftName(draft) {
    const mpl = draft?.packing_lists?.[0] || {};
    return String(
      draft?._saved_draft_name ||
      mpl.customer_po_number ||
      mpl.id ||
      'Untitled MPL'
    ).trim();
  }

  function currentMplDraftName() {
    const inputValue = document.getElementById('mpl-draft-name-input')?.value;
    return String(inputValue || '').trim() || defaultMplDraftName(activeKeheDocumentDraft);
  }

  function updateMplDraftNameFromInput(input) {
    if (activeKeheDocumentType !== 'masterPackingList' || !activeKeheDocumentDraft) return;
    const value = String(input?.value || '').trim();
    if (value) {
      activeKeheDocumentDraft._saved_draft_name = value;
    } else {
      delete activeKeheDocumentDraft._saved_draft_name;
    }
  }

  async function saveActiveMplDraft(options = {}) {
    const showStatus = options.showStatus !== false;
    if (!hasPermission('save_mpl')) {
      setStatus('Your role can preview and generate, but cannot save MPL drafts.', 'error');
      return false;
    }
    if (activeKeheDocumentType !== 'masterPackingList' || !activeKeheDocumentDraft) {
      setStatus('Open or create a Master Packing List before saving.', 'error');
      return false;
    }

    finalizeMplPalletDraft();
    const existingName = defaultMplDraftName(activeKeheDocumentDraft);
    const name = options.name || currentMplDraftName() || existingName;
    const trimmedName = String(name || '').trim() || existingName || 'Untitled MPL';
    activeKeheDocumentDraft._saved_draft_name = trimmedName;

    const payload = {
      id: activeKeheDocumentDraft._saved_draft_id || '',
      name: trimmedName,
      draft: activeKeheDocumentDraft
    };

    try {
      if (showStatus) setStatus(options.savingMessage || 'Saving MPL draft...', 'info');
      const res = await fetch('/api/kehe/mpl-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not save MPL draft.');
      activeKeheDocumentDraft._saved_draft_id = data.draft?.id || activeKeheDocumentDraft._saved_draft_id;
      activeKeheDocumentDraft._saved_draft_name = data.draft?.name || trimmedName;
      const nameInput = document.getElementById('mpl-draft-name-input');
      if (nameInput) nameInput.value = activeKeheDocumentDraft._saved_draft_name;
      if (showStatus) setStatus(options.successMessage || 'MPL draft saved.', 'success');
      return true;
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Could not save MPL draft.'), 'error');
      return false;
    }
  }

  async function showSavedMplView() {
    try {
      const res = await fetch('/api/kehe/mpl-drafts', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not load saved MPL drafts.');
      savedMplDrafts = Array.isArray(data.drafts) ? data.drafts : [];
      renderSavedMplList();
      document.getElementById('saved-mpl-modal').classList.add('visible');
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Could not load saved MPL drafts.'), 'error');
    }
  }

  function openSavedMplModal() {
    navigateToRoute('mpl/saved');
  }

  function renderSavedMplList() {
    const body = document.getElementById('saved-mpl-body');
    if (!body) return;
    const canDelete = hasPermission('delete_mpl');
    if (!savedMplDrafts.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="9">No saved MPL drafts yet. Create an MPL, then use Save &amp; Generate PDF in the editor.</td></tr>';
      return;
    }
    body.innerHTML = savedMplDrafts.map(draft => `
      <tr>
        <td>${escapeHtml(draft.name || 'Untitled MPL')}</td>
        <td>${escapeHtml(draft.customer_po_number || '—')}</td>
        <td>${escapeHtml(draft.ship_to || '—')}</td>
        <td>${escapeHtml(draft.total_pallets || '—')}</td>
        <td>${escapeHtml(draft.item_count || '0')}</td>
        <td>${escapeHtml(formatDateTime(draft.updated_at))}</td>
        <td>${escapeHtml(savedMplUserLabel(draft))}</td>
        <td><button class="btn-table-preview" type="button" onclick="loadSavedMplDraft('${jsString(draft.id)}')">Open</button></td>
        <td>${canDelete ? `<button class="btn-mini-danger table-action-btn" type="button" onclick="deleteSavedMplDraft('${jsString(draft.id)}', '${jsString(draft.name || 'Untitled MPL')}')">Delete</button>` : '—'}</td>
      </tr>
    `).join('');
  }

  function savedMplUserLabel(draft = {}) {
    return draft.updated_by || draft.created_by || draft.user || draft.saved_by || '—';
  }

  async function deleteSavedMplDraft(draftId, draftName = '') {
    if (!hasPermission('delete_mpl')) {
      setStatus('Only Admin users can delete saved MPL drafts.', 'error');
      return;
    }
    const name = String(draftName || 'this saved MPL');
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      setStatus('Deleting saved MPL draft...', 'info');
      const res = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not delete saved MPL draft.');
      savedMplDrafts = savedMplDrafts.filter(draft => String(draft.id) !== String(draftId));
      if (activeKeheDocumentDraft?._saved_draft_id && String(activeKeheDocumentDraft._saved_draft_id) === String(draftId)) {
        delete activeKeheDocumentDraft._saved_draft_id;
        delete activeKeheDocumentDraft._saved_draft_name;
      }
      renderSavedMplList();
      setStatus('Saved MPL draft deleted.', 'success');
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Could not delete saved MPL draft.'), 'error');
    }
  }

  async function loadSavedMplDraft(draftId) {
    try {
      const res = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not open saved MPL draft.');
      const record = data.draft || {};
      const draft = record.draft;
      if (!draft || typeof draft !== 'object') throw new Error('Saved MPL draft is empty.');
      draft._saved_draft_id = record.id;
      draft._saved_draft_name = record.name;
      activeKeheDocumentType = 'masterPackingList';
      activeKeheDocumentDraft = draft;
      keheLastMplDraft = draft;
      keheMplPalletizationSource = draft.packing_lists?.[0]?.palletization_source || 'Saved';
      closeSavedMplModal(false);
      renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
      openDocumentEditor();
      if (selectedKit === 'kehe') renderKeheUnifiedReport(activeKeheDocumentDraft);
      setStatus('Saved MPL draft opened.', 'success');
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Could not open saved MPL draft.'), 'error');
    }
  }

  function triggerExcelImport(target) {
    if (!hasPermission('table_crud')) {
      setStatus('Your role can view this table but cannot import or edit master data.', 'error');
      return;
    }
    const id = target === 'dc-directory' ? 'dc-directory-excel-input' : 'product-master-excel-input';
    const input = document.getElementById(id);
    if (input) input.click();
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadCsvRows(filename, rows) {
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportMplProductMasterTable() {
    const rows = getAllMplProductMasterRows();
    downloadCsvRows('labelkit_product_master_export.csv', [
      ['Storefront', 'GTIN', 'Description', 'Packaging Level', 'L x W x H (in)', 'Weight', 'Case Qty', 'Labels / Unit', 'SKU'],
      ...rows.map(row => [
        row.storefront,
        row.gtin,
        row.description,
        row.packaging_level,
        row.dimensions_in,
        row.weight_lbs,
        row.case_qty,
        row.labels_per_unit,
        row.sku
      ])
    ]);
    setStatus(`Exported ${rows.length} Product Master row${rows.length === 1 ? '' : 's'}.`, 'success');
  }

  function exportMplDirectoryTable() {
    const rows = getMplDirectoryRows();
    downloadCsvRows('labelkit_directory_export.csv', [
      ['Storefront', 'Code', 'Name', 'Ship From', 'Ship To', 'Bill To', 'Match Values'],
      ...rows.map(row => [
        row.storefront,
        row.dc,
        row.name,
        row.ship_from,
        row.delivery_address,
        row.billing_address,
        row.match_values.join('\n')
      ])
    ]);
    setStatus(`Exported ${rows.length} Directory row${rows.length === 1 ? '' : 's'}.`, 'success');
  }

  function downloadImportTemplate(target) {
    const isDirectory = target === 'dc-directory';
    const rows = isDirectory
      ? [
          ['Storefront', 'Code', 'Name', 'Ship From', 'Ship To', 'Bill To', 'Match Values'],
          ['KeHE', '45', 'KeHE Romeoville DC', 'BAKELL LLC\n1967 ESSEX CT\nREDLANDS, CA 92373\nUSA', 'Ship To address here', 'Bill To address here', 'GLN or matching values here']
        ]
      : [
          ['Storefront', 'GTIN', 'Description', 'Packaging Level', 'L x W x H (in)', 'Weight', 'Case Qty', 'Labels / Unit', 'SKU'],
          ['KeHE', '10850068684998', 'Example Case Product', 'Case', '24 x 12 x 6', '2', '36', '2', 'TW-EXAMPLE']
        ];
    downloadCsvRows(isDirectory ? 'labelkit_directory_import_template.csv' : 'labelkit_product_master_import_template.csv', rows);
    setStatus(`${isDirectory ? 'Directory' : 'Product Master'} import template downloaded.`, 'success');
  }

  async function handleExcelImportFile(target, input) {
    if (!hasPermission('table_crud')) {
      setStatus('Your role can view this table but cannot import or edit master data.', 'error');
      return;
    }
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const endpoint = target === 'dc-directory'
      ? '/api/mpl/directory/import-preview'
      : '/api/mpl/product-master/import-preview';
    const form = new FormData();
    form.append('file', file);
    try {
      setStatus('Reading Excel import preview...', 'info');
      const res = await fetch(endpoint, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not preview Excel import.');
      activeExcelImportPreview = { target, ...data };
      await navigateToRoute(`mpl/import/${target}`);
      setStatus('Excel import preview ready. Confirm to save changes.', 'info');
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Could not preview Excel import.'), 'error');
    }
  }

  function renderExcelImportPreview() {
    const preview = activeExcelImportPreview || {};
    const summary = preview.summary || {};
    document.getElementById('excel-import-title').textContent = preview.target === 'dc-directory'
      ? 'Directory Table Excel Import Preview'
      : 'Product Master Table Excel Import Preview';
    document.getElementById('excel-import-summary').textContent =
      `${preview.filename || 'Excel file'} • ${summary.added_rows || 0} added • ${summary.updated_rows || 0} updated • ${summary.unchanged_rows || 0} unchanged`;
    const rowModeLabel = document.getElementById('excel-import-row-mode-label');
    if (rowModeLabel) {
      rowModeLabel.textContent = preview.target === 'dc-directory'
        ? 'Unique key: Storefront + Code. Matching rows update the existing Directory record.'
        : 'Unique key: Storefront + Packaging Level + SKU. Matching rows update the existing Product Master record.';
    }
    const body = document.getElementById('excel-import-body');
    const changes = Array.isArray(preview.changes) ? preview.changes : [];
    const rows = Array.isArray(preview.rows) ? preview.rows : [];
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="5">No rows were found in this upload.</td></tr>';
      document.getElementById('btn-confirm-excel-import').disabled = true;
      return;
    }
    document.getElementById('btn-confirm-excel-import').disabled = false;
    body.innerHTML = rows.map((row, index) => {
      const rowKey = importPreviewRowKey(row, index);
      const rowChanges = changes.filter(change => String(change.record_key || '') === rowKey);
      const action = importPreviewRowAction(rowChanges);
      const changeText = importPreviewChangeText(rowChanges);
      return `
      <tr>
        <td><input type="checkbox" class="excel-import-row-check" data-row-index="${index}" checked onchange="updateExcelImportSelectionState()"></td>
        <td>${escapeHtml(action)}</td>
        <td>${escapeHtml(importPreviewRowLabel(row, index))}</td>
        <td>${escapeHtml(importPreviewRowDetails(row))}</td>
        <td>${escapeHtml(changeText)}</td>
      </tr>`;
    }).join('');
    updateExcelImportSelectionState();
  }

  function importPreviewRowKey(row, index) {
    return String(row?.unique_key || row?.UNIQUE_KEY || `row-${index + 1}`);
  }

  function importPreviewRowLabel(row, index) {
    return String(row?.description || row?.name || row?.gtin || row?.dc || row?.sku || `Row ${index + 1}`);
  }

  function importPreviewRowDetails(row) {
    if (activeExcelImportPreview?.target === 'dc-directory') {
      return [
        row?.storefront ? `Storefront: ${row.storefront}` : '',
        row?.dc ? `Code: ${row.dc}` : '',
        row?.delivery_address ? `Ship To: ${truncateAuditValue(row.delivery_address)}` : '',
        row?.billing_address ? `Bill To: ${truncateAuditValue(row.billing_address)}` : '',
      ].filter(Boolean).join(' | ');
    }
    return [
      row?.storefront ? `Storefront: ${row.storefront}` : '',
      row?.gtin ? `GTIN: ${row.gtin}` : '',
      row?.packaging_level ? `Level: ${row.packaging_level}` : '',
      row?.sku ? `SKU: ${row.sku}` : '',
      row?.dimensions_in ? `Dims: ${row.dimensions_in}` : '',
    ].filter(Boolean).join(' | ');
  }

  function importPreviewRowAction(rowChanges) {
    const actions = rowChanges.map(change => String(change.action || '').toLowerCase());
    if (actions.includes('add')) return 'add';
    if (actions.includes('update')) return 'update';
    if (actions.includes('delete')) return 'delete';
    return 'unchanged';
  }

  function importPreviewChangeText(rowChanges) {
    if (!rowChanges.length) return 'No field changes detected';
    if (rowChanges.some(change => change.field === '__row__')) return 'New row';
    const fields = rowChanges.map(change => change.field).filter(Boolean);
    return `${rowChanges.length} field change${rowChanges.length === 1 ? '' : 's'}${fields.length ? ': ' + fields.join(', ') : ''}`;
  }

  function selectedExcelImportRows() {
    const rows = Array.isArray(activeExcelImportPreview?.rows) ? activeExcelImportPreview.rows : [];
    const selectedIndexes = Array.from(document.querySelectorAll('.excel-import-row-check:checked'))
      .map(input => Number(input.getAttribute('data-row-index')))
      .filter(index => Number.isInteger(index) && index >= 0 && index < rows.length);
    return selectedIndexes.map(index => rows[index]);
  }

  function updateExcelImportSelectionState() {
    const selectedCount = selectedExcelImportRows().length;
    const totalCount = Array.isArray(activeExcelImportPreview?.rows) ? activeExcelImportPreview.rows.length : 0;
    const btn = document.getElementById('btn-confirm-excel-import');
    if (btn) {
      btn.textContent = selectedCount ? `Import Selected Rows (${selectedCount})` : 'Import Selected Rows';
      btn.disabled = selectedCount === 0 || totalCount === 0;
    }
  }

  async function confirmExcelImport() {
    if (!hasPermission('table_crud')) {
      setStatus('Your role can view this table but cannot import or edit master data.', 'error');
      return;
    }
    if (!activeExcelImportPreview) return;
    const target = activeExcelImportPreview.target;
    const endpoint = target === 'dc-directory'
      ? '/api/mpl/directory/import-confirm'
      : '/api/mpl/product-master/import-confirm';
    const selectedRows = selectedExcelImportRows();
    if (!selectedRows.length) {
      setStatus('Select at least one row to import.', 'error');
      return;
    }
    try {
      document.getElementById('btn-confirm-excel-import').disabled = true;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: selectedRows,
          batch_id: activeExcelImportPreview.batch_id || '',
          filename: activeExcelImportPreview.filename || ''
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not confirm Excel import.');
      if (target === 'dc-directory') {
        mplDirectoryRows = (data.rows || []).map(normalizeDcDirectoryRow);
        keheDcDirectoryRows = mplDirectoryRows.filter(row => isKeheStorefront(row.storefront));
        saveMplDirectoryToStorage();
        saveKeheDcDirectoryToStorage();
        renderMplDirectoryTable();
        renderKeheDcDirectoryTable();
      } else {
        mplProductMasterRows = (data.rows || []).map(normalizeProductRow);
        keheProductMasterRows = mplProductMasterRows.filter(row => isKeheStorefront(row.storefront));
        saveMplProductMasterToStorage();
        saveKeheProductMasterToStorage();
        renderMplProductMasterTable();
        renderKeheProductMasterTable();
      }
      closeExcelImportModal(true);
      setStatus('Excel import confirmed and change history saved.', 'success');
    } catch (err) {
      document.getElementById('btn-confirm-excel-import').disabled = false;
      setStatus('Error: ' + (err.message || 'Could not confirm Excel import.'), 'error');
    }
  }

  async function showKeheAuditView(table = '') {
    if (!hasPermission('audit_view')) {
      setStatus('Your role does not have access to change history.', 'error');
      return;
    }
    try {
      const tableName = table === 'all' ? '' : table;
      const url = tableName ? `/api/kehe/audit-log?table=${encodeURIComponent(tableName)}&limit=300` : '/api/kehe/audit-log?limit=300';
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not load change history.');
      renderKeheAuditHistory(Array.isArray(data.entries) ? data.entries : []);
      document.getElementById('audit-history-modal').classList.add('visible');
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Could not load change history.'), 'error');
    }
  }

  function openKeheAuditModal(table = '') {
    navigateToRoute(`${getCurrentPage()}/audit/${encodeURIComponent(table || 'all')}`);
  }

  function renderKeheAuditHistory(entries) {
    const body = document.getElementById('audit-history-body');
    if (!body) return;
    if (!entries.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="7">No change history yet.</td></tr>';
      return;
    }
    body.innerHTML = entries.map(entry => {
      const actor = entry.actor || {};
      const who = actor.email || actor.name || 'Local user';
      return `
        <tr>
          <td>${escapeHtml(formatDateTime(entry.timestamp))}</td>
          <td>${escapeHtml(who)}</td>
          <td>${escapeHtml(auditActionLabel(entry.action))}</td>
          <td>${escapeHtml(entry.record_label || entry.record_key || '')}</td>
          <td>${escapeHtml(auditFieldLabel(entry.field))}</td>
          <td>${escapeHtml(truncateAuditValue(entry.old_value))}</td>
          <td>${escapeHtml(truncateAuditValue(entry.new_value))}</td>
        </tr>`;
    }).join('');
  }

  function humanizeIdentifier(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return text
      .replace(/^__row__$/i, 'Entire Record')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function auditActionLabel(value) {
    const key = String(value || '').trim().toLowerCase();
    const labels = {
      add: 'Added',
      create: 'Created',
      insert: 'Added',
      update: 'Updated',
      edit: 'Edited',
      delete: 'Deleted',
      remove: 'Removed',
      import: 'Imported',
      upsert: 'Imported / Updated'
    };
    return labels[key] || humanizeIdentifier(value);
  }

  function auditFieldLabel(value) {
    return humanizeIdentifier(value) || 'Record';
  }

  function truncateAuditValue(value) {
    const text = String(value ?? '');
    return text.length > 140 ? text.slice(0, 128) + ' [trimmed]' : text;
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function renderManualMplSelect(label, optionsHtml) {
    return `
      <div class="manual-mpl-field">
        <label>${escapeHtml(label)}</label>
        ${optionsHtml}
      </div>`;
  }

  function renderManualMplTools(mpl, mplIndex) {
    if (!mpl?.manual_mpl && !activeKeheDocumentDraft?.manual_mpl) return '';
    const dcRows = getActiveDcDirectoryRows();
    const storefrontCheck = validateMplStorefrontConsistency(activeKeheDocumentDraft);
    const selectedDcIndex = dcRows.findIndex(row =>
      String(row.dc || '') === String(mpl.dc || '') &&
      String(row.name || '') === String(mpl.dc_name || '') &&
      (!isStandaloneMplReferenceMode() || normalizeStorefront(row.storefront || 'KeHE') === normalizeStorefront(mpl.storefront || activeKeheDocumentDraft?.storefront || 'KeHE'))
    );
    const dcSelect = dcRows.length
      ? `<select onchange="applyManualMplDcRow(${mplIndex}, this.value)">
          <option value="">Select DC / Name</option>
          ${dcRows.map((row, index) => {
            const label = isStandaloneMplReferenceMode()
              ? `[${normalizeStorefront(row.storefront || 'KeHE')}] ${dcDirectoryDisplayName(row, index)}`
              : dcDirectoryDisplayName(row, index);
            return `<option value="${index}" ${index === selectedDcIndex ? 'selected' : ''}>${escapeHtml(label)}</option>`;
          }).join('')}
        </select>`
      : '<select disabled><option>No DC Directory rows</option></select>';

    const addressSelect = (field, label) => {
      const options = manualMplAddressOptions(field);
      const selectedIndex = manualMplSelectedAddressIndex(field, mpl[field]);
      const select = options.length
        ? `<select onchange="applyManualMplAddress(${mplIndex}, '${jsString(field)}', this.value)">
            <option value="">Select ${escapeHtml(label)}</option>
            ${options.map((option, index) => `<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escapeHtml(firstLine(option) || option)}</option>`).join('')}
          </select>`
        : `<select disabled><option>No ${escapeHtml(label)} options</option></select>`;
      return renderManualMplSelect(label, select);
    };

    return `
      <div class="manual-mpl-tools">
        <div class="manual-mpl-title">${isStandaloneMplReferenceMode() ? 'Packing List & Ti-Hi References' : 'Create MPL References'}</div>
        <div class="manual-mpl-grid">
          ${renderManualMplSelect('DC / Name', dcSelect)}
          ${addressSelect('supplier_info', 'Ship From')}
          ${addressSelect('ship_to', 'Ship To')}
          ${addressSelect('bill_to', 'Bill To')}
        </div>
        ${storefrontCheck.ok ? '' : `<div class="manual-mpl-warning">${escapeHtml(storefrontCheck.message)}</div>`}
      </div>`;
  }

  function applyManualMplDcRow(mplIndex, rowIndex) {
    if (rowIndex === '') return;
    const mpl = getMpl(mplIndex);
    const row = getActiveDcDirectoryRows()[Number(rowIndex)];
    if (!mpl || !row) return;
    const nextStorefront = normalizeStorefront(row.storefront || 'KeHE');
    const selectedStores = getMplSelectedStorefronts(mpl);
    mpl.dc = row.dc || '';
    mpl.dc_name = row.name || '';
    mpl.storefront = nextStorefront;
    if (activeKeheDocumentDraft) activeKeheDocumentDraft.storefront = nextStorefront;
    mpl.supplier_info = row.ship_from || DEFAULT_KEHE_SHIP_FROM;
    mpl.ship_to = row.delivery_address || '';
    mpl.bill_to = row.billing_address || '';
    if (selectedStores.length && !selectedStores.includes(nextStorefront)) {
      refreshManualMplAfterChange(mpl, `Warning: Directory storefront changed to ${nextStorefront}. Existing selected SKU storefronts must match before PDF generation.`);
      return;
    }
    refreshManualMplAfterChange(mpl, 'DC Directory row applied to Create MPL.');
  }

  function applyManualMplAddress(mplIndex, field, optionIndex) {
    if (optionIndex === '') return;
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    const option = manualMplAddressOptions(field)[Number(optionIndex)];
    if (!option) return;
    mpl[field] = option;
    refreshManualMplAfterChange(mpl, 'Create MPL address updated.');
  }

  function refreshManualMplAfterChange(mpl, message = '') {
    if (!mpl || !activeKeheDocumentDraft) return;
    ensureMplPalletState(mpl);
    syncMplLineNumbers(mpl);
    markMplPalletizationSource(
      mpl,
      'Manual',
      isStandaloneMplReferenceMode()
        ? 'Manual MPL created from standalone Product Master Table and Directory.'
        : 'Manual MPL created from GTIN / Packaging Master Table and KeHE DC Directory.'
    );
    keheLastMplDraft = activeKeheDocumentDraft;
    renderKeheUnifiedReport(activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    if (message) setStatus(message, 'info');
  }

  function renderMplProductSelect(mplIndex, itemIndex, item) {
    const rows = getActiveProductMasterRows();
    const caseRows = rows
      .map((row, index) => ({ row, index }))
      .filter(entry => isProductInPackingList(entry.row));
    if (!rows.length) return '';
    if (!caseRows.length) {
      return `
        <div class="mpl-product-picker">
          <label>Product</label>
          <select disabled><option>No selected Case rows</option></select>
        </div>`;
    }
    const selectedIndex = getMplItemProductIndex(item);
    return `
      <div class="mpl-product-picker">
        <label>Product</label>
        <select onchange="selectMplItemProduct(${mplIndex}, ${itemIndex}, this.value)">
          <option value="">Select product</option>
          ${caseRows.map(({ row, index }) => `<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escapeHtml(productMasterOptionLabel(row, index))}</option>`).join('')}
        </select>
      </div>`;
  }

  function selectMplItemProduct(mplIndex, itemIndex, rowIndex) {
    const mpl = getMpl(mplIndex);
    const item = mpl?.items?.[itemIndex];
    const product = getActiveProductMasterRows()[Number(rowIndex)];
    if (!mpl || !item || !product) return;
    if (!isProductInPackingList(product)) return;
    ensureMplPalletState(mpl);
    applyProductRowToMplItem(item, product);
    if (mpl.manual_mpl && !normalizePalletId(item.location_on_pallet)) {
      item.location_on_pallet = (mpl._pallet_ids && mpl._pallet_ids[0]) || '1';
    }
    applyProductMasterToDraft(activeKeheDocumentDraft, false);
    setMplManualSource(
      mpl,
      isStandaloneMplReferenceMode()
        ? 'Manual MPL line item selected from standalone Product Master Table.'
        : 'Manual MPL line item selected from GTIN / Packaging Master Table.'
    );
    keheLastMplDraft = activeKeheDocumentDraft;
    renderKeheUnifiedReport(activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    const storefronts = getMplSelectedStorefronts(mpl);
    if (storefronts.length > 1) {
      setStatus(`Warning: selected SKUs use multiple storefronts (${storefronts.join(', ')}). PDF generation is blocked until they match.`, 'error');
    } else {
      setStatus(isStandaloneMplReferenceMode() ? 'Line item filled from standalone Product Master Table.' : 'Line item filled from GTIN / Packaging Master Table.', 'info');
    }
  }

  function matchCaseProductForPallet(item) {
    const rows = getActiveProductMasterRows().filter(isProductInPackingList);
    const exactCandidates = [item.case_upc].map(canonicalId).filter(Boolean);
    const exact = rows.find(row => exactCandidates.includes(canonicalId(row.gtin)));
    if (exact) return exact;
    const skuCandidates = [item.sku].map(canonicalId).filter(Boolean);
    return rows.find(row => skuCandidates.includes(canonicalId(row.sku))) || null;
  }

  function parseDimensionsInches(value) {
    const nums = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 3) return null;
    const dims = nums.slice(0, 3).map(Number);
    return dims.every(n => Number.isFinite(n) && n > 0) ? { l: dims[0], w: dims[1], h: dims[2] } : null;
  }

  function roundProductWeightForPallet(productWeight) {
    return Math.ceil((productWeight * 1.05) / 10) * 10;
  }

  function palletDisplayWeight(productWeight) {
    return `${roundProductWeightForPallet(productWeight) + 50} lbs`;
  }

  function itemQuantityForWeight(item) {
    const n = Number(String(item.qty_on_pallet || item.total_shipped || item.qty || '0').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function applyProductMasterToDraft(draft, preserveManualWeights = true) {
    if (!draft) return;
    draft.product_master = getActiveProductMasterRows();
    if (!Array.isArray(draft.packing_lists)) return;
    draft.packing_lists.forEach(mpl => {
      ensureMplPalletState(mpl);
      const totals = {};
      let listTotal = 0;
      (mpl.items || []).forEach(item => {
        const product = matchProductMaster(item, { caseOnly: true });
        if (!product) return;
        item.gtin = product.gtin || item.gtin || '';
        item.sku = product.sku || item.sku || '';
        item.storefront = normalizeStorefront(product.storefront || item.storefront || '');
        if (product.description && !item.description) item.description = product.description;
        item.packaging_level = product.packaging_level || '';
        item.dimensions_in = product.dimensions_in || '';
        item.unit_weight_lbs = product.weight_lbs || '';
        const unitWeight = parseWeight(product.weight_lbs);
        if (unitWeight === null) return;
        const pallet = normalizePalletId(item.location_on_pallet);
        const itemWeight = unitWeight * itemQuantityForWeight(item);
        item.calculated_weight_lbs = formatLbs(itemWeight);
        listTotal += itemWeight;
        if (!pallet) return;
        totals[pallet] = (totals[pallet] || 0) + itemWeight;
      });
      if (listTotal > 0 && (!preserveManualWeights || !String(mpl.total_weight || '').trim())) {
        mpl.total_weight = formatLbs(listTotal);
      }
      Object.keys(totals).forEach(pallet => {
        const calculated = formatLbs(totals[pallet]);
        if (!mpl._pallet_weights) mpl._pallet_weights = {};
        if (!preserveManualWeights || !String(mpl._pallet_weights[pallet] || '').trim()) {
          mpl._pallet_weights[pallet] = calculated;
        }
        (mpl.items || []).forEach(item => {
          if (normalizePalletId(item.location_on_pallet) === pallet && (!preserveManualWeights || !String(item.pallet_weight || '').trim())) {
            item.pallet_weight = mpl._pallet_weights[pallet] || calculated;
          }
        });
      });
    });
  }

  function recalculateMplWeights(mplIndex) {
    const mpl = getMpl(mplIndex);
    if (!mpl || !activeKeheDocumentDraft) return;
    applyProductMasterToDraft(activeKeheDocumentDraft, false);
    if (mpl.manual_mpl) {
      markMplPalletizationSource(
        mpl,
        'Manual',
        isStandaloneMplReferenceMode()
          ? 'Manual MPL weights recalculated from standalone Product Master Table.'
          : 'Manual MPL weights recalculated from GTIN / Packaging Master Table.'
      );
    }
    keheLastMplDraft = activeKeheDocumentDraft;
    renderKeheUnifiedReport(activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    setStatus(isStandaloneMplReferenceMode() ? 'MPL weights recalculated from standalone Product Master Table.' : 'MPL weights recalculated from GTIN / Packaging Master Table.', 'info');
  }


  function markMplPalletizationSource(mpl, source, note = '') {
    if (!mpl) return;
    mpl.palletization_source = source;
    mpl.palletization_note = note || `Palletization source: ${source}.`;
    if (activeKeheDocumentType === 'masterPackingList') {
      keheMplPalletizationSource = source;
      keheLastMplDraft = activeKeheDocumentDraft;
    }
  }

  function setMplManualSource(mpl, reason = 'Manual pallet assignment. Palletization no longer matches XML or Auto Palletize exactly.') {
    if (!mpl) return;
    const prev = String(mpl.palletization_source || '').trim();
    if (prev !== 'Manual') {
      markMplPalletizationSource(mpl, 'Manual', reason);
      setStatus('Palletization changed manually. Pallet Label and MPL source now show Manual.', 'info');
    }
  }

  function palletSourceLabel(source) {
    return String(source || 'Not generated').trim() || 'Not generated';
  }

  function cloneDraftValue(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function captureXmlPalletSnapshot(mpl) {
    if (mpl?.manual_mpl || activeKeheDocumentDraft?.manual_mpl) return false;
    if (!mpl || mpl._xml_pallet_snapshot) return !!(mpl && mpl._xml_pallet_snapshot);
    ensureMplPalletState(mpl);
    const source = palletSourceLabel(mpl.palletization_source);
    const hasAssignedItems = (mpl.items || []).some(item => !!normalizePalletId(item.location_on_pallet));
    if (source !== 'XML') return false;
    if (!hasAssignedItems) return false;
    mpl._xml_pallet_snapshot = {
      items: cloneDraftValue(mpl.items || []),
      _pallet_ids: cloneDraftValue(mpl._pallet_ids || []),
      _pallet_weights: cloneDraftValue(mpl._pallet_weights || {}),
      total_pallets: mpl.total_pallets || String((mpl._pallet_ids || []).length || 1),
      palletization_note: 'Using palletization from XML.'
    };
    return true;
  }

  function captureXmlPalletSnapshots(draft) {
    (draft?.packing_lists || []).forEach(mpl => captureXmlPalletSnapshot(mpl));
  }

  function canReverseMplToXml(mpl) {
    return !!(mpl && mpl._xml_pallet_snapshot);
  }

  function reverseMplToXmlPalletization(mplIndex) {
    const mpl = getMpl(mplIndex);
    if (!mpl || !mpl._xml_pallet_snapshot) return;
    const snapshot = cloneDraftValue(mpl._xml_pallet_snapshot);
    mpl.items = snapshot.items || [];
    mpl._pallet_ids = snapshot._pallet_ids || [];
    mpl._pallet_weights = snapshot._pallet_weights || {};
    mpl.total_pallets = snapshot.total_pallets || String((mpl._pallet_ids || []).length || 1);
    markMplPalletizationSource(mpl, 'XML', 'Using palletization from XML. Reversed from Auto Palletize / Manual palletization.');
    syncMplLineNumbers(mpl);
    keheLastMplDraft = activeKeheDocumentDraft;
    renderKeheUnifiedReport(activeKeheDocumentDraft);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    setStatus('MPL palletization was restored to the original XML assignment.', 'success');
  }

  function getDraftPalletCountFromMplDraft(draft) {
    const lists = draft?.packing_lists || [];
    return lists.reduce((sum, mpl) => {
      ensureMplPalletState(mpl);
      return sum + ((mpl._pallet_ids && mpl._pallet_ids.length) || 0);
    }, 0);
  }

  function getPalletLabelCountFromDraft(draft) {
    return (draft?.pallets || []).reduce((max, p) => {
      const n = Number(String(p.pallet_number || '').replace(/\D/g, ''));
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, draft?.pallets?.length || 0);
  }

  function getPalletizationMismatchText() {
    if (!keheLastMplDraft || !keheLastPalletLabelDraft) return '—';
    const mplCount = getDraftPalletCountFromMplDraft(keheLastMplDraft);
    const labelCount = getPalletLabelCountFromDraft(keheLastPalletLabelDraft);
    if (mplCount && labelCount && mplCount !== labelCount) return `Mismatch: MPL ${mplCount}, Pallet Label ${labelCount}`;
    if (palletSourceLabel(keheMplPalletizationSource) !== palletSourceLabel(kehePalletLabelSource)) return 'Source mismatch';
    return 'No mismatch';
  }

  function getXmlPalletMismatchNote(mpl, calculatedCount) {
    const xmlCount = Number(String(mpl?.xml_total_pallets || '').replace(/\D/g, ''));
    if (xmlCount && calculatedCount && xmlCount !== calculatedCount) {
      return `Auto Palletize created ${calculatedCount} pallet(s). XML says ${xmlCount} pallet(s), so this does not match XML.`;
    }
    return `Auto Palletize created ${calculatedCount || 0} pallet(s).`;
  }

  function maxCasesForProduct(product, warnings, label, constraints) {
    const dims = parseDimensionsInches(product.dimensions_in);
    const unitWeight = parseWeight(product.weight_lbs);
    if (!dims) warnings.push(`${label}: missing Case dimensions. Kept Unassigned / Needs Review.`);
    if (unitWeight === null) warnings.push(`${label}: missing Case weight. Kept Unassigned / Needs Review.`);
    if (!dims || unitWeight === null) return null;
    const perLayerA = Math.floor(constraints.max_length_in / dims.l) * Math.floor(constraints.max_width_in / dims.w);
    const perLayerB = Math.floor(constraints.max_length_in / dims.w) * Math.floor(constraints.max_width_in / dims.l);
    const perLayer = Math.max(perLayerA, perLayerB);
    const layers = Math.floor(constraints.max_height_in / dims.h);
    const byDimensions = perLayer * layers;
    if (byDimensions < 1) {
      warnings.push(`${label}: Case dimensions exceed pallet footprint/height. Kept Unassigned / Needs Review.`);
      return null;
    }
    const maxProductWeight = Math.max(0, constraints.max_gross_lbs - TIHI_PALLET_TARE_LBS);
    const byWeight = Math.floor((maxProductWeight / TIHI_PALLET_BUFFER_FACTOR) / unitWeight);
    if (byWeight < 1) {
      warnings.push(`${label}: one Case exceeds the ${constraints.max_gross_lbs} lb pallet limit after buffer/pallet weight. Kept Unassigned / Needs Review.`);
      return null;
    }
    return { dims, unitWeight, maxCases: Math.min(byDimensions, byWeight), caseVolume: dims.l * dims.w * dims.h };
  }

  function autoPalletizeMpl(mplIndex, options = {}) {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    ensureMplPalletState(mpl);
    captureXmlPalletSnapshot(mpl);
    const originalItems = (mpl.items || []).map(item => ({ ...item }));
    const warnings = [];
    const pallets = [];
    const unassigned = [];
    const defaultConstraints = normalizeTiHiConstraints(mpl._tihi_constraints || {});
    mpl._tihi_constraints = defaultConstraints;
    mpl._tihi_pallet_constraints = {};

    const constraintsForPallet = () => defaultConstraints;
    const maxCasesWithinConstraints = (meta, constraints) => {
      if (!meta || !constraints) return 0;
      const perLayerA = Math.floor(constraints.max_length_in / meta.dims.l) * Math.floor(constraints.max_width_in / meta.dims.w);
      const perLayerB = Math.floor(constraints.max_length_in / meta.dims.w) * Math.floor(constraints.max_width_in / meta.dims.l);
      const perLayer = Math.max(perLayerA, perLayerB);
      const layers = Math.floor(constraints.max_height_in / meta.dims.h);
      const byDimensions = perLayer * layers;
      const maxProductWeight = Math.max(0, constraints.max_gross_lbs - TIHI_PALLET_TARE_LBS);
      const byWeight = Math.floor((maxProductWeight / TIHI_PALLET_BUFFER_FACTOR) / meta.unitWeight);
      return Math.min(byDimensions, byWeight);
    };

    function ensurePallet() {
      const nextId = String(pallets.length + 1);
      const p = { id: nextId, productWeight: 0, volume: 0, items: [] };
      pallets.push(p);
      return p;
    }

    function buildAutoPalletItemCopy(item, palletId, qty, meta) {
      const copy = { ...item };
      copy.location_on_pallet = palletId;
      copy.qty_on_pallet = String(qty);
      copy.total_ordered = String(qty);
      copy.total_shipped = String(qty);
      copy.unit_weight_lbs = String(meta.unitWeight);
      copy.calculated_weight_lbs = formatLbs(meta.unitWeight * qty);
      copy.packaging_level = 'Case';
      copy.pallet_weight = '';
      return copy;
    }

    function fitsTiHiLayout(pallet, item, meta, qty) {
      const palletId = normalizePalletId(pallet?.id) || '1';
      const candidateItems = [
        ...(pallet?.items || []).map(existing => ({ ...existing })),
        buildAutoPalletItemCopy(item, palletId, qty, meta)
      ];
      const tempMpl = {
        ...mpl,
        items: candidateItems,
        _tihi_constraints: defaultConstraints,
        _tihi_pallet_constraints: {}
      };
      const { entries } = buildMplTiHiEntries(tempMpl);
      const entry = entries.find(row => normalizePalletId(row.pallet) === palletId);
      if (!entry) return false;
      const constraints = constraintsForPallet();
      if ((entry.overflowCases || 0) > 0) return false;
      if (Number(entry.usedHeight || 0) > Number(constraints.max_height_in || 0) + 0.0001) return false;
      if (Number(entry.grossWeightLbs || 0) > Number(constraints.max_gross_lbs || 0) + 0.0001) return false;
      return true;
    }

    function fits(pallet, item, meta, qty) {
      if (!pallet || !meta || qty <= 0) return false;
      const constraints = constraintsForPallet();
      const maxCases = maxCasesWithinConstraints(meta, constraints);
      if (qty > maxCases) return false;
      const palletVolumeLimit = constraints.max_length_in * constraints.max_width_in * constraints.max_height_in;
      if (pallet.volume + meta.caseVolume * qty > palletVolumeLimit) return false;
      if (roundProductWeightForPallet((pallet.productWeight + meta.unitWeight * qty)) + TIHI_PALLET_TARE_LBS > constraints.max_gross_lbs) return false;
      return fitsTiHiLayout(pallet, item, meta, qty);
    }

    function addToPallet(pallet, item, qty, meta) {
      const copy = buildAutoPalletItemCopy(item, pallet.id, qty, meta);
      pallet.productWeight += meta.unitWeight * qty;
      pallet.volume += meta.caseVolume * qty;
      pallet.items.push(copy);
    }

    const palletizeQueue = originalItems
      .map((item, index) => {
        const product = matchCaseProductForPallet(item);
        const unitWeight = product ? (parseWeight(product.weight_lbs) ?? 0) : 0;
        return { item, index, product, unitWeight };
      })
      .sort((a, b) => (b.unitWeight - a.unitWeight) || (a.index - b.index));

    palletizeQueue.forEach(({ item, index, product }) => {
      const label = item.item_number || item.gtin || item.case_upc || item.sku || `Line ${index + 1}`;
      if (!product) {
        warnings.push(`${label}: no checked Case row matched in GTIN / Packaging Master. Kept Unassigned / Needs Review.`);
        unassigned.push({ ...item, location_on_pallet: '', pallet_weight: '' });
        return;
      }
      const meta = maxCasesForProduct(product, warnings, label, defaultConstraints);
      const qty = Math.max(0, Math.ceil(itemQuantityForWeight(item)));
      if (!meta || qty < 1) {
        unassigned.push({ ...item, location_on_pallet: '', pallet_weight: '' });
        return;
      }

      let placedWhole = false;
      for (const pallet of pallets) {
        if (fits(pallet, item, meta, qty)) {
          addToPallet(pallet, item, qty, meta);
          placedWhole = true;
          break;
        }
      }
      if (!placedWhole) {
        const newPallet = ensurePallet();
        if (fits(newPallet, item, meta, qty)) {
          addToPallet(newPallet, item, qty, meta);
          placedWhole = true;
        }
      }
      if (placedWhole) return;

      let remaining = qty;
      while (remaining > 0) {
        let moved = false;
        const chunkLimit = Math.max(0, Math.min(remaining, maxCasesWithinConstraints(meta, constraintsForPallet())));
        for (let chunk = chunkLimit; chunk >= 1; chunk -= 1) {
          const existingPallets = pallets.length ? pallets : [ensurePallet()];
          const targetPallet = existingPallets.find(pallet => fits(pallet, item, meta, chunk));
          if (targetPallet) {
            addToPallet(targetPallet, item, chunk, meta);
            remaining -= chunk;
            moved = true;
            break;
          }
        }
        if (!moved) {
          const lastPallet = pallets[pallets.length - 1];
          const newPallet = lastPallet && lastPallet.items.length === 0 ? lastPallet : ensurePallet();
          for (let chunk = chunkLimit; chunk >= 1; chunk -= 1) {
            if (fits(newPallet, item, meta, chunk)) {
              addToPallet(newPallet, item, chunk, meta);
              remaining -= chunk;
              moved = true;
              break;
            }
          }
          if (!moved) break;
        }
      }
      if (remaining > 0) {
        const leftover = { ...item, qty_on_pallet: String(remaining), total_ordered: String(remaining), total_shipped: String(remaining), location_on_pallet: '', pallet_weight: '' };
        unassigned.push(leftover);
        warnings.push(`${label}: ${remaining} case(s) could not be palletized. Kept Unassigned / Needs Review.`);
      }
    });

    const newItems = [];
    const weights = {};
    pallets.forEach(pallet => {
      weights[pallet.id] = palletDisplayWeight(pallet.productWeight);
      pallet.items.forEach(item => {
        item.pallet_weight = weights[pallet.id];
        newItems.push(item);
      });
    });
    unassigned.forEach(item => newItems.push(item));

    const mergeKeyForAutoItem = (item) => {
      const pallet = normalizePalletId(item.location_on_pallet);
      const identity = canonicalId(item.sku || item.item_number || item.gtin || item.case_upc || item.upc)
        || String(item.description || '').trim().toLowerCase();
      return [
        pallet || 'unassigned',
        identity,
        String(item.description || '').trim().toLowerCase(),
        String(item.uom || '').trim().toUpperCase(),
        String(item.expiration_date || '').trim(),
        String(item.unit_weight_lbs || '').trim(),
        String(item.dimensions_in || '').trim()
      ].join('|');
    };
    const mergedItems = [];
    const mergedMap = new Map();
    newItems.forEach(item => {
      const pallet = normalizePalletId(item.location_on_pallet);
      if (!pallet) {
        mergedItems.push(item);
        return;
      }
      const key = mergeKeyForAutoItem(item);
      const qty = Math.max(0, Math.ceil(itemQuantityForWeight(item)));
      const existing = mergedMap.get(key);
      if (!existing) {
        const copy = { ...item };
        copy.qty_on_pallet = String(qty);
        copy.total_ordered = String(qty);
        copy.total_shipped = String(qty);
        mergedMap.set(key, copy);
        mergedItems.push(copy);
        return;
      }
      const updatedQty = Math.max(0, Math.ceil(itemQuantityForWeight(existing))) + qty;
      existing.qty_on_pallet = String(updatedQty);
      existing.total_ordered = String(updatedQty);
      existing.total_shipped = String(updatedQty);
      const existingLines = String(existing.line || '').split(',').map(part => part.trim()).filter(Boolean);
      const nextLines = String(item.line || '').split(',').map(part => part.trim()).filter(Boolean);
      const mergedLines = [...new Set([...existingLines, ...nextLines])];
      if (mergedLines.length) existing.line = mergedLines.join(', ');
    });
    mpl.items = mergedItems;
    mpl._pallet_ids = pallets.map(p => p.id);
    mpl._pallet_weights = weights;
    mpl.total_pallets = String(mpl._pallet_ids.length || 1);
    const note = getXmlPalletMismatchNote(mpl, mpl._pallet_ids.length);
    markMplPalletizationSource(mpl, 'Auto Palletize', note);
    if (!Array.isArray(mpl.warnings)) mpl.warnings = [];
    mpl.warnings = [...new Set([...(mpl.warnings || []), ...warnings, note])];
    syncMplLineNumbers(mpl);
    keheLastMplDraft = activeKeheDocumentDraft;
    if (options.render !== false) {
      renderKeheUnifiedReport(activeKeheDocumentDraft);
      renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    }
    if (options.showStatus !== false) {
      setStatus(warnings.length ? 'Auto Palletize completed with Needs Review items. Check Unassigned rows and warnings.' : 'Auto Palletize completed.', warnings.length ? 'error' : 'success');
    }
    return { palletCount: mpl._pallet_ids.length, warnings: [...warnings] };
  }

  const TIHI_PALLET_LENGTH_IN = 48;
  const TIHI_PALLET_WIDTH_IN = 40;
  const TIHI_PALLET_MAX_HEIGHT_IN = 70;
  const TIHI_PALLET_MAX_GROSS_LBS = 2000;
  const TIHI_PALLET_TARE_LBS = 50;
  const TIHI_PALLET_BUFFER_FACTOR = 1.05;

  function defaultTiHiConstraints() {
    return {
      max_length_in: TIHI_PALLET_LENGTH_IN,
      max_width_in: TIHI_PALLET_WIDTH_IN,
      max_height_in: TIHI_PALLET_MAX_HEIGHT_IN,
      max_gross_lbs: TIHI_PALLET_MAX_GROSS_LBS
    };
  }

  function normalizeTiHiConstraints(raw = {}) {
    const defaults = defaultTiHiConstraints();
    const readPositive = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : fallback;
    };
    return {
      max_length_in: readPositive(raw.max_length_in, defaults.max_length_in),
      max_width_in: readPositive(raw.max_width_in, defaults.max_width_in),
      max_height_in: readPositive(raw.max_height_in, defaults.max_height_in),
      max_gross_lbs: readPositive(raw.max_gross_lbs, defaults.max_gross_lbs)
    };
  }

  function getMplTiHiConstraints(mpl, palletId = '') {
    if (!mpl) return defaultTiHiConstraints();
    mpl._tihi_constraints = normalizeTiHiConstraints(mpl._tihi_constraints || {});
    const normalizedPallet = normalizePalletId(palletId);
    if (normalizedPallet) {
      if (!mpl._tihi_pallet_constraints || typeof mpl._tihi_pallet_constraints !== 'object') {
        mpl._tihi_pallet_constraints = {};
      }
      mpl._tihi_pallet_constraints[normalizedPallet] = normalizeTiHiConstraints(
        mpl._tihi_pallet_constraints[normalizedPallet] || mpl._tihi_constraints
      );
      return mpl._tihi_pallet_constraints[normalizedPallet];
    }
    return mpl._tihi_constraints;
  }

  function bestTiHiOrientation(dims, constraints) {
    if (!dims) return null;
    const seen = new Set();
    const candidates = [
      [dims.l, dims.w],
      [dims.w, dims.l]
    ].map(([caseLength, caseWidth]) => {
      const key = `${caseLength}x${caseWidth}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const columns = Math.floor(constraints.max_length_in / caseLength);
      const rows = Math.floor(constraints.max_width_in / caseWidth);
      const ti = columns * rows;
      if (ti < 1) return null;
      const fillRatio = (columns * caseLength * rows * caseWidth) / (constraints.max_length_in * constraints.max_width_in);
      return { caseLength, caseWidth, caseHeight: dims.h, columns, rows, ti, fillRatio };
    }).filter(Boolean);
    if (!candidates.length) return null;
    return candidates.sort((a, b) => (b.ti - a.ti) || (b.fillRatio - a.fillRatio) || (a.caseWidth - b.caseWidth))[0];
  }

  function tihiLayerCapacity(group, constraints) {
    const orientation = group.baseOrientation || bestTiHiOrientation(group.dims, constraints);
    return Math.max(1, Number(orientation?.ti || 1));
  }

  function tihiItemLabel(item, index = 0) {
    return item?.sku || item?.item_number || item?.gtin || item?.case_upc || item?.description || `Line ${index + 1}`;
  }

  const TIHI_SKU_COLOR_PALETTE = [
    '#d99a4b', '#7db3ff', '#8fd19e', '#f5a3a3',
    '#b7a0ff', '#7fd8d0', '#f2cf63', '#f0b27a',
    '#6cc4a1', '#b6d36f', '#f28bb3', '#86a9f4',
    '#c89ee8', '#70c7e8', '#e2b66f', '#9fc0a0'
  ];

  function tihiColorForIndex(index) {
    return TIHI_SKU_COLOR_PALETTE[index % TIHI_SKU_COLOR_PALETTE.length];
  }

  function tihiColorIdentity(group) {
    return canonicalId(group?.sku || group?.itemNumber || group?.gtin || '')
      || String(group?.description || group?.label || '').trim().toLowerCase();
  }

  function tihiColorToRgb(color) {
    const raw = String(color || '').trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(raw)) return [0.85, 0.60, 0.29];
    return [
      parseInt(raw.slice(0, 2), 16) / 255,
      parseInt(raw.slice(2, 4), 16) / 255,
      parseInt(raw.slice(4, 6), 16) / 255
    ];
  }

  function tihiIntersectionArea(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.length, b.x + b.length);
    const y2 = Math.min(a.y + a.width, b.y + b.width);
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  }

  function tihiRectsOverlap(a, b) {
    return tihiIntersectionArea(a, b) > 0.001;
  }

  function tihiTopZ(placement) {
    return Number(placement.z || 0) + Number(placement.height ?? placement.case_height ?? 0);
  }

  function tihiZOverlaps(placement, baseZ, height) {
    const bottom = Number(placement.z || 0);
    const top = tihiTopZ(placement);
    return bottom < Number(baseZ || 0) + Number(height || 0) - 0.001 && top > Number(baseZ || 0) + 0.001;
  }

  function tihiSupportSurfaces(placements, layerBaseZ, constraints) {
    if (layerBaseZ <= 0.001) {
      return [{ x: 0, y: 0, length: constraints.max_length_in, width: constraints.max_width_in }];
    }
    return placements
      .filter(p => Math.abs((Number(p.z || 0) + Number(p.height || 0)) - layerBaseZ) <= 0.001)
      .map(p => ({ x: p.x, y: p.y, length: p.length, width: p.width, unitWeight: Number(p.unitWeight || 0) }));
  }

  function tihiSupportLevels(placements, constraints) {
    const levels = [0];
    (placements || []).forEach(placement => {
      const top = tihiTopZ(placement);
      if (top <= Number(constraints.max_height_in || 0) + 0.001 && !levels.some(level => Math.abs(level - top) <= 0.001)) {
        levels.push(top);
      }
    });
    return levels.sort((a, b) => a - b);
  }

  function tihiSupportRatio(placement, supportSurfaces, minSupportWeight = 0) {
    const area = placement.length * placement.width;
    if (!(area > 0)) return 0;
    const supported = supportSurfaces
      .filter(surface => !Number.isFinite(Number(surface.unitWeight)) || Number(surface.unitWeight || 0) + 0.001 >= minSupportWeight)
      .reduce((sum, surface) => sum + tihiIntersectionArea(placement, surface), 0);
    return Math.min(1, supported / area);
  }

  function tihiHasLighterSupportOverlap(placement, supportSurfaces, minSupportWeight = 0) {
    const requiredWeight = Number(minSupportWeight || 0);
    if (!(requiredWeight > 0)) return false;
    return supportSurfaces.some(surface => (
      Number.isFinite(Number(surface.unitWeight))
      && Number(surface.unitWeight || 0) + 0.001 < requiredWeight
      && tihiIntersectionArea(placement, surface) > 0.001
    ));
  }

  function tihiCandidateValues(rawValues, maxValue) {
    const values = [];
    rawValues.forEach(value => {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      const clamped = Math.min(Math.max(n, 0), maxValue);
      if (!values.some(existing => Math.abs(existing - clamped) < 0.001)) values.push(clamped);
    });
    return values.sort((a, b) => a - b);
  }

  function pickBestLayerPlacement(layerPlacements, supportSurfaces, itemDims, constraints, preferRotated = false, minSupportWeight = 0, blockingPlacements = null, baseZ = 0) {
    const options = [
      { length: itemDims.l, width: itemDims.w, height: itemDims.h, rotated: false },
      { length: itemDims.w, width: itemDims.l, height: itemDims.h, rotated: true }
    ].filter((opt, idx, arr) => idx === arr.findIndex(other => other.length === opt.length && other.width === opt.width));

    let best = null;
    const blockers = Array.isArray(blockingPlacements) ? blockingPlacements : layerPlacements;
    const isBetterScore = (left, right) => {
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const lv = left[i] ?? 0;
        const rv = right[i] ?? 0;
        if (lv === rv) continue;
        return lv > rv;
      }
      return false;
    };

    options.forEach(opt => {
      if (opt.length > constraints.max_length_in || opt.width > constraints.max_width_in) return;
      const maxX = constraints.max_length_in - opt.length;
      const maxY = constraints.max_width_in - opt.width;
      const xSeeds = [0, maxX];
      const ySeeds = [0, maxY];
      blockers.forEach(p => {
        xSeeds.push(p.x, p.x + p.length, p.x - opt.length);
        ySeeds.push(p.y, p.y + p.width, p.y - opt.width);
      });
      supportSurfaces.forEach(surface => {
        xSeeds.push(surface.x, surface.x + surface.length - opt.length, surface.x + surface.length, surface.x - opt.length);
        ySeeds.push(surface.y, surface.y + surface.width - opt.width, surface.y + surface.width, surface.y - opt.width);
      });

      const xs = tihiCandidateValues(xSeeds, maxX);
      const ys = tihiCandidateValues(ySeeds, maxY);
      xs.forEach(x => {
        ys.forEach(y => {
          const placement = { ...opt, x, y };
          if (blockers.some(existing => tihiZOverlaps(existing, baseZ, opt.height) && tihiRectsOverlap(placement, existing))) return;
          if (tihiHasLighterSupportOverlap(placement, supportSurfaces, minSupportWeight)) return;
          const supportRatio = tihiSupportRatio(placement, supportSurfaces, minSupportWeight);
          if (supportRatio < 0.8) return;
          const orientationTie = Math.floor(constraints.max_length_in / opt.length) * Math.floor(constraints.max_width_in / opt.width);
          const score = [
            opt.rotated === preferRotated ? 1 : 0,
            orientationTie,
            supportRatio,
            -(y),
            -(x)
          ];
          if (!best || isBetterScore(score, best.score)) {
            best = { placement, score, supportRatio };
          }
        });
      });
    });
    return best;
  }

  function subtractTihiRect(rect, cover) {
    const x1 = Math.max(rect.x, cover.x);
    const y1 = Math.max(rect.y, cover.y);
    const x2 = Math.min(rect.x + rect.length, cover.x + cover.length);
    const y2 = Math.min(rect.y + rect.width, cover.y + cover.width);
    if (x2 <= x1 || y2 <= y1) return [rect];

    const pieces = [];
    if (x1 > rect.x) pieces.push({ x: rect.x, y: rect.y, length: x1 - rect.x, width: rect.width });
    if (x2 < rect.x + rect.length) pieces.push({ x: x2, y: rect.y, length: rect.x + rect.length - x2, width: rect.width });
    const middleLength = x2 - x1;
    if (y1 > rect.y) pieces.push({ x: x1, y: rect.y, length: middleLength, width: y1 - rect.y });
    if (y2 < rect.y + rect.width) pieces.push({ x: x1, y: y2, length: middleLength, width: rect.y + rect.width - y2 });
    return pieces.filter(piece => piece.length > 0.001 && piece.width > 0.001);
  }

  function isTihiPlacementFullyCovered(placement, higherPlacements) {
    let uncovered = [{ x: placement.x, y: placement.y, length: placement.length, width: placement.width }];
    higherPlacements.forEach(higher => {
      const cover = { x: higher.x, y: higher.y, length: higher.length, width: higher.width };
      uncovered = uncovered.flatMap(piece => subtractTihiRect(piece, cover));
    });
    const uncoveredArea = uncovered.reduce((sum, piece) => sum + (piece.length * piece.width), 0);
    return uncoveredArea <= 0.001;
  }

  function visibleTopPlacementsForTiHi(placements) {
    return placements.filter(placement => {
      const top = Number(placement.z || 0) + Number(placement.height || 0);
      const higher = placements.filter(other => (Number(other.z || 0) + Number(other.height || 0)) > top + 0.001);
      return !isTihiPlacementFullyCovered(placement, higher);
    }).sort((a, b) => {
      const atop = Number(a.z || 0) + Number(a.height || 0);
      const btop = Number(b.z || 0) + Number(b.height || 0);
      return (atop - btop) || (Number(a.layerIndex || 0) - Number(b.layerIndex || 0));
    });
  }

  function tihiPatternLetter(index) {
    let n = Math.max(0, Number(index) || 0);
    let label = '';
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }

  function tihiPatternSignature(layerPlacements) {
    const q = value => Number(value || 0).toFixed(3);
    return [...layerPlacements]
      .sort((a, b) => (Number(a.y || 0) - Number(b.y || 0)) || (Number(a.x || 0) - Number(b.x || 0)) || String(a.label || '').localeCompare(String(b.label || '')))
      .map(p => [
        q(p.x),
        q(p.y),
        q(p.length),
        q(p.width),
        q(p.height),
        p.rotated ? 'R' : 'N',
        String(p.label || ''),
        String(p.color || '')
      ].join(':'))
      .join('|');
  }

  function buildTiHiLayerPatternData(placements) {
    const layers = new Map();
    (placements || []).forEach(placement => {
      const layerIndex = Number(placement.layerIndex || 0);
      if (!layers.has(layerIndex)) layers.set(layerIndex, []);
      layers.get(layerIndex).push(placement);
    });

    const signatureMap = new Map();
    const patterns = [];
    const rows = [];
    [...layers.keys()].sort((a, b) => a - b).forEach(layerIndex => {
      const layerPlacements = [...(layers.get(layerIndex) || [])].sort((a, b) => (Number(a.y || 0) - Number(b.y || 0)) || (Number(a.x || 0) - Number(b.x || 0)));
      const signature = tihiPatternSignature(layerPlacements);
      let patternIndex = signatureMap.get(signature);
      if (patternIndex === undefined) {
        patternIndex = patterns.length;
        signatureMap.set(signature, patternIndex);
        patterns.push({
          letter: tihiPatternLetter(patternIndex),
          signature,
          layers: [],
          placements: layerPlacements.map(p => ({ ...p }))
        });
      }
      const pattern = patterns[patternIndex];
      pattern.layers.push(layerIndex + 1);
      const z = Math.min(...layerPlacements.map(p => Number(p.z || 0)));
      const top = Math.max(...layerPlacements.map(p => Number(p.z || 0) + Number(p.height || 0)));
      layerPlacements.forEach(p => {
        p.patternLetter = pattern.letter;
        p.patternIndex = patternIndex;
      });
      rows.push({
        layerIndex,
        layerNumber: layerIndex + 1,
        letter: pattern.letter,
        z,
        height: Math.max(0, top - z),
        placements: layerPlacements
      });
    });
    return { patterns, rows };
  }

  function transformTiHiLayer(layer, constraints, flipX, flipY) {
    return (layer || []).map(placement => {
      const x = Number(placement.x || 0);
      const y = Number(placement.y || 0);
      const length = Number(placement.length || 0);
      const width = Number(placement.width || 0);
      return {
        ...placement,
        x: flipX ? Math.max(0, Number(constraints.max_length_in || 0) - x - length) : x,
        y: flipY ? Math.max(0, Number(constraints.max_width_in || 0) - y - width) : y
      };
    });
  }

  function tihiInternalXEdges(layer, maxLength) {
    const edges = [];
    (layer || []).forEach(placement => {
      const x = Number(placement.x || 0);
      const length = Number(placement.length || 0);
      [x, x + length].forEach(edge => {
        if (edge > 0.001 && edge < Number(maxLength || 0) - 0.001) {
          edges.push(Number(edge.toFixed(3)));
        }
      });
    });
    return edges;
  }

  function tihiEdgeOverlapScore(leftEdges, rightEdges) {
    let score = 0;
    const used = new Set();
    (leftEdges || []).forEach(left => {
      for (let index = 0; index < (rightEdges || []).length; index += 1) {
        if (used.has(index)) continue;
        if (Math.abs(left - rightEdges[index]) <= 0.001) {
          score += 1;
          used.add(index);
          break;
        }
      }
    });
    return score;
  }

  function tihiLayerVariantValid(originalLayer, candidateLayer, placements, constraints, levelZ) {
    const supportSurfaces = tihiSupportSurfaces(placements, levelZ, constraints);
    const originalSet = new Set(originalLayer || []);

    for (const placement of candidateLayer || []) {
      const placementWeight = Number(placement.unitWeight || 0);
      if (tihiHasLighterSupportOverlap(placement, supportSurfaces, placementWeight)) return false;
      const supportRatio = tihiSupportRatio(placement, supportSurfaces, placementWeight);
      if (supportRatio < 0.8) return false;
      placement.supportRatio = supportRatio;
    }

    for (let index = 0; index < candidateLayer.length; index += 1) {
      const placement = candidateLayer[index];
      for (let otherIndex = 0; otherIndex < candidateLayer.length; otherIndex += 1) {
        if (index === otherIndex) continue;
        const other = candidateLayer[otherIndex];
        if (tihiZOverlaps(other, Number(placement.z || 0), Number(placement.height || 0)) && tihiRectsOverlap(placement, other)) return false;
      }
      for (const other of placements || []) {
        if (originalSet.has(other)) continue;
        if (tihiZOverlaps(other, Number(placement.z || 0), Number(placement.height || 0)) && tihiRectsOverlap(placement, other)) return false;
      }
    }
    return true;
  }

  function finalizeHeightZonePatterns(placements, constraints) {
    if (!Array.isArray(placements) || !placements.length) return;
    const levels = [];
    placements.forEach(placement => {
      const z = Number(placement.z || 0);
      if (!levels.some(level => Math.abs(level - z) <= 0.001)) levels.push(z);
    });
    levels.sort((a, b) => a - b);

    levels.forEach((levelZ, levelIndex) => {
      const layer = placements.filter(placement => Math.abs(Number(placement.z || 0) - levelZ) <= 0.001);
      layer.forEach(placement => {
        placement.layerIndex = levelIndex;
      });

      const previousLayers = levels.slice(Math.max(0, levelIndex - 3), levelIndex)
        .map(previousZ => placements.filter(placement => Math.abs(Number(placement.z || 0) - previousZ) <= 0.001));
      const previousEdges = previousLayers.map(previousLayer => tihiInternalXEdges(previousLayer, constraints.max_length_in));
      const previousSignature = previousLayers.length ? tihiPatternSignature(previousLayers[previousLayers.length - 1]) : '';
      const variants = [
        [0, false, false],
        [1, true, false],
        [2, false, true],
        [3, true, true]
      ];
      let bestVariant = null;
      let bestScore = null;
      const isBetterScore = (left, right) => {
        if (!right) return true;
        for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
          const lv = left[index] ?? 0;
          const rv = right[index] ?? 0;
          if (lv === rv) continue;
          return lv > rv;
        }
        return false;
      };

      variants.forEach(([transformIndex, flipX, flipY]) => {
        const candidateLayer = transformTiHiLayer(layer, constraints, flipX, flipY);
        if (!tihiLayerVariantValid(layer, candidateLayer, placements, constraints, levelZ)) return;
        const candidateEdges = tihiInternalXEdges(candidateLayer, constraints.max_length_in);
        const immediatePenalty = previousEdges.length ? tihiEdgeOverlapScore(candidateEdges, previousEdges[previousEdges.length - 1]) : 0;
        const recentPenalty = previousEdges.slice(0, -1).reduce((sum, edges) => sum + tihiEdgeOverlapScore(candidateEdges, edges), 0);
        const signature = tihiPatternSignature(candidateLayer);
        const transformPreference = transformIndex === levelIndex % 4 ? 1 : 0;
        const score = [
          -(immediatePenalty * 3 + recentPenalty),
          signature === previousSignature ? 0 : 1,
          transformPreference,
          -transformIndex
        ];
        if (isBetterScore(score, bestScore)) {
          bestScore = score;
          bestVariant = candidateLayer;
        }
      });

      if (!bestVariant) return;
      layer.forEach((placement, index) => {
        placement.x = bestVariant[index].x;
        placement.y = bestVariant[index].y;
        placement.supportRatio = bestVariant[index].supportRatio;
      });
    });
  }

  function buildPalletTiHiLayout(itemGroups, constraints) {
    const placements = [];
    const overflow = [];

    const activeGroups = [...itemGroups]
      .sort((a, b) => (b.unitWeight - a.unitWeight) || (a.sortIndex - b.sortIndex))
      .map(group => ({ ...group, remainingCases: group.assignedCases }));

    while (activeGroups.some(group => group.remainingCases > 0)) {
      let candidate = null;
      const supportLevels = tihiSupportLevels(placements, constraints);
      const isBetterCandidateScore = (left, right) => {
        for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
          const lv = left[i] ?? 0;
          const rv = right[i] ?? 0;
          if (lv === rv) continue;
          return lv > rv;
        }
        return false;
      };
      activeGroups.forEach(group => {
        if (group.remainingCases <= 0) return;
        supportLevels.forEach((baseZ, levelIndex) => {
          if (baseZ >= Number(constraints.max_height_in || 0) - 0.001) return;
          const supportSurfaces = tihiSupportSurfaces(placements, baseZ, constraints);
          if (!supportSurfaces.length) return;
          const bestFit = pickBestLayerPlacement([], supportSurfaces, group.dims, constraints, levelIndex % 2 === 1, group.unitWeight || 0, placements, baseZ);
          if (!bestFit) return;
          const placement = bestFit.placement;
          if (baseZ + Number(placement.height || 0) > constraints.max_height_in + 0.001) return;
          const layerCapacity = tihiLayerCapacity(group, constraints);
          const layerCaseCount = Math.min(Number(group.remainingCases || 0), layerCapacity);
          const score = [
            -(Number(baseZ || 0)),
            group.unitWeight || 0,
            Number(group.remainingCases || 0) >= layerCapacity ? 1 : 0,
            layerCaseCount,
            placement.length * placement.width,
            ...(bestFit.score || [])
          ];
          if (!candidate || isBetterCandidateScore(score, candidate.score)) {
            candidate = { group, bestFit, score, baseZ };
          }
        });
      });

      if (!candidate) {
        activeGroups.forEach(group => {
          while (group.remainingCases > 0) {
            overflow.push(group);
            group.remainingCases -= 1;
          }
        });
        break;
      }

      const { group, bestFit } = candidate;
      const finalPlacement = bestFit.placement;
      const baseZ = Number(candidate.baseZ || 0);
      const placed = {
        pallet: group.pallet,
        label: group.label,
        color: group.color,
        lineLabel: group.lines.join(', '),
        x: finalPlacement.x,
        y: finalPlacement.y,
        z: baseZ,
        layerIndex: 0,
        length: finalPlacement.length,
        width: finalPlacement.width,
        height: finalPlacement.height,
        rotated: !!finalPlacement.rotated,
        supportRatio: Number(bestFit.supportRatio || 1),
        unitWeight: Number(group.unitWeight || 0)
      };
      placements.push(placed);

      group.remainingCases -= 1;
    }

    finalizeHeightZonePatterns(placements, constraints);

    const usedHeight = placements.reduce((max, placement) => Math.max(max, tihiTopZ(placement)), 0);
    const caseVolume = placements.reduce((sum, p) => sum + (p.length * p.width * p.height), 0);
    return {
      placements,
      usedHeight,
      overflowCount: overflow.length,
      palletFillPct: Math.min(100, (caseVolume / (constraints.max_length_in * constraints.max_width_in * constraints.max_height_in)) * 100)
    };
  }

  function buildMplTiHiEntries(mpl) {
    const items = Array.isArray(mpl?.items) ? mpl.items : [];
    const grouped = new Map();
    const warnings = [];
    const constraints = getMplTiHiConstraints(mpl);

    items.forEach((item, index) => {
      const pallet = normalizePalletId(item.location_on_pallet) || '1';
      const assignedCases = Math.max(0, Math.ceil(itemQuantityForWeight(item)));
      if (!assignedCases) return;

      const fallbackProduct = matchCaseProductForPallet(item) || {};
      const dimensionsIn = String(item.dimensions_in || fallbackProduct.dimensions_in || '').trim();
      const weightLbs = String(item.unit_weight_lbs || fallbackProduct.weight_lbs || '').trim();
      const dims = parseDimensionsInches(dimensionsIn);
      const unitWeight = parseWeight(weightLbs);
      const label = tihiItemLabel(item, index);

      if (!dims) {
        warnings.push(`Pallet ${pallet} / ${label}: missing Case dimensions in product master.`);
        return;
      }
      if (unitWeight === null || unitWeight <= 0) {
        warnings.push(`Pallet ${pallet} / ${label}: missing Case weight in product master.`);
        return;
      }

      const entityKey = canonicalId(item.sku || item.item_number || item.gtin || item.case_upc || item.upc)
        || String(item.description || '').trim().toLowerCase()
        || `line-${index + 1}`;
      const key = [pallet, entityKey, dimensionsIn, weightLbs].join('|');
      if (!grouped.has(key)) {
        grouped.set(key, {
          pallet,
          sku: item.sku || fallbackProduct.sku || '',
          itemNumber: item.item_number || '',
          gtin: item.gtin || item.case_upc || item.upc || fallbackProduct.gtin || '',
          description: item.description || fallbackProduct.description || '',
          dimensionsIn,
          weightLbs,
          dims,
          unitWeight,
          assignedCases: 0,
          lines: [],
          sortIndex: index
        });
      }
      const group = grouped.get(key);
      group.assignedCases += assignedCases;
      if (item.line !== undefined && item.line !== null && String(item.line).trim()) {
        group.lines.push(String(item.line).trim());
      }
    });

    const palletGroups = {};
    const colorBySku = new Map();
    Array.from(grouped.values())
      .sort((a, b) => (Number(a.pallet) || 0) - (Number(b.pallet) || 0) || a.sortIndex - b.sortIndex)
      .forEach((group, index) => {
        const label = group.sku || group.itemNumber || group.gtin || group.description || `Item ${index + 1}`;
        const groupConstraints = getMplTiHiConstraints(mpl, group.pallet);
        const orientation = bestTiHiOrientation(group.dims, groupConstraints);
        if (!orientation) {
          warnings.push(`Pallet ${group.pallet} / ${label}: Case footprint exceeds the pallet base.`);
          return;
        }
        group.label = label;
        const colorKey = tihiColorIdentity({ ...group, label }) || `group-${index}`;
        if (!colorBySku.has(colorKey)) {
          colorBySku.set(colorKey, tihiColorForIndex(colorBySku.size));
        }
        group.color = colorBySku.get(colorKey);
        group.baseOrientation = orientation;
        group.lines = [...new Set(group.lines)].sort((a, b) => Number(a) - Number(b));
        if (!palletGroups[group.pallet]) palletGroups[group.pallet] = [];
        palletGroups[group.pallet].push(group);
      });

    const entries = Object.entries(palletGroups).map(([palletId, groups]) => {
      const palletConstraints = getMplTiHiConstraints(mpl, palletId);
      const totalWeight = groups.reduce((sum, group) => sum + (group.unitWeight * group.assignedCases), 0);
      const grossWeightLbs = roundProductWeightForPallet(totalWeight) + TIHI_PALLET_TARE_LBS;
      if (grossWeightLbs > palletConstraints.max_gross_lbs) {
        warnings.push(`Pallet ${palletId}: gross pallet weight ${Math.round(grossWeightLbs)} lbs exceeds the ${palletConstraints.max_gross_lbs} lb limit.`);
      }
      groups.sort((a, b) => (b.unitWeight - a.unitWeight) || (a.sortIndex - b.sortIndex));
      const layout = buildPalletTiHiLayout(groups, palletConstraints);
      const { placements, usedHeight, overflowCount } = layout;
      if (!placements.length) {
        warnings.push(`Pallet ${palletId}: no TI-Hi layout could be created from the assigned case measurements.`);
        return null;
      }
      const layerBuckets = new Map();
      placements.forEach(p => {
        const key = Number(p.layerIndex || 0);
        if (!layerBuckets.has(key)) layerBuckets.set(key, []);
        layerBuckets.get(key).push(p);
      });
      const maxLayer = Math.max(...placements.map(p => p.layerIndex));
      const displayLayer = maxLayer;
      const topPlacements = visibleTopPlacementsForTiHi(placements);
      const topRowsUsed = new Set(topPlacements.map(p => `${p.y.toFixed(4)}:${p.width.toFixed(4)}`)).size || 1;
      const maxCasesInLayer = Math.max(...[...layerBuckets.values()].map(layer => layer.length));
      const layerPatternData = buildTiHiLayerPatternData(placements);
      const caseCount = placements.length;
      return {
        pallet: palletId,
        palletLabel: palletId,
        constraints: palletConstraints,
        placements,
        topPlacements,
        layerPatterns: layerPatternData.patterns,
        layerPatternRows: layerPatternData.rows,
        groups,
        assignedCases: groups.reduce((sum, group) => sum + group.assignedCases, 0),
        shownCases: caseCount,
        overflowCases: overflowCount,
        ti: maxCasesInLayer,
        hi: maxLayer + 1,
        displayLayer,
        topRowsUsed,
        topLayerCases: topPlacements.length,
        grossWeightLbs,
        palletFillPct: Number(layout.palletFillPct || 0),
        usedHeight,
        lines: [...new Set(groups.flatMap(group => group.lines))].sort((a, b) => Number(a) - Number(b))
      };
    }).filter(Boolean);

    entries.sort((a, b) => (Number(a.pallet) || 0) - (Number(b.pallet) || 0));

    return { entries, warnings: [...new Set(warnings)], constraints };
  }

  function copyElementComputedStyles(source, target) {
    const computed = window.getComputedStyle(source);
    for (const prop of computed) {
      target.style.setProperty(prop, computed.getPropertyValue(prop), computed.getPropertyPriority(prop));
    }
    Array.from(source.children || []).forEach((child, index) => {
      if (target.children[index]) copyElementComputedStyles(child, target.children[index]);
    });
  }

  async function renderElementToPngDataUrl(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));
    const cloned = element.cloneNode(true);
    copyElementComputedStyles(element, cloned);
    cloned.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const markup = new XMLSerializer().serializeToString(cloned);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#ffffff;overflow:hidden;">${markup}</div>
        </foreignObject>
      </svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function renderMplTiHiCardSnapshot(entry, constraints) {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.width = '720px';
    host.style.padding = '0';
    host.style.background = '#ffffff';
    host.style.zIndex = '-1';
    host.innerHTML = renderMplTiHiCard(entry, 0, entry.constraints || constraints, false);
    document.body.appendChild(host);
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const card = host.querySelector('.tihi-card');
      if (!card) return '';
      return await renderElementToPngDataUrl(card);
    } catch (_err) {
      return '';
    } finally {
      host.remove();
    }
  }

  function drawSnapshotRect(ctx, x, y, w, h, fill = '#ffffff', stroke = '#cbd5e1', lineWidth = 1) {
    ctx.save();
    ctx.fillStyle = fill;
    if (stroke) ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    if (stroke) ctx.stroke();
    ctx.restore();
  }

  function drawSnapshotText(ctx, text, x, y, options = {}) {
    ctx.save();
    ctx.fillStyle = options.color || '#0f172a';
    ctx.font = `${options.weight || 700} ${options.size || 12}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = options.align || 'left';
    ctx.textBaseline = options.baseline || 'top';
    ctx.fillText(String(text ?? ''), x, y, options.maxWidth);
    ctx.restore();
  }

  function drawSnapshotWrappedText(ctx, text, x, y, maxWidth, lineHeight, options = {}) {
    ctx.save();
    ctx.fillStyle = options.color || '#334155';
    ctx.font = `${options.weight || 700} ${options.size || 11}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(word => {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    const maxLines = options.maxLines || lines.length || 1;
    lines.slice(0, maxLines).forEach((row, index) => {
      const suffix = index === maxLines - 1 && lines.length > maxLines ? '...' : '';
      ctx.fillText(`${row}${suffix}`, x, y + (index * lineHeight), maxWidth);
    });
    ctx.restore();
  }

  function drawSnapshotTopView(ctx, entry, constraints, x, y, w, h) {
    drawSnapshotRect(ctx, x, y, w, h, '#f8fafc', '#cbd5e1', 1);
    drawSnapshotText(ctx, 'Top View', x + (w / 2), y + 18, { align: 'center', size: 13, weight: 900, color: '#020617' });
    const pad = 42;
    const areaX = x + pad;
    const areaY = y + 58;
    const areaW = w - (pad * 2);
    const areaH = h - 94;
    const scale = Math.min(areaW / constraints.max_length_in, areaH / constraints.max_width_in);
    const palletW = constraints.max_length_in * scale;
    const palletH = constraints.max_width_in * scale;
    const px = areaX + ((areaW - palletW) / 2);
    const py = areaY + ((areaH - palletH) / 2);
    drawSnapshotRect(ctx, px, py, palletW, palletH, '#ffffff', '#334155', 2);
    (entry.topPlacements || []).forEach(p => {
      const rx = px + (Number(p.x || 0) * scale);
      const ry = py + palletH - ((Number(p.y || 0) + Number(p.width || 0)) * scale);
      drawSnapshotRect(ctx, rx, ry, Number(p.length || 0) * scale, Number(p.width || 0) * scale, p.color || '#d99a4b', '#6b4c24', 1);
    });
    drawSnapshotText(ctx, `${constraints.max_length_in} in`, px, y + h - 26, { size: 9, weight: 800, color: '#64748b' });
    drawSnapshotText(ctx, `Visible top surfaces ${entry.topLayerCases || 0} case(s)`, x + (w / 2), y + h - 26, { align: 'center', size: 9, weight: 800, color: '#64748b' });
    drawSnapshotText(ctx, `${constraints.max_width_in} in`, px + palletW, y + h - 26, { align: 'right', size: 9, weight: 800, color: '#64748b' });
  }

  function drawSnapshotSideView(ctx, entry, constraints, x, y, w, h) {
    drawSnapshotRect(ctx, x, y, w, h, '#f8fafc', '#cbd5e1', 1);
    drawSnapshotText(ctx, 'Side View', x + (w / 2), y + 18, { align: 'center', size: 13, weight: 900, color: '#020617' });
    const pad = 48;
    const areaX = x + pad;
    const areaY = y + 54;
    const areaW = w - (pad * 2);
    const areaH = h - 90;
    const scale = Math.min(areaW / constraints.max_length_in, areaH / constraints.max_height_in);
    const palletW = constraints.max_length_in * scale;
    const frameH = constraints.max_height_in * scale;
    const px = areaX + ((areaW - palletW) / 2);
    const py = areaY + ((areaH - frameH) / 2);
    const palletBaseH = 10;
    const stackBaseY = py + frameH - palletBaseH;
    drawSnapshotRect(ctx, px, py, palletW, frameH, '#ffffff', '#334155', 2);
    (entry.placements || []).forEach(p => {
      const rx = px + (Number(p.x || 0) * scale);
      const ry = stackBaseY - ((Number(p.z || 0) + Number(p.height || 0)) * scale);
      drawSnapshotRect(ctx, rx, ry, Number(p.length || 0) * scale, Number(p.height || 0) * scale, p.color || '#d99a4b', '#6b4c24', 1);
    });
    (entry.layerPatternRows || []).forEach((row, index) => {
      const cy = stackBaseY - ((Number(row.z || 0) + (Number(row.height || 0) / 2)) * scale);
      const lx = index % 2 === 0 ? Math.max(x + 18, px - 16) : Math.min(x + w - 20, px + palletW + 16);
      drawSnapshotText(ctx, row.letter || '', lx, cy - 7, { align: 'center', size: 13, weight: 900, color: '#dc2626' });
    });
    drawSnapshotRect(ctx, px, stackBaseY, palletW, palletBaseH, '#ad9d77', '#5b5240', 1);
    const notchW = palletW / 4.5;
    drawSnapshotRect(ctx, px + (notchW * 0.75), stackBaseY + 2, notchW * 0.8, palletBaseH - 4, '#ffffff', '', 0);
    drawSnapshotRect(ctx, px + (notchW * 2.5), stackBaseY + 2, notchW * 0.8, palletBaseH - 4, '#ffffff', '', 0);
    drawSnapshotText(ctx, `${constraints.max_length_in} in`, px, y + h - 26, { size: 9, weight: 800, color: '#64748b' });
    drawSnapshotText(ctx, `${Math.round(Number(entry.usedHeight || 0))} in used height`, x + (w / 2), y + h - 26, { align: 'center', size: 9, weight: 800, color: '#64748b' });
    drawSnapshotText(ctx, `${entry.hi || 0} layer(s)`, px + palletW, y + h - 26, { align: 'right', size: 9, weight: 800, color: '#64748b' });
  }

  function drawSnapshotPatternMini(ctx, pattern, constraints, x, y, w, h) {
    const pad = 5;
    const scale = Math.min((w - (2 * pad)) / constraints.max_length_in, (h - (2 * pad)) / constraints.max_width_in);
    const palletW = constraints.max_length_in * scale;
    const palletH = constraints.max_width_in * scale;
    const px = x + ((w - palletW) / 2);
    const py = y + ((h - palletH) / 2);
    drawSnapshotRect(ctx, px, py, palletW, palletH, '#ffffff', '#334155', 1);
    (pattern.placements || []).forEach(p => {
      const rx = px + (Number(p.x || 0) * scale);
      const ry = py + palletH - ((Number(p.y || 0) + Number(p.width || 0)) * scale);
      drawSnapshotRect(ctx, rx, ry, Number(p.length || 0) * scale, Number(p.width || 0) * scale, p.color || '#d99a4b', '#6b4c24', 0.8);
    });
  }

  function drawSnapshotLayerPatterns(ctx, entry, constraints, x, y, w) {
    const patterns = entry.layerPatterns || [];
    if (!patterns.length) return 0;
    const cols = Math.min(4, Math.max(1, patterns.length));
    const itemW = (w - ((cols - 1) * 8)) / cols;
    const itemH = 72;
    const rows = Math.ceil(patterns.length / cols);
    const h = 22 + (rows * itemH) + ((rows - 1) * 7);
    drawSnapshotRect(ctx, x, y, w, h, '#f8fafc', '#e2e8f0', 1);
    drawSnapshotText(ctx, 'LAYER PATTERNS', x + 8, y + 7, { size: 8, weight: 900, color: '#334155' });
    patterns.forEach((pattern, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const px = x + (col * (itemW + 8));
      const py = y + 22 + (row * (itemH + 7));
      drawSnapshotRect(ctx, px, py, itemW, itemH, '#ffffff', '#dbe4ef', 1);
      drawSnapshotText(ctx, pattern.letter || '', px + 11, py + 8, { align: 'center', size: 11, weight: 900, color: '#0f172a' });
      drawSnapshotPatternMini(ctx, pattern, constraints, px + 24, py + 7, Math.min(72, itemW - 30), 45);
      drawSnapshotWrappedText(ctx, `Layers ${(pattern.layers || []).join(', ') || '-'}`, px + 6, py + 55, itemW - 12, 9, { size: 8, weight: 800, color: '#334155', maxLines: 1 });
    });
    return h;
  }

  function renderMplTiHiEntryCanvasSnapshot(mpl, entry) {
    const constraints = entry.constraints || getMplTiHiConstraints(mpl, entry.palletLabel);
    const groups = entry.groups || [];
    const patternRows = Math.max(0, Math.ceil((entry.layerPatterns || []).length / 4));
    const width = 980;
    const legendRows = Math.max(1, Math.ceil(groups.length / 2));
    const patternH = patternRows ? 22 + (patternRows * 72) + ((patternRows - 1) * 7) + 12 : 0;
    const cardH = 588 + patternH + (legendRows * 28);
    const height = cardH + 48;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const x = 28;
    let y = 24;
    drawSnapshotRect(ctx, x, y, width - 56, cardH, '#f8fbff', '#0f5ea8', 2);
    drawSnapshotText(ctx, `Pallet ${entry.palletLabel} - Current edited layout`, x + 12, y + 14, { size: 14, weight: 900, color: '#020617' });
    drawSnapshotText(ctx, `${groups.length} item group(s) on this pallet`, x + 12, y + 34, { size: 10, weight: 800, color: '#334155' });

    const statW = (width - 80) / 2;
    const statH = 38;
    const statY = y + 64;
    const stats = [
      ['Assigned', `${entry.assignedCases || 0} case(s)`],
      ['Shown / Overflow', `${entry.shownCases || 0} shown - ${entry.overflowCases || 0} overflow`],
      ['TI x HI', `${entry.ti || 0} x ${entry.hi || 0}`],
      ['Pallet Use', `${Number(entry.palletFillPct || 0).toFixed(1)}% volume - ${Math.round(Number(entry.grossWeightLbs || 0))} lbs gross`]
    ];
    stats.forEach((stat, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const sx = x + 12 + (col * (statW + 12));
      const sy = statY + (row * (statH + 8));
      drawSnapshotRect(ctx, sx, sy, statW, statH, '#f8fafc', '#e2e8f0', 1);
      drawSnapshotText(ctx, stat[0].toUpperCase(), sx + 9, sy + 7, { size: 8, weight: 900, color: '#334155' });
      drawSnapshotText(ctx, stat[1], sx + 9, sy + 21, { size: 10, weight: 800, color: '#0f172a' });
    });

    const diagramY = statY + 96;
    const diagramW = (width - 112) / 2;
    const diagramH = 350;
    drawSnapshotTopView(ctx, entry, constraints, x + 36, diagramY, diagramW, diagramH);
    drawSnapshotSideView(ctx, entry, constraints, x + 60 + diagramW, diagramY, diagramW, diagramH);

    let legendY = diagramY + diagramH + 18;
    const renderedPatternH = drawSnapshotLayerPatterns(ctx, entry, constraints, x + 12, legendY, width - 80);
    if (renderedPatternH) legendY += renderedPatternH + 12;
    const legendW = (width - 96) / 2;
    groups.forEach((group, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const lx = x + 12 + (col * (legendW + 12));
      const ly = legendY + (row * 28);
      drawSnapshotRect(ctx, lx, ly, legendW, 24, '#f8fafc', '#e2e8f0', 1);
      drawSnapshotRect(ctx, lx + 8, ly + 6, 12, 12, group.color || '#d99a4b', '#475569', 1);
      drawSnapshotWrappedText(
        ctx,
        `${group.label || ''} - Lines ${group.lines?.join(', ') || '-'} - ${group.assignedCases || 0} case(s) - ${group.dimensionsIn || ''}`,
        lx + 28,
        ly + 5,
        legendW - 36,
        10,
        { size: 9, weight: 800, color: '#334155', maxLines: 2 }
      );
    });
    drawSnapshotText(ctx, `MPL lines: ${(entry.lines || []).join(', ')}`, x + 12, y + cardH - 20, { size: 10, weight: 800, color: '#334155' });

    return canvas.toDataURL('image/png');
  }

  async function captureMplTiHiEntrySnapshot(mpl, entry) {
    const domImage = await renderMplTiHiCardSnapshot(entry, entry.constraints || getMplTiHiConstraints(mpl, entry.palletLabel));
    if (domImage) return domImage;
    return renderMplTiHiEntryCanvasSnapshot(mpl, entry);
  }

  async function buildMplTiHiSnapshotPayload(mpl) {
    const { entries, warnings, constraints } = buildMplTiHiEntries(mpl);
    const entryImageDataUrls = [];
    for (const entry of entries) {
      entryImageDataUrls.push(await captureMplTiHiEntrySnapshot(mpl, entry));
    }
    const mapPlacement = p => ({
      x: Number(p.x || 0),
      y: Number(p.y || 0),
      z: Number(p.z || 0),
      layer_index: Number(p.layerIndex || 0),
      case_length: Number(p.length || 0),
      case_width: Number(p.width || 0),
      case_height: Number(p.height || 0),
      rotated: !!p.rotated,
      unit_weight: Number(p.unitWeight || 0),
      pattern_letter: p.patternLetter || '',
      color: tihiColorToRgb(p.color)
    });
    const mapPattern = pattern => ({
      letter: pattern.letter || '',
      layers: [...(pattern.layers || [])].map(value => Number(value || 0)).filter(Boolean),
      placements: (pattern.placements || []).map(mapPlacement)
    });
    return {
      constraints: {
        max_length_in: Number(constraints.max_length_in),
        max_width_in: Number(constraints.max_width_in),
        max_height_in: Number(constraints.max_height_in),
        max_gross_lbs: Number(constraints.max_gross_lbs)
      },
      warnings: [...warnings],
      sheet_image_data_url: '',
      entries: entries.map((entry, index) => ({
        pallet: entry.pallet,
        pallet_label: entry.palletLabel,
        image_data_url: entryImageDataUrls[index] || '',
        placements: (entry.placements || []).map(mapPlacement),
        top_placements: (entry.topPlacements || []).map(mapPlacement),
        layer_patterns: (entry.layerPatterns || []).map(mapPattern),
        layer_pattern_rows: (entry.layerPatternRows || []).map(row => ({
          layer_index: Number(row.layerIndex || 0),
          layer_number: Number(row.layerNumber || 0),
          letter: row.letter || '',
          z: Number(row.z || 0),
          height: Number(row.height || 0)
        })),
        groups: (entry.groups || []).map(group => ({
          label: group.label,
          assigned_cases: Number(group.assignedCases || 0),
          dimensions_in: group.dimensionsIn || '',
          lines: [...(group.lines || [])],
          color: tihiColorToRgb(group.color)
        })),
        constraints: {
          max_length_in: Number((entry.constraints || constraints).max_length_in),
          max_width_in: Number((entry.constraints || constraints).max_width_in),
          max_height_in: Number((entry.constraints || constraints).max_height_in),
          max_gross_lbs: Number((entry.constraints || constraints).max_gross_lbs)
        },
        assigned_cases: Number(entry.assignedCases || 0),
        shown_cases: Number(entry.shownCases || 0),
        overflow_cases: Number(entry.overflowCases || 0),
        ti: Number(entry.ti || 0),
        hi: Number(entry.hi || 0),
        top_rows_used: Number(entry.topRowsUsed || 0),
        top_layer_cases: Number(entry.topLayerCases || 0),
        gross_weight_lbs: Number(entry.grossWeightLbs || 0),
        pallet_fill_pct: Number(entry.palletFillPct || 0),
        used_height: Number(entry.usedHeight || 0),
        lines: [...(entry.lines || [])]
      }))
    };
  }

  async function captureCurrentMplTiHiSnapshots(draft) {
    for (const mpl of (draft?.packing_lists || [])) {
      try {
        mpl._tihi_snapshot = await buildMplTiHiSnapshotPayload(mpl);
      } catch (err) {
        console.warn('TI-HI snapshot capture failed; MPL will use backend fallback rendering.', err);
        delete mpl._tihi_snapshot;
      }
    }
  }

  function getMplTiHiSectionId(mplIndex, palletId, prefix = 'tihi') {
    const safe = String(palletId || '1').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    return `mpl-${mplIndex}-${prefix}-${safe}`;
  }

  function renderTiHiTopViewSvg(entry, constraints) {
    const width = 340;
    const height = 260;
    const pad = 12;
    const scale = Math.min((width - (2 * pad)) / constraints.max_length_in, (height - (2 * pad)) / constraints.max_width_in);
    const palletW = constraints.max_length_in * scale;
    const palletH = constraints.max_width_in * scale;
    const originX = (width - palletW) / 2;
    const originY = (height - palletH) / 2;
    const rects = (entry.topPlacements || []).map(p =>
      `<rect x="${(originX + (p.x * scale)).toFixed(2)}" y="${(originY + palletH - ((p.y + p.width) * scale)).toFixed(2)}" width="${(p.length * scale).toFixed(2)}" height="${(p.width * scale).toFixed(2)}" fill="${p.color}" stroke="#6b4c24" stroke-width="1"/>`
    );
    return `
      <div class="tihi-svg-wrap">
        <svg class="tihi-svg" viewBox="0 0 ${width} ${height}" aria-label="TI-Hi top view">
          <rect x="${originX.toFixed(2)}" y="${originY.toFixed(2)}" width="${palletW.toFixed(2)}" height="${palletH.toFixed(2)}" fill="#ffffff" stroke="#334155" stroke-width="1.4"/>
          ${rects.join('')}
        </svg>
      </div>`;
  }

  function renderTiHiSideViewSvg(entry, constraints) {
    const width = 330;
    const height = 320;
    const pad = 18;
    const scale = Math.min((width - (2 * pad)) / constraints.max_length_in, (height - (2 * pad)) / constraints.max_height_in);
    const palletW = constraints.max_length_in * scale;
    const frameH = constraints.max_height_in * scale;
    const originX = (width - palletW) / 2;
    const frameY = (height - frameH) / 2;
    const palletBaseH = 8;
    const stackBaseY = frameY + frameH - palletBaseH;
    const rects = (entry.placements || []).map(p =>
      `<rect x="${(originX + (p.x * scale)).toFixed(2)}" y="${(stackBaseY - ((p.z + p.height) * scale)).toFixed(2)}" width="${(p.length * scale).toFixed(2)}" height="${(p.height * scale).toFixed(2)}" fill="${p.color}" stroke="#6b4c24" stroke-width="1"/>`
    );
    const patternLabels = (entry.layerPatternRows || []).map((row, index) => {
      const cy = stackBaseY - ((Number(row.z || 0) + (Number(row.height || 0) / 2)) * scale);
      const lx = index % 2 === 0 ? Math.max(12, originX - 11) : Math.min(width - 18, originX + palletW + 11);
      return `<text x="${lx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" fill="#dc2626">${escapeHtml(row.letter || '')}</text>`;
    });
    const notchW = palletW / 4.5;
    return `
      <div class="tihi-svg-wrap">
        <svg class="tihi-svg side" viewBox="0 0 ${width} ${height}" aria-label="TI-Hi side view">
          <rect x="${originX.toFixed(2)}" y="${frameY.toFixed(2)}" width="${palletW.toFixed(2)}" height="${frameH.toFixed(2)}" fill="#ffffff" stroke="#334155" stroke-width="1.2"/>
          ${rects.join('')}
          ${patternLabels.join('')}
          <rect x="${originX.toFixed(2)}" y="${stackBaseY.toFixed(2)}" width="${palletW.toFixed(2)}" height="${palletBaseH}" fill="#ad9d77" stroke="#5b5240" stroke-width="1"/>
          <rect x="${(originX + (notchW * 0.75)).toFixed(2)}" y="${(stackBaseY + 1.5).toFixed(2)}" width="${(notchW * 0.8).toFixed(2)}" height="${(palletBaseH - 3).toFixed(2)}" fill="#ffffff" stroke="none"/>
          <rect x="${(originX + (notchW * 2.5)).toFixed(2)}" y="${(stackBaseY + 1.5).toFixed(2)}" width="${(notchW * 0.8).toFixed(2)}" height="${(palletBaseH - 3).toFixed(2)}" fill="#ffffff" stroke="none"/>
        </svg>
      </div>`;
  }

  function renderTiHiPatternMiniSvg(pattern, constraints) {
    const width = 92;
    const height = 72;
    const pad = 7;
    const scale = Math.min((width - (2 * pad)) / constraints.max_length_in, (height - (2 * pad)) / constraints.max_width_in);
    const palletW = constraints.max_length_in * scale;
    const palletH = constraints.max_width_in * scale;
    const originX = (width - palletW) / 2;
    const originY = (height - palletH) / 2;
    const rects = (pattern.placements || []).map(p =>
      `<rect x="${(originX + (p.x * scale)).toFixed(2)}" y="${(originY + palletH - ((p.y + p.width) * scale)).toFixed(2)}" width="${(p.length * scale).toFixed(2)}" height="${(p.width * scale).toFixed(2)}" fill="${escapeHtml(p.color || '#d99a4b')}" stroke="#6b4c24" stroke-width="0.8"/>`
    );
    return `
      <svg class="tihi-pattern-svg" viewBox="0 0 ${width} ${height}" aria-label="Layer pattern ${escapeHtml(pattern.letter || '')}">
        <rect x="${originX.toFixed(2)}" y="${originY.toFixed(2)}" width="${palletW.toFixed(2)}" height="${palletH.toFixed(2)}" fill="#ffffff" stroke="#334155" stroke-width="1"/>
        ${rects.join('')}
      </svg>`;
  }

  function renderTiHiLayerPatterns(entry, constraints) {
    const patterns = entry.layerPatterns || [];
    if (!patterns.length) return '';
    return `
      <div class="tihi-layer-patterns">
        <div class="tihi-layer-pattern-title">Layer Patterns</div>
        <div class="tihi-layer-pattern-grid">
          ${patterns.map(pattern => `
            <div class="tihi-layer-pattern-item">
              <div class="tihi-layer-pattern-badge">${escapeHtml(pattern.letter || '')}</div>
              ${renderTiHiPatternMiniSvg(pattern, constraints)}
              <div class="tihi-layer-pattern-layers">Layers ${escapeHtml((pattern.layers || []).join(', ') || '-')}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function renderTiHiLegend(entry) {
    const groups = entry.groups || [];
    if (!groups.length) return '';
    return `
      <div class="tihi-legend">
        ${groups.map(group => `
          <div class="tihi-legend-item">
            <span class="tihi-legend-swatch" style="background:${escapeHtml(group.color || '#d99a4b')}"></span>
            <span><strong>${escapeHtml(group.label || 'Item')}</strong><br>Lines ${escapeHtml((group.lines || []).join(', ') || '—')} • ${escapeHtml(String(group.assignedCases || 0))} case(s) • ${escapeHtml(group.dimensionsIn || '')} in</span>
          </div>
        `).join('')}
      </div>`;
  }

  function renderMplTiHiCard(entry, mplIndex, constraints, isHighlighted = false) {
    return `
      <div class="tihi-card${isHighlighted ? ' highlight' : ''}">
        <div class="tihi-card-head">
          <div>
            <div class="tihi-card-title">Pallet ${escapeHtml(entry.palletLabel)} • Current edited layout</div>
            <div class="tihi-card-subtitle">${escapeHtml(String((entry.groups || []).length))} item group(s) on this pallet</div>
          </div>
          ${entry.overflowCases ? `<div class="tihi-card-overflow">${escapeHtml(String(entry.overflowCases))} over limit</div>` : ''}
        </div>
        <div class="tihi-stats">
          <div class="tihi-stat"><strong>Assigned</strong><span>${escapeHtml(String(entry.assignedCases))} case(s)</span></div>
          <div class="tihi-stat"><strong>Shown / Overflow</strong><span>${escapeHtml(String(entry.shownCases))} shown • ${escapeHtml(String(entry.overflowCases || 0))} overflow</span></div>
          <div class="tihi-stat"><strong>TI x HI</strong><span>${escapeHtml(String(entry.ti))} x ${escapeHtml(String(entry.hi))}</span></div>
          <div class="tihi-stat"><strong>Pallet Use</strong><span>${escapeHtml(entry.palletFillPct.toFixed(1))}% volume • ${escapeHtml(String(Math.round(entry.grossWeightLbs)))} lbs gross</span></div>
        </div>
        <div class="tihi-visual-grid">
          <div class="tihi-diagram">
            <div class="tihi-diagram-title">Top View</div>
            ${renderTiHiTopViewSvg(entry, constraints)}
            <div class="tihi-dim-row"><span>${escapeHtml(String(constraints.max_length_in))} in</span><span>Visible top surfaces ${escapeHtml(String(entry.topLayerCases))} case(s)</span><span>${escapeHtml(String(constraints.max_width_in))} in</span></div>
          </div>
          <div class="tihi-diagram">
            <div class="tihi-diagram-title">Side View</div>
            ${renderTiHiSideViewSvg(entry, constraints)}
            <div class="tihi-dim-row"><span>${escapeHtml(String(constraints.max_length_in))} in</span><span>${escapeHtml(String(Math.round(entry.usedHeight || 0)))} in used height</span><span>${escapeHtml(String(entry.hi))} layer(s)</span></div>
          </div>
        </div>
        ${renderTiHiLayerPatterns(entry, constraints)}
        ${renderTiHiLegend(entry)}
        ${entry.lines.length ? `<div class="tihi-lines">MPL lines: ${escapeHtml(entry.lines.join(', '))}</div>` : ''}
      </div>`;
  }

  function openMplPalletTiHi(mplIndex, palletId) {
    const mpl = getMpl(mplIndex);
    if (!mpl || !activeKeheDocumentDraft) return;
    const normalizedPallet = normalizePalletId(palletId) || '1';
    navigateToRoute(`${getCurrentPage()}/tihi/${mplIndex}/${encodeURIComponent(normalizedPallet)}`);
  }

  function showMplTiHiRoute(subpath) {
    const parts = subpath.split('/');
    const mplIndex = parseInt(parts[1], 10);
    const palletId = decodeURIComponent(parts.slice(2).join('/') || '1');
    const mpl = getMpl(mplIndex);
    if (!mpl || !activeKeheDocumentDraft) return;
    applyProductMasterToDraft(activeKeheDocumentDraft, true);
    (activeKeheDocumentDraft.packing_lists || []).forEach((list, index) => {
      list._show_tihi = index === mplIndex;
    });
    mpl._tihi_focus_pallet = normalizePalletId(palletId) || '1';
    mpl._show_tihi = true;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    showDocumentEditorView();
    setStatus(`TI-Hi preview refreshed for pallet ${palletId}.`, 'info');
  }

  function closeMplTiHiPopup(mplIndex, useHistory = true) {
    if (useHistory) {
      closeCurrentRouteView(`${getCurrentPage()}/document-editor`);
      return;
    }
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    mpl._show_tihi = false;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  }

  function updateMplTiHiConstraint(mplIndex, palletId, key, value) {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    const constraints = getMplTiHiConstraints(mpl, palletId);
    constraints[key] = value;
  }

  function resetMplTiHiConstraints(mplIndex, palletId) {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    const normalizedPallet = normalizePalletId(palletId);
    if (normalizedPallet && mpl._tihi_pallet_constraints) {
      delete mpl._tihi_pallet_constraints[normalizedPallet];
    } else {
      mpl._tihi_constraints = defaultTiHiConstraints();
    }
    mpl._show_tihi = true;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  }

  function recalcMplTiHiPopup(mplIndex, palletId = '') {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    const normalizedPallet = normalizePalletId(palletId);
    if (normalizedPallet) {
      getMplTiHiConstraints(mpl, normalizedPallet);
    } else {
      mpl._tihi_constraints = normalizeTiHiConstraints(mpl._tihi_constraints || {});
    }
    mpl._show_tihi = true;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    setStatus(`TI-Hi recalculated for ${normalizedPallet ? `pallet ${normalizedPallet}` : (mpl.id || `MPL ${mplIndex + 1}`)}.`, 'info');
  }

  function renderMplTiHiSheet(mpl, mplIndex, options = {}) {
    const focusPallet = normalizePalletId(options.focusPallet ?? mpl?._tihi_focus_pallet ?? '');
    const showOnlyFocus = options.showOnlyFocus ?? !!focusPallet;
    const { entries, warnings, constraints } = buildMplTiHiEntries(mpl);
    const entriesToShow = showOnlyFocus ? entries.filter(entry => normalizePalletId(entry.palletLabel) === focusPallet) : entries;
    const focusEntry = entries.find(entry => normalizePalletId(entry.palletLabel) === focusPallet);
    const sheetConstraints = focusEntry?.constraints || (focusPallet ? getMplTiHiConstraints(mpl, focusPallet) : constraints);
    const statusLabel = options.statusLabel || 'Preview Page';
    const idPrefix = options.idPrefix || 'tihi';
    const editable = !!options.editable;
    return `
      <div class="pdf-document-shell">
        <div class="pdf-sheet-toolbar">
          <span>${escapeHtml((mpl?.id || 'MPL') + ' · TI-HI')}</span>
          <span class="status-tag success">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="pdf-sheet tihi-sheet">
          <div class="tihi-sheet-title">TI-HI Layout Summary</div>
          <div class="tihi-sheet-subtitle">
            <span>PO: ${escapeHtml(mpl?.customer_po_number || '—')}</span>
            <span>Constraints: ${escapeHtml(String(sheetConstraints.max_length_in))} × ${escapeHtml(String(sheetConstraints.max_width_in))} × ${escapeHtml(String(sheetConstraints.max_height_in))} in • Max ${escapeHtml(String(sheetConstraints.max_gross_lbs))} lbs gross</span>
            <span>All dimensions shown in inches</span>
          </div>
          ${editable ? `
            <div class="tihi-sheet-subtitle">
              <div class="tihi-constraint-bar">
                <div class="tihi-constraint-field">
                  <label>Max Length (in)</label>
                  <input type="number" min="1" step="0.1" value="${escapeHtml(String(sheetConstraints.max_length_in))}" oninput="updateMplTiHiConstraint(${mplIndex}, '${jsString(focusPallet)}', 'max_length_in', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Max Width (in)</label>
                  <input type="number" min="1" step="0.1" value="${escapeHtml(String(sheetConstraints.max_width_in))}" oninput="updateMplTiHiConstraint(${mplIndex}, '${jsString(focusPallet)}', 'max_width_in', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Max Height (in)</label>
                  <input type="number" min="1" step="0.1" value="${escapeHtml(String(sheetConstraints.max_height_in))}" oninput="updateMplTiHiConstraint(${mplIndex}, '${jsString(focusPallet)}', 'max_height_in', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Max Gross (lbs)</label>
                  <input type="number" min="1" step="1" value="${escapeHtml(String(sheetConstraints.max_gross_lbs))}" oninput="updateMplTiHiConstraint(${mplIndex}, '${jsString(focusPallet)}', 'max_gross_lbs', this.value)">
                </div>
                <div class="tihi-constraint-actions">
                  <button class="btn-secondary" type="button" onclick="resetMplTiHiConstraints(${mplIndex}, '${jsString(focusPallet)}')">Defaults</button>
                  <button class="btn-generate" type="button" onclick="recalcMplTiHiPopup(${mplIndex}, '${jsString(focusPallet)}')">Recalculate</button>
                </div>
              </div>
            </div>` : ''}
          ${warnings.length ? `<div class="tihi-warning">${warnings.slice(0, 6).map(escapeHtml).join('<br>')}</div>` : ''}
          ${entriesToShow.length
            ? entriesToShow.map(entry => `
              <section class="tihi-pallet-section" id="${escapeHtml(getMplTiHiSectionId(mplIndex, entry.palletLabel, idPrefix))}">
                <div class="tihi-pallet-section-head">
                  <span>Pallet ${escapeHtml(entry.palletLabel)}</span>
                  <span>${escapeHtml(String((entry.groups || []).length))} item group(s)</span>
                </div>
                ${renderMplTiHiCard(entry, mplIndex, entry.constraints || constraints, normalizePalletId(entry.palletLabel) === focusPallet)}
              </section>`).join('')
            : '<div class="tihi-empty">No TI-Hi diagram could be generated for this MPL.<br>Add Case dimensions and Case weight for the palletized SKU rows in the product master, then render again.</div>'}
        </div>
      </div>`;
  }

  function renderMplTiHiPopup(mpl, mplIndex) {
    if (!mpl?._show_tihi) return '';
    return `
      <div class="tihi-popup-panel visible tihi-screen-only" onclick="if (event.target === this) closeMplTiHiPopup(${mplIndex}, true)">
        <div class="editor-dialog">
          <div class="editor-toolbar">
            <button class="window-back-btn" type="button" onclick="goBackFromWindow()" aria-label="Back"></button>
            <div>
              <div class="editor-title">${escapeHtml((mpl?.id || 'MPL') + ' TI-HI Preview')}</div>
            </div>
            <button class="btn-secondary" type="button" onclick="closeMplTiHiPopup(${mplIndex}, true)">Close</button>
          </div>
          <div class="editor-body">
            <div class="tihi-popup-shell">
              ${renderMplTiHiSheet(mpl, mplIndex, { showOnlyFocus: true, statusLabel: 'Popup Preview', idPrefix: 'popup', editable: true })}
            </div>
          </div>
        </div>
      </div>`;
  }

  function selectKit(kit, updateHistory = true) {
    selectedKit = kit;
    xmlFiles = [];
    pdfFiles = [];
    currentResultId = null;
    currentReport = null;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    keheProductMasterRows = loadKeheProductMasterFromStorage();
    keheDcDirectoryRows = loadKeheDcDirectoryFromStorage();
    keheLastMplDraft = null;
    keheLastPalletLabelDraft = null;
    keheMplPalletizationSource = 'Not generated';
    kehePalletLabelSource = 'Not generated';

    const cfg = KIT_CONFIG[selectedKit];
    document.title = cfg.headerName;
    document.getElementById('kit-selection').classList.add('hidden');
    document.getElementById('upload-page').classList.remove('hidden');
    document.getElementById('mpl-workspace-page').classList.add('hidden');
    document.getElementById('btn-change-kit').classList.add('visible');

    document.getElementById('header-app-name').textContent = cfg.headerName;
    document.getElementById('header-app-sub').textContent = cfg.headerSub;
    document.getElementById('workflow-title').innerHTML = cfg.titleHtml;
    const titleAccent = document.querySelector('#workflow-title span');
    if (titleAccent) {
      titleAccent.classList.toggle('kehe-accent', selectedKit === 'kehe');
    }
    document.getElementById('workflow-description').textContent = cfg.description;
    document.getElementById('kehe-generate-title').textContent = cfg.generateTitle || 'Generate';
    document.getElementById('generate-subtitle').textContent = cfg.generateSubtitle || '';
    document.getElementById('workflow-note').innerHTML = cfg.noteHtml;
    document.getElementById('xml-step-title').textContent = cfg.xmlTitle;
    document.getElementById('xml-drop-hint').innerHTML = cfg.xmlHintHtml;
    document.getElementById('btn-label').textContent = cfg.generateLabel;
    document.getElementById('btn-download').download = cfg.outputName;
    document.getElementById('pdf-step-block').classList.toggle('hidden', !cfg.requiresPdf);

    const docActions = document.getElementById('kehe-document-actions');
    docActions.classList.toggle('visible', selectedKit === 'kehe');
    document.querySelector('.generate-block').classList.toggle('kehe-mode', selectedKit === 'kehe');
    document.getElementById('kehe-preview-actions').classList.toggle('visible', selectedKit === 'kehe');
    document.getElementById('btn-open-preview').classList.toggle('hidden', selectedKit === 'kehe');
    resetKeheXmlDerivedState();
    toggleKeheExtractedPanel(selectedKit === 'kehe');
    toggleKeheProductMasterPanel(selectedKit === 'kehe');
    if (selectedKit === 'kehe') {
      keheProductMasterLoadPromise = loadKeheProductMasterFromBackend();
      keheDcDirectoryLoadPromise = loadKeheDcDirectoryFromBackend();
    }

    setStatus('', '');
    setDownloadReady(false);
    setExportReady(false);
    setPreviewReady(false);
    resetPreviewSurface();
    closePreview();
    hideAllRouteViews();
    renderList(xmlFiles, 'xml-file-list', 'xml');
    renderList(pdfFiles, 'pdf-file-list', 'pdf');
    renderKeheProductMasterTable();
    renderEmptyReport();

    if (updateHistory) {
      setHistoryPage(selectedKit);
    }
  }

  async function selectMplWorkspace(updateHistory = true) {
    selectedKit = 'mpl';
    xmlFiles = [];
    pdfFiles = [];
    currentResultId = null;
    currentReport = null;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    activeKeheDocumentType = null;
    activeKeheDocumentDraft = null;
    keheProductMasterRows = loadKeheProductMasterFromStorage();
    keheDcDirectoryRows = loadKeheDcDirectoryFromStorage();
    mplProductMasterRows = loadMplProductMasterFromStorage();
    mplDirectoryRows = loadMplDirectoryFromStorage();
    keheLastMplDraft = null;
    keheLastPalletLabelDraft = null;
    keheMplPalletizationSource = 'Manual';
    kehePalletLabelSource = 'Not generated';

    document.title = 'Packing List & Ti-Hi · LabelKit';
    document.getElementById('kit-selection').classList.add('hidden');
    document.getElementById('upload-page').classList.add('hidden');
    document.getElementById('mpl-workspace-page').classList.remove('hidden');
    document.getElementById('btn-change-kit').classList.add('visible');
    document.getElementById('header-app-name').textContent = 'Packing List & Ti-Hi';
    document.getElementById('header-app-sub').textContent = 'Standalone MPL workspace';

    resetKeheXmlDerivedState();
    toggleKeheExtractedPanel(false);
    toggleKeheProductMasterPanel(false);
    setDownloadReady(false);
    setExportReady(false);
    setPreviewReady(false);
    resetPreviewSurface();
    closePreview();
    hideAllRouteViews();
    setStatus('', '');

    mplProductMasterLoadPromise = loadMplProductMasterFromBackend();
    mplDirectoryLoadPromise = loadMplDirectoryFromBackend();
    try {
      await Promise.allSettled([
        mplProductMasterLoadPromise,
        mplDirectoryLoadPromise
      ]);
    } finally {
      renderMplProductMasterTable();
      renderMplDirectoryTable();
    }

    if (updateHistory) {
      setHistoryPage('mpl');
    }
  }

  function resetToSelection(updateHistory = true) {
    selectedKit = null;
    document.title = 'JDI Label Kits';
    document.getElementById('upload-page').classList.add('hidden');
    document.getElementById('mpl-workspace-page').classList.add('hidden');
    document.getElementById('kit-selection').classList.remove('hidden');
    document.getElementById('btn-change-kit').classList.remove('visible');
    document.getElementById('header-app-name').textContent = 'LabelKit';
    document.getElementById('header-app-sub').textContent = 'Select a workflow';
    document.querySelector('.generate-block').classList.remove('kehe-mode');
    document.getElementById('kehe-preview-actions').classList.remove('visible');
    document.getElementById('btn-open-preview').classList.remove('hidden');
    toggleKeheExtractedPanel(false);
    toggleKeheProductMasterPanel(false);
    hideAllRouteViews();
    resetKeheXmlDerivedState();
    keheCurrentExtractedSource = null;
    setStatus('', '');
    closePreview();

    if (updateHistory) {
      setHistoryPage('home');
    }
  }

  window.addEventListener('popstate', function(event) {
    const targetRoute = normalizeAppRoute(event.state?.route || getRouteFromHash());
    applyRouteFromNavigation(targetRoute);
  });

  window.addEventListener('hashchange', function() {
    applyRouteFromNavigation(getRouteFromHash());
  });

  function currentConfig() {
    if (!selectedKit) throw new Error('Select a kit first.');
    return KIT_CONFIG[selectedKit] || KIT_CONFIG.mpl;
  }

  function setDownloadReady(isReady, href = '') {
    const dl = document.getElementById('btn-download');
    if (isReady) {
      dl.classList.remove('disabled');
      dl.setAttribute('aria-disabled', 'false');
      dl.href = href;
    } else {
      dl.classList.add('disabled');
      dl.setAttribute('aria-disabled', 'true');
      dl.removeAttribute('href');
    }
    setPreviewReady(isReady && !!href);
  }

  function setPreviewReady(isReady) {
    const btn = document.getElementById('btn-open-preview');
    btn.disabled = !isReady;
    btn.classList.toggle('disabled', !isReady);
    if (selectedKit === 'kehe') {
      renderKeheUnifiedReport(keheCurrentExtractedSource);
    }
  }

  function setKehePreviewReady(key, isReady, href = null) {
    const cfg = KEHE_PREVIEW_CONFIG[key];
    if (!cfg) return;
    if (href !== null) {
      if (kehePreviewUrls[key] && kehePreviewUrls[key] !== href) URL.revokeObjectURL(kehePreviewUrls[key]);
      kehePreviewUrls[key] = href;
    }
    const btn = document.getElementById(cfg.buttonId);
    if (!btn) return;
    btn.disabled = !isReady;
    btn.classList.toggle('disabled', !isReady);
  }

  function resetKehePreviewUrls() {
    Object.keys(kehePreviewUrls).forEach(key => {
      if (kehePreviewUrls[key]) URL.revokeObjectURL(kehePreviewUrls[key]);
      kehePreviewUrls[key] = null;
      setKehePreviewReady(key, false);
    });
  }

  function toggleKeheExtractedPanel(isVisible) {
    const panel = document.getElementById('kehe-extracted-panel');
    if (!panel) return;
    panel.classList.toggle('visible', !!isVisible);
    if (!isVisible) {
      const scroll = document.getElementById('kehe-extracted-scroll');
      if (scroll) scroll.innerHTML = '<div class="empty-row">Upload XML and generate/prepare a KeHE document to see extracted fields.</div>';
    }
  }

  function resetKeheXmlDerivedState() {
    keheCurrentExtractedSource = null;
    keheGeneratedLabelCount = 0;
    keheLastMplDraft = null;
    keheLastPalletLabelDraft = null;
    keheMplPalletizationSource = 'Not generated';
    kehePalletLabelSource = 'Not generated';
    keheExtractionRequestId += 1;
    if (keheExtractedLoadTimer) clearTimeout(keheExtractedLoadTimer);
    resetKehePreviewUrls();
    const scroll = document.getElementById('kehe-extracted-scroll');
    if (scroll) scroll.innerHTML = '<div class="empty-row">Reading uploaded KeHE XML data…</div>';
    renderKeheProductMasterTable();
  }

  function scheduleKeheExtractedDataLoad() {
    if (selectedKit !== 'kehe') return;
    if (keheExtractedLoadTimer) clearTimeout(keheExtractedLoadTimer);
    if (!xmlFiles.length) {
      renderKeheUnifiedReport(null);
      return;
    }
    keheExtractedLoadTimer = setTimeout(loadKeheExtractedDataFromXml, 150);
  }

  async function fetchKeheDraft(endpoint) {
    const form = new FormData();
    xmlFiles.forEach(f => form.append('xml_files', f));
    form.append('product_master_json', JSON.stringify(getKeheProductMasterRows()));
    const res = await fetch(endpoint, { method: 'POST', body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.detail || 'Could not read KeHE XML data.');
    return payload;
  }

  async function loadKeheExtractedDataFromXml() {
    if (selectedKit !== 'kehe' || !xmlFiles.length) return;
    const requestId = ++keheExtractionRequestId;
    try {
      let payload;
      try {
        payload = await fetchKeheDraft('/prepare/kehe/master-packing-list');
      } catch (mplErr) {
        payload = await fetchKeheDraft('/prepare/kehe/pallet-label');
      }
      if (requestId !== keheExtractionRequestId) return;
      keheCurrentExtractedSource = payload;
      const seeded = normalizeKeheExtractedSource(payload);
      seedKeheProductMasterFromItems(seeded.items || []);
      renderKeheUnifiedReport(payload);
      if (selectedKit === 'kehe') setStatus('KeHE XML data loaded. Generate any output when ready.', 'info');
    } catch (err) {
      if (requestId !== keheExtractionRequestId) return;
      renderKeheUnifiedReport(null);
      setStatus('Error reading KeHE XML data: ' + (err.message || 'Could not extract fields.'), 'error');
    }
  }

  function setActivePreviewFormat(format) {
    activePreviewFormat = format || 'rollo';
    const dialog = document.getElementById('preview-dialog');
    if (!dialog) return;
    dialog.classList.toggle('a4-preview', activePreviewFormat === 'a4');
    dialog.classList.toggle('rollo-preview', activePreviewFormat !== 'a4');
  }

  function setExportReady(isReady) {
    const btn = document.getElementById('btn-export-report');
    btn.disabled = !isReady;
    btn.classList.toggle('disabled', !isReady);
  }

  function setStatus(msg, type) {
    const defaultEl = document.getElementById('status-bar');
    const mplEl = document.getElementById('mpl-status-bar');
    const el = selectedKit === 'mpl' && mplEl ? mplEl : defaultEl;
    if (!msg) {
      [defaultEl, mplEl].filter(Boolean).forEach(target => {
        target.textContent = '';
        target.className = 'status-bar';
      });
      return;
    }
    [defaultEl, mplEl].filter(Boolean).forEach(target => {
      if (target !== el) {
        target.textContent = '';
        target.className = 'status-bar';
      }
    });
    el.textContent = msg;
    el.className = 'status-bar ' + type;
  }

  function reportColumns() {
    return currentConfig().columns;
  }

  function csvColumns() {
    return currentConfig().csvColumns || currentConfig().columns;
  }

  function reportColumnClass(key) {
    const normalized = String(key || 'value').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return `report-col report-col-${normalized}`;
  }

  function setReportTableMode(mode = selectedKit) {
    const table = document.querySelector('.match-table');
    const wrap = document.querySelector('.match-table-wrap');
    if (!table) return;
    table.classList.toggle('michaels-report-table', mode === 'michaels');
    table.classList.toggle('kehe-report-table', mode === 'kehe');
    table.classList.toggle('document-report-table', mode !== 'michaels' && mode !== 'kehe');
    if (wrap) {
      wrap.classList.toggle('michaels-report-wrap', mode === 'michaels');
      wrap.classList.toggle('kehe-report-wrap', mode === 'kehe');
    }
  }

  function renderReportHeader(columns) {
    return '<tr>' + columns.map(([key, label]) => {
      return `<th class="${reportColumnClass(key)}">${escapeHtml(label)}</th>`;
    }).join('') + '</tr>';
  }

  function normalizeReportRow(row) {
    const normalized = { ...(row || {}) };
    if (selectedKit === 'michaels') {
      normalized.matched_xml = [row?.xml_po || '—', row?.xml_store || '—', row?.sscc || '—'].join(' / ');
    }
    return normalized;
  }

  function formatStatusCell(value) {
    const text = String(value || '—');
    const key = text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return `<span class="status-tag ${escapeHtml(key)}">${escapeHtml(text)}</span>`;
  }

  function renderEmptyReport() {
    const cfg = currentConfig();
    const columns = reportColumns();
    document.getElementById('report-title').textContent = cfg.reportTitle;
    document.getElementById('match-rules').textContent = cfg.reportRules;
    setReportTableMode(selectedKit);
    document.getElementById('match-summary').innerHTML = `
      <div class="match-pill">
        <strong>Waiting for run</strong>
        <span>${escapeHtml(cfg.waitingText)}</span>
      </div>
    `;
    document.getElementById('match-table-head').innerHTML = renderReportHeader(columns);
    document.getElementById('match-table-body').innerHTML = `<tr><td class="empty-row" colspan="${columns.length}">No report details yet.</td></tr>`;
  }

  function renderSummary(report) {
    const cfg = currentConfig();
    const summary = (report && report.summary) || {};
    const knownEntries = cfg.summaryLabels
      .filter(([key]) => Object.prototype.hasOwnProperty.call(summary, key))
      .map(([key, label]) => [label, summary[key]]);

    const entries = knownEntries.length ? knownEntries : Object.entries(summary).map(([key, value]) => [key.replace(/_/g, ' '), value]);

    if (!entries.length) {
      document.getElementById('match-summary').innerHTML = `
        <div class="match-pill"><strong>Generated</strong><span>Report received from backend.</span></div>
      `;
      return;
    }

    document.getElementById('match-summary').innerHTML = entries.map(([label, value]) => {
      const displayValue = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value;
      return `<div class="match-pill"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(displayValue)}</span></div>`;
    }).join('');
  }

  function renderReport(report) {
    if (selectedKit === 'kehe') {
      renderKeheUnifiedReport(report);
      return;
    }

    currentReport = report || null;
    currentCsvColumns = null;
    currentCsvName = null;
    const cfg = currentConfig();
    const columns = reportColumns();
    const rows = (report && report.rows) || [];

    const rules = selectedKit === 'michaels' && report && Array.isArray(report.matching_rules) && report.matching_rules.length
      ? report.matching_rules.join(' • ')
      : cfg.reportRules;

    document.getElementById('report-title').textContent = cfg.reportTitle;
    document.getElementById('match-rules').textContent = rules;
    setReportTableMode(selectedKit);
    renderSummary(report);
    document.getElementById('match-table-head').innerHTML = renderReportHeader(columns);

    const bodyEl = document.getElementById('match-table-body');
    if (!rows.length) {
      bodyEl.innerHTML = `<tr><td class="empty-row" colspan="${columns.length}">No report details available for this run.</td></tr>`;
      setExportReady(false);
      return;
    }

    bodyEl.innerHTML = rows.map(rawRow => {
      const row = normalizeReportRow(rawRow);
      return '<tr>' + columns.map(([key]) => {
        const value = row[key];
        if (key === 'status') return `<td class="${reportColumnClass(key)}">${formatStatusCell(value)}</td>`;
        const displayValue = value || '—';
        return `<td class="${reportColumnClass(key)}" title="${escapeHtml(displayValue)}">${escapeHtml(displayValue)}</td>`;
      }).join('') + '</tr>';
    }).join('');

    setExportReady(true);
  }

  async function loadReport(resultId) {
    if (!resultId) return null;
    const res = await fetch(`/results/${encodeURIComponent(resultId)}/report`);
    if (!res.ok) throw new Error('Could not load report.');
    return await res.json();
  }

  function exportReport() {
    if (!currentReport || !currentReport.rows || !currentReport.rows.length) return;

    const cols = currentCsvColumns || csvColumns();
    const csvNameToUse = currentCsvName || currentConfig().csvName;
    const headers = cols.map(([, label]) => label);
    const escapeCsv = value => {
      const text = String(value ?? '');
      return `"${text.replace(/"/g, '""')}"`;
    };

    const lines = [headers.join(',')];
    currentReport.rows.forEach(row => {
      lines.push(cols.map(([key]) => escapeCsv(row[key])).join(','));
    });

    const csvBlob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const link = document.createElement('a');
    link.href = csvUrl;
    link.download = csvNameToUse;
    link.click();
    setTimeout(() => URL.revokeObjectURL(csvUrl), 1000);
  }

  function renderList(files, listId, type) {
    const el = document.getElementById(listId);
    el.innerHTML = '';
    files.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'file-chip';
      d.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><button class="remove" type="button" aria-label="Remove ${escapeHtml(f.name)}" onclick="removeFile('${type}',${i})">×</button>`;
      el.appendChild(d);
    });
    checkReady();
  }

  function removeFile(type, i) {
    if (type === 'xml') {
      xmlFiles.splice(i, 1);
      if (selectedKit === 'kehe') resetKeheXmlDerivedState();
      renderList(xmlFiles, 'xml-file-list', 'xml');
      if (selectedKit === 'kehe') scheduleKeheExtractedDataLoad();
    } else {
      pdfFiles.splice(i, 1);
      renderList(pdfFiles, 'pdf-file-list', 'pdf');
    }
  }

  function addFiles(type, fileList) {
    const files = Array.from(fileList || []);
    if (type === 'xml') {
      xmlFiles = [...xmlFiles, ...files.filter(f => f.name.toLowerCase().endsWith('.xml'))];
      if (selectedKit === 'kehe') resetKeheXmlDerivedState();
      renderList(xmlFiles, 'xml-file-list', 'xml');
      if (selectedKit === 'kehe') scheduleKeheExtractedDataLoad();
    } else {
      pdfFiles = [...pdfFiles, ...files.filter(f => f.name.toLowerCase().endsWith('.pdf'))];
      renderList(pdfFiles, 'pdf-file-list', 'pdf');
    }
    setDownloadReady(false);
    setExportReady(false);
    setStatus('', '');
  }

  document.getElementById('xml-input').addEventListener('change', e => {
    addFiles('xml', e.target.files);
    e.target.value = '';
  });
  document.getElementById('pdf-input').addEventListener('change', e => {
    addFiles('pdf', e.target.files);
    e.target.value = '';
  });

  ['xml-zone','pdf-zone'].forEach(id => {
    const z = document.getElementById(id);
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('drag-over'); });
    z.addEventListener('dragleave', () => z.classList.remove('drag-over'));
    z.addEventListener('drop', e => {
      e.preventDefault(); z.classList.remove('drag-over');
      addFiles(id === 'xml-zone' ? 'xml' : 'pdf', e.dataTransfer.files);
    });
  });

  function checkReady() {
    const btn = document.getElementById('btn-generate');
    if (!selectedKit) {
      btn.disabled = true;
      return;
    }
    const cfg = currentConfig();
    const isReady = cfg.requiresPdf ? (xmlFiles.length > 0 && pdfFiles.length > 0) : xmlFiles.length > 0;
    btn.disabled = !isReady;

    const palletBtn = document.getElementById('btn-kehe-pallet-label');
    const mplBtn = document.getElementById('btn-kehe-mpl');
    const packBtn = document.getElementById('btn-kehe-pack-labels');
    if (palletBtn && mplBtn && packBtn) {
      const keheReady = selectedKit === 'kehe' && xmlFiles.length > 0;
      palletBtn.disabled = !keheReady;
      mplBtn.disabled = !keheReady;
      packBtn.disabled = !keheReady;
    }
  }

  function resetPreviewSurface() {
    const preview = document.getElementById('pdf-preview');
    preview.innerHTML = '';
  }

  function showPreviewFallback(message) {
    const preview = document.getElementById('pdf-preview');
    preview.innerHTML = `<div class="preview-note">${escapeHtml(message)}</div>`;
  }

  async function renderPdfPreview(url) {
    if (!window.pdfjsLib) {
      throw new Error('PDF preview library failed to load.');
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const preview = document.getElementById('pdf-preview');
    preview.innerHTML = '';

    const loadingTask = window.pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = preview.clientWidth || (activePreviewFormat === 'a4' ? 900 : 420);
      const targetWidth = activePreviewFormat === 'a4'
        ? Math.min(availableWidth, 900)
        : Math.min(availableWidth, 420);
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const pageWrap = document.createElement('div');
      pageWrap.className = 'pdf-page';
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      pageWrap.appendChild(canvas);
      preview.appendChild(pageWrap);

      await page.render({ canvasContext: context, viewport }).promise;
    }
  }

  function maybeClosePreview(event) {
    if (event.target.id === 'preview-panel') closePreview(true);
  }

  async function showPreviewView() {
    if (!blobUrl) return;
    setActivePreviewFormat(activePreviewFormat);
    const panel = document.getElementById('preview-panel');
    panel.classList.add('visible');
    if (!document.getElementById('pdf-preview').childElementCount) {
      await renderPdfPreview(blobUrl);
    }
  }

  async function openPreview() {
    if (!blobUrl) return;
    await navigateToRoute(`${getCurrentPage()}/preview`);
  }

  async function openKehePreview(key) {
    const cfg = KEHE_PREVIEW_CONFIG[key];
    const url = kehePreviewUrls[key];
    if (!cfg || !url) return;
    blobUrl = url;
    document.getElementById('btn-download').download = cfg.outputName;
    setActivePreviewFormat(cfg.format);
    resetPreviewSurface();
    await openPreview();
  }

  function closePreview(useHistory = false) {
    if (useHistory) {
      closeCurrentRouteView(getCurrentPage());
      return;
    }
    document.getElementById('preview-panel').classList.remove('visible');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForGeneration(resultId) {
    const deadline = Date.now() + (10 * 60 * 1000);
    while (Date.now() < deadline) {
      const res = await fetch(`/results/${encodeURIComponent(resultId)}/status`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data.detail || 'Could not check generation status.');

      if (data.report) renderReport(data.report);
      if (data.status === 'complete') return data;
      if (data.status === 'error') throw new Error(data.detail || 'Generation failed.');

      setStatus(data.detail || 'Still generating…', 'info');
      await sleep(500);
    }
    throw new Error('Generation is taking too long. Please try a smaller batch.');
  }

  async function generate() {
    if (!selectedKit) return;
    const cfg = currentConfig();
    if (cfg.requiresPdf && (!xmlFiles.length || !pdfFiles.length)) return;
    if (!cfg.requiresPdf && !xmlFiles.length) return;

    const btn = document.getElementById('btn-generate');
    const spinner = document.getElementById('spinner');
    const icon = document.getElementById('btn-icon');
    const lbl = document.getElementById('btn-label');

    btn.disabled = true;
    spinner.classList.add('visible');
    icon.style.display = 'none';
    lbl.textContent = 'Generating…';

    setStatus('Processing…', 'info');
    document.getElementById('refresh-warning').classList.add('visible');
    setDownloadReady(false);
    setExportReady(false);
    setPreviewReady(false);
    currentResultId = null;
    currentReport = null;

    resetPreviewSurface();
    closePreview();

    const form = new FormData();
    xmlFiles.forEach(f => form.append('xml_files', f));
    if (selectedKit === 'kehe') {
      form.append('product_master_json', JSON.stringify(getKeheProductMasterRows()));
    }
    if (cfg.requiresPdf) {
      pdfFiles.forEach(f => form.append('pdf_files', f));
    }

    try {
      const res = await fetch(cfg.endpoint, { method: 'POST', body: form });
      const resultIdFromHeader = res.headers.get('X-Result-Id');
      const contentType = (res.headers.get('content-type') || '').toLowerCase();

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        if (err.report) renderReport(err.report);
        throw new Error(err.detail || 'Server error');
      }

      currentResultId = resultIdFromHeader;

      if (contentType.includes('application/json')) {
        const payload = await res.json().catch(() => ({}));
        currentResultId = currentResultId || payload.result_id;
        if (!currentResultId) throw new Error(payload.detail || 'Generation could not be started.');

        setStatus(payload.detail || 'Files uploaded. Generation started…', 'info');
        const status = await waitForGeneration(currentResultId);

        const fileRes = await fetch(`/results/${encodeURIComponent(currentResultId)}/file`);
        if (!fileRes.ok) {
          const fileErr = await fileRes.json().catch(() => ({ detail: fileRes.statusText }));
          throw new Error(fileErr.detail || 'Generated PDF could not be downloaded.');
        }

        const blob = await fileRes.blob();
        if (blobUrl && selectedKit !== 'kehe') URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(blob);
        setDownloadReady(true, blobUrl);
        if (selectedKit === 'kehe') {
          setKehePreviewReady('labels', true, blobUrl);
          setActivePreviewFormat('rollo');
        }

        if (status.report) {
          renderReport(status.report);
        }
      } else {
        const blob = await res.blob();
        if (blobUrl && selectedKit !== 'kehe') URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(blob);
        setDownloadReady(true, blobUrl);
        if (selectedKit === 'kehe') {
          setKehePreviewReady('labels', true, blobUrl);
          setActivePreviewFormat('rollo');
        }

        if (currentResultId) {
          try {
            const report = await loadReport(currentResultId);
            renderReport(report);
          } catch (reportErr) {
            setExportReady(false);
          }
        }
      }

      setStatus('Generated successfully. Opening preview popup…', 'info');
      try {
        await openPreview();
        setStatus('Preview opened and report updated below the button.', 'success');
      } catch (previewErr) {
        showPreviewFallback('Preview could not be rendered in this browser session. Use Download PDF to open the file directly.');
        setStatus('PDF generated and the report is ready, but the in-app preview could not be rendered here.', 'error');
      }
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Generation failed.'), 'error');
    } finally {
      btn.disabled = false;
      spinner.classList.remove('visible');
      icon.style.display = '';
      lbl.textContent = cfg.generateLabel;
      document.getElementById('refresh-warning').classList.remove('visible');
      checkReady();
    }
  }

  // =========================================================================
  // KeHE Document (Pallet Label / Master Packing List) workflow
  // =========================================================================

  function showDocumentEditorView() {
    if (!activeKeheDocumentDraft) return;
    document.getElementById('document-editor-panel').classList.add('visible');
  }

  function openDocumentEditor() {
    navigateToRoute(`${getCurrentPage()}/document-editor`);
  }

  function closeDocumentEditor(useHistory = false) {
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
    mpl._pallet_ids.forEach(id => {
      const weightedItem = mpl.items.find(item => normalizePalletId(item.location_on_pallet) === id && String(item.pallet_weight || '').trim());
      if (weightedItem && !mpl._pallet_weights[id]) {
        mpl._pallet_weights[id] = weightedItem.pallet_weight;
      }
    });

    const assignedPalletCount = mpl._pallet_ids.length || assignedIds.length || 1;
    mpl.total_pallets = String(assignedPalletCount);
  }

  function syncMplLineNumbers(mpl) {
    if (!mpl || !Array.isArray(mpl.items)) return;
    mpl.items.forEach((item, index) => { item.line = index + 1; });
  }

  function editorPdfInput(path, value, className = '', placeholder = '') {
    return `<input class="${escapeHtml(className)}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" data-draft-path="${escapeHtml(path)}" oninput="updateDraftValue(this)">`;
  }

  function renderCopiesControl(path, value, helpText = 'Number of labels to generate.', minCopies = 1) {
    return `
      <div class="label-copy-control">
        <div>
          <div class="label-copy-title">Copies</div>
          <div class="label-copy-help">${escapeHtml(helpText)}</div>
        </div>
        <input type="number" min="${escapeHtml(String(minCopies))}" step="1" inputmode="numeric" class="label-copy-input" value="${escapeHtml(value ?? minCopies)}" placeholder="${escapeHtml(String(minCopies))}" data-draft-path="${escapeHtml(path)}" oninput="updateDraftValue(this)">
      </div>`;
  }

  function editorPdfTextarea(path, value, className = '', placeholder = '') {
    return `<textarea class="${escapeHtml(className)}" placeholder="${escapeHtml(placeholder)}" data-draft-path="${escapeHtml(path)}" oninput="updateDraftValue(this)">${escapeHtml(value ?? '')}</textarea>`;
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
    return `
      <tr class="mpl-pallet-item-row" data-mpl-index="${mplIndex}" data-item-index="${itemIndex}">
        <td style="width:16%">${editorPdfInput(`${base}.item_number`, item.item_number || item.upc || '')}</td>
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
      </tr>`;
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
      <div class="mpl-pdf-pallet-section" data-mpl-index="${mplIndex}" data-pallet-id="${escapeHtml(palletId)}">
        <div class="mpl-pdf-pallet-heading">
          <div>Pallet: ${escapeHtml(palletId)}</div>
          <div class="mpl-pallet-weight-edit">
            <span>Weight</span>
            <input value="${escapeHtml(weight)}" placeholder="ex: 820 LBS" oninput="setMplPalletWeight(${mplIndex}, '${jsString(palletId)}', this.value)">
          </div>
          <div class="mpl-pallet-heading-actions">
            <button class="btn-secondary" type="button" onclick="addMplItem(${mplIndex}, '${jsString(palletId)}')">Add Line Item</button>
            <button class="btn-secondary" type="button" onclick="openMplPalletTiHi(${mplIndex}, '${jsString(palletId)}')">TI-Hi</button>
          </div>
        </div>
        ${renderMplDropZone(mplIndex, palletId, items, 'Drop line items here')}
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

  function renderMasterPackingListEditor(draft) {
    const lists = draft.packing_lists || [];
    if (!lists.length) {
      return '<div class="pdf-editor-note">No Master Packing Lists were returned from the XML.</div>';
    }

    return `
            ${lists.map((mpl, index) => `
        <div class="pdf-document-shell" data-pack-label-index="${index}">
          <div class="pdf-sheet-toolbar">
            <span>${escapeHtml(mpl.id || `MPL ${index + 1}`)}</span>
            ${pdfStatusBadge(mpl.status)}
          </div>
          ${renderManualMplTools(mpl, index)}
          ${Array.isArray(mpl.warnings) && mpl.warnings.length
            ? `<div class="editor-warning" style="width:min(100%, 920px)">${mpl.warnings.map(escapeHtml).join('<br>')}</div>`
            : ''}
          <div class="pdf-sheet mpl-sheet">
            <div class="mpl-pdf-title">MASTER PACKING LIST</div>

            <div class="mpl-info-grid two">
              ${renderMplInfoCell(`packing_lists.${index}.customer_po_number`, 'Customer PO Number', mpl.customer_po_number)}
              ${renderMplInfoCell(`packing_lists.${index}.pro_number`, 'Pro No', mpl.pro_number)}
            </div>
            <div class="mpl-info-grid four">
              ${renderMplInfoCell(`packing_lists.${index}.order_no`, 'Order No', mpl.order_no)}
              ${renderMplInfoCell(`packing_lists.${index}.po_date`, 'PO Date', mpl.po_date)}
              ${renderMplInfoCell(`packing_lists.${index}.bol_number`, 'BOL No', mpl.bol_number)}
              <div class="mpl-info-cell">
                <div class="mpl-info-cell-label">Page No</div>
                <input value="Auto" disabled>
              </div>
            </div>
            <div class="mpl-info-grid three">
              ${renderMplInfoCell(`packing_lists.${index}.total_weight`, 'Total Weight', mpl.total_weight)}
              ${renderMplInfoCell(`packing_lists.${index}.ship_via`, 'Ship Via', mpl.ship_via)}
              ${renderMplInfoCell(`packing_lists.${index}.total_pallets`, 'Total Pallets', mpl.total_pallets)}
            </div>

            <div class="mpl-address-grid">
              ${renderMplAddressBox(`packing_lists.${index}.supplier_info`, 'SUPPLIER INFO:', mpl.supplier_info)}
              ${renderMplAddressBox(`packing_lists.${index}.bill_to`, 'BILL TO:', mpl.bill_to)}
              ${renderMplAddressBox(`packing_lists.${index}.ship_to`, 'SHIP TO:', mpl.ship_to)}
            </div>

            <div class="mpl-ship-bar">
              ${renderMplShipCell(`packing_lists.${index}.customer_no`, 'Customer No', mpl.customer_no || mpl.customer_po_number)}
              ${renderMplShipCell(`packing_lists.${index}.est_ship_date`, 'Ship Date', mpl.est_ship_date)}
              ${renderMplShipCell(`packing_lists.${index}.shipping_instructions`, 'Shipping Instructions', mpl.shipping_instructions)}
            </div>

            ${renderMplItemsEditor(index, mpl.items || [])}
          </div>
        </div>`).join('')}
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
                <div>${editorPdfInput(`${base}.weight_lbs`, label.weight_lbs)}</div>
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

  function togglePackLabelSelection(index, event) {
    if (!activeKeheDocumentDraft || !Array.isArray(activeKeheDocumentDraft.pack_labels)) return;
    if (event && event.target && event.target.closest('input, textarea, select, button, a')) return;
    const label = activeKeheDocumentDraft.pack_labels[index];
    if (!label) return;
    label.print_selected = !label.print_selected;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  }

  function addPackLabel() {
    if (!activeKeheDocumentDraft) return;
    activeKeheDocumentDraft.pack_labels = activeKeheDocumentDraft.pack_labels || [];
    const newIndex = activeKeheDocumentDraft.pack_labels.length;
    activeKeheDocumentDraft.pack_labels.push({
      id: `PACK-${activeKeheDocumentDraft.pack_labels.length + 1}`,
      status: 'Needs Review',
      print_selected: true,
      matched_in_xml: false,
      gtin: '',
      description: '',
      brand: '',
      packaging_level: 'Case',
      pack_prefix: 'MP',
      dimensions_in: '',
      weight_lbs: '',
      case_qty: '1',
      labels_per_unit: '2',
      sku: '',
      lot: '',
      best_before: '',
      copies: 2,
      warnings: ['Manually added label. Verify all fields before printing.']
    });
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    focusAndScrollIntoView(`[data-pack-label-index="${newIndex}"]`, 'textarea, input');
  }

  function deletePackLabel(index) {
    if (!activeKeheDocumentDraft || !Array.isArray(activeKeheDocumentDraft.pack_labels)) return;
    activeKeheDocumentDraft.pack_labels.splice(index, 1);
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
    document.getElementById('document-editor-title').textContent = `Review & Edit ${cfg.label}`;
    if (type === 'masterPackingList') {
      const nameInput = document.getElementById('mpl-draft-name-input');
      const nextName = defaultMplDraftName(draft);
      if (nameInput && String(nameInput.value || '').trim() !== nextName) {
        nameInput.value = nextName;
      }
    }
    updateMplSaveButtonState(type);
    const renderBtn = document.getElementById('btn-render-edited-document');
    if (renderBtn) {
      renderBtn.textContent = type === 'masterPackingList'
        ? 'Generate PDF Only'
        : 'Generate PDF';
    }
    const body = document.getElementById('document-editor-body');
    const dialog = document.querySelector('#document-editor-panel .editor-dialog');
    if (dialog) dialog.classList.add('pdf-editor-dialog');
    body.className = `editor-body pdf-editor-body ${type === 'palletLabel' ? 'pallet-pdf-editor-body' : (type === 'packLabels' ? 'pack-label-pdf-editor-body' : 'mpl-pdf-editor-body')}`;
    if (type === 'palletLabel') {
      body.innerHTML = renderPalletLabelEditor(draft);
    } else if (type === 'packLabels') {
      body.innerHTML = renderPackLabelEditor(draft);
    } else {
      body.innerHTML = renderMasterPackingListEditor(draft);
    }
    enhanceSearchableSelects(body);
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
      }
    }
  }

  function selectAllPackLabels(checked) {
    if (!activeKeheDocumentDraft || !Array.isArray(activeKeheDocumentDraft.pack_labels)) return;
    activeKeheDocumentDraft.pack_labels.forEach(label => { label.print_selected = !!checked; });
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  }

  function selectMatchedPackLabels() {
    if (!activeKeheDocumentDraft || !Array.isArray(activeKeheDocumentDraft.pack_labels)) return;
    activeKeheDocumentDraft.pack_labels.forEach(label => { label.print_selected = !!label.matched_in_xml; });
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
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

  function renderDocumentReport(docCfg, report) {
    if (selectedKit === 'kehe') {
      renderKeheUnifiedReport(keheCurrentExtractedSource || activeKeheDocumentDraft);
      return;
    }
    currentReport = report || null;
    currentCsvColumns = docCfg.columns;
    currentCsvName = docCfg.csvName;
    document.getElementById('report-title').textContent = docCfg.reportTitle;
    document.getElementById('match-rules').textContent = 'Generated from edited document fields.';
    setReportTableMode('document');
    document.getElementById('match-table-head').innerHTML =
      '<tr>' + docCfg.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('') + '</tr>';
    renderSummary(report);
    const rows = report?.rows || [];
    const bodyEl = document.getElementById('match-table-body');
    if (!rows.length) {
      bodyEl.innerHTML = `<tr><td class="empty-row" colspan="${docCfg.columns.length}">No report details available.</td></tr>`;
      setExportReady(false);
      return;
    }
    bodyEl.innerHTML = rows.map(row => {
      return '<tr>' + docCfg.columns.map(([key]) => {
        const value = row[key];
        if (key === 'status') return `<td>${formatStatusCell(value)}</td>`;
        return `<td>${escapeHtml(value || '\u2014')}</td>`;
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
    const cfg = KEHE_DOCUMENT_CONFIG[activeKeheDocumentType];
    const btn = document.getElementById('btn-render-edited-document');
    const saveGenerateBtn = document.getElementById('btn-save-mpl-draft');
    const saveBeforeGenerate = !!options.saveMplDraft && activeKeheDocumentType === 'masterPackingList';
    const workingButtons = [btn, saveGenerateBtn].filter(Boolean);
    workingButtons.forEach(button => { button.disabled = true; });
    try {
      if (saveBeforeGenerate) {
        const saved = await saveActiveMplDraft({
          savingMessage: 'Saving MPL draft before PDF generation...',
          successMessage: 'MPL draft saved. Generating PDF now...'
        });
        if (!saved) return;
      }
      activeKeheDocumentDraft.product_master = getActiveProductMasterRows();
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
      resetPreviewSurface();
      await openPreview();
      setStatus(saveBeforeGenerate ? `${cfg.label} saved and generated successfully.` : `${cfg.label} generated successfully.`, 'success');
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Generation failed.'), 'error');
    } finally {
      if (btn) btn.disabled = false;
      updateMplSaveButtonState(activeKeheDocumentType);
    }
  }
