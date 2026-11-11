"""Order workbook contract, safe input parsing, and live dropdown values."""
from __future__ import annotations

import copy
import io
import json
import re
import zipfile
from datetime import date, datetime
from pathlib import Path
from xml.etree import ElementTree as ET

SCHEMA = json.loads((Path(__file__).parents[1] / 'data/order_workbook_schema.json').read_text(encoding='utf-8'))
TEMPLATE = Path(__file__).parents[1] / 'frontend/dist/assets/templates/order-documents.xlsx'
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
ET.register_namespace('', NS)
MAX_ORDERS, MAX_LINES = 100, 5000


def clean(value):
    if value is None:
        return ''
    if isinstance(value, (datetime, date)):
        return value.strftime('%Y-%m-%d')
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def key(value):
    return re.sub(r'[^a-z0-9]', '', clean(value).lower())


def number(value, label, required=False, whole=False):
    import math
    if clean(value) == '' and not required:
        return None
    try:
        result = float(clean(value).replace(',', ''))
        if not math.isfinite(result) or result <= 0 or (whole and not result.is_integer()):
            raise ValueError()
        return int(result) if result.is_integer() else result
    except (ValueError, TypeError):
        raise ValueError(f'{label} must be a positive {"whole " if whole else ""}number.') from None


def read_order_workbook(data: bytes):
    from openpyxl import load_workbook
    if len(data) > 50 * 1024 * 1024:
        raise ValueError('The order workbook exceeds 50 MB.')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(entry.file_size for entry in archive.infolist()) > 100 * 1024 * 1024:
                raise ValueError('The expanded workbook exceeds 100 MB.')
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=False)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('Upload a valid .xlsx order workbook.') from exc
    result = {}
    try:
        for name, columns in SCHEMA['sheets'].items():
            if name not in book.sheetnames:
                if name == 'Labels':
                    result[name] = []
                    continue
                raise ValueError(f'The workbook needs the {name} sheet. Download the current template.')
            sheet = book[name]
            if (sheet.max_row or 0) > 10002 or (sheet.max_column or 0) > 100:
                raise ValueError(f'{name} is too large. Use at most 100 orders and 5,000 lines.')
            aliases = {key(alias): col[0] for col in columns for alias in col[:2]}
            types = {col[0]: col[2] for col in columns}
            iterator = sheet.iter_rows()
            headers = next(iterator, [])
            if len(headers) > 100:
                raise ValueError(f'{name} has too many columns. Keep the template headers unchanged.')
            fields = []
            for cell in headers:
                text = clean(cell.value)
                if text and key(text) not in aliases:
                    raise ValueError(f'{name}: unknown column "{text}". Keep the template headers unchanged.')
                fields.append(aliases.get(key(text), ''))
            if len([f for f in fields if f]) != len(set(f for f in fields if f)):
                raise ValueError(f'{name}: duplicate column headers.')
            if 'order_number' not in fields or (name == 'Order Lines' and 'sku' not in fields):
                raise ValueError(f'{name}: Order Number{", SKU" if name == "Order Lines" else ""} header is required.')
            rows = []
            for index, cells in enumerate(iterator, 2):
                if index > 10002 or len(cells) > 100:
                    raise ValueError(f'{name} exceeds the workbook row limit.')
                values = {}
                for field, cell in zip(fields, cells):
                    if not field:
                        continue
                    if cell.data_type == 'f':
                        raise ValueError(f'{name} row {index}: paste calculated values instead of formulas in input cells.')
                    if 'gtin' in field and isinstance(cell.value, (int, float)):
                        raise ValueError(f'{name} row {index}: enter GTINs as text to preserve leading zeroes.')
                    values[field] = clean(cell.value)
                    if types[field] == 'date' and values[field]:
                        parsed = None
                        for pattern in ['%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%Y/%m/%d']:
                            try:
                                parsed = datetime.strptime(values[field], pattern).strftime('%Y-%m-%d')
                                break
                            except ValueError:
                                pass
                        if not parsed:
                            raise ValueError(f'{name} row {index}: {field.replace("_", " ")} needs an Excel date or YYYY-MM-DD.')
                        values[field] = parsed
                if any(values.values()):
                    if not values.get('order_number'):
                        raise ValueError(f'{name} row {index}: Order Number is required.')
                    values['_row'] = index
                    rows.append(values)
            result[name] = rows
    finally:
        book.close()
    orders = {}
    for row in result['Orders']:
        order = row['order_number']
        if order in orders:
            raise ValueError(f'Orders row {row["_row"]}: order {order} is repeated. Use one Orders row per order.')
        orders[order] = {'header': row, 'lines': [], 'labels': []}
    if not orders or len(orders) > MAX_ORDERS:
        raise ValueError('Enter between 1 and 100 orders on the Orders sheet.')
    if len(result['Order Lines']) > MAX_LINES:
        raise ValueError('Use at most 5,000 order lines per workbook.')
    for sheet, target in [('Order Lines', 'lines'), ('Labels', 'labels')]:
        for row in result[sheet]:
            if row['order_number'] not in orders:
                raise ValueError(f'{sheet} row {row["_row"]}: order {row["order_number"]} is missing from Orders.')
            # Missing SKUs are repairable in the field review. Labels may bind
            # through Line ID while an incomplete line is being completed.
            if target == 'lines':
                row['line_id'] = row.get('line_id') or f'ROW-{row["_row"]}'
                if any(line['line_id'] == row['line_id'] for line in orders[row['order_number']]['lines']):
                    raise ValueError(f'{sheet} row {row["_row"]}: Line ID is repeated within this order.')
                number(row.get('quantity'), f'{sheet} row {row["_row"]} Ordered Quantity')
            orders[row['order_number']][target].append(row)
    for order, rows in orders.items():
        if not rows['lines']:
            raise ValueError(f'Order {order} needs at least one row on Order Lines.')
    return orders


def column_name(index):
    text = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        text = chr(65 + remainder) + text
    return text


def workbook_bytes(products, directory, templates, values=None):
    """Fill the Artifact Tool-authored template's lists and optional export data.

    Standard OpenXML edits retain its formatting, tables and data validation;
    the application runtime does not need the authoring tool installed.
    """
    choices = copy.deepcopy(SCHEMA['choices'])
    choices.update(customers=sorted({clean(r.get('storefront')) for r in products + directory if r.get('storefront')}),
                   skus=sorted({clean(r.get('sku')) for r in products if r.get('sku')}),
                   configs=sorted({clean(r.get('config_id')) for r in products if r.get('config_id')}),
                   templates=[r['template_id'] for r in templates if r.get('status', 'ACTIVE') == 'ACTIVE'])
    for role, name in [('SHIP_FROM', 'origins'), ('SHIP_TO', 'ship_to'), ('BILL_TO', 'bill_to')]:
        choices[name] = sorted({clean(row.get('dc')) for row in directory if row.get('dc') and role in
                               (row.get('address_roles') or [row.get('record_type')]) and row.get('is_active') is not False
                               and row.get('verification_status') not in {'DRAFT', 'BLOCKED'}})
    with zipfile.ZipFile(TEMPLATE) as original:
        parts = {name: original.read(name) for name in original.namelist()}
    workbook = ET.fromstring(parts['xl/workbook.xml'])
    sheets = {sheet.get('name'): f'xl/worksheets/sheet{i}.xml' for i, sheet in enumerate(workbook.find(f'{{{NS}}}sheets'), 1)}
    names = workbook.find(f'{{{NS}}}definedNames')
    if names is None:
        names = ET.Element(f'{{{NS}}}definedNames')
        calculation = workbook.find(f'{{{NS}}}calcPr')
        workbook.insert(list(workbook).index(calculation) if calculation is not None else len(workbook), names)

    def fill_sheet(name, matrix):
        path = sheets[name]
        root = ET.fromstring(parts[path])
        body = root.find(f'{{{NS}}}sheetData')
        styles = {re.sub(r'\d+', '', cell.get('r')): cell.get('s') for row in body if row.get('r') == '2' for cell in row}
        types = [field[2] for field in SCHEMA['sheets'].get(name, [])]
        # Preserve authored header cells; blank input rows only carry formatting.
        for row in list(body):
            if int(row.get('r')) > 1:
                body.remove(row)
        for r, values_row in enumerate(matrix, 2):
            row = ET.SubElement(body, f'{{{NS}}}row', r=str(r))
            for c, value in enumerate(values_row, 1):
                if value in ('', None):
                    continue
                cell = ET.SubElement(row, f'{{{NS}}}c', r=f'{column_name(c)}{r}')
                if styles.get(column_name(c)):
                    cell.set('s', styles[column_name(c)])
                field_type = types[c-1] if c <= len(types) else 'text'
                numeric = None
                if field_type == 'number':
                    try:
                        numeric = float(value)
                    except (ValueError, TypeError):
                        pass
                elif field_type == 'date':
                    from openpyxl.utils.datetime import to_excel
                    try:
                        numeric = to_excel(datetime.fromisoformat(clean(value)))
                    except ValueError:
                        pass
                if numeric is not None:
                    import math
                    if not math.isfinite(numeric):
                        raise ValueError('Export numeric inputs must be finite.')
                    cell.set('t', 'n')
                    ET.SubElement(cell, f'{{{NS}}}v').text = str(numeric)
                else:
                    cell.set('t', 'inlineStr')
                    node = ET.SubElement(ET.SubElement(cell, f'{{{NS}}}is'), f'{{{NS}}}t')
                    node.text = clean(value)
                    node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        dimension = root.find(f'{{{NS}}}dimension')
        if dimension is not None:
            width = len(SCHEMA['sheets'].get(name, choices))
            dimension.set('ref', f'A1:{column_name(width)}{max(101, len(matrix)+1)}')
        parts[path] = ET.tostring(root, encoding='utf-8', xml_declaration=True)

    fill_sheet('Choices', [[choices[name][i] if i < len(choices[name]) else '' for name in choices]
                           for i in range(max([1] + [len(v) for v in choices.values()]))])
    for index, (name, rows) in enumerate(choices.items(), 1):
        for old in list(names):
            if old.get('name') == f'LK_{name}':
                names.remove(old)
        ET.SubElement(names, f'{{{NS}}}definedName', name=f'LK_{name}').text = f"'Choices'!${column_name(index)}$2:${column_name(index)}${max(2, len(rows)+1)}"
    for name, rows in (values or {}).items():
        if name not in SCHEMA['sheets']:
            continue
        fill_sheet(name, [[row.get(field[0], '') for field in SCHEMA['sheets'][name]] for row in rows])
    for name in SCHEMA['sheets']:
        path = sheets[name]
        root = ET.fromstring(parts[path])
        for validation in root.findall(f'.//{{{NS}}}dataValidation'):
            validation.set('allowBlank', '1')
            formula = validation.find(f'{{{NS}}}formula1')
            if formula is not None and formula.text in {'LK_skus', 'LK_customers', 'LK_configs'}:
                validation.set('showErrorMessage', '0')
        parts[path] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    parts['xl/workbook.xml'] = ET.tostring(workbook, encoding='utf-8', xml_declaration=True)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return output.getvalue()
