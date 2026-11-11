"""Compare uploaded orders with immutable Analytics and reference snapshots."""
from __future__ import annotations

import copy

from fastapi import HTTPException
from labelkit import order_intake as intake
from labelkit.b2b_orders import _resolve_b2b_order_customer
from labelkit.order_workbook_io import clean, key


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
    if not clean(line.get('sku')):
        return []
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
        entries[order] = entry
    return dict(entries=entries, products=products, directory=directory, templates=templates)


def public_check(state):
    from labelkit.order_workbook_review import field_review, public_fields
    return {'phase': 'matching', 'orders': [public_fields(field_review(state, order)) for order in state['entries']]}
