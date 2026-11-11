"""Build detached batch drafts using the shared conversion, planner and render contracts."""
from __future__ import annotations

import copy
import math
import re

from labelkit.document_rules import document_readiness, pallet_plan
from labelkit.order_intake import _analytics_case_conversion, _preferred_shared_level_sku_row
from labelkit.order_workbook_io import SCHEMA, clean, key, number
from labelkit.order_workbook_match import configuration_groups
from labelkit.reference_data import normalize_packaging_level, normalize_product_master_row
from pipelines.b2b_labels import b2b_job_page_plan
from pipelines.address_text import normalize_address_text
from labelkit.product_quality import gtin_check_digit_valid


def choice(value, options, default=''):
    if not clean(value):
        return default
    if 'Yes' in options:
        value = {'true': 'Yes', 'false': 'No'}.get(clean(value).casefold(), value)
    found = next((entry for entry in options if key(entry) == key(value)), None)
    if found is None:
        raise ValueError(f'Choose one of {", ".join(options)} instead of "{value}".')
    return found


def directory_address(rows, header, role):
    field = {'SHIP_FROM': 'ship_from', 'SHIP_TO': 'ship_to', 'BILL_TO': 'bill_to'}[role]
    manual = header.get(field, '')
    if header.get('_field_review'):
        name = header.get(f'{field}_name', '')
        if name and manual and key(manual.splitlines()[0]) != key(name):
            manual = f'{name}\n{manual}'
        return normalize_address_text(manual)
    code = header.get(f'{field}_code', '')
    eligible = [row for row in rows if row.get('is_active') is not False and row.get('verification_status') not in {'DRAFT', 'BLOCKED'}
                and role in (row.get('address_roles') or [row.get('record_type')])
                and len(clean(row.get('address') or row.get(field)).splitlines()) >= 2]
    if code:
        matches = [row for row in eligible if clean(row.get('dc')).casefold() == code.casefold()]
        buyer = [row for row in matches if key(row.get('storefront')) == key(header.get('customer'))]
        matches = buyer or matches
        if len(matches) != 1:
            raise ValueError(f'{field.replace("_", " ")}: Directory code {code} is missing, incomplete, inactive or ambiguous.')
        # An explicit address can override a Directory choice for this run.
        manual = manual if field in header.get('_uploaded_fields', []) and header.get('_source') != 'analytics' else ''
        manual = manual or matches[0].get('address') or matches[0].get(field)
    if not manual and role == 'SHIP_FROM':
        buyer = [row for row in eligible if key(row.get('storefront')) == key(header.get('customer'))]
        origin = next((row for row in buyer if row.get('dc') == 'DEFAULT-SHIP-FROM'), None)
        origin = origin or (buyer[0] if len(buyer) == 1 else None)
        origin = origin or next((row for row in eligible if row.get('dc') == 'DEFAULT-SHIP-FROM'), None)
        manual = (origin or {}).get('address', '')
    if not manual and role != 'SHIP_FROM':
        buyer = [row for row in eligible if key(row.get('storefront')) == key(header.get('customer'))]
        if len(buyer) == 1:
            manual = buyer[0].get('address', '')
    name = header.get(f'{field}_name', '')
    if name and manual and key(manual.splitlines()[0]) != key(name):
        manual = f'{name}\n{manual}'
    return normalize_address_text(manual)


def box_groups(total, mode, value, unit_lbs):
    value = number(value, 'Packing Value', required=True)
    if mode == 'Total boxes':
        if int(value) != value or value > math.ceil(total):
            raise ValueError('Total boxes must be a whole number no greater than ordered units.')
        if float(total).is_integer():
            small, large = divmod(int(total), int(value))
            groups = [(large, small+1), (int(value)-large, small)]
        else:
            groups = [(value, total/value)]
    else:
        if mode == 'Pounds per box' and not unit_lbs:
            raise ValueError('Pounds Per Ordered Unit is required for weight packing.')
        units = value / unit_lbs if mode == 'Pounds per box' else value
        count = math.floor(total/units + 1e-9)
        remainder = total-count*units
        groups = [(count, units), (1 if remainder > 1e-7 else 0, remainder)]
    return [{'count': int(count), 'units': units, 'net_lbs': units*unit_lbs if unit_lbs else None}
            for count, units in groups if count > 0]


def prepare_line(order, index, line, products, customer):
    warnings = []
    groups = configuration_groups(line, products, customer)
    if len(groups) > 1:
        raise ValueError(f'{line["sku"]}: multiple Product Master configurations match. Enter Product Configuration ID.')
    rows = groups[0] if groups else []
    if line.get('config_id') and not rows:
        raise ValueError(f'{line["sku"]}: Configuration ID does not match an active SKU. Select an existing configuration or clear its ID for an order-only product.')
    unit = choice(line.get('quantity_uom'), SCHEMA['choices']['units'], 'Auto')
    if unit == 'Auto':
        exact = [row for row in rows if clean(row.get('sku')).casefold() == clean(line['sku']).casefold()]
        incoming = _preferred_shared_level_sku_row(exact, rows) if len(exact) > 1 else next(iter(exact or rows), None)
        if len({row['packaging_level'] for row in exact}) > 1:
            warnings.append(f'{line["sku"]}: the SKU is shared by packaging levels; Auto interpreted the ordered unit as {incoming["packaging_level"]}. Confirm this unit before generating.')
    else:
        incoming = next((row for row in rows if normalize_packaging_level(row.get('packaging_level')) == unit), None)
        if rows and incoming is None and unit == 'Each':
            incoming = normalize_product_master_row({**rows[0], 'packaging_level': 'Each', 'case_qty': '1',
                'gtin': line.get('each_gtin', ''), 'label_enabled': False})
            rows.append(incoming)
        if rows and incoming is None:
            raise ValueError(f'{line["sku"]}: {unit} is not configured. Choose a configured Ordered Unit.')
    mode = choice(line.get('pack_by'), SCHEMA['choices']['packing_modes'], 'Default')
    if not rows:
        each = normalize_product_master_row(dict(storefront=customer or 'Order customer', config_id=f'UPLOAD-{order}-{index}',
                    sku=line['sku'], description=line.get('description') or line['sku'], packaging_level='Each',
                    case_qty='1', gtin=line.get('each_gtin') or (line.get('gtin') if unit in {'Each', 'Auto'} else ''),
                    customer_item_number=line.get('customer_item_number'), label_enabled=False, is_active=True))
        rows = [each]
        if line.get('eaches_per_case') or unit == 'Case':
            rows.append(normalize_product_master_row({**each, 'packaging_level': 'Case',
                'case_qty': str(number(line.get('eaches_per_case'), f'{line["sku"]} Eaches Per Case', required=True)),
                'gtin': line.get('case_gtin') or (line.get('gtin') if unit == 'Case' else '')}))
        if unit == 'Inner Pack':
            rows.append(normalize_product_master_row({**each, 'packaging_level': 'Inner Pack',
                'case_qty': str(number(line.get('eaches_per_inner'), 'Eaches Per Inner Pack', required=True)), 'gtin': line.get('gtin', '')}))
        incoming = next(row for row in rows if row['packaging_level'] == (unit if unit != 'Auto' else 'Each'))
    if line.get('gtin') or line.get('_field_review'):
        incoming['gtin'] = line['gtin']
    for row in rows:
        if line.get('description') or line.get('_field_review'):
            row['description'] = line['description']
        if line.get('customer_item_number') or line.get('_field_review'):
            row['customer_item_number'] = line['customer_item_number']
        if row['packaging_level'] == 'Each' and (line.get('each_gtin') or line.get('_field_review')):
            row['gtin'] = line['each_gtin']
    case = next((row for row in rows if row['packaging_level'] == 'Case'), None)
    inner = next((row for row in rows if row['packaging_level'] == 'Inner Pack'), None)
    if inner and line.get('eaches_per_inner'):
        inner['case_qty'] = str(number(line['eaches_per_inner'], 'Eaches Per Inner Pack', required=True, whole=True))
    if case:
        if line.get('eaches_per_case') and mode == 'Default':
            quantity = number(line['eaches_per_case'], 'Eaches Per Case', required=True, whole=True)
            if float(case.get('case_qty') or 0) != quantity:
                case['gtin'] = ''
            case['case_qty'] = str(quantity)
        for field in ['length_in', 'width_in', 'height_in', 'gross_weight_lbs']:
            if line.get(field):
                case[field] = str(number(line[field], field.replace('_', ' '), required=True))
        if line.get('case_gtin') or line.get('_field_review'):
            case['gtin'] = line['case_gtin']
        if inner:
            ratio = float(case.get('case_qty') or 0)/float(inner.get('case_qty') or 1)
            if mode == 'Default' and (line.get('eaches_per_case') or line.get('eaches_per_inner')) and not ratio.is_integer():
                raise ValueError('Eaches Per Case is not a whole inner-pack multiple. Use explicit custom packing for repacked boxes.')
            case['inner_packs_per_case'] = str(int(ratio)) if ratio.is_integer() else ''
    matched_units = unit != 'Auto' or any(row['packaging_level'] == 'Each' for row in rows)
    factor = float(incoming.get('case_qty') or 1) if matched_units else 1
    total_eaches = line['quantity']*factor
    if mode != 'Default':
        unit_lbs = number(line.get('unit_lbs'), 'Pounds Per Ordered Unit')
        if not unit_lbs:
            found = re.search(r'(\d+(?:\.\d+)?)\s*LBS?\b', f'{line["sku"]} {line.get("description", "")}', re.I)
            unit_lbs = float(found[1]) if found else None
        measurements = {field: number(line.get(field), f'{line["sku"]} {field.replace("_", " ")}', required=True)
                        for field in ['length_in', 'width_in', 'height_in', 'gross_weight_lbs']}
        packs = box_groups(line['quantity'], mode, line.get('pack_value'), unit_lbs)
        if len(packs) > 1 and not unit_lbs:
            raise ValueError('Unequal final boxes require Pounds Per Ordered Unit to calculate their actual weights.')
        maximum_net = max(group['net_lbs'] or 0 for group in packs)
        if maximum_net > measurements['gross_weight_lbs'] + 1e-7:
            raise ValueError('Packed Box Gross must include the contents and box weight.')
        case_products = []
        for n, group in enumerate(packs):
            product = normalize_product_master_row({**incoming, 'config_id': f'PACK-{order}-{index}-{n}', 'sku': line['sku'],
                'packaging_level': 'Case', 'case_qty': str(group['units']*factor), **{k: str(v) for k, v in measurements.items()},
                'gross_weight_lbs': str(measurements['gross_weight_lbs'] - maximum_net + (group['net_lbs'] or 0)) if unit_lbs else str(measurements['gross_weight_lbs']),
                'gtin': '', 'barcode_type': 'NONE', 'in_packing_list': True, 'is_active': True})
            if case and abs(group['units']*factor-float(case.get('case_qty') or 0)) < 1e-7:
                product['gtin'] = case.get('gtin', '')
            if line.get('case_gtin') and group['units'] == max(pack['units'] for pack in packs):
                product['gtin'] = line['case_gtin']
            group['product'] = product
            case_products.append(product)
        shipping = packs
    else:
        converted = _analytics_case_conversion(line['quantity'], incoming, rows, quantity_is_matched_uom=matched_units)
        if converted and not converted['case_conversion_exact']:
            raise ValueError(f'{line["sku"]}: ordered demand is not a full case multiple. Use Customize Packing By to specify a partial final box instead of rounding demand up.')
        product = (converted or {}).get('outermost_product') or incoming
        if converted is None and not float(line['quantity']).is_integer():
            raise ValueError(f'{line["sku"]}: fractional demand needs explicit custom packing.')
        shipping = [{'count': int((converted or {}).get('quantity_ordered') or line['quantity']), 'units': factor,
                     'net_lbs': None, 'product': product}]
        case_products = []
    each = next((row for row in rows if row['packaging_level'] == 'Each'), {})
    items = []
    for n, group in enumerate(shipping):
        product, count = group['product'], group['count']
        item = dict(sku=product.get('sku') or line['sku'], config_id=product.get('config_id'), storefront=product.get('storefront'),
                    item_number=each.get('gtin') or product.get('customer_item_number') or line['sku'],
                    description=product.get('description') or line['sku'], gtin=product.get('gtin', ''), case_upc=product.get('gtin', ''),
                    each_gtin=each.get('gtin', ''), quantity_per_case=str(product.get('case_qty') or ''),
                    qty_on_pallet=str(count), total_ordered=str(count), total_shipped=str(count), uom='CASES' if product['packaging_level'] == 'Case' else 'EACHES',
                    review_line_index=index, expiration_date=line.get('expiration_date', ''), notes=line.get('notes', ''), location_on_pallet='')
        if mode != 'Default' or any(line.get(field) for field in ['eaches_per_case', 'case_gtin', 'length_in', 'gross_weight_lbs']) or not groups:
            item['order_packaging'] = dict(product=product, source_units=line['quantity'], net_lbs_per_box=group['net_lbs'])
        items.append(item)
    return dict(input=line, incoming=incoming, levels=rows, shipping=shipping, items=items, total_eaches=total_eaches,
                products=rows+case_products, matched=bool(groups), warnings=warnings,
                interpreted_unit=incoming['packaging_level'] if matched_units else 'Each')


def build_order_documents(order, resolved, state):
    header = resolved['header']
    templates = {row['template_id']: row for row in state['templates'] if row.get('status', 'ACTIVE') == 'ACTIVE'}
    selected = {'labels': choice(header.get('labels'), SCHEMA['choices']['yes_no_auto'], 'Auto'),
                'packing_list': choice(header.get('packing_list'), ['Yes', 'No'], 'Yes'),
                'pallet_labels': choice(header.get('pallet_labels'), ['Yes', 'No'], 'Yes')}
    lines = [prepare_line(order, index, line, state['products'], header.get('customer', '')) for index, line in enumerate(resolved['lines'])]
    if not header.get('customer') and not header.get('_field_review'):
        buyers = {line['incoming'].get('storefront') for line in lines if line['matched']}
        header['customer'] = next(iter(buyers)) if len(buyers) == 1 else ''
    customer = key(header.get('customer'))
    layout = choice(header.get('mpl_layout'), SCHEMA['choices']['layouts'], 'Auto')
    if layout == 'Auto':
        layout = 'fancy' if 'fancy' in customer else 'decopac' if 'decopac' in customer else 'dutch_bros' if 'dutch' in customer else 'kehe' if customer == 'kehe' else 'standard'
    brand = choice(header.get('brand'), SCHEMA['choices']['brands'], 'Auto')
    if brand == 'Auto':
        brand = 'bakell' if layout in {'fancy', 'decopac', 'dutch_bros'} else 'jdi_distribution'
    mpl = dict(id=f'SO-{order}', order_no=order, customer_po_number=header.get('po_number', ''), customer_name=header.get('customer', ''),
               est_ship_date=header.get('ship_date', ''), po_date=header.get('po_date', ''), bol_number=header.get('bol_number', ''),
               pro_number=header.get('pro_number', ''), ship_via=header.get('ship_via', ''), shipping_instructions=header.get('shipping_instructions', ''),
               supplier_info=directory_address(state['directory'], header, 'SHIP_FROM'), ship_to=directory_address(state['directory'], header, 'SHIP_TO'),
               bill_to=directory_address(state['directory'], header, 'BILL_TO'), phone_number=header.get('phone', ''),
               template_id=layout, brand_id=brand, title='Packing List', subtitle='Shipment and Pallet Detail',
               source_files=['Uploaded order workbook'], items=[item for line in lines for item in line['items']], warnings=[],
               palletization_source='Auto Palletize', _tihi_constraints={field: number(header[field], field.replace('_', ' '), whole=field in {'cases_per_layer', 'max_layers'})
                    for field in ['max_length_in', 'max_width_in', 'max_height_in', 'max_gross_lbs', 'pallet_base_height_in', 'cases_per_layer', 'max_layers'] if header.get(field)})
    products = [product for line in lines for product in line['products']]
    plan = pallet_plan(mpl, products, 'auto')
    mpl = plan['mpl']
    mpl['warnings'] = list(dict.fromkeys(mpl.get('warnings', [])+plan['warnings']))
    draft = dict(standalone_mpl=True, template_id=layout, brand_id=brand, packing_lists=[mpl], product_master=products, reviewed_product_master=products)
    errors, warnings = [], [warning for line in lines for warning in line['warnings']]
    pallet_count = len(mpl.get('_pallet_ids', []))
    if selected['packing_list'] == 'Yes' or selected['pallet_labels'] == 'Yes':
        if not mpl['customer_po_number']:
            warnings.append('Customer PO is blank. The sales order number is not substituted for it.')
        if not mpl['est_ship_date']:
            warnings.append('Ship Date is blank.')
        if len(mpl['supplier_info'].splitlines()) < 2 or len(mpl['ship_to'].splitlines()) < 2:
            errors.append('Ship From and Ship To need a name and address on separate lines for packing lists and pallet labels.')
        if any(not item.get('location_on_pallet') for item in mpl['items']):
            errors.append('Some lines cannot be assigned to pallets. Supply shipping Case quantities, dimensions and gross weights or custom packing.')
    definitions = resolved['labels']
    label_bindings = []
    for definition in definitions:
        matches = [line for line in lines if (line['input'].get('line_id') == definition.get('line_id') if definition.get('line_id')
                   else clean(line['input']['sku']).casefold() == clean(definition['sku']).casefold())]
        if len(matches) != 1:
            errors.append(f'Labels row {definition.get("_row", "")}: use a valid Line ID to identify exactly one selected line.')
        else:
            if clean(matches[0]['input']['sku']).casefold() != clean(definition['sku']).casefold():
                errors.append(f'Labels row {definition.get("_row", "")}: SKU and Line ID identify different lines.')
            label_bindings.append((matches[0], definition))
    if not definitions:
        for line in lines:
            for level in line['levels']:
                if level.get('label_enabled'):
                    label_bindings.append((line, dict(level=level['packaging_level'], template_id=level.get('label_template_id', ''))))
        if 'fancy' in customer and lines and selected['labels'] != 'No':
            label_bindings.append((lines[0], dict(level='Pallet', template_id='FANCY_PALLET_3X3')))
    jobs = []
    if selected['labels'] != 'No':
        for line, definition in label_bindings:
            template_id = definition.get('template_id', '')
            template = next((row for name, row in templates.items() if name.casefold() == template_id.casefold()), None)
            if not template:
                errors.append(f'{line["input"]["sku"]}: choose an active Label Template.')
                continue
            template_id = template['template_id']
            level = choice(definition.get('level'), SCHEMA['choices']['label_levels'], 'Case')
            if level == 'Pallet':
                if not pallet_count:
                    errors.append('A Pallet-level label needs a calculated pallet plan.')
                groups = [dict(count=pallet_count, product=line['incoming'], net_lbs=None)]
                total = pallet_count
            elif level == 'Case':
                groups = line['shipping']
                if any(group['product']['packaging_level'] != 'Case' for group in groups):
                    errors.append(f'{line["input"]["sku"]}: a Case label needs Eaches Per Case and a shipping Case configuration.')
                    continue
                total = sum(group['count'] for group in groups)
            else:
                product = next((row for row in line['levels'] if row['packaging_level'] == level), None)
                if not product:
                    errors.append(f'{line["input"]["sku"]}: {level} label level is not configured.')
                    continue
                quantity = line['total_eaches']/float(product.get('case_qty') or 1)
                if not math.isclose(quantity, round(quantity), abs_tol=1e-8):
                    errors.append(f'{line["input"]["sku"]}: demand does not make whole {level} labels. Choose another label level or split the uploaded lines explicitly.')
                    continue
                total = int(round(quantity))
                groups = [dict(count=total, product=product, net_lbs=None)]
            start = 1
            for group in groups:
                end = start+group['count']-1
                requested_start = number(definition.get('carton_start'), 'Carton Start', whole=True) or 1
                requested_end = number(definition.get('carton_end'), 'Carton End', whole=True) or total
                if not 1 <= requested_start <= requested_end <= total:
                    errors.append(f'{line["input"]["sku"]}: invalid carton range for {level}.')
                    break
                first, last = max(start, requested_start), min(end, requested_end)
                if first <= last:
                    product = copy.deepcopy(group['product'])
                    if product.get('gtin') and product.get('barcode_type') in {'', 'NONE', None}:
                        product['barcode_type'] = {12: 'UPC_A', 13: 'EAN_13', 14: 'GTIN_14'}.get(len(product['gtin']), 'CODE128')
                    if template.get('barcode_policy') == 'REQUIRED' and not gtin_check_digit_valid(product.get('gtin')):
                        errors.append(f'{line["input"]["sku"]}: {template_id} requires a valid barcode GTIN.')
                    if definition.get('print_barcode') == 'No' and template.get('barcode_policy') == 'REQUIRED':
                        errors.append(f'{template_id} requires a barcode; Print Barcode cannot be No.')
                    if definition.get('print_barcode') == 'Yes' and not gtin_check_digit_valid(product.get('gtin')):
                        errors.append(f'{line["input"]["sku"]}: Print Barcode is Yes but this label level has no valid GTIN.')
                    run = dict(order_number=order, po_number=mpl['customer_po_number'], ship_date=mpl['est_ship_date'],
                               expected_delivery_date=definition.get('expected_delivery_date') or header.get('expected_delivery_date', ''),
                               invoice_number=header.get('invoice_number', ''), lot_number=definition.get('lot_number', ''),
                               best_before=definition.get('best_before') or line['input'].get('expiration_date', ''),
                               carton_total=str(total), carton_start=str(first), carton_end=str(last),
                               copies=str(number(definition.get('copies'), 'Label Copies', whole=True) or template.get('default_copies') or 1),
                               quantity_label=definition.get('quantity_label') or str(sum(row['total_eaches'] for row in lines) if level == 'Pallet' else line['total_eaches']),
                               net_weight=definition.get('net_weight') or (f'{group["net_lbs"]:g} lb' if group['net_lbs'] else ''),
                               pack_text=definition.get('case_pack_text', ''), print_barcode=choice(definition.get('print_barcode'), ['Auto', 'Yes', 'No'], 'Auto') != 'No' and bool(product.get('gtin')))
                    for source, required in [(product, 'required_product_fields'), (run, 'required_run_fields')]:
                        for field in template.get(required) or []:
                            if not clean(source.get(field)):
                                errors.append(f'{line["input"]["sku"]}: {template_id} requires {field.replace("_", " ")}.')
                    job = dict(template_id=template_id, line_id=line['input'].get('line_id'), product=product, run=run, directory=dict(ship_from=mpl['supplier_info'], delivery_address=mpl['ship_to'], billing_address=mpl['bill_to']))
                    try:
                        b2b_job_page_plan(job, template)
                    except ValueError as exc:
                        errors.append(f'{line["input"]["sku"]}: {exc}')
                    jobs.append(job)
                start = end+1
        if selected['labels'] == 'Yes' and not jobs:
            errors.append('Customer Labels is Yes but no enabled or explicitly selected label templates are available.')
    if jobs:
        warnings += [issue['message'] for issue in document_readiness('labels', dict(jobs=jobs), state['templates'])['issues']]
    if selected['packing_list'] == 'Yes':
        warnings += [issue['message'] for issue in document_readiness('masterPackingList', draft)['issues']]
    copies = number(header.get('pallet_copies'), 'Pallet Label Copies', whole=True) or 2
    pallets = dict(pallets=[dict(id=f'PALLET-{pallet}', pallet_number=pallet, total_pallets=str(pallet_count), copies=copies,
                    date=mpl['est_ship_date'], ship_from=mpl['supplier_info'], ship_to=mpl['ship_to'], customer_po_numbers=mpl['customer_po_number'],
                    bol_number=mpl['bol_number'], pro_number=mpl['pro_number'], status='Ready', warnings=[])
                  for pallet in mpl.get('_pallet_ids', [])])
    if selected['pallet_labels'] == 'Yes':
        warnings += [issue['message'] for issue in document_readiness('palletLabel', pallets)['issues']]
    if not jobs and selected['packing_list'] == selected['pallet_labels'] == 'No':
        errors.append('Select at least one document output.')
    return dict(order_number=order, source=resolved['source'], record_id=resolved['record_id'],
                packing_list=draft if selected['packing_list'] == 'Yes' else None,
                pallet_labels=pallets if selected['pallet_labels'] == 'Yes' else None, jobs=jobs,
                errors=list(dict.fromkeys(errors)), warnings=list(dict.fromkeys(warnings)),
                line_count=len(lines), pallet_count=pallet_count,
                decisions=resolved['differences'], header=header,
                review=dict(customer=header.get('customer', ''), po_number=mpl['customer_po_number'], ship_date=mpl['est_ship_date'],
                    ship_from=mpl['supplier_info'], ship_to=mpl['ship_to'], bill_to=mpl['bill_to'],
                    outputs=[name for name, enabled in [('Customer labels', bool(jobs)), ('Packing list and Ti-Hi', selected['packing_list'] == 'Yes'), ('Pallet labels', selected['pallet_labels'] == 'Yes')] if enabled],
                    lines=[dict(sku=line['input']['sku'], line_id=line['input'].get('line_id', ''), quantity=line['input']['quantity'],
                                unit=line['interpreted_unit'], boxes=sum(group['count'] for group in line['shipping']),
                                config_id=line['incoming'].get('config_id', ''),
                                templates=list(dict.fromkeys(job['template_id'] for job in jobs if job['line_id'] == line['input'].get('line_id')))) for line in lines]))
