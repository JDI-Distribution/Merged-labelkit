"""One-sheet entry layout mapped to the shared order/line/label contract."""
from __future__ import annotations

from labelkit.order_workbook_io import SCHEMA, clean

ENTRY_SHEET, HEADER_ROW = 'Order Entry', 4
MAX_ENTRY_ROWS = 15000  # 5,000 item rows plus up to 10,000 extra label instructions.
CORE_FIELDS = ['order_number', 'sku', 'description', 'quantity', 'quantity_uom', 'po_number', 'ship_date',
               'expected_delivery_date', 'customer', 'pack_by', 'pack_value', 'unit_lbs', 'length_in', 'width_in',
               'height_in', 'gross_weight_lbs', 'template_id', 'level', 'copies', 'lot_number', 'best_before']

FIELDS = {}
for scope, columns in SCHEMA['sheets'].items():
    for name, label, kind, choices in columns:
        if name in {'order_number', 'sku', 'line_id'} and name in FIELDS:
            continue
        field = 'label_expected_delivery_date' if scope == 'Labels' and name == 'expected_delivery_date' else name
        if field == 'copies':
            label = 'Label Copies'
        if field == 'label_expected_delivery_date':
            label = 'Label Expected Delivery Date'
        FIELDS[field] = (scope, name, label, kind, choices)
FIELD_ORDER = CORE_FIELDS + [name for name in FIELDS if name not in CORE_FIELDS]
ENTRY_COLUMNS = [(name, FIELDS[name][2], FIELDS[name][3], FIELDS[name][4]) for name in FIELD_ORDER]


def expand_entry(rows):
    """Blank shared cells inherit within the same order, never the previous order.

    Repeated explicit Line IDs add label instructions without duplicating demand.
    Different populated values for a shared order/line field must be corrected.
    """
    orders, lines, labels = {}, {}, []
    for row in rows:
        order = row['order_number']
        header = orders.setdefault(order, dict(order_number=order, _row=row['_row']))
        line_id = row.get('line_id') or f'ROW-{row["_row"]}'
        line = lines.setdefault((order, line_id), dict(order_number=order, line_id=line_id, _row=row['_row']))
        label = dict(order_number=order, line_id=line_id, sku=row.get('sku', ''), _row=row['_row'])
        for field, (scope, name, title, _, _) in FIELDS.items():
            value = row.get(field, '')
            target = header if scope == 'Orders' else line if scope == 'Order Lines' else label
            if name in {'order_number', 'line_id', 'sku'}:
                if name == 'sku' and value:
                    if line.get('sku') and line['sku'] != value:
                        raise ValueError(f'{ENTRY_SHEET} row {row["_row"]}: Line ID {line_id} has different SKUs. Use a separate Line ID for another item.')
                    line['sku'] = value
                continue
            if value:
                if scope != 'Labels' and target.get(name) and target[name] != value:
                    raise ValueError(f'{ENTRY_SHEET} row {row["_row"]}: {title} differs for {"order " + order if scope == "Orders" else "Line ID " + line_id}. Enter shared details once or keep them consistent.')
                target[name] = value
        if any(label.get(column[0]) for column in SCHEMA['sheets']['Labels'] if column[0] not in {'order_number', 'sku', 'line_id'}):
            # A semicolon-separated template list adds labels to the same demand.
            templates = [part.strip() for part in label.get('template_id', '').split(';')] or ['']
            labels.extend({**label, 'template_id': template} for template in templates if template or len(templates) == 1)
    for line in lines.values():
        for column in SCHEMA['sheets']['Order Lines']:
            line.setdefault(column[0], '')
    for label in labels:
        label['sku'] = label.get('sku') or lines[(label['order_number'], label['line_id'])].get('sku', '')
    return {'Orders': list(orders.values()), 'Order Lines': list(lines.values()), 'Labels': labels}


def flatten_entry(values):
    """Export one item row, plus additional label rows with the same Line ID."""
    headers = {clean(row.get('order_number')): row for row in values.get('Orders', [])}
    labels = values.get('Labels', [])
    rows, used_labels, seen_orders = [], set(), set()
    source_lines = values.get('Order Lines', [])
    for index, original in enumerate(source_lines):
        line = {**original, 'line_id': original.get('line_id') or f'LINE-{index+1}'}
        order = clean(line.get('order_number'))
        matches = [(i, row) for i, row in enumerate(labels) if clean(row.get('order_number')) == order and
                   (row.get('line_id') == line['line_id'] if row.get('line_id') else
                    clean(row.get('sku')).casefold() == clean(line.get('sku')).casefold() and
                    sum(clean(other.get('sku')).casefold() == clean(line.get('sku')).casefold() and clean(other.get('order_number')) == order for other in source_lines) == 1)]
        for offset, (label_index, label) in enumerate(matches or [(-1, {})]):
            row = dict(order_number=order, sku=line.get('sku', ''), line_id=line['line_id'])
            for field, (scope, name, _, _, _) in FIELDS.items():
                if name in {'order_number', 'sku', 'line_id'}:
                    continue
                source = headers.get(order, {}) if scope == 'Orders' and order not in seen_orders else line if scope == 'Order Lines' and offset == 0 else label if scope == 'Labels' else {}
                row[field] = source.get(name, '')
            rows.append(row)
            seen_orders.add(order)
            if label_index >= 0:
                used_labels.add(label_index)
    # Preserve incomplete inputs too; the app can repair them after upload.
    for index, label in enumerate(labels):
        if index in used_labels:
            continue
        row = dict(order_number=label.get('order_number'), sku=label.get('sku'), line_id=label.get('line_id') or f'LABEL-{index+1}')
        for field, (scope, name, _, _, _) in FIELDS.items():
            if scope == 'Labels' and name not in {'order_number','sku','line_id'}:
                row[field] = label.get(name, '')
        rows.append(row)
    for order, header in headers.items():
        if order not in seen_orders:
            rows.append({field: header.get(name, '') for field, (scope, name, _, _, _) in FIELDS.items() if scope == 'Orders'})
    return rows
