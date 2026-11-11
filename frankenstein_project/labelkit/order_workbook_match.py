"""Compare uploaded orders with immutable Analytics and reference snapshots."""
from __future__ import annotations

import copy
from collections import defaultdict

from fastapi import HTTPException
from labelkit import order_intake as intake
from labelkit.b2b_orders import _resolve_b2b_order_customer
from labelkit.order_workbook_io import clean, key, number


def address(details, kind):
    prefix = 'shipping' if kind == 'ship_to' else 'billing'
    name = details.get('ship_to_name' if kind == 'ship_to' else 'billing_customer_name')
    city = ', '.join(filter(None, [details.get(f'{prefix}_city'), details.get(f'{prefix}_state')]))
    city = ' '.join(filter(None, [city, details.get(f'{prefix}_zip_code')]))
    return '\n'.join(clean(v) for v in [name, *(details.get(f'{prefix}_street{i}') for i in range(1, 4)), city, details.get(f'{prefix}_country')] if clean(v))


def analytics_lines(rows):
    found = {}
    for raw in rows:
        sku = intake._analytics_row_value(raw, intake.ANALYTICS_SKU_COLUMN)
        quantity = intake._analytics_quantity(intake._analytics_row_value(raw, intake.ANALYTICS_QUANTITY_COLUMN))
        if not sku or quantity is None:
            continue
        canonical = sku.casefold()
        if canonical not in found:
            found[canonical] = {'sku': sku, 'quantity': 0, **intake._analytics_order_item_fallback(raw, sku)}
        found[canonical]['quantity'] += quantity
    return list(found.values())


def analytics_header(rows):
    details = intake._analytics_order_details(rows)
    return {'customer': _resolve_b2b_order_customer(details, [])['name'],
            'po_number': details.get('purchase_order_number') or details.get('po_number', ''),
            'ship_date': details.get('ship_date', ''), 'ship_to': address(details, 'ship_to'),
            'bill_to': address(details, 'bill_to'), 'shipping_instructions': details.get('order_notes', ''),
            '_details': details}


def configuration_groups(line, products, customer=''):
    candidates = [row for row in products if row.get('is_active') is not False and row.get('verification_status') != 'BLOCKED'
                  and clean(line['sku']).casefold() in {clean(row.get('sku')).casefold(), clean(row.get('display_sku')).casefold()}]
    if line.get('config_id'):
        candidates = [row for row in candidates if clean(row.get('config_id')).casefold() == clean(line['config_id']).casefold()]
    buyer_rows = [row for row in candidates if key(row.get('storefront')) == key(customer)]
    if buyer_rows:
        candidates = buyer_rows
    groups = {(row.get('storefront'), row.get('config_id') or row.get('sku')) for row in candidates}
    return [[copy.deepcopy(row) for row in products if (row.get('storefront'), row.get('config_id') or row.get('sku')) == group
             and row.get('is_active') is not False and row.get('verification_status') != 'BLOCKED'] for group in sorted(groups)]


def selected_record(entry, record_id=''):
    wanted = record_id or entry['input']['header'].get('record_id', '')
    if wanted:
        return next((record for record in entry['records'] if clean(record['ecomdash_id']) == wanted), None)
    return entry['records'][0] if len(entry['records']) == 1 else None


def compare_order(entry, products):
    uploaded = entry['input']
    record = selected_record(entry)
    differences = []
    def add(field, analytics, workbook, reason):
        differences.append(dict(field=field, analytics=clean(analytics), workbook=clean(workbook), reason=reason))
    if entry.get('analytics_error'):
        add('Order lookup', entry['analytics_error'], uploaded['header']['order_number'], 'Analytics could not be checked. Explicitly use the workbook or skip this order.')
    elif not entry['records']:
        add('Order number', 'Not found', uploaded['header']['order_number'], 'No Analytics order matches this number.')
    elif not record:
        add('Analytics record', f'{len(entry["records"])} available record(s)', uploaded['header'].get('record_id', ''), 'Select the Analytics record, or use the workbook without an Analytics fallback.')
    if record:
        baseline = analytics_header(record['rows'])
        actual = {line['sku'].casefold(): line for line in analytics_lines(record['rows'])}
        entered = defaultdict(list)
        for line in uploaded['lines']:
            entered[line['sku'].casefold()].append(line)
        for sku in sorted(set(actual) | set(entered)):
            if sku not in actual:
                add(f'SKU {entered[sku][0]["sku"]}', 'Not on this Analytics order', 'In workbook', 'Uploaded SKU not found on this order.')
            elif sku not in entered:
                add(f'SKU {actual[sku]["sku"]}', 'On Analytics order', 'Not in workbook', 'The workbook does not include this Analytics SKU.')
            else:
                quantities = [number(row.get('quantity'), 'Ordered Quantity') for row in entered[sku]]
                if all(value is not None for value in quantities) and sum(quantities) != actual[sku]['quantity']:
                    add(f'{actual[sku]["sku"]} quantity', actual[sku]['quantity'], sum(quantities), 'Ordered quantities differ.')
                for line in entered[sku]:
                    for field in ['description', 'gtin']:
                        if line.get(field) and actual[sku].get(field) and key(line[field]) != key(actual[sku][field]):
                            add(f'{line["sku"]} {field}', actual[sku][field], line[field], 'Order line values differ.')
        for field in ['customer', 'po_number', 'ship_date', 'ship_to', 'bill_to', 'shipping_instructions']:
            if uploaded['header'].get(field) and baseline.get(field) and key(uploaded['header'][field]) != key(baseline[field]):
                add(field.replace('_', ' ').title(), baseline[field], uploaded['header'][field], 'Order details differ.')
    customer = uploaded['header'].get('customer') or (analytics_header(record['rows']).get('customer') if record else '')
    for line in uploaded['lines']:
        groups = configuration_groups(line, products, customer)
        if len(groups) != 1:
            add(f'{line["sku"]} Product Master', 'No configuration' if not groups else f'{len(groups)} configurations', line.get('config_id') or 'Workbook packaging fields',
                'Confirm the source. An uploaded order-only configuration needs sufficient quantities, box data and label settings; ambiguous configurations need a Configuration ID.')
    return differences


def check_orders(request, orders, products, directory, templates, analytics_client, progress=lambda message: None):
    entries = {}
    for index, (order, uploaded) in enumerate(orders.items(), 1):
        progress(f'Checking order {index} of {len(orders)}: {order}')
        entry = {'input': uploaded, 'records': [], 'analytics_error': ''}
        try:
            rows = analytics_client.export_order_rows(request, order)
            entry['records'] = intake._analytics_order_instance_groups(rows)
        except (HTTPException, ValueError, OSError) as exc:
            entry['analytics_error'] = str(getattr(exc, 'detail', str(exc)))
        entry['differences'] = compare_order(entry, products)
        entries[order] = entry
    return dict(entries=entries, products=products, directory=directory, templates=templates)


def public_check(state):
    return {'phase': 'matching', 'orders': [dict(order_number=order, line_count=len(entry['input']['lines']),
             differences=entry['differences'], analytics_available=bool(entry['records']),
             records=[{field: record.get(field, '') for field in ['ecomdash_id', 'storefront', 'billing_customer_name', 'invoice_date']}
                      for record in entry['records']]) for order, entry in state['entries'].items()]}


def resolve_source(entry, choice):
    source = choice.get('source') or ('auto' if not entry['differences'] else '')
    if source not in {'auto', 'analytics', 'workbook', 'skip'}:
        raise ValueError('Choose Analytics, uploaded workbook, or Skip for every discrepancy.')
    if source == 'auto' and entry['differences']:
        raise ValueError('This order has discrepancies. Explicitly choose Analytics, uploaded workbook or Skip.')
    if source == 'skip':
        return None
    record = selected_record(entry, clean(choice.get('record_id')))
    if source == 'analytics' and record is None:
        raise ValueError('Select an available Analytics record before using Analytics.')
    uploaded = copy.deepcopy(entry['input'])
    baseline = analytics_header(record['rows']) if record else {}
    actual = analytics_lines(record['rows']) if record else []
    # Packing, document and label controls describe this run and apply to either source.
    settings = uploaded['header']
    factual = {'customer', 'po_number', 'ship_date', 'ship_to', 'bill_to', 'ship_to_name', 'bill_to_name', 'shipping_instructions'}
    header = {**baseline, **{k: v for k, v in settings.items() if v and (source != 'analytics' or k not in factual or not baseline.get(k))}}
    header['_uploaded_fields'] = [field for field, value in settings.items() if value]
    header['_source'] = source
    if source == 'analytics':
        lines = []
        for raw in actual:
            controls = next((line for line in uploaded['lines'] if line['sku'].casefold() == raw['sku'].casefold()), {})
            lines.append({**controls, **{k: v for k, v in raw.items() if v != ''}, 'quantity_uom': 'Auto', 'line_id': controls.get('line_id') or raw['sku']})
    else:
        lines = []
        for line in uploaded['lines']:
            raw = next((row for row in actual if row['sku'].casefold() == line['sku'].casefold()), {})
            resolved = {**raw, **{k: v for k, v in line.items() if v != ''}}
            if not line.get('quantity') and sum(row['sku'].casefold() == line['sku'].casefold() for row in uploaded['lines']) > 1:
                raise ValueError(f'{line["sku"]}: enter each split line quantity; Analytics only has its aggregated quantity.')
            lines.append(resolved)
    for line in lines:
        line['quantity'] = number(line.get('quantity'), f'{line["sku"]} Ordered Quantity', required=True)
    return dict(header=header, lines=lines, labels=uploaded['labels'], source=source,
                record_id=record['ecomdash_id'] if record else '', differences=entry['differences'])
