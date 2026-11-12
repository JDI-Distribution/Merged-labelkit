"""Editable workbook-first field resolution against immutable app snapshots."""
from __future__ import annotations

import copy
from datetime import datetime

from labelkit.order_workbook_io import SCHEMA, clean, key, number
from labelkit.order_workbook_match import analytics_header, analytics_lines, configuration_groups, selected_record
from labelkit.order_intake import _preferred_shared_level_sku_row
from pipelines.kehe.tihi_layout import _mpl_tihi_constraints

SOURCE_NAMES = dict(workbook='Excel', analytics='Analytics', product_master='Product Master', directory='Directory', default='App default', custom='Edited')


def field_review(state, order, edits=None):
    """Return every input and its provenance. No store or uploaded data is mutated."""
    edits = edits or {}
    overrides = edits.get('fields') or {}
    if not isinstance(overrides, dict) or any(not isinstance(value, dict) for value in overrides.values()):
        raise ValueError('Field edits must contain a source and optional edited value.')
    entry = state['entries'][order]
    references = entry.get('references') or state
    uploaded = copy.deepcopy(entry['input'])
    record = None if edits.get('record_id') == '__none__' else selected_record(entry, clean(edits.get('record_id')))
    baseline = analytics_header(record['rows']) if record else {}
    baseline['record_id'] = record['ecomdash_id'] if record else ''
    actual = analytics_lines(record['rows']) if record else []
    item_choices = []
    if state.get('intake') == 'numbers':
        from labelkit.order_batch_intake import order_number_input
        uploaded, item_choices = order_number_input(order, record, edits)
    excluded = set(edits.get('excluded_lines') or []) if state.get('intake') == 'numbers' else set()
    sections, decisions, allowed = [], [], set()
    defaults = dict(labels='Auto', packing_list='Yes', pallet_labels='Yes', pallet_copies=2, manual_pallet_count=1,
                    mpl_layout='Auto', brand='Auto', **{k: v for k, v in _mpl_tihi_constraints().items() if v})
    products = [row for row in references['products'] if row.get('is_active') is not False and row.get('verification_status') != 'BLOCKED']
    buyers = set()
    for index, line in enumerate(uploaded['lines']):
        if line['line_id'] in excluded:
            continue
        lookup = dict(line)
        for name in ['sku', 'config_id']:
            edit = overrides.get(f'line:{index}:{name}') or {}
            if edit.get('source') == 'custom':
                lookup[name] = clean(edit.get('value'))
                if name == 'sku':
                    lookup['config_id'] = ''
        if not lookup.get('sku'):
            matches = [row for row in actual if line.get('description') and key(row.get('description')) == key(line['description'])]
            if len(matches) == 1:
                lookup['sku'] = matches[0]['sku']
        groups = configuration_groups(lookup, products)
        if len(groups) == 1 and groups[0][0].get('storefront'):
            buyers.add(groups[0][0]['storefront'])
    choices = {**SCHEMA['choices'], 'skus': sorted({clean(row.get('sku')) for row in products if row.get('sku')} | {row['sku'] for row in actual}),
               'customers': sorted({clean(row.get('storefront')) for row in products+references['directory'] if row.get('storefront')}),
               'templates': [row['template_id'] for row in state['templates'] if row.get('status', 'ACTIVE') == 'ACTIVE']}

    def cell(prefix, column, candidates, fields, required=False, options=None, readonly=False):
        name, label, kind, list_name = column
        path = f'{prefix}:{name}'
        allowed.add(path)
        available = {source: clean(value) for source, value in candidates.items() if clean(value)}
        if list_name in {'yes_no','yes_no_auto','units','label_levels','packing_modes','layouts','brands'}:
            for source, value in available.items():
                if list_name.startswith('yes_no'):
                    value = {'true':'Yes','false':'No'}.get(value.casefold(), value)
                available[source] = next((item for item in choices[list_name] if key(item) == key(value)), value)
        default_source = next(iter(available), '')
        selected = overrides.get(path, {}).get('source', 'auto')
        if selected == 'auto':
            source, value = default_source, available.get(default_source, '')
        elif selected == 'custom':
            source, value = 'custom', clean(overrides[path].get('value'))
            if list_name in {'yes_no','yes_no_auto','units','label_levels','packing_modes','layouts','brands'}:
                value = next((item for item in choices[list_name] if key(item) == key(value)), value)
        elif selected in available:
            source, value = selected, available[selected]
        else:
            source, value = '', ''
        if readonly:
            source, value, selected = default_source, available.get(default_source, ''), 'auto'
        def comparable(v):
            if kind == 'number':
                try:
                    return float(v.replace(',', ''))
                except ValueError:
                    pass
            return v.casefold().replace('\r\n', '\n').strip()
        conflicts = len({comparable(v) for s, v in available.items() if s != 'default'}) > 1
        fields.append(dict(path=path, name=name, label=label, type=kind, value=value, source=source,
                           source_label='Order input' if source == 'workbook' and state.get('intake') == 'numbers' else SOURCE_NAMES.get(source, 'Not available'), selection=selected,
                           default_source=default_source, candidates=available, required=required,
                           conflict=conflicts, missing=required and not value, readonly=readonly,
                           stale=selected not in {'auto','custom'} and selected not in available,
                           options=list(options or []), choice_list=list_name))
        decisions.append(dict(field=path, value=value, source=source, default_source=default_source, conflict=conflicts))
        return value

    header, header_fields = {}, []
    # Customer and Directory codes resolve first so dependent defaults use edits.
    columns = list(SCHEMA['sheets']['Orders'])
    if state.get('intake') == 'numbers':
        columns.append(['manual_pallet_count', 'Manual Pallet Count (when packing list is excluded)', 'number', ''])
    first = {'order_number', 'record_id', 'customer', 'ship_from_code', 'bill_to_code', 'ship_to_code', 'labels', 'packing_list', 'pallet_labels'}
    directory_rows = [row for row in references['directory'] if row.get('is_active') is not False
                      and row.get('verification_status') not in {'DRAFT', 'BLOCKED'} and len(clean(row.get('address')).splitlines()) >= 2]
    for column in sorted(columns, key=lambda c: c[0] not in first):
        name = column[0]
        candidates = dict(workbook=uploaded['header'].get(name), analytics=baseline.get(name))
        if name == 'customer' and len(buyers) == 1:
            candidates['product_master'] = next(iter(buyers))
        if name == 'record_id':
            candidates = dict(analytics=baseline.get(name))
        options = None
        if name.endswith('_code'):
            role = {'ship_from_code': 'SHIP_FROM', 'ship_to_code': 'SHIP_TO', 'bill_to_code': 'BILL_TO'}[name]
            options = sorted({clean(row.get('dc')) for row in directory_rows if role in (row.get('address_roles') or [row.get('record_type')]) and row.get('dc')})
        if name in {'ship_from', 'ship_to', 'bill_to'}:
            role = {'ship_from': 'SHIP_FROM', 'ship_to': 'SHIP_TO', 'bill_to': 'BILL_TO'}[name]
            eligible = [row for row in directory_rows if role in (row.get('address_roles') or [row.get('record_type')])]
            code = header.get(name+'_code')
            if code:
                eligible = [row for row in eligible if clean(row.get('dc')).casefold() == code.casefold()]
            buyer = [row for row in eligible if key(row.get('storefront')) == key(header.get('customer'))]
            eligible = buyer or (eligible if code or name == 'ship_from' else [])
            chosen = eligible[0] if len(eligible) == 1 else next((r for r in eligible if name == 'ship_from' and r.get('dc') == 'DEFAULT-SHIP-FROM'), None)
            candidates['directory'] = (chosen or {}).get('address')
        candidates['default'] = defaults.get(name)
        required = name in {'ship_from', 'ship_to'} and (header.get('packing_list') != 'No' or header.get('pallet_labels') != 'No')
        header[name] = cell('header', column, candidates, header_fields, required=required, options=options, readonly=name in {'order_number', 'record_id'})
    header_fields.sort(key=lambda f: next(i for i, c in enumerate(columns) if c[0] == f['name']))
    sections.append(dict(id='header', title='Order details and document options', kind='header', fields=header_fields))
    lines, level_groups, notices = [], [], []
    for index, line in enumerate(uploaded['lines']):
        if line['line_id'] in excluded:
            allowed.update(f'line:{index}:{column[0]}' for column in SCHEMA['sheets']['Order Lines'])
            continue
        fields, effective = [], {}
        prefix = f'line:{index}'
        # A missing SKU can be filled only by a unique description or GTIN match.
        raw = next((row for row in actual if clean(line.get('sku')).casefold() == row['sku'].casefold()), {}) if line.get('sku') else {}
        if state.get('intake') == 'numbers' and not line.get('sku') and line['line_id'].startswith('LINE-'):
            raw = actual[int(line['line_id'].split('-')[1])-1]
        if not line.get('sku'):
            matches = [row for row in actual if (line.get('description') and key(row.get('description')) == key(line['description']))
                       or (line.get('gtin') and row.get('gtin') == line['gtin'])]
            raw = matches[0] if len(matches) == 1 else raw
        sku_column = next(c for c in SCHEMA['sheets']['Order Lines'] if c[0] == 'sku')
        effective['sku'] = cell(prefix, sku_column, dict(workbook=line.get('sku'), analytics=raw.get('sku')), fields)
        # Re-match after an inline SKU edit; never reuse the previous SKU's app data.
        raw = next((row for row in actual if effective['sku'].casefold() == row['sku'].casefold()), {}) if effective['sku'] else raw
        config_column = next(c for c in SCHEMA['sheets']['Order Lines'] if c[0] == 'config_id')
        groups = configuration_groups(dict(sku=effective['sku']), products, header.get('customer'))
        config_options = sorted({clean(group[0].get('config_id')) for group in groups if group[0].get('config_id')})
        effective['config_id'] = cell(prefix, config_column, dict(workbook=line.get('config_id'), product_master=groups[0][0].get('config_id') if len(groups) == 1 else ''), fields, options=config_options)
        groups = configuration_groups(effective, products, header.get('customer'))
        levels = groups[0] if len(groups) == 1 else []
        exact = [r for r in levels if clean(r.get('sku')).casefold() == effective['sku'].casefold()]
        incoming = _preferred_shared_level_sku_row(exact, levels) if len(exact) > 1 else next(iter(exact or levels), {})
        case = next((r for r in levels if r.get('packaging_level') == 'Case'), {})
        each = next((r for r in levels if r.get('packaging_level') == 'Each'), {})
        inner = next((r for r in levels if r.get('packaging_level') == 'Inner Pack'), {})
        master = dict(description=incoming.get('description'), customer_item_number=incoming.get('customer_item_number'), gtin=incoming.get('gtin'),
                      each_gtin=each.get('gtin'), case_gtin=case.get('gtin'), eaches_per_inner=inner.get('case_qty'), eaches_per_case=case.get('case_qty'),
                      **{field: case.get(field) for field in ['length_in', 'width_in', 'height_in', 'gross_weight_lbs']})
        units_column = next(c for c in SCHEMA['sheets']['Order Lines'] if c[0] == 'quantity_uom')
        effective['quantity_uom'] = cell(prefix, units_column, dict(workbook=line.get('quantity_uom'), product_master=incoming.get('packaging_level'), default='Auto'), fields)
        split = bool(effective['sku']) and sum(clean(r.get('sku')).casefold() == effective['sku'].casefold() for r in uploaded['lines']) > 1
        for column in SCHEMA['sheets']['Order Lines']:
            name = column[0]
            if name in effective:
                continue
            analytics_value = raw.get(name) if not (name == 'quantity' and split) else ''
            # A quantity is meaningful only in its original incoming SKU unit.
            if name == 'quantity' and incoming and effective['quantity_uom'] not in {'Auto', incoming.get('packaging_level')}:
                analytics_value = ''
            required = name == 'quantity'
            effective[name] = cell(prefix, column, dict(workbook=line.get(name), analytics=analytics_value,
                product_master=master.get(name), default='Default' if name == 'pack_by' else ''), fields, required=required,
                readonly=name in {'order_number', 'line_id'})
        effective['order_number'] = order
        effective['line_id'] = line['line_id']
        effective['_review_index'] = index
        for field in fields:
            if field['name'] == 'description':
                field['required'] = not effective['sku']
            if field['name'] in {'length_in', 'width_in', 'height_in', 'gross_weight_lbs'}:
                field['required'] = effective['pack_by'] != 'Default' or header['packing_list'] != 'No'
            if field['name'] == 'pack_value':
                field['required'] = effective['pack_by'] != 'Default'
            if field['name'] == 'unit_lbs':
                field['required'] = effective['pack_by'] == 'Pounds per box'
            field['missing'] = field['required'] and not field['value']
        if not raw and record:
            notices.append(f'{effective["sku"] or line["line_id"]}: SKU is not on the selected Analytics order. Confirm the SKU or keep this order-only line.')
        if len(groups) != 1:
            notices.append(f'{effective["sku"] or line["line_id"]}: {"multiple configurations match; select one" if groups else "no Product Master match; enter order-only packaging details"}.')
        fields.sort(key=lambda f: next(i for i,c in enumerate(SCHEMA['sheets']['Order Lines']) if c[0] == f['name']))
        sections.append(dict(id=prefix, title=f'{effective["sku"] or effective["description"] or "Order-only item"} · {line["line_id"]}', kind='line', fields=fields,
            product_match='matched' if len(groups) == 1 else 'ambiguous' if groups else 'missing',
            analytics_match='matched' if raw else 'missing' if record else 'unavailable'))
        lines.append(effective)
        level_groups.append(levels)
    included = {line['sku'].casefold() for line in lines}
    for row in actual:
        if row['sku'].casefold() not in included:
            notices.append(f'{row["sku"]}: present in Analytics but not included in this batch. Confirm the selected items.')
    definitions = uploaded['labels']
    if not definitions:
        definitions = []
        for line, levels in zip(lines, level_groups):
            enabled = [r for r in levels if r.get('label_enabled')]
            for row in enabled or [dict(packaging_level='Case')]:
                definitions.append(dict(order_number=order, line_id=line['line_id'], sku=line['sku'],
                    _app_template=row.get('label_template_id', ''), _app_level=row['packaging_level'], _optional=True,
                    _app_copies=row.get('default_copies',''),
                    _binding_id=f'{line["line_id"]}:{row["packaging_level"]}:{row.get("label_template_id", "")}'))
        if state.get('intake') == 'numbers' and 'fancy' in key(header.get('customer')) and lines and header['labels'] != 'No':
            definitions.append(dict(order_number=order,line_id=lines[0]['line_id'],sku=lines[0]['sku'],_app_template='FANCY_PALLET_3X3',_app_level='Pallet',_optional=True,_binding_id='partner:fancy:pallet'))
    labels = []
    if state.get('intake') == 'numbers':
        extra = edits.get('added_labels') or []
        if not isinstance(extra,list) or len(extra)>1000 or any(not isinstance(row,dict) or set(row)!={'line_id','id'} or not isinstance(row['id'],str) or not row['id'].startswith('EXTRA-') or row['line_id'] not in {item['line_id'] for item in item_choices} for row in extra):
            raise ValueError('Choose an included item for each additional label template.')
        if len({row['id'] for row in extra})!=len(extra):
            raise ValueError('Additional label IDs must be unique.')
        definitions = list(definitions) + [dict(order_number=order,line_id=row['line_id'],sku=next(line['sku'] for line in lines if line['line_id']==row['line_id']),_optional=False,_binding_id=row['id']) for row in extra if row['line_id'] in {line['line_id'] for line in lines}]
    for index, definition in enumerate(definitions):
        fields, effective = [], {}
        line_id_edit = overrides.get(f'label:{index}:line_id') or {}
        binding = clean(line_id_edit.get('value')) if line_id_edit.get('source') == 'custom' else definition.get('line_id')
        bound = [line for line in lines if (line['line_id'] == binding if binding else line['sku'].casefold() == clean(definition.get('sku')).casefold())]
        linked = bound[0] if len(bound) == 1 else {}
        if linked and definition.get('sku') and clean(definition['sku']).casefold() != linked['sku'].casefold():
            notices.append(f'Label {index+1}: using SKU {linked["sku"]} from its linked Line ID. The Excel label row supplied {definition["sku"]}.')
        for column in SCHEMA['sheets']['Labels']:
            name = column[0]
            app_value = definition.get('_app_template') if name == 'template_id' else definition.get('_app_level') if name == 'level' else ''
            if name == 'copies':
                app_value = definition.get('_app_copies','')
            if name == 'sku' and linked:
                app_value = linked['sku']
            if name == 'template_id' and not definition.get('_optional') and not definition.get('template_id') and linked:
                levels = level_groups[lines.index(linked)]
                matches = [r['label_template_id'] for r in levels if r.get('label_enabled') and r.get('packaging_level') == (definition.get('level') or 'Case') and r.get('label_template_id')]
                app_value = matches[0] if len(set(matches)) == 1 else ''
            selected_template = next((row for row in state['templates'] if row['template_id'] == effective.get('template_id')), {})
            defaults_label = dict(level='Case', copies=selected_template.get('default_copies') or 1, print_barcode='Auto', expected_delivery_date=header.get('expected_delivery_date'))
            candidates = dict(workbook=definition.get(name), product_master=app_value, default=defaults_label.get(name))
            # Keep line bindings in sync after SKU edits, including explicit Labels rows.
            if name == 'sku' and linked:
                candidates = dict(default=linked['sku'])
            effective[name] = cell(f'label:{index}', column, candidates, fields,
                required=name == 'template_id' and header['labels'] != 'No' and (not definition.get('_optional') or header['labels'] == 'Yes'),
                readonly=name in {'order_number','sku'}, options=[line['line_id'] for line in lines] if name == 'line_id' else None)
        effective.update(order_number=order, line_id=linked.get('line_id') or binding or '')
        if effective['template_id'] or not definition.get('_optional'):
            labels.append(effective)
        template = next((r for r in state['templates'] if r['template_id'] == effective['template_id']), {})
        required_run = set(template.get('required_run_fields') or [])
        for field in fields:
            if header['labels'] != 'No' and field['name'] in required_run - {'carton_total', 'carton_start', 'carton_end', 'order_number', 'po_number', 'ship_date', 'quantity_label'}:
                field['required'] = True
                field['missing'] = not field['value']
        if linked and header['labels'] != 'No':
            line_section = next(s for s in sections if s['id'] == f'line:{linked["_review_index"]}')
            needed = set(template.get('required_product_fields') or [])
            if linked.get('pack_by') != 'Default':
                needed.discard('case_qty')
            mapping = dict(case_qty='eaches_per_case' if effective['level'] == 'Case' else 'eaches_per_inner' if effective['level'] == 'Inner Pack' else '',
                           gtin='case_gtin' if effective['level'] == 'Case' else 'each_gtin' if effective['level'] == 'Each' else 'gtin')
            for field in line_section['fields']:
                if field['name'] in {mapping.get(n,n) for n in needed}:
                    field['required'], field['missing'] = True, not field['value']
            if 'po_number' in required_run:
                po = next(f for f in header_fields if f['name'] == 'po_number')
                po['required'], po['missing'] = True, not po['value']
        sections.append(dict(id=f'label:{index}', binding_id=definition.get('_binding_id',str(index)), title=f'Label {index+1} · {effective["sku"] or "Select line"}', kind='label', fields=fields))
    # All resolved addresses, including explicit blanks, are authoritative after review.
    header['_field_review'] = True
    invalid = set(overrides) - allowed
    if invalid and not edits.get('skip'):
        raise ValueError('An edited field no longer exists. Reopen the field review.')
    if not entry['records']:
        notices.insert(0, 'Order not found in Analytics. Enter order-only details below or skip this order.' if state.get('intake') == 'numbers' else 'Order not found in Analytics. Available Excel and app values are shown below.')
    elif edits.get('record_id') == '__none__':
        notices.insert(0, 'No Analytics fallback selected. Enter order-only details; Product Master and Directory defaults remain available.' if state.get('intake') == 'numbers' else 'No Analytics fallback selected. Using Excel, Product Master and Directory values.')
    elif not record:
        notices.insert(0, 'Select the correct Analytics record to fill its missing values. No record was chosen automatically.')
    if entry.get('analytics_error'):
        notices.insert(0, f'Analytics could not be checked: {entry["analytics_error"]}')
    flat = [field for section in sections for field in section['fields']]
    return dict(order_number=order, sections=sections, notices=notices, item_choices=item_choices, skipped=bool(edits.get('skip')), choices=choices,
                choice_labels={row['template_id']:row.get('name') or row['template_id'] for row in state['templates']},
                missing_count=sum(f['missing'] for f in flat), conflict_count=sum(f['conflict'] for f in flat),
                filled_count=sum(f['source'] in {'analytics','product_master','directory','default'} and bool(f['value']) for f in flat),
                record_id=record['ecomdash_id'] if record else '', records=[{k:r.get(k,'') for k in ['ecomdash_id','storefront','invoice_date']} for r in entry['records']],
                resolved=dict(header=header, lines=lines, labels=labels, source='fields', record_id=record['ecomdash_id'] if record else '', differences=decisions))


def public_fields(review):
    return {key: value for key, value in review.items() if key != 'resolved'}


def resolve_fields(state, order, edits):
    if edits.get('skip') is True:
        return None
    review = field_review(state, order, edits)
    resolved = review['resolved']
    if not resolved['lines']:
        raise ValueError('Include at least one item, add an order-only item, or skip this order.')
    entry = state['entries'][order]
    if entry['records'] and not review['record_id'] and edits.get('record_id') != '__none__':
        raise ValueError('Select the Analytics record, or choose No Analytics fallback for this order.')
    if any(f['stale'] for section in review['sections'] for f in section['fields']):
        raise ValueError('A selected field source is no longer available. Choose Default or edit that field.')
    if (review['notices'] or review['conflict_count']) and edits.get('acknowledge_matches') is not True:
        raise ValueError('Review the order/SKU match notices and conflicting defaults before calculating.')
    missing = [f['label'] for section in review['sections'] for f in section['fields'] if f['missing']]
    if missing:
        raise ValueError('Complete the highlighted fields: '+', '.join(dict.fromkeys(missing))+'.')
    for section in review['sections']:
        for field in section['fields']:
            if field['type'] == 'date' and field['value']:
                try:
                    datetime.strptime(field['value'], '%Y-%m-%d')
                except ValueError:
                    raise ValueError(f'{field["label"]}: enter a date as YYYY-MM-DD.') from None
    for index, line in enumerate(resolved['lines']):
        line['_field_review'] = True
        line['_explicit_fields'] = [field['name'] for section in review['sections'] if section['id'] == f'line:{line.get("_review_index", index)}'
                                    for field in section['fields'] if field['selection'] != 'auto' or field['source'] == 'workbook']
        if not line['sku'] and not line['description']:
            raise ValueError(f'{line["line_id"]}: enter a description or SKU to identify this order-only item.')
        line['quantity'] = number(line.get('quantity'), f'{line["sku"]} Ordered Quantity', required=True)
    return resolved
