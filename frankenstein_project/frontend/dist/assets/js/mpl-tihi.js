/* Master Packing List palletization and Ti-Hi layout logic. */
  function maxCasesForProduct(product, warnings, label, constraints) {
    const length = parsePositiveNumber(product.length_in);
    const width = parsePositiveNumber(product.width_in);
    const height = parsePositiveNumber(product.height_in);
    const dims = length && width && height ? { l: length, w: width, h: height } : null;
    const unitWeight = parseWeight(product.gross_weight_lbs);
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
    mpl._tihi_pallet_constraints = mpl._tihi_pallet_constraints || {};

    const constraintsForPallet = (palletId = '') => getMplTiHiConstraints(mpl, palletId);
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
        _tihi_constraints: normalizeTiHiConstraints(mpl._tihi_constraints || {}),
        _tihi_pallet_constraints: { ...(mpl._tihi_pallet_constraints || {}) }
      };
      const { entries } = buildMplTiHiEntries(tempMpl);
      const entry = entries.find(row => normalizePalletId(row.pallet) === palletId);
      if (!entry) return false;
      const constraints = constraintsForPallet(palletId);
      if ((entry.overflowCases || 0) > 0) return false;
      if (Number(entry.usedHeight || 0) > Number(constraints.max_height_in || 0) + 0.0001) return false;
      if (Number(entry.grossWeightLbs || 0) > Number(constraints.max_gross_lbs || 0) + 0.0001) return false;
      return true;
    }

    function fits(pallet, item, meta, qty) {
      if (!pallet || !meta || qty <= 0) return false;
      const constraints = constraintsForPallet(pallet?.id);
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
        const unitWeight = product ? (parseWeight(product.gross_weight_lbs) ?? 0) : 0;
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
      const lengthIn = parsePositiveNumber(item.length_in || fallbackProduct.length_in);
      const widthIn = parsePositiveNumber(item.width_in || fallbackProduct.width_in);
      const heightIn = parsePositiveNumber(item.height_in || fallbackProduct.height_in);
      const dimensionsIn = lengthIn && widthIn && heightIn
        ? `${formatNumberString(lengthIn)} x ${formatNumberString(widthIn)} x ${formatNumberString(heightIn)}`
        : '';
      const weightLbs = String(item.unit_weight_lbs || fallbackProduct.gross_weight_lbs || '').trim();
      const dims = lengthIn && widthIn && heightIn ? { l: lengthIn, w: widthIn, h: heightIn } : null;
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
      const key = [pallet, entityKey, lengthIn, widthIn, heightIn, weightLbs].join('|');
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
    // Use the deterministic canvas renderer for PDF snapshots. Capturing the
    // responsive DOM card made the exported preview depend on viewport width,
    // font timing, and foreignObject support, which could crop or shift diagrams.
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

  function refreshMplLiveTiHiNow(mplIndex) {
    const mpl = getMpl(mplIndex);
    const panels = [...document.querySelectorAll(`[data-mpl-live-tihi="${mplIndex}"]`)];
    if (!mpl || !panels.length) return;
    try {
      const { entries, warnings, constraints } = buildMplTiHiEntries(mpl);
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

  function recalcMplTiHiPopup(mplIndex, palletId = '') {
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
    autoPalletizeMpl(mplIndex, { render: true, showStatus: false });
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
