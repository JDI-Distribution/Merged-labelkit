export function createMplDraftSync(options) {
    const delayMs = Number(options.delayMs || 30000);
    let timer = null;
    let dirty = false;
    let saving = false;
    let generation = 0;

    function notify(state, detail) {
      options.onState?.(state, detail || '');
    }

    function schedule() {
      generation += 1;
      dirty = true;
      notify('unsaved');
      clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    }

    async function flush() {
      clearTimeout(timer);
      timer = null;
      if (!dirty || saving || !options.canSave()) return false;
      saving = true;
      const savedGeneration = generation;
      notify('saving');
      try {
        const saved = await options.save();
        if (saved) {
          markSaved(savedGeneration);
        } else {
          notify('error');
        }
        return !!saved;
      } catch (error) {
        notify('error', error?.message || 'Save failed');
        return false;
      } finally {
        saving = false;
        if (dirty && generation !== savedGeneration && timer === null) timer = setTimeout(flush, delayMs);
      }
    }

    function markSaved(expectedGeneration) {
      if (expectedGeneration !== undefined && expectedGeneration !== generation) return;
      if (expectedGeneration === undefined) generation += 1;
      dirty = false;
      clearTimeout(timer);
      timer = null;
      notify('saved', new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }

    function hasUnsavedChanges() { return dirty; }
    function discard() { generation += 1; dirty = false; clearTimeout(timer); timer = null; }
    function dispose() { clearTimeout(timer); timer = null; }
    return { schedule, flush, markSaved, hasUnsavedChanges, discard, dispose, version: () => generation };
}

export const draftSync = Object.freeze({ create: createMplDraftSync });
globalThis.LabelKitDraftSync = draftSync;
