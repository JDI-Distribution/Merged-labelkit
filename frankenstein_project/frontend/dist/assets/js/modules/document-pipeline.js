/* One lifecycle for readiness, rendering and publication of a reviewed snapshot. */
const activeRuns = new Map();

export async function runDocumentPipeline({ kind, draft, isCurrent = () => true, render, output, skipReadiness = false }) {
  const order = typeof globalThis.reviewedOrderSnapshot === 'function' ? globalThis.reviewedOrderSnapshot() : null;
  const orderRevision = order?.revision;
  const snapshot = JSON.parse(JSON.stringify({ ...draft, ...(order ? { reviewed_order: order } : {}) }));
  if (order) {
    const fields = order.fields;
    for (const job of snapshot.jobs || []) {
      Object.assign(job.run ||= {}, { po_number: fields.po_number, ship_date: fields.ship_date });
      Object.assign(job.directory ||= {}, { ship_from: fields.ship_from, address: fields.ship_to,
        delivery_address: fields.ship_to, billing_address: fields.bill_to });
    }
    for (const mpl of snapshot.packing_lists || []) Object.assign(mpl, { customer_po_number: fields.po_number,
      est_ship_date: fields.ship_date, supplier_info: fields.ship_from, ship_to: fields.ship_to, bill_to: fields.bill_to });
    for (const pallet of snapshot.pallets || []) Object.assign(pallet, { customer_po_numbers: fields.po_number,
      date: fields.ship_date, ship_from: fields.ship_from, ship_to: fields.ship_to });
  }
  const token = Symbol(kind);
  activeRuns.set(output.key, token);
  const current = () => activeRuns.get(output.key) === token && isCurrent()
    && (!order || globalThis.reviewedOrderSnapshot()?.revision === orderRevision);
  const ensureCurrent = () => {
    if (!current()) throw new Error('Document changed during generation. Review and approve the current version again.');
  };
  globalThis.documentPipelineActive = (globalThis.documentPipelineActive || 0) + 1;
  try {
    ensureCurrent();
    const readiness = await globalThis.LabelKitAPI.json('/api/documents/readiness', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, draft: snapshot }),
    });
    ensureCurrent();
    if (!skipReadiness && !readiness.ready) {
      globalThis.closeWorkflowProgress?.();
      if (!(await globalThis.confirmDocumentReadiness(readiness))) return null;
      globalThis.showWorkflowProgress?.(3, 'Generating the reviewed document…');
    }
    ensureCurrent();
    const generated = await render(snapshot, ensureCurrent);
    ensureCurrent();
    const { key, ...details } = output;
    await globalThis.recordGeneratedOutput(key, { ...details, ...generated, documentSnapshot: snapshot, isCurrent: current });
    ensureCurrent();
    return generated;
  } finally {
    globalThis.documentPipelineActive -= 1;
    if (activeRuns.get(output.key) === token) activeRuns.delete(output.key);
  }
}

globalThis.runDocumentPipeline = runDocumentPipeline;
