(function (global) {
  'use strict';

  function createMplDraftSync(options) {
    const delayMs = Number(options.delayMs || 30000);
    let timer = null;
    let dirty = false;
    let saving = false;

    function notify(state, detail) {
      options.onState?.(state, detail || '');
    }

    function schedule() {
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
      notify('saving');
      try {
        const saved = await options.save();
        if (saved) {
          dirty = false;
          notify('saved', new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        } else {
          notify('error');
        }
        return !!saved;
      } catch (error) {
        notify('error', error?.message || 'Save failed');
        return false;
      } finally {
        saving = false;
      }
    }

    function markSaved() {
      dirty = false;
      clearTimeout(timer);
      timer = null;
      notify('saved', new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }

    function hasUnsavedChanges() { return dirty; }
    function discard() { dirty = false; clearTimeout(timer); timer = null; }
    function dispose() { clearTimeout(timer); timer = null; }
    return { schedule, flush, markSaved, hasUnsavedChanges, discard, dispose };
  }

  global.LabelKitDraftSync = { create: createMplDraftSync };
})(window);
