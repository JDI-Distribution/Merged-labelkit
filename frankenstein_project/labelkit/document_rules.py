"""Authoritative document readiness and pallet planning; no persistence."""
from __future__ import annotations

import copy
import math
import re
import hashlib
import json

from labelkit.product_quality import gtin_check_digit_valid, _positive_number
from pipelines.kehe.common import _format_lbs, _parse_float, _MPL_PALLET_TARE_LBS, _MPL_PALLET_BUFFER_FACTOR
from pipelines.kehe.product_master import apply_product_master_to_mpl_draft, _match_product_master_row, sync_mpl_pallet_total_weight
from pipelines.kehe.tihi_layout import _mpl_build_tihi_entries, _mpl_tihi_constraints, _mpl_round_product_weight_for_pallet


def document_readiness(kind, draft, templates=()):
    issues = []

    def add(sku, message, category, index=-1):
        issues.append(dict(sku=sku or 'Unidentified SKU', message=str(message), category=category, index=index))

    if kind == 'labels':
        by_id = {row['template_id']: row for row in templates}
        for index, job in enumerate(draft.get('jobs') or []):
            if job.get('print_selected') is False:
                continue
            product, run = job.get('product') or {}, job.get('run') or {}
            sku = product.get('sku') or product.get('customer_item_number') or f'Order line {index + 1}'
            template = by_id.get(job.get('template_id'))
            if not template:
                add(sku, 'Choose at least one supported label template for this product.', 'review', index)
                continue
            if job.get('match_status', 'matched') != 'matched':
                add(sku, job.get('match_reason') or 'Product Master configuration was not matched; order data will be used.', 'product', index)
            for source, field_name, suffix in ((product, 'required_product_fields', ''), (run, 'required_run_fields', ' from this run')):
                for field in template.get(field_name) or []:
                    if not str(source.get(field) or '').strip():
                        category = 'barcode' if re.search('gtin|barcode', field, re.I) else 'case' if re.search('case|quantity', field, re.I) else 'product' if not suffix else 'review'
                        add(sku, f"{field.replace('_', ' ')} is missing{suffix}.", category, index)
            if product.get('verification_status') and str(product['verification_status']).upper() != 'VERIFIED':
                add(sku, f"Product status is {product['verification_status']}.", 'review', index)
            if all(field in run for field in ('carton_start', 'carton_end', 'carton_total')):
                start, end, total = (_parse_float(run.get(field)) or 0 for field in ('carton_start', 'carton_end', 'carton_total'))
                if not 1 <= start <= end <= total:
                    add(sku, 'Carton range must be Start ≥ 1, End ≥ Start, and Total ≥ End.', 'review', index)
            for message in job.get('review_reasons') or []:
                add(sku, message, 'review', index)
    elif kind == 'masterPackingList':
        for index, mpl in enumerate(draft.get('packing_lists') or []):
            weights = mpl.get('_pallet_weights') or {}
            for pallet in mpl.get('_pallet_ids') or weights.keys():
                if not str(weights.get(pallet) or '').strip():
                    add(f'Pallet {pallet}', 'Pallet weight is missing.', 'dimensions')
            for pallet, weight in weights.items():
                if str(weight).strip() and not _positive_number(re.sub(r'[^0-9.-]', '', str(weight))):
                    add(f'Pallet {pallet}', 'Pallet weight must be a positive number.', 'review')
            for item_index, item in enumerate(mpl.get('items') or []):
                sku = item.get('sku') or item.get('item_number') or f'MPL {index + 1}, line {item_index + 1}'
                ordered, shipped, qty = (_parse_float(item.get(field)) or 0 for field in ('total_ordered', 'total_shipped', 'qty_on_pallet'))
                for label, field in (('Total ordered', 'total_ordered'), ('Total shipped', 'total_shipped'), ('Quantity on pallet', 'qty_on_pallet')):
                    value = item.get(field)
                    number = _parse_float(value)
                    if str(value or '').strip() and (number is None or number < 0):
                        add(sku, f'{label} must be zero or a positive number.', 'review')
                if ordered > 0 and not str(item.get('total_shipped') or '').strip():
                    add(sku, 'Total shipped is missing.', 'review')
                if ordered and shipped and ordered != shipped:
                    add(sku, f'Total ordered ({ordered:g}) does not match total shipped ({shipped:g}).', 'review')
                if shipped and qty > shipped:
                    add(sku, 'Quantity on pallet exceeds total shipped.', 'review')
                for field, label in (('item_number', 'Item Number'), ('description', 'Item Description')):
                    if not item.get(field):
                        add(sku, f'{label} is missing.', 'product')
            for warning in mpl.get('warnings') or []:
                add(mpl.get('customer_po_number') or f'MPL {index + 1}', warning, 'review')
    else:
        for index, label in enumerate(draft.get('pack_labels' if kind == 'packLabels' else 'pallets') or []):
            if label.get('print_selected') is False:
                continue
            sku = label.get('sku') or label.get('item_number') or label.get('id') or f'Label {index + 1}'
            if kind == 'packLabels':
                if not gtin_check_digit_valid(label.get('gtin')):
                    add(sku, 'Barcode GTIN is missing or has an invalid check digit.', 'barcode', index)
                if not _positive_number(label.get('case_qty'), whole=True):
                    add(sku, 'Case-pack quantity is missing or invalid.', 'case', index)
                if not _positive_number(re.sub(r'[^0-9.-]', '', str(label.get('gross_weight_lbs') or label.get('weight_lbs') or ''))):
                    add(sku, 'Package weight is missing or invalid.', 'dimensions', index)
            else:
                for field, message, category in (('customer_po_numbers', 'Customer PO number is missing.', 'review'), ('ship_to', 'Ship To information is missing.', 'product')):
                    if not label.get(field):
                        add(sku, message, category, index)
            if 'review' in str(label.get('status') or '').lower():
                add(sku, 'Label source data requires review.', 'review', index)
            for warning in label.get('warnings') or []:
                add(sku, warning, 'review', index)
    unique = list({(issue['sku'], issue['message']): issue for issue in issues}.values())
    groups = {}
    for issue in unique:
        key = (issue['index'], issue['sku'])
        group = groups.setdefault(key, dict(sku=issue['sku'], index=issue['index'], issues=[], categories=[]))
        group['issues'].append(issue)
        if issue['category'] not in group['categories']:
            group['categories'].append(issue['category'])
    return dict(ready=not unique, issues=unique, groups=list(groups.values()), metrics={
        'ready': int(not unique), **{category: sum(category in group['categories'] for group in groups.values())
                                  for category in ('product', 'barcode', 'case', 'dimensions', 'review')},
    })


def auto_palletize(mpl, products):
    """Keep whole lines together when possible; split only when required by limits."""
    original = copy.deepcopy(mpl.get('items') or [])
    pallets, unassigned, warnings = [], [], []

    def qty(item):
        return max(0, math.ceil(_parse_float(item.get('qty_on_pallet') or item.get('total_shipped') or item.get('qty')) or 0))

    def product_for(item):
        return _match_product_master_row(item, products, packing_list_only=True)

    def copy_item(item, pallet, amount, product):
        weight = _parse_float(product.get('gross_weight_lbs')) or 0
        return {**item, 'location_on_pallet': pallet['id'], 'qty_on_pallet': str(amount),
                'total_ordered': str(amount), 'total_shipped': str(amount), 'unit_weight_lbs': str(weight),
                'calculated_weight_lbs': _format_lbs(weight * amount), 'packaging_level': 'Case', 'pallet_weight': ''}

    def capacity(pallet, product):
        constraints = _mpl_tihi_constraints(mpl, pallet['id'])
        length, width, height = (float(product[field]) for field in ('length_in', 'width_in', 'height_in'))
        per_layer = min(max(math.floor(constraints['max_length_in'] / length) * math.floor(constraints['max_width_in'] / width),
                            math.floor(constraints['max_length_in'] / width) * math.floor(constraints['max_width_in'] / length)),
                        constraints['cases_per_layer'] or math.inf)
        layers = min(math.floor(constraints['max_height_in'] / height), constraints['max_layers'] or math.inf)
        product_weight = sum((_parse_float(row.get('unit_weight_lbs')) or 0) * qty(row) for row in pallet['items'])
        by_weight = math.floor(((constraints['max_gross_lbs'] - _MPL_PALLET_TARE_LBS) / _MPL_PALLET_BUFFER_FACTOR - product_weight) / float(product['gross_weight_lbs']))
        return max(0, min(int(per_layer * layers), by_weight))

    def fits(pallet, item, amount, product):
        constraints = _mpl_tihi_constraints(mpl, pallet['id'])
        if amount > capacity(pallet, product):
            return False
        candidate = copy_item(item, pallet, amount, product)
        entries, _ = _mpl_build_tihi_entries(mpl, pallet['items'] + [candidate])
        entry = next((entry for entry in entries if entry['pallet'] == pallet['id']), None)
        return entry and not entry['overflow_cases'] and entry['used_height'] <= constraints['max_height_in'] + .0001 and entry['gross_weight_lbs'] <= constraints['max_gross_lbs'] + .0001

    def new_pallet():
        pallet = dict(id=str(len(pallets) + 1), items=[])
        pallets.append(pallet)
        return pallet

    queue = sorted(enumerate(original), key=lambda pair: (-(_parse_float((product_for(pair[1]) or {}).get('gross_weight_lbs')) or 0), pair[0]))
    for index, item in queue:
        product = product_for(item)
        label = item.get('item_number') or item.get('sku') or f'Line {index + 1}'
        if not product or not all(_positive_number(product.get(field)) for field in ('length_in', 'width_in', 'height_in', 'gross_weight_lbs')):
            unassigned.append({**item, 'location_on_pallet': '', 'pallet_weight': ''})
            warnings.append(f'{label}: missing checked Case dimensions/weight. Kept Unassigned / Needs Review.')
            continue
        # Use reviewed item measurements if present; metadata preparation has filled blanks.
        amount = qty(item)
        if not amount:
            unassigned.append({**item, 'location_on_pallet': '', 'pallet_weight': ''})
            continue
        target = next((p for p in pallets if fits(p, item, amount, product)), None)
        if target is None:
            target = new_pallet()
        if fits(target, item, amount, product):
            target['items'].append(copy_item(item, target, amount, product))
            continue
        remaining = amount
        while remaining:
            moved = False
            for pallet in pallets:
                # Binary search assumes a supported smaller stack also fits.
                low, high = 0, min(remaining, capacity(pallet, product))
                if high and fits(pallet, item, high, product):
                    low = high
                while low < high:
                    middle = (low + high + 1) // 2
                    if fits(pallet, item, middle, product):
                        low = middle
                    else:
                        high = middle - 1
                if low:
                    pallet['items'].append(copy_item(item, pallet, low, product))
                    remaining -= low
                    moved = True
                    break
            if not moved:
                if not pallets[-1]['items']:
                    break
                new_pallet()
        if remaining:
            unassigned.append({**item, 'qty_on_pallet': str(remaining), 'total_shipped': str(remaining),
                               'location_on_pallet': '', 'pallet_weight': ''})
            warnings.append(f'{label}: {remaining} case(s) could not be palletized. Kept Unassigned / Needs Review.')
    # A failed fit must not create an empty numbered pallet.
    pallets = [p for p in pallets if p['items']]
    items, weights = [], {}
    for index, pallet in enumerate(pallets):
        number = str(index + 1)
        weight = sum((_parse_float(row.get('unit_weight_lbs')) or 0) * qty(row) for row in pallet['items'])
        weights[number] = _format_lbs(_mpl_round_product_weight_for_pallet(weight) + _MPL_PALLET_TARE_LBS)
        merged = {}
        for row in pallet['items']:
            key = tuple(str(row.get(field) or '').strip().lower() for field in ('sku', 'description', 'uom', 'expiration_date', 'unit_weight_lbs', 'dimensions_in', 'review_line_index'))
            if key in merged:
                amount = qty(merged[key]) + qty(row)
                merged[key].update(qty_on_pallet=str(amount), total_shipped=str(amount))
                merged[key]['calculated_weight_lbs'] = _format_lbs((_parse_float(row.get('unit_weight_lbs')) or 0) * amount)
            else:
                merged[key] = row
        for row in merged.values():
            row.update(location_on_pallet=number, pallet_weight=weights[number])
            items.append(row)
    items.extend(unassigned)
    # Restore order-level demand independently of how shipped cases were split.
    identity = lambda row: row.get('sku') or row.get('gtin') or row.get('item_number') or row.get('description') or str(row.get('line'))
    demand = {}
    for row in original:
        key = identity(row)
        demand[key] = demand.get(key, 0) + max(0, _parse_float(row.get('total_ordered', row.get('qty_on_pallet'))) or 0)
    for index, row in enumerate(items):
        key = identity(row)
        last = not any(identity(other) == key for other in items[index + 1:])
        ordered = demand.get(key, 0) if last else min(demand.get(key, 0), qty(row))
        row['total_ordered'] = str(int(ordered)) if ordered == int(ordered) else str(ordered)
        demand[key] = demand.get(key, 0) - ordered
        row['line'] = index + 1
    mpl.update(items=items, _pallet_ids=list(weights), _pallet_weights=weights, total_pallets=str(len(weights) or 1))
    mpl['warnings'] = list(dict.fromkeys([*(mpl.get('warnings') or []), *warnings]))
    sync_mpl_pallet_total_weight(mpl)
    return warnings


def pallet_plan(mpl, products, action='plan'):
    mpl = copy.deepcopy(mpl)
    draft = dict(packing_lists=[mpl], product_master=products)
    apply_product_master_to_mpl_draft(draft, force=action == 'weights')
    if action == 'auto':
        auto_palletize(mpl, products)
    entries, warnings = _mpl_build_tihi_entries(mpl, mpl.get('items') or [])
    mpl['_pallet_dimensions'] = {row['pallet_label']: f"{row['constraints']['max_length_in']:g} x {row['constraints']['max_width_in']:g} x {row['loaded_height']:g} in" for row in entries}
    mpl['_pallet_tihi'] = {row['pallet_label']: f"{row['ti']} x {row['hi']}" for row in entries}
    signature = hashlib.sha256(json.dumps({
        'items': [{key: item.get(key) for key in ('location_on_pallet', 'qty_on_pallet', 'total_shipped', 'length_in', 'width_in', 'height_in', 'unit_weight_lbs', 'sku')}
                  for item in mpl.get('items') or []],
        'constraints': _mpl_tihi_constraints(mpl), 'per_pallet': mpl.get('_tihi_pallet_constraints') or {},
    }, sort_keys=True).encode()).hexdigest()
    return dict(mpl=mpl, entries=entries, warnings=warnings, constraints=_mpl_tihi_constraints(mpl), signature=signature)
