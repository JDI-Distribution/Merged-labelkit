
  /* =======================================================================
     FRONTEND: Workflow state and backend routing.
     Michaels and KeHE are separated here so each kit calls the correct backend.
     ======================================================================= */
  const KIT_CONFIG = {
    michaels: {
      headerName: 'Michaels DTS · LabelKit',
      headerSub: 'ASN XML + ShipStation shipping labels',
      titleHtml: 'Michaels DTS · <span>LabelKit</span>',
      description: 'Upload your ASN XML from Infocon and one or more ShipStation shipping-label PDFs. One PDF upload returns one print-ready PDF; multiple PDF uploads return a ZIP with one separate output PDF per upload. The combined preview includes a named break page between uploaded PDFs.',
      generateTitle: 'Generate Michaels Documents',
      generateSubtitle: 'Create separate matched output files plus a combined preview with named PDF break pages.',
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
        ['output_order', 'Final PDF Order'],
        ['output_files', 'Output Files'],
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
      headerSub: '',
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
    },
    b2b: {
      headerName: 'B2B Case-Pack Labels · LabelKit',
      headerSub: 'Customer-first case-pack workflow',
      titleHtml: 'B2B Case-Pack <span>Labels</span>',
      description: '',
      noteHtml: '',
      xmlTitle: '',
      xmlHintHtml: '',
      requiresPdf: false,
      endpoint: '',
      outputName: 'b2b_case_pack_labels.pdf',
      generateLabel: 'B2B Case-Pack Labels',
      reportTitle: 'B2B Label Runs',
      reportRules: '',
      waitingText: 'Select customer and product configuration to start.',
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
      csvName: 'b2b_case_pack_labels.csv'
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
        ['gross_weight_lbs', 'Gross Weight'],
        ['case_qty', 'Case Qty'],
        ['copies', 'Copies'],
        ['note', 'Note']
      ]
    },
    partnerPackLabels: {
      label: 'Pack Labels',
      outputName: 'customer_pack_labels.pdf'
    },
    partnerPalletLabels: {
      label: 'Pallet Labels',
      outputName: 'customer_pallet_labels.pdf'
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

  const MPL_TEMPLATE_CONFIG = {
    kehe: {
      label: 'KeHE MPL',
      title: 'MASTER PACKING LIST',
      description: 'The required KeHE master packing list layout.'
    },
    decopac: {
      label: 'DecoPac',
      title: 'Pallet Breakdown',
      description: 'A pallet-first format for DecoPac orders, shipping details, and case totals.'
    },
    dutch_bros: {
      label: 'Dutch Brothers',
      title: 'Pallet Breakdown',
      description: 'The DecoPac-style pallet breakdown headed for Dutch Bros.'
    },
    fancy: {
      label: 'Fancy Sprinkles',
      title: 'Pallet Breakdown',
      description: 'The shared pallet-breakdown format headed for Fancy Sprinkles.'
    },
    standard: {
      label: 'Standard',
      title: 'MASTER PACKING LIST',
      description: 'The familiar general-purpose format with the same editable fields and columns.'
    }
  };

  const MPL_STANDALONE_TEMPLATE_IDS = ['kehe', 'decopac', 'dutch_bros', 'fancy', 'standard'];

  let PARTNER_WORKFLOW_CONFIG = {};
  let PARTNER_CUSTOMER_IDS = [];
  const MPL_BRAND_CONFIG = {
    brew_glitter: {
      label: 'Brew Glitter',
      supplierName: 'BREW GLITTER',
      logo: '/assets/img/mpl-brands/brew_glitter.png',
      primary: '#111111',
      accent: '#E6AE3F',
      soft: '#F6D58C',
      pale: '#FFF9EC',
      onPrimary: '#FFFFFF'
    },
    bakell: {
      label: 'Bakell',
      supplierName: 'BAKELL LLC',
      logo: '/assets/img/mpl-brands/bakell.png',
      primary: '#A7866C',
      accent: '#E7AF35',
      soft: '#F2D28A',
      pale: '#FFF9EC',
      onPrimary: '#FFFFFF'
    },
    pfg: {
      label: 'PFG',
      supplierName: 'PFG',
      logo: '/assets/img/mpl-brands/pfg.png',
      logoClass: 'pfg-safe',
      primary: '#00A84F',
      accent: '#79BE43',
      soft: '#CDEEB7',
      pale: '#F3FFF2',
      onPrimary: '#FFFFFF'
    },
    jdi_distribution: {
      label: 'JDI Distribution',
      supplierName: 'JDI DISTRIBUTION',
      logo: '/assets/img/mpl-brands/jdi_distribution.png',
      primary: '#3B3B3A',
      accent: '#F04B3A',
      soft: '#FFD5CE',
      pale: '#FFF7F5',
      onPrimary: '#FFFFFF'
    }
  };
  const MPL_BRAND_IDS = Object.keys(MPL_BRAND_CONFIG);
  const MPL_DEFAULT_BRAND_ID = 'jdi_distribution';
  const MPL_DEFAULT_ADDRESS_LINES = ['1967 ESSEX CT', 'REDLANDS, CA 92373', 'USA'];

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
  let downloadBlobUrl = null;
  let currentResultId = null;
  let currentReport = null;
  let activeKeheDocumentType = null;
  let activeKeheDocumentDraft = null;
  let mplVersionHistory = [];
  let currentCsvName = null;
  let currentCsvColumns = null;
  let savedMplDrafts = [];
  let activeExcelImportPreview = null;
  let activeKeheAuditEntries = [];
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
  let mplDirectorySharedShipFrom = DEFAULT_KEHE_SHIP_FROM;
  let keheDcDirectoryRows = loadKeheDcDirectoryFromStorage();
  let keheDcDirectoryLoadPromise = null;
  let mplProductMasterRows = loadMplProductMasterFromStorage();
  let mplProductMasterLoadPromise = null;
  let mplProductMasterSaveTimer = null;
  const mplExpandedProductGroups = new Set();
  let mplDirectoryRows = loadMplDirectoryFromStorage();
  let mplDirectoryLoadPromise = null;
  let mplDirectorySaveTimer = null;
  let mplDirectoryExpandedIndex = -1;
  let b2bLabelTemplates = [];
  let b2bSelectedCustomer = '';
  let b2bSelectedGroupKey = '';
  let b2bSelectedProductIndex = -1;
  let b2bSelectedDirectoryIndex = -1;
  let b2bSelectedTemplateId = '';
  let b2bOrderFallbackProducts = [];
  let b2bCopiesTemplateId = '';
  let b2bSettingsProductIndex = -1;
  let b2bPreviewUrl = null;
  let partnerOrderPayload = null;
  let partnerCustomerId = '';
  let partnerCustomerOverride = '';
  let partnerLabelJobs = [];
  let partnerMplDraft = null;
  let partnerLabelsPreviewUrl = null;
  let partnerPalletLabelsPreviewUrl = null;
  let partnerMplPreviewUrl = null;
  let partnerEditingLabelKind = '';
  let partnerEditingMpl = false;
  let partnerInlineLabelKind = 'packLabels';
  let partnerInlineLabelIndex = -1;
  let b2bRunFields = {
    po_number: '',
    order_number: '',
    invoice_number: '',
    lot_number: '',
    ship_date: '',
    quantity_label: '',
    expected_delivery_date: '',
    best_before: '',
    carton_total: '1',
    carton_start: '1',
    carton_end: '1',
    copies: '1',
    print_barcode: 'false',
    project_name: '',
    allergens: '',
    required_statement: ''
  };
  const B2B_PACKAGING_LEVELS = ['Each', 'Inner Pack', 'Case', 'Master Case', 'Pallet', 'Shipper Contents'];
  const B2B_BARCODE_TYPES = ['UPC_A', 'EAN_13', 'GTIN_14', 'NONE'];
  const B2B_BARCODE_LEVELS = ['EACH', 'INNER_PACK', 'CASE', 'MASTER_CASE', 'PALLET', 'NONE'];
  const B2B_VERIFICATION_STATUSES = ['DRAFT', 'NEEDS_REVIEW', 'VERIFIED', 'BLOCKED'];
  const B2B_DIRECTORY_RECORD_TYPES = ['CUSTOMER_DEFAULT', 'DESTINATION', 'DISTRIBUTION_CENTER'];
  const mplLiveTiHiTimers = new Map();
  let keheExtractedLoadTimer = null;
  let keheExtractionRequestId = 0;
  let embeddedAuthMounted = false;
  const pages = ['home', 'michaels', 'kehe', 'mpl', 'b2b', 'partners'];

  fetch('/health').catch(() => {});

  function updateMplSaveState(state = 'unsaved', detail = '') {
    const badge = document.getElementById('mpl-save-state');
    if (!badge) return;
    badge.dataset.state = state;
    badge.textContent = state === 'saving' ? 'Saving…'
      : state === 'saved' ? `Saved${detail ? ` · ${detail}` : ''}`
      : state === 'error' ? 'Save failed'
      : 'Unsaved changes';
  }

  const mplDraftSync = window.LabelKitDraftSync?.create({
    delayMs: 30000,
    canSave: () => activeKeheDocumentType === 'masterPackingList' && !!activeKeheDocumentDraft && hasPermission('save_mpl'),
    save: () => saveActiveMplDraft({ showStatus: false, autoSave: true, createVersion: false }),
    onState: updateMplSaveState
  });

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

  function renderPartnerCustomerOptions() {
    const container = document.getElementById('partner-customer-options');
    if (!container) return;
    container.innerHTML = PARTNER_CUSTOMER_IDS.map(customerId => {
      const config = PARTNER_WORKFLOW_CONFIG[customerId];
      return `<button type="button" data-partner-customer="${escapeHtml(customerId)}" role="radio" aria-checked="false" onclick="selectPartnerCustomer('${jsString(customerId)}')"><span>${escapeHtml(config.label)}</span><small>${escapeHtml(config.selectorHint || 'Packing lists and labels')}</small></button>`;
    }).join('');
  }

  async function loadCustomerWorkflowConfig() {
    const res = await fetchWithTimeout('/api/customer-workflows', { cache: 'no-store' }, 15000);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.detail || 'Could not load customer workflows.');
    const workflows = Array.isArray(payload.workflows) ? payload.workflows : [];
    PARTNER_WORKFLOW_CONFIG = Object.fromEntries(workflows
      .filter(workflow => workflow && workflow.id)
      .map(workflow => [String(workflow.id), {
        label: String(workflow.label || workflow.id),
        mplTemplateId: String(workflow.mpl_template_id || 'standard'),
        labelTemplateIds: Array.isArray(workflow.label_template_ids) ? workflow.label_template_ids.map(String) : [],
        homeAccent: String(workflow.accent || 'green'),
        selectorHint: String(workflow.selector_hint || ''),
        detectionAliases: Array.isArray(workflow.detection_aliases) ? workflow.detection_aliases.map(String) : []
      }]));
    PARTNER_CUSTOMER_IDS = Object.keys(PARTNER_WORKFLOW_CONFIG);
    if (!PARTNER_CUSTOMER_IDS.length) throw new Error('No customer workflows are configured.');
    renderPartnerCustomerOptions();
    return PARTNER_WORKFLOW_CONFIG;
  }

  function renderAuthState() {
    const gate = document.getElementById('auth-gate');
    const appShell = document.getElementById('app-shell');
    const header = document.querySelector('header');
    const userChip = document.getElementById('auth-user-chip');
    const userName = document.getElementById('auth-user-name');
    const userRole = document.getElementById('auth-user-role');
    const logoutButton = document.getElementById('auth-logout-btn');
    const dataNav = document.getElementById('header-data-nav');
    const loginHint = document.getElementById('auth-login-hint');
    const needsLogin = !!appRuntimeConfig.auth_required && !appRuntimeConfig.authenticated;

    if (gate) gate.classList.toggle('visible', needsLogin);
    if (appShell) appShell.classList.toggle('auth-locked', needsLogin);
    if (header) header.classList.toggle('auth-locked', needsLogin);

    if (userChip) userChip.classList.toggle('hidden', !appRuntimeConfig.authenticated);
    if (userName) userName.textContent = authUserLabel();
    if (userRole) userRole.textContent = appRuntimeConfig?.user?.role_name || appRuntimeConfig?.user?.role || 'User';
    if (logoutButton) logoutButton.classList.toggle('hidden', !appRuntimeConfig.authenticated);
    if (dataNav) dataNav.classList.toggle('hidden', !appRuntimeConfig.authenticated);
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
    document.querySelectorAll('button[onclick="addMplProductRow()"], button[onclick="addMplDirectoryRow()"], button[onclick="toggleSharedDirectoryOriginEditor()"], button[onclick^="triggerExcelImport"]').forEach(btn => {
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
    const saveOnly = document.getElementById('btn-save-mpl-only');
    const versions = document.getElementById('btn-mpl-versions');
    const saveState = document.getElementById('mpl-save-state');
    const isMplEditor = type === 'masterPackingList';
    if (nameWrap) nameWrap.classList.toggle('hidden', !isMplEditor);
    if (isMplEditor && nameInput && activeKeheDocumentDraft && !String(nameInput.value || '').trim()) {
      nameInput.value = defaultMplDraftName(activeKeheDocumentDraft);
    }
    if (!saveDraft) return;
    const canSave = hasPermission('save_mpl');
    [saveOnly, versions, saveState].forEach(element => element?.classList.toggle('hidden', !isMplEditor));
    if (saveOnly) saveOnly.disabled = !isMplEditor || !canSave;
    if (versions) versions.disabled = !activeKeheDocumentDraft?._saved_draft_id;
    saveDraft.classList.toggle('hidden', !isMplEditor);
    saveDraft.disabled = !isMplEditor || !canSave;
    saveDraft.textContent = 'Save & Generate PDF';
    saveDraft.title = isMplEditor && !canSave
      ? 'Admin or Editor role required to save MPL drafts.'
      : '';
  }

  function removeTemporaryUrlParameters() {
    const url = new URL(window.location.href);
    let changed = false;
    ['verify', 'refresh', 'ui'].forEach(parameter => {
      if (url.searchParams.has(parameter)) {
        url.searchParams.delete(parameter);
        changed = true;
      }
    });
    if (changed) {
      const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
      history.replaceState(history.state, '', cleanUrl);
    }
  }

  async function bootstrapLabelKit() {
    removeTemporaryUrlParameters();
    await loadAppRuntimeConfig();
    if (appRuntimeConfig.auth_required && !appRuntimeConfig.authenticated) {
      return;
    }
    try {
      await loadCustomerWorkflowConfig();
    } catch (err) {
      setStatus(`Could not load customer workflows: ${err.message || 'unknown error'}`, 'error');
    }
    const initialRoute = getRouteFromHash();
    setHistoryRoute(initialRoute, true);
    await applyRouteFromNavigation(initialRoute);
    const editorBody = document.getElementById('document-editor-body');
    const markDirty = () => {
      if (activeKeheDocumentType === 'masterPackingList' && activeKeheDocumentDraft) mplDraftSync?.schedule();
    };
    editorBody?.addEventListener('input', markDirty);
    editorBody?.addEventListener('change', markDirty);
    editorBody?.addEventListener('click', event => {
      if (event.target.closest('button') && activeKeheDocumentType === 'masterPackingList') {
        setTimeout(markDirty, 0);
      }
    });
    window.addEventListener('beforeunload', event => {
      if (!mplDraftSync?.hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    });
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

  function setHistoryRoute(route, replace = false) {
    const normalized = normalizeAppRoute(route);
    const nextHash = `#${normalized}`;
    // Auth is complete before application navigation starts, so keep the
    // visible URL canonical and independent of the path that served index.html.
    const nextUrl = `/${nextHash}`;
    const state = {
      page: routePage(normalized),
      route: normalized,
      isOverlayRoute: !!routeSubpath(normalized),
      pushedOverlayRoute: !replace && !!routeSubpath(normalized)
    };
    const currentHash = window.location.hash || '#home';

    if (replace) {
      history.replaceState(state, '', nextUrl);
      return;
    }

    if (currentHash !== nextHash) {
      history.pushState(state, '', nextUrl);
      return;
    }

    if (!history.state || history.state.route !== normalized) {
      history.replaceState(state, '', nextUrl);
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
    } else if (normalized === 'b2b') {
      await selectB2BWorkspace(false);
    } else if (normalized === 'partners') {
      await selectPartnerWorkspace(false);
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
    const current = getRouteFromHash();
    if (routeSubpath(current).startsWith('tihi/')) {
      returnToMplEditor();
      return;
    }
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
    if (normalized === 'b2b/product-master') {
      showMplProductMasterView();
      return;
    }
    if (normalized === 'partners/product-master') {
      showMplProductMasterView();
      return;
    }
    if (normalized === 'mpl/directory') {
      showMplDirectoryView();
      return;
    }
    if (normalized === 'b2b/directory') {
      showMplDirectoryView();
      return;
    }
    if (normalized === 'partners/directory') {
      showMplDirectoryView();
      return;
    }
    if (subpath === 'shared-product-master') {
      showMplProductMasterView();
      return;
    }
    if (subpath === 'shared-directory') {
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

  function uniqueTextValues(values) {
    return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));
  }

  function syncTableFilterOptions(selectId, values, allLabel = 'All') {
    const select = document.getElementById(selectId);
    if (!select) return;
    const current = String(select.value || '');
    const options = uniqueTextValues(values);
    select.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = allLabel;
    select.appendChild(allOption);
    options.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = options.includes(current) ? current : '';
  }

  function clearTableFilters(renderer, ...controlIds) {
    controlIds.forEach(id => {
      const control = document.getElementById(id);
      if (!control) return;
      if (control.tagName === 'SELECT') {
        control.selectedIndex = 0;
      } else if (control.type === 'checkbox' || control.type === 'radio') {
        control.checked = false;
      } else {
        control.value = '';
      }
    });
    if (typeof renderer === 'function') renderer();
    const firstControl = document.getElementById(controlIds[0]);
    if (firstControl && !firstControl.disabled) firstControl.focus({ preventScroll: true });
  }

  function selectOptionsHtml(values, currentValue = '', blankLabel = '') {
    const current = String(currentValue || '').trim();
    const options = uniqueTextValues([...(values || []), current]);
    const blank = blankLabel
      ? `<option value="" ${current ? '' : 'selected'}>${escapeHtml(blankLabel)}</option>`
      : '';
    return blank + options.map(value => (
      `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(value)}</option>`
    )).join('');
  }

  function b2bCustomerOptions(currentValue = '') {
    return uniqueTextValues([
      currentValue,
      ...b2bLabelTemplates.map(template => template?.customer),
      ...mplProductMasterRows.map(row => normalizeProductRow(row).storefront),
      ...mplDirectoryRows.map(row => normalizeDcDirectoryRow(row).storefront),
    ]);
  }

  function b2bTemplateIdOptions() {
    return uniqueTextValues(b2bLabelTemplates.map(template => template?.template_id));
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
    const selects = Array.from(scope.querySelectorAll('select:not([data-search-enhanced]):not([data-no-search])'));
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

  /* Product Master and Customer Directory logic lives in reference-data.js. */

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
    const candidates = [item.config_id, item.gtin, item.case_upc, item.upc, item.item_number, item.customer_item_number, item.sku]
      .map(canonicalId)
      .filter(Boolean);
    return rows.find(row => {
      const keys = [row.config_id, row.gtin, row.customer_item_number, row.sku].map(canonicalId).filter(Boolean);
      return candidates.some(candidate => keys.includes(candidate));
    }) || rows.find(row => row.description && item.description && row.description.trim().toLowerCase() === String(item.description).trim().toLowerCase()) || null;
  }

  function getMplItemProductIndex(item) {
    const rows = getActiveProductMasterRows();
    const candidates = [item?.config_id, item?.gtin, item?.case_upc, item?.upc, item?.item_number, item?.customer_item_number, item?.sku]
      .map(canonicalId)
      .filter(Boolean);
    let index = rows.findIndex(row => {
      if (!isCasePackagingLevel(row.packaging_level)) return false;
      const keys = [row.config_id, row.gtin, row.customer_item_number, row.sku].map(canonicalId).filter(Boolean);
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
      row.config_id ? `Config ${row.config_id}` : '',
      row.description || `Product ${index + 1}`,
      row.customer_item_number ? `Cust Item ${row.customer_item_number}` : '',
      row.sku ? `SKU ${row.sku}` : '',
      row.gtin ? `GTIN ${row.gtin}` : '',
      row.packaging_level || ''
    ].filter(Boolean);
    return parts.join(' - ');
  }

  function findEachProductForCaseProduct(product) {
    if (!product) return null;
    const wantedSku = String(product.sku || '').trim().toLowerCase();
    const wantedStorefront = normalizeStorefront(product.storefront || '').toLowerCase();
    if (!wantedSku) return null;
    const matches = getActiveAllProductMasterRows().filter(row => (
      normalizePackagingLevel(row.packaging_level) === 'Each'
      && String(row.sku || '').trim().toLowerCase() === wantedSku
      && normalizeStorefront(row.storefront || '').toLowerCase() === wantedStorefront
      && !!String(row.gtin || '').trim()
    ));
    const uniqueGtins = [...new Set(matches.map(row => canonicalId(row.gtin)).filter(Boolean))];
    return uniqueGtins.length === 1 ? matches[0] : null;
  }

  function applyProductRowToMplItem(item, product, options = {}) {
    if (!item || !product) return;
    const qtyFallback = options.defaultQty || '1';
    const eachProduct = findEachProductForCaseProduct(product);
    const eachGtin = String(options.eachGtin || eachProduct?.gtin || '').trim();
    item.item_number = eachGtin || product.sku || item.sku || item.item_number || '';
    item.each_gtin = eachGtin;
    item.case_upc = product.gtin || item.case_upc || '';
    item.gtin = product.gtin || item.gtin || '';
    item.sku = product.sku || item.sku || '';
    item.description = product.description || item.description || '';
    item.storefront = normalizeStorefront(product.storefront || item.storefront || '');
    item.packaging_level = product.packaging_level || item.packaging_level || '';
    item.length_in = product.length_in || item.length_in || '';
    item.width_in = product.width_in || item.width_in || '';
    item.height_in = product.height_in || item.height_in || '';
    item.dimensions_in = product.dimensions_display || item.dimensions_in || '';
    item.unit_weight_lbs = product.gross_weight_lbs || item.unit_weight_lbs || '';
    item.quantity_per_case = product.case_qty || item.quantity_per_case || '';
    if (!String(item.product_size || '').trim()) {
      const eachWeight = String(product.each_net_weight_g || '').trim();
      item.product_size = eachWeight ? `${eachWeight} g` : '';
    }
    item.uom = item.uom || 'CASES';
    if (!String(item.qty_on_pallet || '').trim()) item.qty_on_pallet = qtyFallback;
    if (!String(item.total_ordered || '').trim()) item.total_ordered = item.qty_on_pallet || qtyFallback;
    if (!String(item.total_shipped || '').trim()) item.total_shipped = item.qty_on_pallet || qtyFallback;
    if (!String(item.units_on_pallet || '').trim()) {
      const cases = Number(item.qty_on_pallet);
      const unitsPerCase = Number(item.quantity_per_case);
      item.units_on_pallet = Number.isFinite(cases) && Number.isFinite(unitsPerCase)
        ? String(cases * unitsPerCase)
        : '';
    }
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
    if (field === 'supplier_info') return getSavedMplShipFromAddresses();
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
      invoice_po_number: '',
      lot: '',
      color: '',
      product_size: '',
      quantity_per_case: '',
      units_on_pallet: '',
      balance_owed: '',
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
    const standalone = selectedKit === 'mpl' || selectedKit === 'partners';
    const requestedTemplate = String(options.templateId || '').trim().toLowerCase();
    const templateId = standalone && MPL_STANDALONE_TEMPLATE_IDS.includes(requestedTemplate)
      ? requestedTemplate
      : (standalone ? 'standard' : 'kehe');
    const dcRows = getActiveDcDirectoryRows();
    const requestedStorefront = String(options.storefront || '').trim();
    const firstDc = (
      requestedStorefront
        ? dcRows.find(row => normalizeStorefront(row.storefront || '') === normalizeStorefront(requestedStorefront))
        : null
    ) || (standalone ? {} : (dcRows[0] || {}));
    const firstItem = blankManualMplItem(1, '1');
    const storefront = normalizeStorefront(requestedStorefront || firstDc.storefront || 'KeHE');
    const requestedBrand = String(options.brandId || '').trim().toLowerCase();
    const templateDefaultBrand = ['decopac', 'dutch_bros', 'fancy'].includes(templateId) ? 'bakell' : MPL_DEFAULT_BRAND_ID;
    const brandId = standalone
      ? (MPL_BRAND_IDS.includes(requestedBrand) ? requestedBrand : (templateDefaultBrand === 'bakell' ? 'bakell' : (inferMplBrandId(storefront) || templateDefaultBrand)))
      : 'bakell';
    const supplierInfo = standalone
      ? (firstDc.ship_from || mplBrandSupplierInfo(brandId))
      : (firstDc.ship_from || DEFAULT_KEHE_SHIP_FROM);
    return {
      document_type: 'kehe_master_packing_list',
      version: 3,
      manual_mpl: true,
      standalone_mpl: standalone,
      template_id: templateId,
      brand_id: brandId,
      storefront,
      summary: { packing_lists: 1, manual_mpl: true },
      warnings: [],
      product_master: getActiveProductMasterRows(),
      extracted_headers: [],
      extracted_items: [],
      packing_lists: [{
        id: 'MANUAL-MPL-1',
        title: MPL_TEMPLATE_CONFIG[templateId]?.title || 'MASTER PACKING LIST',
        standard_heading: 'Packing List',
        standard_subheading: 'Shipment and Pallet Detail',
        template_id: templateId,
        brand_id: brandId,
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
        supplier_info: supplierInfo,
        delivery_from_name: standalone ? MPL_BRAND_CONFIG[brandId].supplierName : 'BAKELL LLC',
        bill_to: firstDc.billing_address || '',
        ship_to: firstDc.delivery_address || '',
        customer_no: '',
        est_ship_date: '',
        shipping_instructions: '',
        phone_number: '',
        pallet_heading: 'PALLET 1',
        palletization_source: 'Manual',
        palletization_note: standalone
          ? 'Manual MPL created from standalone Product Master Table and Directory.'
          : 'Manual MPL created from GTIN / Packaging Master Table and KeHE DC Directory.',
        source_files: ['Manual Create MPL'],
        items: [firstItem],
        _pallet_ids: ['1'],
        _pallet_weights: {},
        _pallet_dimensions: { '1': '48 x 40 in' },
        _pallet_tihi: { '1': '' },
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
    const body = document.getElementById('mpl-order-instance-body');
    const count = document.getElementById('mpl-order-instance-count');
    const button = document.getElementById('btn-load-selected-mpl-order');
    const help = document.getElementById('mpl-order-instance-selection-help');
    if (picker) {
      picker.classList.add('hidden');
      picker.closest('.mpl-order-lookup-card')?.classList.remove('mpl-order-selection-open');
      delete picker.dataset.salesOrderNumber;
      delete picker.dataset.ecomdashId;
    }
    if (body) body.innerHTML = '';
    if (count) count.textContent = '';
    if (button) button.disabled = true;
    if (help) help.textContent = 'Check one order to continue.';
  }

  function showMplOrderInstancePicker(orderNumber, instances) {
    const picker = document.getElementById('mpl-order-instance-picker');
    const body = document.getElementById('mpl-order-instance-body');
    const count = document.getElementById('mpl-order-instance-count');
    const button = document.getElementById('btn-load-selected-mpl-order');
    if (!picker || !body) return;
    const orderInstances = Array.isArray(instances) ? instances : [];
    body.innerHTML = '';
    orderInstances.forEach(instance => {
      const ecomdashId = String(instance?.ecomdash_id || '').trim();
      const row = document.createElement('tr');
      const values = [
        ecomdashId,
        String(instance?.storefront || '').trim(),
        String(instance?.billing_customer_name || '').trim(),
        String(instance?.invoice_date || '').trim(),
        String(Number(instance?.sku_count || 0))
      ];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value || '—';
        if (index === 0) cell.className = 'mpl-order-instance-id';
        row.appendChild(cell);
      });
      const selectCell = document.createElement('td');
      selectCell.className = 'mpl-order-instance-select-column';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'mpl-order-instance-checkbox';
      checkbox.value = ecomdashId;
      checkbox.disabled = !ecomdashId;
      checkbox.setAttribute('aria-label', `Select ECOMDASH ID ${ecomdashId || 'missing'}`);
      checkbox.addEventListener('change', () => selectMplOrderInstance(checkbox));
      selectCell.appendChild(checkbox);
      row.appendChild(selectCell);
      body.appendChild(row);
    });
    picker.dataset.salesOrderNumber = String(orderNumber || '').trim();
    delete picker.dataset.ecomdashId;
    if (count) count.textContent = `${orderInstances.length} unique order${orderInstances.length === 1 ? '' : 's'}`;
    if (button) button.disabled = true;
    picker.classList.remove('hidden');
    picker.closest('.mpl-order-lookup-card')?.classList.add('mpl-order-selection-open');
  }

  function selectMplOrderInstance(selectedCheckbox) {
    const picker = document.getElementById('mpl-order-instance-picker');
    const button = document.getElementById('btn-load-selected-mpl-order');
    const help = document.getElementById('mpl-order-instance-selection-help');
    if (!picker || !selectedCheckbox) return;
    picker.querySelectorAll('.mpl-order-instance-checkbox').forEach(checkbox => {
      if (checkbox !== selectedCheckbox) checkbox.checked = false;
      checkbox.closest('tr')?.classList.toggle('selected', checkbox.checked);
    });
    const ecomdashId = selectedCheckbox.checked ? String(selectedCheckbox.value || '').trim() : '';
    if (ecomdashId) picker.dataset.ecomdashId = ecomdashId;
    else delete picker.dataset.ecomdashId;
    if (button) button.disabled = !ecomdashId;
    if (help) help.textContent = ecomdashId
      ? `ECOMDASH ID ${ecomdashId} selected.`
      : 'Check one order to continue.';
  }

  function loadSelectedMplOrderInstance() {
    const picker = document.getElementById('mpl-order-instance-picker');
    const orderNumber = String(picker?.dataset.salesOrderNumber || '').trim();
    const ecomdashId = String(picker?.dataset.ecomdashId || '').trim();
    if (!orderNumber || !ecomdashId) {
      setStatus('Select an ECOMDASH ID before loading the order.', 'error');
      return;
    }
    loadMplOrderFromAnalytics(null, ecomdashId, orderNumber);
  }

  function completeMplOrderLoad(payload, orderNumber, templateId) {
    const requestedTemplate = String(templateId || '').trim().toLowerCase();
    const normalizedTemplate = MPL_STANDALONE_TEMPLATE_IDS.includes(requestedTemplate)
      ? requestedTemplate
      : 'standard';
    activeKeheDocumentType = 'masterPackingList';
    activeKeheDocumentDraft = buildAnalyticsOrderMplDraft(payload, normalizedTemplate);
    keheLastMplDraft = activeKeheDocumentDraft;
    const palletization = autoPalletizeMpl(0, { render: false, showStatus: false }) || {};
    keheMplPalletizationSource = activeKeheDocumentDraft.packing_lists?.[0]?.palletization_source || 'Order Data + Product Master';
    renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
    openDocumentEditor();

    const summary = payload.summary || {};
    const matched = Number(summary.matched_products || 0);
    const converted = Number(summary.converted_to_cases || 0);
    const needsReview = Number(summary.unmatched_products || 0) + Number(summary.ambiguous_products || 0) + Number(summary.partial_case_items || 0);
    setStatus(
      `Sales Order ${orderNumber} loaded with the ${MPL_TEMPLATE_CONFIG[normalizedTemplate].label} template: ${payload.items?.length || 0} line item(s), ${matched} Product Master match(es)${converted ? `, ${converted} converted from eaches to cases` : ''}, ${Number(palletization.palletCount || 0)} pallet(s)${needsReview ? `, ${needsReview} need review` : ''}.`,
      needsReview ? 'info' : 'success'
    );
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

  function buildAnalyticsOrderMplDraft(payload, templateId = 'standard') {
    const orderNumber = String(payload?.sales_order_number || '').trim();
    const sourceItems = Array.isArray(payload?.items) ? payload.items : [];
    const matchedStorefronts = [...new Set(sourceItems
      .map(item => item?.product?.storefront)
      .filter(Boolean)
      .map(normalizeStorefront))];
    const draft = buildManualMasterPackingListDraft({
      storefront: matchedStorefronts.length === 1 ? matchedStorefronts[0] : '',
      templateId
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
      : 'Order data';

    mpl.id = orderNumber ? `SO-${orderNumber}` : mpl.id;
    mpl.customer_po_number = orderNumber;
    mpl.order_no = orderNumber;
    mpl.customer_no = orderNumber;
    if (analyticsBillTo) mpl.bill_to = analyticsBillTo;
    if (analyticsShipTo) mpl.ship_to = analyticsShipTo;
    mpl.shipping_instructions = String(orderDetails.order_notes || '').trim();
    mpl.source_files = [`${orderSourceLabel} · ${payload?.source?.view_name || 'Order Data'}`];
    mpl.palletization_source = `${orderSourceLabel} + Product Master`;
    const convertedItemCount = Number(payload?.summary?.converted_to_cases || 0);
    mpl.palletization_note = convertedItemCount
      ? `Order SKUs and each quantities loaded from ${orderSourceLabel}; ${convertedItemCount} line item(s) converted to cases using the saved Product Master case pack before palletization.`
      : `Order SKUs and quantities loaded from ${orderSourceLabel}; product details and weights matched from the saved Product Master.`;
    mpl.items = sourceItems.map((sourceItem, index) => {
      const quantity = analyticsOrderQuantity(sourceItem?.quantity_ordered) || '1';
      const sku = String(sourceItem?.sku || '').trim();
      const item = blankManualMplItem(index + 1, '1');
      item.item_number = String(sourceItem?.item_number || sku).trim();
      item.sku = sku;
      item.description = String(sourceItem?.description || '').trim();
      item.unit_weight_lbs = String(sourceItem?.unit_weight_lbs || '').trim();
      item.pallet_weight = String(sourceItem?.pallet_weight || '').trim();
      item.gtin = String(sourceItem?.gtin || '').trim();
      item.order_match_status = String(sourceItem?.match_status || '').trim();
      item.qty_on_pallet = quantity;
      item.total_ordered = quantity;
      item.total_shipped = quantity;
      item.analytics_quantity_eaches = analyticsOrderQuantity(sourceItem?.quantity_ordered_eaches);
      item.eaches_per_inner_pack = analyticsOrderQuantity(sourceItem?.eaches_per_inner_pack);
      item.inner_packs_per_case = analyticsOrderQuantity(sourceItem?.inner_packs_per_case);
      item.eaches_per_case = analyticsOrderQuantity(sourceItem?.eaches_per_case);
      item.case_conversion_exact = sourceItem?.case_conversion_exact !== false;
      const orderUnitWeight = parseWeight(item.unit_weight_lbs);
      if (orderUnitWeight !== null) {
        item.calculated_weight_lbs = formatLbs(orderUnitWeight * Number(quantity));
        if (!item.pallet_weight) item.pallet_weight = item.calculated_weight_lbs;
      }

      if (sourceItem?.match_status === 'matched' && sourceItem.product) {
        applyProductRowToMplItem(item, normalizeProductRow(sourceItem.product), {
          defaultQty: quantity,
          eachGtin: sourceItem.each_gtin
        });
        const itemWarnings = [];
        if (!item.each_gtin) {
          item.item_number = sku;
          itemWarnings.push('No Each GTIN; using SKU as Item Number.');
        }
        if (sourceItem?.quantity_uom === 'CASES' && sourceItem?.case_conversion_exact === false) {
          itemWarnings.push(`Analytics ordered ${item.analytics_quantity_eaches || sourceItem.quantity_ordered_eaches} eaches, which is not a full ${item.eaches_per_case || sourceItem.eaches_per_case}-each case multiple. Rounded up to ${quantity} cases for palletization.`);
        }
        if (itemWarnings.length) {
          item.notes = itemWarnings.join(' ');
          warnings.push(`SKU ${sku}: ${item.notes}`);
        }
      } else if (sourceItem?.match_status === 'ambiguous') {
        item.uom = 'EACHES';
        item.notes = `SKU ${sku}: multiple Product Master matches; using order data. Select a product for case pack, weight, and TI-HI.`;
        warnings.push(item.notes);
      } else {
        item.uom = 'EACHES';
        item.notes = `SKU ${sku}: using order data; add Product Master data for GTIN, weight, and TI-HI.`;
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
      ambiguous_products: Number(payload?.summary?.ambiguous_products || 0),
      converted_to_cases: convertedItemCount,
      partial_case_items: Number(payload?.summary?.partial_case_items || 0)
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
      quantity_ordered_eaches: item.quantity_ordered_eaches ?? '',
      quantity_ordered_cases: item.quantity_ordered_cases ?? '',
      eaches_per_case: item.eaches_per_case ?? '',
      item_number: item.item_number || '',
      description: item.description || '',
      unit_weight_lbs: item.unit_weight_lbs || '',
      pallet_weight: item.pallet_weight || '',
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
    setStatus(`Searching order data for Sales Order ${orderNumber}…`, 'info');
    showWorkflowProgress(0, `Loading Sales Order ${orderNumber}…`);
    try {
      await ensureKeheReferenceDataLoaded();
      updateWorkflowProgress('Matching SKUs', 'Loading Product Master and matching order SKUs…');
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
        closeWorkflowProgress();
        showMplOrderInstancePicker(orderNumber, payload.order_instances);
        setStatus(`Sales Order ${orderNumber} matches multiple ECOMDASH IDs. Select the correct storefront/customer order.`, 'info');
        return;
      }
      hideMplOrderInstancePicker();
      updateWorkflowProgress('Calculating cartons', 'Calculating cartons, weights, and palletization…');
      completeMplOrderLoad(payload, orderNumber, 'standard');
      closeWorkflowProgress();
    } catch (err) {
      closeWorkflowProgress();
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
    mplDraftSync?.schedule();
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
    const firstMpl = activeKeheDocumentDraft.packing_lists?.[0] || {};
    const reviewStatus = String(activeKeheDocumentDraft.review_status || firstMpl.review_status || 'DRAFT').toUpperCase();
    activeKeheDocumentDraft.review_status = ['DRAFT', 'REVIEWED', 'APPROVED'].includes(reviewStatus) ? reviewStatus : 'DRAFT';

    const payload = {
      id: activeKeheDocumentDraft._saved_draft_id || '',
      name: trimmedName,
      expected_revision: Number(activeKeheDocumentDraft._saved_draft_revision || 0),
      create_version: options.createVersion !== false && !options.autoSave,
      version_reason: options.versionReason || 'Explicit save',
      status: activeKeheDocumentDraft.review_status,
      customer_code: activeKeheDocumentDraft.storefront || firstMpl.customer_name || firstMpl.ship_to_name || '',
      po_number: firstMpl.customer_po_number || '',
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
      if (res.status === 409) {
        const editor = data.updated_by ? ` by ${data.updated_by}` : '';
        throw new Error(`${data.detail || 'A newer saved version exists.'}${editor}`);
      }
      if (!res.ok) throw new Error(data.detail || 'Could not save MPL draft.');
      activeKeheDocumentDraft._saved_draft_id = data.draft?.id || activeKeheDocumentDraft._saved_draft_id;
      activeKeheDocumentDraft._saved_draft_name = data.draft?.name || trimmedName;
      activeKeheDocumentDraft._saved_draft_revision = Number(data.draft?.revision || activeKeheDocumentDraft._saved_draft_revision || 0);
      const nameInput = document.getElementById('mpl-draft-name-input');
      if (nameInput) nameInput.value = activeKeheDocumentDraft._saved_draft_name;
      mplDraftSync?.markSaved();
      updateMplSaveButtonState();
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
    const search = String(document.getElementById('saved-mpl-search')?.value || '').trim().toLowerCase();
    const status = String(document.getElementById('saved-mpl-status-filter')?.value || '').trim().toUpperCase();
    const creator = String(document.getElementById('saved-mpl-created-by-filter')?.value || '').trim().toLowerCase();
    const date = String(document.getElementById('saved-mpl-date-filter')?.value || '').trim();
    const filtered = savedMplDrafts.filter(draft => {
      const haystack = [draft.name, draft.customer_code, draft.order_number, draft.customer_po_number, draft.ship_to].join(' ').toLowerCase();
      const user = savedMplCreatedByLabel(draft).toLowerCase();
      const createdDate = String(draft.created_at || draft.updated_at || '').slice(0, 10);
      return (!search || haystack.includes(search))
        && (!status || String(draft.status || 'DRAFT').toUpperCase() === status)
        && (!creator || user.includes(creator))
        && (!date || createdDate === date);
    });
    const count = document.getElementById('saved-mpl-filter-count');
    if (count) count.textContent = `${filtered.length} of ${savedMplDrafts.length}`;
    if (!savedMplDrafts.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="13">No saved MPL drafts yet. Create an MPL, then use Save &amp; Generate PDF in the editor.</td></tr>';
      return;
    }
    if (!filtered.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="13">No saved MPL drafts match these filters.</td></tr>';
      return;
    }
    body.innerHTML = filtered.map(draft => `
      <tr>
        <td>${escapeHtml(draft.name || 'Untitled MPL')}</td>
        <td>${escapeHtml(draft.customer_code || '—')}</td>
        <td>${escapeHtml(draft.order_number || '—')}</td>
        <td>${escapeHtml(draft.customer_po_number || '—')}</td>
        <td>${escapeHtml(draft.ship_to || '—')}</td>
        <td>${escapeHtml(draft.total_pallets || '—')}</td>
        <td>${escapeHtml(draft.item_count || '0')}</td>
        <td>${escapeHtml(formatDateTime(draft.updated_at))}</td>
        <td>${escapeHtml(savedMplCreatedByLabel(draft))}</td>
        <td><span class="status-tag ${String(draft.status || 'DRAFT').toUpperCase() === 'APPROVED' ? 'success' : 'needs-review'}">${escapeHtml(String(draft.status || 'DRAFT'))}</span></td>
        <td><button class="btn-table-preview" type="button" onclick="loadSavedMplDraft('${jsString(draft.id)}')">Open</button></td>
        <td><button class="btn-secondary table-action-btn" type="button" onclick="duplicateSavedMplDraft('${jsString(draft.id)}')">Copy</button></td>
        <td>${canDelete ? `<button class="btn-mini-danger table-action-btn" type="button" onclick="deleteSavedMplDraft('${jsString(draft.id)}', '${jsString(draft.name || 'Untitled MPL')}')">Delete</button>` : '—'}</td>
      </tr>
    `).join('');
  }

  function savedMplUserLabel(draft = {}) {
    return draft.updated_by || draft.created_by || draft.user || draft.saved_by || '—';
  }

  function savedMplCreatedByLabel(draft = {}) {
    return draft.created_by || draft.user || draft.saved_by || draft.updated_by || '—';
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
      await ensureKeheReferenceDataLoaded();
      const res = await fetch(`/api/kehe/mpl-drafts/${encodeURIComponent(draftId)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not open saved MPL draft.');
      const record = data.draft || {};
      const draft = record.draft;
      if (!draft || typeof draft !== 'object') throw new Error('Saved MPL draft is empty.');
      draft._saved_draft_id = record.id;
      draft._saved_draft_name = record.name;
      draft._saved_draft_revision = Number(record.revision || 0);
      activeKeheDocumentType = 'masterPackingList';
      activeKeheDocumentDraft = draft;
      activeKeheDocumentDraft.product_master = getActiveAllProductMasterRows();
      applyProductMasterToDraft(activeKeheDocumentDraft, false);
      keheLastMplDraft = draft;
      keheMplPalletizationSource = draft.packing_lists?.[0]?.palletization_source || 'Saved';
      closeSavedMplModal(false);
      renderDocumentEditor('masterPackingList', activeKeheDocumentDraft);
      openDocumentEditor();
      if (selectedKit === 'kehe') renderKeheUnifiedReport(activeKeheDocumentDraft);
      mplDraftSync?.markSaved();
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

  function productMasterCsvHeader() {
    return [
      'Customer / Storefront', 'Config ID', 'SKU', 'Customer Item Number', 'Product Description', 'Product Status',
      'Packaging Level', 'GTIN', 'Eaches Contained', 'Each Weight (g)', 'Total Product Weight (g)',
      'Total Weight with Packaging (lb)', 'Final Length (in)', 'Final Width/Breadth (in)', 'Final Height (in)',
      'Label Template ID', 'Barcode Type', 'Barcode Level', 'Default Copies', 'Label Enabled', 'Level Active', 'Source Note'
    ];
  }

  function productMasterCsvRow(row = {}) {
    const isFinalCase = String(row.packaging_level || '').trim().toLowerCase() === 'case';
    return [
      row.storefront, row.config_id, row.sku, row.customer_item_number, row.description, row.verification_status,
      row.packaging_level, row.gtin, row.packaging_level === 'Each' ? '1' : row.case_qty,
      isFinalCase ? row.each_net_weight_g : '',
      isFinalCase ? row.package_net_weight_g : '',
      isFinalCase ? row.gross_weight_lbs : '',
      isFinalCase ? row.length_in : '',
      isFinalCase ? row.width_in : '',
      isFinalCase ? row.height_in : '',
      row.label_template_id, row.barcode_type, row.barcode_level, row.default_copies,
      row.label_enabled, row.is_active, row.source_note,
    ];
  }

  function exportMplProductMasterTable() {
    const rows = getAllMplProductMasterRows();
    downloadCsvRows('labelkit_product_master_export.csv', [
      productMasterCsvHeader(),
      ...rows.map(productMasterCsvRow)
    ]);
    setStatus(`Exported ${rows.length} Product Master row${rows.length === 1 ? '' : 's'}.`, 'success');
  }

  function directoryCsvHeader() {
    return [
      'Customer / Storefront', 'Code', 'Destination Name', 'Ship From Override', 'Ship To', 'Bill To', 'Match Values',
      'Record Type', 'Default Label Template ID', 'Receiving Email', 'Docking Instructions',
      'Manufacturer Name', 'Manufacturer Address', 'Verification Status', 'Source Note', 'Active'
    ];
  }

  function directoryCsvRow(row = {}) {
    const sharedOrigin = getSharedMplDirectoryShipFrom();
    const shipFromOverride = String(row.ship_from || '').trim() === sharedOrigin ? '' : row.ship_from;
    return [
      row.storefront,
      row.dc,
      row.name,
      shipFromOverride,
      row.delivery_address,
      row.billing_address,
      Array.isArray(row.match_values) ? row.match_values.join('\n') : row.match_values,
      row.record_type,
      row.default_label_template_id,
      row.receiving_email,
      row.docking_instructions,
      row.manufacturer_name,
      row.manufacturer_address,
      row.verification_status,
      row.source_note,
      row.is_active,
    ];
  }

  function exportMplDirectoryTable() {
    const rows = getMplDirectoryRows();
    downloadCsvRows('labelkit_directory_export.csv', [
      directoryCsvHeader(),
      ...rows.map(directoryCsvRow)
    ]);
    setStatus(`Exported ${rows.length} destination record${rows.length === 1 ? '' : 's'}. Only non-default Ship From overrides are included.`, 'success');
  }

  function downloadImportTemplate(target) {
    const isDirectory = target === 'dc-directory';
    const rows = isDirectory
      ? [
          directoryCsvHeader(),
          [
            'USAGE GUIDE — not imported', 'Unique customer destination code', 'Customer, DC, store, or warehouse name',
            'Optional alternate origin; leave blank to use the shared default', 'Required destination address', 'Billing address; may match Ship To', 'Optional GLN, city, ZIP, or aliases separated by line breaks',
            'Use DESTINATION for shipping locations', 'Optional saved label template', 'Optional receiving contact', 'Optional delivery instructions',
            'Optional manufacturer override', 'Optional manufacturer address override', 'DRAFT / NEEDS_REVIEW / VERIFIED / BLOCKED', 'Optional source or review note', 'true/false'
          ],
          directoryCsvRow(normalizeDcDirectoryRow({
            storefront: 'KeHE',
            dc: '45',
            name: 'KeHE Ontario DC',
            delivery_address: 'KeHE Distributors, LLC\n601 S Rockefeller Ave\nOntario, CA 91761\nUSA',
            billing_address: 'KeHE Distributors, LLC\n601 S Rockefeller Ave\nOntario, CA 91761\nUSA',
            match_values: ['0569813430045', 'Ontario', '91761'],
            record_type: 'DESTINATION',
            verification_status: 'DRAFT',
            is_active: true,
          }))
        ]
      : [
          productMasterCsvHeader(),
          [
            'USAGE GUIDE — not imported', 'Repeat one Config ID for every packaging level of a product.',
            'Shared product SKU', 'Optional customer item', 'Shared description', 'Shared status',
            'One row per level', 'Level barcode', 'Total sellable eaches at this level', 'One sellable each', 'All product in the final case',
            'Final case including packaging', 'Final case length', 'Final case width', 'Final case height',
            'Level label template', 'Level barcode type', 'Level barcode level', 'Copies per unit', 'true/false', 'true/false', 'Optional notes'
          ],
          productMasterCsvRow(normalizeProductRow({ storefront: 'KeHE', config_id: 'TW-CRS109-4OZ', sku: 'TW-CRS109-4OZ', description: 'SUGAR RIMM GLITTER GOLD BREW GLITTER', verification_status: 'DRAFT', packaging_level: 'Case', gtin: '40850068684654', case_qty: '36', each_net_weight_g: '113', package_net_weight_g: '4068', length_in: '18', width_in: '12', height_in: '8', gross_weight_lbs: '10', default_copies: '2', is_active: true })),
          productMasterCsvRow(normalizeProductRow({ storefront: 'KeHE', config_id: 'TW-CRS109-4OZ', sku: 'TW-CRS109-4OZ', description: 'SUGAR RIMM GLITTER GOLD BREW GLITTER', verification_status: 'DRAFT', packaging_level: 'Inner Pack', gtin: '30850068684657', case_qty: '6', default_copies: '6', is_active: true })),
          productMasterCsvRow(normalizeProductRow({ storefront: 'KeHE', config_id: 'TW-CRS109-4OZ', sku: 'TW-CRS109-4OZ', description: 'SUGAR RIMM GLITTER GOLD BREW GLITTER', verification_status: 'DRAFT', packaging_level: 'Each', gtin: '850068684656', case_qty: '1', is_active: true }))
        ];
    downloadCsvRows(isDirectory ? 'labelkit_directory_import_template.csv' : 'labelkit_product_master_import_template.csv', rows);
    setStatus(`${isDirectory ? 'Address Directory' : 'Product Master'} import template downloaded.`, 'success');
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
      setStatus(target === 'dc-directory' ? 'Reading address import preview…' : 'Reading Product Master import preview…', 'info');
      const res = await fetch(endpoint, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not preview Excel import.');
      activeExcelImportPreview = { target, ...data };
      await navigateToRoute(`mpl/import/${target}`);
      setStatus(`${target === 'dc-directory' ? 'Address' : 'Product Master'} import preview ready. Confirm to save changes.`, 'info');
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Could not preview Excel import.'), 'error');
    }
  }

  function renderExcelImportPreview() {
    const preview = activeExcelImportPreview || {};
    const summary = preview.summary || {};
    document.getElementById('excel-import-title').textContent = preview.target === 'dc-directory'
      ? 'Address Directory Import Preview'
      : 'Product Master Table Excel Import Preview';
    document.getElementById('excel-import-summary').textContent =
      `${preview.filename || 'Excel file'} • ${summary.added_rows || 0} added • ${summary.updated_rows || 0} updated • ${summary.unchanged_rows || 0} unchanged • ${summary.duplicate_rows || 0} duplicate • ${summary.invalid_rows || 0} invalid`;
    const resultSummary = document.getElementById('excel-import-result-summary');
    if (resultSummary) {
      resultSummary.innerHTML = '';
      resultSummary.classList.remove('visible');
    }
    const confirmButton = document.getElementById('btn-confirm-excel-import');
    if (confirmButton) confirmButton.onclick = confirmExcelImport;
    const rowModeLabel = document.getElementById('excel-import-row-mode-label');
    if (rowModeLabel) {
      rowModeLabel.textContent = preview.target === 'dc-directory'
        ? 'Unique key: Customer + Code. Ship From is supplied automatically; matching destinations update the existing record.'
        : 'Unique key: Storefront + Config ID + Packaging Level. Legacy rows without Config ID use Storefront + Packaging Level + SKU.';
    }
    const body = document.getElementById('excel-import-body');
    const changes = Array.isArray(preview.changes) ? preview.changes : [];
    const rows = Array.isArray(preview.rows) ? preview.rows : [];
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="5">No rows were found in this upload.</td></tr>';
      const count = document.getElementById('excel-import-filter-count');
      if (count) count.textContent = '0 rows';
      document.getElementById('btn-confirm-excel-import').disabled = true;
      return;
    }
    document.getElementById('btn-confirm-excel-import').disabled = false;
    const qualityRows = Array.isArray(preview.quality?.rows) ? preview.quality.rows : [];
    body.innerHTML = rows.map((row, index) => {
      const rowKey = importPreviewRowKey(row, index);
      const rowChanges = changes.filter(change => String(change.record_key || '') === rowKey);
      const action = importPreviewRowAction(rowChanges);
      const changeText = importPreviewChangeText(rowChanges);
      const quality = qualityRows.find(result => Number(result.index) === index);
      const requiresReview = ['invalid', 'duplicate'].includes(String(quality?.status || ''));
      const qualityText = quality
        ? `${quality.score}% complete${quality.issues?.length ? ` · ${quality.issues.map(issue => issue.message).join('; ')}` : ''}`
        : '';
      const importQuality = requiresReview ? 'review' : 'ready';
      const filterText = [importPreviewRowLabel(row, index), importPreviewRowDetails(row), changeText, action, qualityText].join(' ').toLowerCase();
      return `
      <tr class="${requiresReview ? 'import-row-review' : ''}" data-import-action="${escapeHtml(action)}" data-import-quality="${importQuality}" data-import-search="${escapeHtml(filterText)}">
        <td><input type="checkbox" class="excel-import-row-check" data-row-index="${index}" ${requiresReview ? '' : 'checked'} onchange="updateExcelImportSelectionState()"></td>
        <td>${escapeHtml(action)}</td>
        <td>${escapeHtml(importPreviewRowLabel(row, index))}</td>
        <td>${escapeHtml(importPreviewRowDetails(row))}${qualityText ? `<small class="import-quality-note">${escapeHtml(qualityText)}</small>` : ''}</td>
        <td>${escapeHtml(changeText)}</td>
      </tr>`;
    }).join('');
    filterExcelImportRows();
    updateExcelImportSelectionState();
  }

  function filterExcelImportRows() {
    const body = document.getElementById('excel-import-body');
    if (!body) return;
    const search = String(document.getElementById('excel-import-search')?.value || '').trim().toLowerCase();
    const action = String(document.getElementById('excel-import-action-filter')?.value || '').trim().toLowerCase();
    const quality = String(document.getElementById('excel-import-quality-filter')?.value || '').trim().toLowerCase();
    const rows = Array.from(body.querySelectorAll('tr[data-import-search]'));
    let visibleCount = 0;
    rows.forEach(row => {
      const visible = (!search || String(row.dataset.importSearch || '').includes(search))
        && (!action || row.dataset.importAction === action)
        && (!quality || row.dataset.importQuality === quality);
      row.classList.toggle('hidden', !visible);
      if (visible) visibleCount += 1;
    });
    const count = document.getElementById('excel-import-filter-count');
    if (count) count.textContent = `${visibleCount} of ${rows.length} rows`;
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
      row?.dimensions_display ? `Dims: ${row.dimensions_display}` : '',
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
      showImportResultReport(activeExcelImportPreview, selectedRows);
      document.querySelectorAll('.excel-import-row-check').forEach(input => { input.disabled = true; });
      const confirmButton = document.getElementById('btn-confirm-excel-import');
      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Done';
        confirmButton.onclick = () => closeExcelImportModal(true);
      }
      document.getElementById('excel-import-summary').textContent = 'Import complete · review the result report or download missing information.';
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

  function renderKeheAuditHistory(entries = null) {
    const body = document.getElementById('audit-history-body');
    if (!body) return;
    if (Array.isArray(entries)) activeKeheAuditEntries = entries;
    const allEntries = activeKeheAuditEntries;
    syncTableFilterOptions('audit-history-action-filter', allEntries.map(entry => auditActionLabel(entry.action)), 'All change types');
    const search = String(document.getElementById('audit-history-search')?.value || '').trim().toLowerCase();
    const action = String(document.getElementById('audit-history-action-filter')?.value || '').trim().toLowerCase();
    const date = String(document.getElementById('audit-history-date-filter')?.value || '').trim();
    const filtered = allEntries.filter(entry => {
      const actor = entry.actor || {};
      const actionLabel = auditActionLabel(entry.action);
      const haystack = [actor.email, actor.name, actionLabel, entry.record_label, entry.record_key, auditFieldLabel(entry.field), entry.old_value, entry.new_value].join(' ').toLowerCase();
      const entryDate = String(entry.timestamp || '').slice(0, 10);
      return (!search || haystack.includes(search))
        && (!action || actionLabel.toLowerCase() === action)
        && (!date || entryDate === date);
    });
    const count = document.getElementById('audit-history-filter-count');
    if (count) count.textContent = `${filtered.length} of ${allEntries.length} changes`;
    if (!allEntries.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="7">No change history yet.</td></tr>';
      return;
    }
    if (!filtered.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="7">No changes match these filters.</td></tr>';
      return;
    }
    body.innerHTML = filtered.map(entry => {
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
            ${options.map((option, index) => {
              const isDefaultOrigin = field === 'supplier_info' && option === getSharedMplDirectoryShipFrom();
              const optionLabel = `${isDefaultOrigin ? 'Default — ' : ''}${firstLine(option) || option}`;
              return `<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`;
            }).join('')}
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
    mpl.supplier_info = row.ship_from || mpl.supplier_info || mplBrandSupplierInfo(mplBrandId(mpl));
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
      const itemNumberWarnings = [];
      mpl.warnings = (mpl.warnings || []).filter(warning => (
        !String(warning).includes('required for MPL Item Number')
        && !String(warning).includes('was not found as an enabled Case row in Product Master')
      ));
      (mpl.items || []).forEach(item => {
        const orderMatchStatus = String(item.order_match_status || '').toLowerCase();
        const product = ['unmatched', 'ambiguous'].includes(orderMatchStatus)
          ? null
          : matchProductMaster(item, { caseOnly: true });
        const hasIdentity = [item.item_number, item.sku, item.gtin, item.case_upc, item.upc, item.description]
          .some(value => !!String(value || '').trim());
        if (!product) {
          if (hasIdentity) {
            const identity = item.sku || item.gtin || item.case_upc || item.upc || item.item_number || 'Unknown item';
            item.item_number = item.sku || item.item_number || identity;
            item.each_gtin = '';
            itemNumberWarnings.push(orderMatchStatus === 'ambiguous'
              ? `SKU ${identity}: multiple Product Master matches; using order data. Select a product for case pack, weight, and TI-HI.`
              : `SKU ${identity}: using order data; add Product Master data for GTIN, weight, and TI-HI.`);
            const orderUnitWeight = parseWeight(item.unit_weight_lbs);
            if (orderUnitWeight !== null) {
              const pallet = normalizePalletId(item.location_on_pallet);
              const itemWeight = orderUnitWeight * itemQuantityForWeight(item);
              item.calculated_weight_lbs = formatLbs(itemWeight);
              listTotal += itemWeight;
              if (pallet) totals[pallet] = (totals[pallet] || 0) + itemWeight;
            }
          }
          return;
        }
        const eachProduct = findEachProductForCaseProduct(product);
        const eachGtin = String(eachProduct?.gtin || item.each_gtin || '').trim();
        item.item_number = eachGtin || product.sku || item.sku || item.item_number || '';
        item.each_gtin = eachGtin;
        if (!eachGtin) {
          itemNumberWarnings.push(`SKU ${product.sku || item.sku || 'Unknown SKU'}: no Each GTIN; using SKU as Item Number.`);
        }
        item.gtin = product.gtin || item.gtin || '';
        item.case_upc = product.gtin || item.case_upc || '';
        item.sku = product.sku || item.sku || '';
        item.storefront = normalizeStorefront(product.storefront || item.storefront || '');
        if (product.description && !item.description) item.description = product.description;
        item.packaging_level = product.packaging_level || '';
        item.length_in = product.length_in || '';
        item.width_in = product.width_in || '';
        item.height_in = product.height_in || '';
        item.dimensions_in = product.dimensions_display || '';
        item.unit_weight_lbs = product.gross_weight_lbs || '';
        const unitWeight = parseWeight(product.gross_weight_lbs);
        if (unitWeight === null) return;
        const pallet = normalizePalletId(item.location_on_pallet);
        const itemWeight = unitWeight * itemQuantityForWeight(item);
        item.calculated_weight_lbs = formatLbs(itemWeight);
        listTotal += itemWeight;
        if (!pallet) return;
        totals[pallet] = (totals[pallet] || 0) + itemWeight;
      });
      if (itemNumberWarnings.length) {
        mpl.warnings = [...new Set([...(mpl.warnings || []), ...itemNumberWarnings])];
        mpl.status = 'Needs Review';
      }
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

  /* MPL palletization and Ti-Hi logic lives in mpl-tihi.js. */

  function selectKit(kit, updateHistory = true) {
    selectedKit = kit;
    document.body.dataset.module = kit;
    xmlFiles = [];
    pdfFiles = [];
    currentResultId = null;
    currentReport = null;
    if (downloadBlobUrl && downloadBlobUrl !== blobUrl) URL.revokeObjectURL(downloadBlobUrl);
    downloadBlobUrl = null;
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
    document.getElementById('b2b-workspace-page').classList.add('hidden');
    document.getElementById('partner-workspace-page').classList.add('hidden');
    document.getElementById('btn-change-kit').classList.add('visible');

    document.getElementById('header-app-name').textContent = cfg.headerName;
    const headerSub = document.getElementById('header-app-sub');
    headerSub.textContent = cfg.headerSub;
    headerSub.classList.toggle('hidden', !cfg.headerSub);
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
    document.getElementById('btn-download-label').textContent = 'Download PDF';
    document.getElementById('pdf-step-block').classList.toggle('hidden', !cfg.requiresPdf);
    const michaelsOutputOrder = document.getElementById('michaels-output-order');
    michaelsOutputOrder.classList.toggle('visible', selectedKit === 'michaels');
    if (selectedKit === 'michaels') {
      const pdfOrderOption = michaelsOutputOrder.querySelector('input[value="pdf"]');
      if (pdfOrderOption) pdfOrderOption.checked = true;
    }

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
    document.body.dataset.module = 'mpl';
    xmlFiles = [];
    pdfFiles = [];
    currentResultId = null;
    currentReport = null;
    if (downloadBlobUrl && downloadBlobUrl !== blobUrl) URL.revokeObjectURL(downloadBlobUrl);
    downloadBlobUrl = null;
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
    document.getElementById('b2b-workspace-page').classList.add('hidden');
    document.getElementById('partner-workspace-page').classList.add('hidden');
    document.getElementById('mpl-workspace-page').classList.remove('hidden');
    document.getElementById('btn-change-kit').classList.add('visible');
    document.getElementById('header-app-name').textContent = 'Packing List & Ti-Hi';
    document.getElementById('header-app-sub').textContent = '';
    document.getElementById('header-app-sub').classList.add('hidden');

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

  async function selectB2BWorkspace(updateHistory = true) {
    selectedKit = 'b2b';
    document.body.dataset.module = 'b2b';
    xmlFiles = [];
    pdfFiles = [];
    currentResultId = null;
    currentReport = null;
    if (downloadBlobUrl && downloadBlobUrl !== blobUrl) URL.revokeObjectURL(downloadBlobUrl);
    downloadBlobUrl = null;
    if (blobUrl && blobUrl !== b2bPreviewUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    activeKeheDocumentType = null;
    activeKeheDocumentDraft = null;
    b2bOrderFallbackProducts = [];
    mplProductMasterRows = loadMplProductMasterFromStorage();
    mplDirectoryRows = loadMplDirectoryFromStorage();

    document.title = 'B2B Case-Pack Labels · LabelKit';
    document.getElementById('kit-selection').classList.add('hidden');
    document.getElementById('upload-page').classList.add('hidden');
    document.getElementById('mpl-workspace-page').classList.add('hidden');
    document.getElementById('partner-workspace-page').classList.add('hidden');
    document.getElementById('b2b-workspace-page').classList.remove('hidden');
    document.getElementById('btn-change-kit').classList.add('visible');
    document.getElementById('header-app-name').textContent = 'B2B Case-Pack Labels';
    document.getElementById('header-app-sub').textContent = '';
    document.getElementById('header-app-sub').classList.add('hidden');

    setDownloadReady(false);
    setExportReady(false);
    setPreviewReady(false);
    resetPreviewSurface();
    closePreview();
    hideAllRouteViews();
    setStatus('', '');

    mplProductMasterLoadPromise = loadMplProductMasterFromBackend();
    mplDirectoryLoadPromise = loadMplDirectoryFromBackend();
    await Promise.allSettled([mplProductMasterLoadPromise, mplDirectoryLoadPromise, loadB2BLabelTemplates()]);
    renderB2BCreator();

    if (updateHistory) {
      setHistoryPage('b2b');
    }
  }

  async function openB2BProductMaster() {
    if (!b2bLabelTemplates.length) await loadB2BLabelTemplates();
    await navigateToRoute(`${selectedKit === 'partners' ? 'partners' : 'b2b'}/product-master`);
    showMplProductMasterView();
  }

  async function openB2BDirectory() {
    await navigateToRoute(`${selectedKit === 'partners' ? 'partners' : 'b2b'}/directory`);
    showMplDirectoryView();
  }

  async function openSharedProductMaster() {
    if (!b2bLabelTemplates.length) await loadB2BLabelTemplates();
    await loadMplProductMasterFromBackend();
    await navigateToRoute(`${getCurrentPage()}/shared-product-master`);
  }

  async function openSharedCustomerDirectory() {
    await loadMplDirectoryFromBackend();
    await navigateToRoute(`${getCurrentPage()}/shared-directory`);
  }

  /* B2B and partner feature logic lives in their workspace scripts. */

  function resetToSelection(updateHistory = true) {
    revokePartnerPreviewUrls();
    partnerOrderPayload = null;
    partnerCustomerId = '';
    partnerCustomerOverride = '';
    partnerLabelJobs = [];
    partnerMplDraft = null;
    partnerEditingMpl = false;
    partnerEditingLabelKind = '';
    delete document.body.dataset.partnerCustomer;
    selectedKit = null;
    document.body.dataset.module = 'home';
    document.title = 'JDI Label Kits';
    document.getElementById('upload-page').classList.add('hidden');
    document.getElementById('mpl-workspace-page').classList.add('hidden');
    document.getElementById('b2b-workspace-page').classList.add('hidden');
    document.getElementById('partner-workspace-page').classList.add('hidden');
    document.getElementById('kit-selection').classList.remove('hidden');
    document.getElementById('btn-change-kit').classList.remove('visible');
    document.getElementById('header-app-name').textContent = 'LabelKit';
    document.getElementById('header-app-sub').textContent = 'Select a workflow';
    document.getElementById('header-app-sub').classList.remove('hidden');
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

  function setDownloadPresentation(filename, mediaType = 'application/pdf') {
    const dl = document.getElementById('btn-download');
    dl.download = filename || currentConfig().outputName;
    document.getElementById('btn-download-label').textContent = mediaType.includes('zip')
      ? 'Download ZIP'
      : 'Download PDF';
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
    const b2bEl = document.getElementById('b2b-status-bar');
    const partnerEl = document.getElementById('partner-status-bar');
    const el = selectedKit === 'partners' && partnerEl
      ? partnerEl
      : selectedKit === 'b2b' && b2bEl
      ? b2bEl
      : (selectedKit === 'mpl' && mplEl ? mplEl : defaultEl);
    if (!msg) {
      [defaultEl, mplEl, b2bEl, partnerEl].filter(Boolean).forEach(target => {
        target.textContent = '';
        target.className = 'status-bar';
      });
      return;
    }
    [defaultEl, mplEl, b2bEl, partnerEl].filter(Boolean).forEach(target => {
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

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs-3.11.174/pdf.worker.min.js';

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

  function printActivePreview() {
    if (!blobUrl) {
      setStatus('Generate the PDF before printing.', 'error');
      return;
    }
    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.style.position = 'fixed';
    printFrame.style.width = '1px';
    printFrame.style.height = '1px';
    printFrame.style.opacity = '0';
    printFrame.style.pointerEvents = 'none';
    printFrame.src = blobUrl;
    printFrame.onload = () => {
      window.setTimeout(() => {
        const cleanup = () => printFrame.remove();
        try {
          printFrame.contentWindow?.focus();
          printFrame.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
          printFrame.contentWindow?.print();
        } catch (_err) {
          window.open(blobUrl, '_blank', 'noopener');
        }
        window.setTimeout(cleanup, 60000);
      }, 350);
    };
    document.body.appendChild(printFrame);
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

    if (downloadBlobUrl && downloadBlobUrl !== blobUrl) URL.revokeObjectURL(downloadBlobUrl);
    downloadBlobUrl = null;
    if (blobUrl && selectedKit !== 'kehe') URL.revokeObjectURL(blobUrl);
    blobUrl = null;

    const form = new FormData();
    xmlFiles.forEach(f => form.append('xml_files', f));
    if (selectedKit === 'kehe') {
      form.append('product_master_json', JSON.stringify(getKeheProductMasterRows()));
    }
    if (cfg.requiresPdf) {
      pdfFiles.forEach(f => form.append('pdf_files', f));
      const selectedOrder = document.querySelector('input[name="michaels-output-order"]:checked');
      form.append('group_by_pdf', String(!selectedOrder || selectedOrder.value === 'pdf'));
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

        const downloadBlob = await fileRes.blob();
        const outputMediaType = String(status.media_type || fileRes.headers.get('content-type') || 'application/pdf').toLowerCase();
        downloadBlobUrl = URL.createObjectURL(downloadBlob);
        setDownloadPresentation(status.output_filename || cfg.outputName, outputMediaType);

        if (outputMediaType.includes('zip')) {
          const previewRes = await fetch(`/results/${encodeURIComponent(currentResultId)}/preview`);
          if (!previewRes.ok) {
            const previewErr = await previewRes.json().catch(() => ({ detail: previewRes.statusText }));
            throw new Error(previewErr.detail || 'Combined PDF preview could not be loaded.');
          }
          blobUrl = URL.createObjectURL(await previewRes.blob());
          setDownloadReady(true, downloadBlobUrl);
          setPreviewReady(true);
        } else {
          blobUrl = downloadBlobUrl;
          setDownloadReady(true, blobUrl);
        }
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
        downloadBlobUrl = blobUrl;
        setDownloadPresentation(cfg.outputName, 'application/pdf');
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

  /* Shared document editing and rendering logic lives in document-editor.js. */
