function palletId(value) {
  const clean = String(value ?? '').trim();
  return clean && clean !== '0' ? clean : '';
}

export function selectedDocuments(root = document) {
  return {
    labels: !!root.getElementById('operations-generate-labels')?.checked,
    mpl: !!root.getElementById('operations-generate-mpl')?.checked,
    pallets: !!root.getElementById('operations-generate-pallets')?.checked,
  };
}

export function assignedPalletCount(draft) {
  const mpl = draft?.packing_lists?.[0];
  if (!mpl) return 0;
  const ids = Array.isArray(mpl._pallet_ids) ? mpl._pallet_ids.map(palletId).filter(Boolean) : [];
  const assigned = [...new Set((mpl.items || []).map(item => palletId(item.location_on_pallet)).filter(Boolean))];
  return Math.max(ids.length, assigned.length);
}

export function usesManualPalletCount({ selected, hasOrderOrDraft }) {
  return !!hasOrderOrDraft && !!selected?.pallets && !selected?.mpl;
}

export function effectivePalletCount({ selected, hasOrderOrDraft, manualCount, mplDraft }) {
  return usesManualPalletCount({ selected, hasOrderOrDraft })
    ? Math.max(1, Number.parseInt(manualCount, 10) || 1)
    : assignedPalletCount(mplDraft);
}

export function nextReviewStage({ selected, reviewed, palletCount }) {
  if (selected.labels && !reviewed.labels) return 'labels';
  if (selected.mpl && !reviewed.mpl) return 'mpl';
  if (selected.pallets && selected.mpl && palletCount < 1) return 'mpl';
  if (selected.pallets && !reviewed.pallets) return 'pallets';
  return 'generate';
}

export function buildManualPalletDraft({ mpl = {}, count = 1, copies = 1 }) {
  const total = Math.max(1, Number.parseInt(count, 10) || 1);
  const copyCount = Math.max(1, Number.parseInt(copies, 10) || 1);
  const warning = 'Pallet count was entered manually because Packing List & Ti-Hi was not selected. Verify pallet count, PO numbers, and addresses before printing.';
  const pallets = Array.from({ length: total }, (_, index) => ({
    id: `PALLET-${index + 1}`,
    status: 'Needs Review',
    dc: mpl.dc || '',
    title: 'PALLET PLACARD',
    date: mpl.est_ship_date || '',
    ship_from: mpl.supplier_info || '',
    ship_to: mpl.ship_to || '',
    billing: mpl.bill_to || '',
    customer_po_numbers: mpl.customer_po_number || '',
    bol_number: mpl.bol_number || '',
    pro_number: mpl.pro_number || '',
    carrier: mpl.ship_via || '',
    pallet_number: String(index + 1),
    total_pallets: String(total),
    carton_count: '',
    placement_note: 'Place the requested pallet placard copies on the pallet.',
    copies: copyCount,
    source_files: mpl.source_files || [],
    source_mpl: mpl.id || '',
    warnings: [warning],
  }));
  return {
    document_type: 'kehe_pallet_label',
    version: 3,
    summary: { groups: total, from_mpl: false, manual: true },
    warnings: [warning],
    palletization_source: 'Manual',
    source_note: `Manual pallet count: ${total}. Packing List & Ti-Hi was not selected for this run.`,
    table_preview: false,
    pallets,
  };
}

export const orderDocumentsModel = Object.freeze({
  selectedDocuments,
  assignedPalletCount,
  usesManualPalletCount,
  effectivePalletCount,
  nextReviewStage,
  buildManualPalletDraft,
});

globalThis.LabelKitOrderDocuments = orderDocumentsModel;
