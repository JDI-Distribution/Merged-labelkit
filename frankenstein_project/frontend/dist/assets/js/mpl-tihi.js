/* The backend owns pallet assignment and Ti-Hi geometry; this file draws its results. */
  const mplPalletPlans = new WeakMap();
  function defaultTiHiConstraints() { return window.LabelKitPackingModel.defaultConstraints(); }
  function normalizeTiHiConstraints(raw = {}) { return window.LabelKitPackingModel.normalizeConstraints(raw); }
  function getMplTiHiConstraints(mpl, palletId = '') {
    return normalizeTiHiConstraints(mpl?._tihi_pallet_constraints?.[normalizePalletId(palletId)] || mpl?._tihi_constraints || {});
  }
  function tihiColorToRgb(color) { return window.LabelKitPackingModel.colorToRgb(color); }
  function palletPlanInput(mpl) {
    return {
      mpl: { items: mpl.items || [], warnings: mpl.warnings || [], _tihi_constraints: mpl._tihi_constraints || {},
        _tihi_pallet_constraints: mpl._tihi_pallet_constraints || {}, _pallet_ids: mpl._pallet_ids || [],
        _pallet_weights: mpl._pallet_weights || {} },
      product_master: activeKeheDocumentDraft?.reviewed_product_master || getActiveAllProductMasterRows(),
    };
  }
  function palletPlanView(value, key = '') {
    if (key === 'constraints') return value;
    if (key === 'color' && Array.isArray(value)) return '#' + value.map(number => Math.round(number * 255).toString(16).padStart(2, '0')).join('');
    if (key === 'dimensions' && Array.isArray(value)) return { l: value[0], w: value[1], h: value[2] };
    if (Array.isArray(value)) return value.map(item => palletPlanView(item));
    if (!value || typeof value !== 'object') return value;
    const aliases = { case_length: 'length', case_width: 'width', case_height: 'height', dimensions: 'dims', unit_weight_lbs: 'weightLbs' };
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [
      aliases[name] || name.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()), palletPlanView(item, name),
    ]));
  }
  async function fetchMplPalletPlan(mpl, action = 'plan') {
    const input = palletPlanInput(mpl), key = JSON.stringify(input);
    const previous = mplPalletPlans.get(mpl);
    if (action === 'plan' && previous?.key === key) {
      if (previous.error) throw previous.error;
      return previous.promise;
    }
    const state = { key, result: null, error: null };
    const draft = activeKeheDocumentDraft;
    state.promise = window.LabelKitAPI.json('/api/documents/pallet-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, action }),
    }, 45000).then(payload => {
      if (JSON.stringify(palletPlanInput(mpl)) !== key || activeKeheDocumentDraft !== draft) throw new Error('Pallet inputs changed during calculation. Recalculate the current version.');
      if (action !== 'plan') {
        Object.assign(mpl, payload.mpl);
        documentEditorRevision += 1;
        mplDraftSync?.schedule();
      } else {
        const weights = mpl._pallet_weights ||= {};
        for (const [pallet, weight] of Object.entries(payload.mpl._pallet_weights || {})) {
          if (!String(weights[pallet] || '').trim()) weights[pallet] = weight;
        }
        (mpl.items || []).forEach((item, index) => {
          const calculated = payload.mpl.items[index];
          item.calculated_weight_lbs = calculated.calculated_weight_lbs || '';
          if (!String(item.pallet_weight || '').trim()) item.pallet_weight = calculated.pallet_weight || '';
        });
        mpl.total_weight = payload.mpl.total_weight;
      }
      mpl._pallet_dimensions = payload.mpl._pallet_dimensions;
      mpl._pallet_tihi = payload.mpl._pallet_tihi;
      state.key = JSON.stringify(palletPlanInput(mpl));
      state.result = { entries: payload.entries.map(entry => palletPlanView(entry)), warnings: payload.warnings, constraints: payload.constraints, signature: payload.signature };
      if (action === 'plan' && activeKeheDocumentType === 'masterPackingList' && !window.documentPipelineActive) {
        const focused = document.activeElement, path = focused?.dataset?.draftPath;
        const selection = path ? [focused.selectionStart, focused.selectionEnd] : null;
        renderDocumentEditor(activeKeheDocumentType, draft, { refreshOnly: true });
        if (path) {
          const input = [...document.querySelectorAll('[data-draft-path]')].find(element => element.dataset.draftPath === path);
          input?.focus({ preventScroll: true });
          try { input?.setSelectionRange(...selection); } catch (_err) {}
        }
      }
      return state.result;
    }).catch(error => { state.error = error; throw error; });
    mplPalletPlans.set(mpl, state);
    return state.promise;
  }
  function buildMplTiHiEntries(mpl) {
    const state = mplPalletPlans.get(mpl);
    if (state?.key === JSON.stringify(palletPlanInput(mpl))) {
      if (state.result) return state.result;
      return { entries: [], warnings: [state.error?.message || 'Calculating Ti-Hi on the server…'], constraints: getMplTiHiConstraints(mpl), pending: !state.error };
    }
    fetchMplPalletPlan(mpl).catch(error => setStatus(`Ti-Hi calculation failed: ${error.message}`, 'error'));
    return { entries: [], warnings: ['Calculating Ti-Hi on the server…'], constraints: getMplTiHiConstraints(mpl), pending: true };
  }
  async function autoPalletizeMpl(mplIndex, options = {}) {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    ensureMplPalletState(mpl);
    captureXmlPalletSnapshot(mpl);
    try {
      await fetchMplPalletPlan(mpl, 'auto');
      const note = getXmlPalletMismatchNote(mpl, mpl._pallet_ids.length);
      markMplPalletizationSource(mpl, 'Auto Palletize', note);
      keheLastMplDraft = activeKeheDocumentDraft;
      if (options.render !== false) {
        renderKeheUnifiedReport(activeKeheDocumentDraft);
        renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
      }
      if (options.showStatus !== false) setStatus('Auto Palletize completed. Review any warnings.', 'info');
      return { palletCount: mpl._pallet_ids.length, warnings: mpl.warnings || [] };
    } catch (error) {
      setStatus(`Auto Palletize failed: ${error.message}`, 'error');
      throw error;
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
    const scale = Math.min(areaW / constraints.max_length_in, areaH / (constraints.max_height_in + constraints.pallet_base_height_in));
    const palletW = constraints.max_length_in * scale;
    const frameH = (constraints.max_height_in + constraints.pallet_base_height_in) * scale;
    const px = areaX + ((areaW - palletW) / 2);
    const py = areaY + ((areaH - frameH) / 2);
    const palletBaseH = constraints.pallet_base_height_in * scale;
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
    drawSnapshotText(ctx, `${Number((Number(entry.usedHeight || 0) + constraints.pallet_base_height_in).toFixed(2))} in incl. pallet`, x + (w / 2), y + h - 26, { align: 'center', size: 9, weight: 800, color: '#64748b' });
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
    // Use the deterministic canvas renderer for PDF snapshots. Capturing the
    // responsive DOM card made the exported preview depend on viewport width,
    // font timing, and foreignObject support, which could crop or shift diagrams.
    return renderMplTiHiEntryCanvasSnapshot(mpl, entry);
  }

  async function buildMplTiHiSnapshotPayload(mpl) {
    const { entries, warnings, constraints, signature } = await fetchMplPalletPlan(mpl);
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
      source_signature: signature,
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
    for (const mpl of draft?.packing_lists || []) mpl._tihi_snapshot = await buildMplTiHiSnapshotPayload(mpl);
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
    const scale = Math.min((width - (2 * pad)) / constraints.max_length_in, (height - (2 * pad)) / (constraints.max_height_in + constraints.pallet_base_height_in));
    const palletW = constraints.max_length_in * scale;
    const frameH = (constraints.max_height_in + constraints.pallet_base_height_in) * scale;
    const originX = (width - palletW) / 2;
    const frameY = (height - frameH) / 2;
    const palletBaseH = constraints.pallet_base_height_in * scale;
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
            <div class="tihi-dim-row"><span>${escapeHtml(String(constraints.max_length_in))} in</span><span>${escapeHtml(String(Number((entry.usedHeight + constraints.pallet_base_height_in).toFixed(2))))} in incl. pallet</span><span>${escapeHtml(String(entry.hi))} layer(s)</span></div>
          </div>
        </div>
        ${renderTiHiLayerPatterns(entry, constraints)}
        ${renderTiHiLegend(entry)}
        ${entry.lines.length ? `<div class="tihi-lines">MPL lines: ${escapeHtml(entry.lines.join(', '))}</div>` : ''}
      </div>`;
  }

  function mplLiveTiHiLoadingMarkup() {
    return `
      <div class="mpl-live-tihi-loading" role="status">
        <span class="mpl-live-tihi-spinner" aria-hidden="true"></span>
        <span>Creating Ti-Hi…</span>
      </div>`;
  }

  function renderMplLiveTiHiContent(entry, constraints, warnings = []) {
    if (!entry) {
      return `
        <div class="mpl-live-tihi-empty">
          <strong>Ti-Hi unavailable</strong>
          <span>${escapeHtml(warnings[0] || 'Add Case dimensions, Case weight, and a pallet quantity to create the live layout.')}</span>
        </div>`;
    }
    return `
      <div class="mpl-live-tihi-summary">
        <span><strong>${escapeHtml(String(entry.ti))} × ${escapeHtml(String(entry.hi))}</strong> TI × HI</span>
        <span>${escapeHtml(String(entry.assignedCases))} cases</span>
        <span>${escapeHtml(String(Math.round(entry.grossWeightLbs)))} lbs</span>
      </div>
      ${entry.overflowCases ? `<div class="mpl-live-tihi-warning">${escapeHtml(String(entry.overflowCases))} case(s) exceed the current pallet limits.</div>` : ''}
      <div class="mpl-live-tihi-views">
        <div>
          <span class="mpl-live-tihi-view-label">Top</span>
          ${renderTiHiTopViewSvg(entry, constraints)}
        </div>
        <div>
          <span class="mpl-live-tihi-view-label">Side</span>
          ${renderTiHiSideViewSvg(entry, constraints)}
        </div>
      </div>`;
  }

  async function refreshMplLiveTiHiNow(mplIndex) {
    const mpl = getMpl(mplIndex);
    const panels = [...document.querySelectorAll(`[data-mpl-live-tihi="${mplIndex}"]`)];
    if (!mpl || !panels.length) return;
    try {
      const { entries, warnings, constraints } = await fetchMplPalletPlan(mpl);
      const entriesByPallet = new Map(
        entries.map(entry => [normalizePalletId(entry.palletLabel), entry])
      );
      panels.forEach(panel => {
        const palletId = normalizePalletId(panel.getAttribute('data-pallet-id'));
        const entry = entriesByPallet.get(palletId);
        const body = panel.querySelector('.mpl-live-tihi-body');
        if (!body) return;
        body.innerHTML = renderMplLiveTiHiContent(entry, entry?.constraints || getMplTiHiConstraints(mpl, palletId) || constraints, warnings);
      });
    } catch (err) {
      panels.forEach(panel => {
        const body = panel.querySelector('.mpl-live-tihi-body');
        if (body) {
          body.innerHTML = `<div class="mpl-live-tihi-empty"><strong>Ti-Hi could not be created</strong><span>${escapeHtml(err?.message || 'Check the pallet inputs and try again.')}</span></div>`;
        }
      });
    }
  }

  function scheduleMplLiveTiHiRefresh(mplIndex, delay = 160) {
    const currentTimer = mplLiveTiHiTimers.get(mplIndex);
    if (currentTimer) window.clearTimeout(currentTimer);
    document.querySelectorAll(`[data-mpl-live-tihi="${mplIndex}"] .mpl-live-tihi-body`).forEach(body => {
      body.innerHTML = mplLiveTiHiLoadingMarkup();
    });
    const timer = window.setTimeout(() => {
      mplLiveTiHiTimers.delete(mplIndex);
      refreshMplLiveTiHiNow(mplIndex);
    }, delay);
    mplLiveTiHiTimers.set(mplIndex, timer);
  }

  function scheduleAllMplLiveTiHiRefresh() {
    (activeKeheDocumentDraft?.packing_lists || []).forEach((_mpl, index) => {
      scheduleMplLiveTiHiRefresh(index);
    });
  }

  function openMplTiHiSettings(mplIndex) {
    const mpl = getMpl(mplIndex);
    if (!mpl || !activeKeheDocumentDraft) return;
    mpl._tihi_mode = 'settings';
    mpl._tihi_focus_pallet = '';
    navigateToRoute(`${getCurrentPage()}/tihi/settings/${mplIndex}`);
  }

  function openMplPalletTiHi(mplIndex, palletId) {
    const mpl = getMpl(mplIndex);
    if (!mpl || !activeKeheDocumentDraft) return;
    mpl._tihi_mode = 'edit';
    const normalizedPallet = normalizePalletId(palletId) || '';
    mpl._tihi_focus_pallet = normalizedPallet;
    navigateToRoute(`${getCurrentPage()}/tihi/edit/${mplIndex}/${encodeURIComponent(normalizedPallet)}`);
  }

  function showMplTiHiRoute(subpath) {
    const parts = subpath.split('/');
    const isSettings = parts[0] === 'tihi' && parts[1] === 'settings';
    const isEdit = parts[0] === 'tihi' && parts[1] === 'edit';
    const mplIndex = parseInt(parts[isSettings || isEdit ? 2 : 1], 10);
    const palletId = isSettings ? '' : decodeURIComponent(parts.slice(isEdit ? 3 : 2).join('/') || '');
    const mpl = getMpl(mplIndex);
    if (!mpl || !activeKeheDocumentDraft) return;
    applyProductMasterToDraft(activeKeheDocumentDraft, true);
    (activeKeheDocumentDraft.packing_lists || []).forEach((list, index) => {
      list._show_tihi = index === mplIndex;
    });
    mpl._tihi_mode = isSettings ? 'settings' : 'edit';
    mpl._tihi_focus_pallet = normalizePalletId(palletId) || '';
    mpl._show_tihi = true;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    showDocumentEditorView();
    setStatus(isSettings ? 'TI-Hi settings opened for all pallets.' : `TI-Hi editor opened for pallet ${palletId}.`, 'info');
  }

  function returnToMplEditor() {
    if (activeKeheDocumentDraft?.packing_lists) {
      activeKeheDocumentDraft.packing_lists.forEach(mpl => {
        mpl._show_tihi = false;
        mpl._tihi_mode = '';
      });
    }
    document.querySelectorAll('.tihi-popup-panel').forEach(panel => panel.remove());
    document.getElementById('document-editor-panel')?.classList.add('visible');
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    navigateToRoute(`${getCurrentPage()}/document-editor`, true);
  }

  function closeMplTiHiPopup(mplIndex, useHistory = true) {
    if (useHistory) {
      returnToMplEditor();
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
    mpl._pallet_tihi = {};
    mpl._pallet_dimensions = {};
  }

  function updateMplTiHiConstraintAndPreview(mplIndex, palletId, key, value) {
    updateMplTiHiConstraint(mplIndex, palletId, key, value);
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
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

  function setMplTiHiFocusPallet(mplIndex, palletId) {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    mpl._tihi_focus_pallet = normalizePalletId(palletId) || '';
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
  }

  async function recalcMplTiHiPopup(mplIndex, palletId = '') {
    const mpl = getMpl(mplIndex);
    if (!mpl) return;
    const normalizedPallet = normalizePalletId(palletId);
    if (normalizedPallet) {
      const next = normalizeTiHiConstraints(getMplTiHiConstraints(mpl, normalizedPallet));
      mpl._tihi_pallet_constraints = mpl._tihi_pallet_constraints || {};
      mpl._tihi_pallet_constraints[normalizedPallet] = next;
      mpl._tihi_focus_pallet = normalizedPallet;
    } else {
      mpl._tihi_constraints = normalizeTiHiConstraints(mpl._tihi_constraints || {});
      mpl._tihi_focus_pallet = '';
      if (mpl._tihi_pallet_constraints && typeof mpl._tihi_pallet_constraints === 'object') {
        Object.keys(mpl._tihi_pallet_constraints).forEach(palletKey => {
          delete mpl._tihi_pallet_constraints[palletKey];
        });
      }
    }
    if (activeKeheDocumentDraft) {
      applyProductMasterToDraft(activeKeheDocumentDraft, false);
    }
    await autoPalletizeMpl(mplIndex, { render: true, showStatus: false });
    mpl._show_tihi = true;
    renderDocumentEditor(activeKeheDocumentType, activeKeheDocumentDraft);
    setStatus(`TI-Hi recalculated for ${normalizedPallet ? `pallet ${normalizedPallet}` : (mpl.id || `MPL ${mplIndex + 1}`)} and the order was re-optimized to the updated pallet limits.`, 'success');
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
    const showPreview = options.showPreview !== false;
    const showRecalculate = options.showRecalculate ?? !focusPallet;
    const palletOptions = (mpl?._pallet_ids || ['1']).map(palletId => normalizePalletId(palletId)).filter(Boolean);
    const selectedScope = focusPallet || '';
    return `
      <div class="pdf-document-shell">
        ${showPreview ? `<div class="pdf-sheet-toolbar">
          <span>${escapeHtml((mpl?.id || 'MPL') + ' · TI-HI')}</span>
          <span class="status-tag success">${escapeHtml(statusLabel)}</span>
        </div>` : ''}
        <div class="pdf-sheet tihi-sheet">
          ${showPreview ? `<div class="tihi-sheet-title">TI-HI Layout Summary</div>
          <div class="tihi-sheet-subtitle">
            <span>PO: ${escapeHtml(mpl?.customer_po_number || '—')}</span>
            <span>Constraints: ${escapeHtml(String(sheetConstraints.max_length_in))} × ${escapeHtml(String(sheetConstraints.max_width_in))} × ${escapeHtml(String(sheetConstraints.max_height_in))} in • Max ${escapeHtml(String(sheetConstraints.max_gross_lbs))} lbs gross</span>
            <span>All dimensions shown in inches</span>
          </div>` : `<div class="tihi-settings-title">TI-HI Settings</div>`}
          ${editable ? `
            <div class="tihi-sheet-subtitle">
              <div class="tihi-constraint-bar">
                ${!showPreview ? `<div class="tihi-constraint-field tihi-scope-field">
                  <label>Apply To</label>
                  <select onchange="setMplTiHiFocusPallet(${mplIndex}, this.value)">
                    <option value="" ${!selectedScope ? 'selected' : ''}>All pallets</option>
                    ${palletOptions.map(palletId => `<option value="${escapeHtml(palletId)}" ${selectedScope === palletId ? 'selected' : ''}>Pallet ${escapeHtml(palletId)}</option>`).join('')}
                  </select>
                </div>` : `<div class="tihi-constraint-field tihi-scope-field"><label>Edit Pallet</label><output>Pallet ${escapeHtml(focusPallet)}</output></div>`}
                ${!showPreview ? `<div class="tihi-constraint-field tihi-pallet-count-field"><label>Pallets</label><output>${escapeHtml(String(palletOptions.length || 1))}</output></div>` : ''}
                <div class="tihi-constraint-field">
                  <label>Max Length (in)</label>
                  <input type="number" min="1" step="0.1" value="${escapeHtml(String(sheetConstraints.max_length_in))}" onchange="${showPreview ? 'updateMplTiHiConstraintAndPreview' : 'updateMplTiHiConstraint'}(${mplIndex}, '${jsString(focusPallet)}', 'max_length_in', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Max Width (in)</label>
                  <input type="number" min="1" step="0.1" value="${escapeHtml(String(sheetConstraints.max_width_in))}" onchange="${showPreview ? 'updateMplTiHiConstraintAndPreview' : 'updateMplTiHiConstraint'}(${mplIndex}, '${jsString(focusPallet)}', 'max_width_in', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Max Height (in)</label>
                  <input type="number" min="1" step="0.1" value="${escapeHtml(String(sheetConstraints.max_height_in))}" onchange="${showPreview ? 'updateMplTiHiConstraintAndPreview' : 'updateMplTiHiConstraint'}(${mplIndex}, '${jsString(focusPallet)}', 'max_height_in', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Max Gross (lbs)</label>
                  <input type="number" min="1" step="1" value="${escapeHtml(String(sheetConstraints.max_gross_lbs))}" onchange="${showPreview ? 'updateMplTiHiConstraintAndPreview' : 'updateMplTiHiConstraint'}(${mplIndex}, '${jsString(focusPallet)}', 'max_gross_lbs', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Cases per layer (Ti)</label>
                  <input aria-label="Cases per layer (Ti)" type="number" min="1" step="1" placeholder="Auto" value="${escapeHtml(String(sheetConstraints.cases_per_layer || ''))}" onchange="${showPreview ? 'updateMplTiHiConstraintAndPreview' : 'updateMplTiHiConstraint'}(${mplIndex}, '${jsString(focusPallet)}', 'cases_per_layer', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Maximum layers (Hi)</label>
                  <input aria-label="Maximum layers (Hi)" type="number" min="1" step="1" placeholder="Auto" value="${escapeHtml(String(sheetConstraints.max_layers || ''))}" onchange="${showPreview ? 'updateMplTiHiConstraintAndPreview' : 'updateMplTiHiConstraint'}(${mplIndex}, '${jsString(focusPallet)}', 'max_layers', this.value)">
                </div>
                <div class="tihi-constraint-field">
                  <label>Pallet base height (in)</label>
                  <input aria-label="Pallet base height (in)" type="number" min="0.1" step="0.1" value="${escapeHtml(String(sheetConstraints.pallet_base_height_in))}" onchange="${showPreview ? 'updateMplTiHiConstraintAndPreview' : 'updateMplTiHiConstraint'}(${mplIndex}, '${jsString(focusPallet)}', 'pallet_base_height_in', this.value)">
                </div>
                <div class="tihi-constraint-actions">
                  <button class="btn-secondary" type="button" onclick="resetMplTiHiConstraints(${mplIndex}, '${jsString(focusPallet)}')">Defaults</button>
                  ${showRecalculate ? `<button class="btn-generate" type="button" onclick="recalcMplTiHiPopup(${mplIndex}, '${jsString(focusPallet)}')">Recalculate</button>` : ''}
                </div>
              </div>
            </div>` : ''}
          ${showPreview && warnings.length ? `<div class="tihi-warning">${warnings.slice(0, 6).map(escapeHtml).join('<br>')}</div>` : ''}
          ${showPreview && entriesToShow.length
            ? entriesToShow.map(entry => `
              <section class="tihi-pallet-section" id="${escapeHtml(getMplTiHiSectionId(mplIndex, entry.palletLabel, idPrefix))}">
                <div class="tihi-pallet-section-head">
                  <span>Pallet ${escapeHtml(entry.palletLabel)}</span>
                  <span>${escapeHtml(String((entry.groups || []).length))} item group(s)</span>
                </div>
                ${renderMplTiHiCard(entry, mplIndex, entry.constraints || constraints, normalizePalletId(entry.palletLabel) === focusPallet)}
              </section>`).join('')
            : (showPreview ? '<div class="tihi-empty">No TI-Hi diagram could be generated for this MPL.<br>Add Case dimensions and Case weight for the palletized SKU rows in the product master, then render again.</div>' : '')}
        </div>
      </div>`;
  }

  function renderMplTiHiPopup(mpl, mplIndex) {
    if (!mpl?._show_tihi) return '';
    const editMode = mpl?._tihi_mode === 'edit';
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
              ${renderMplTiHiSheet(mpl, mplIndex, { showOnlyFocus: editMode, statusLabel: editMode ? 'Pallet Editor' : 'Settings', idPrefix: 'popup', editable: true, showPreview: editMode, showRecalculate: !editMode })}
            </div>
          </div>
        </div>
      </div>`;
  }
