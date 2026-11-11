import copy
import asyncio
import io
import json
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import pymupdf
from fastapi import HTTPException, UploadFile
from starlette.requests import Request
from openpyxl import load_workbook

from labelkit.b2b_orders import _load_b2b_label_templates
from labelkit.jobs import RESULT_JOBS
from labelkit.jobs import create_result_job
from labelkit.order_workbook_jobs import resolve_worker, generate_worker
from labelkit.order_workbook_documents import box_groups, build_order_documents
from labelkit.order_workbook_io import read_order_workbook, workbook_bytes
from labelkit.order_workbook_entry import expand_entry
from labelkit.order_workbook_match import check_orders
from labelkit.order_workbook_review import field_review, resolve_fields
from labelkit.reference_data import normalize_product_master_row
from labelkit.routes import order_workbooks as routes, generation
from labelkit.routes.documents import calculate_pallet_plan


class OrderWorkbookTests(unittest.TestCase):
    def setUp(self):
        self.products = [normalize_product_master_row(dict(storefront='Generic B2B', config_id='KNOWN', sku=sku,
            description='Known product', packaging_level=level, case_qty=qty, gtin=gtin, label_enabled=level == 'Case',
            label_template_id='STANDARD_CASE_PACK_4X6', default_copies='1', length_in='24', width_in='16', height_in='10',
            gross_weight_lbs='26', is_active=True, verification_status='VERIFIED'))
            for sku, level, qty, gtin in [('KNOWN-1LB', 'Each', '1', '00850068684991'), ('KNOWN-CASE', 'Case', '25', '10850068684998')]]
        self.refs = dict(products=self.products, directory=[], templates=_load_b2b_label_templates()['templates'])
        self.header = dict(order_number='1001', customer='Generic B2B', po_number='PO001', ship_date='2026-11-11',
            ship_from='BAKELL LLC\n1967 Essex Ct\nRedlands, CA 92373', ship_to='Receiver\n123 Main St',
            bill_to='Accounts\n456 Office St', labels='Yes', packing_list='Yes', pallet_labels='Yes')
        self.values = {'Orders': [self.header, {**self.header, 'order_number': '0002'}], 'Order Lines': [
            dict(order_number='1001', line_id='A', sku='KNOWN-1LB', quantity=600),
            dict(order_number='0002', line_id='B', sku='NEW-SKU', quantity=20, description='Uploaded product',
                 eaches_per_case=10, length_in=6, width_in=6, height_in=6, gross_weight_lbs=11)],
            'Labels': [dict(order_number='1001', line_id='A', sku='KNOWN-1LB', level='Case', template_id='STANDARD_CASE_PACK_4X6', copies=1),
                       dict(order_number='0002', line_id='B', sku='NEW-SKU', level='Case', template_id='STANDARD_CASE_PACK_4X6', copies=1)]}
        self.analytics = [dict(SKUNumber='KNOWN-1LB', **{'Quantity Ordered': '650', 'ProductName': 'Known product',
            'Ecomdash ID': 'REC-1001', 'Sales Order Number': '1001', 'Storefront': 'Generic B2B',
            'Ship To Name': 'Receiver', 'Shipping Street1': '123 Main St',
            'Billing Customer Name': 'Accounts', 'Billing Street1': '456 Office St'})]
        self.request = Request({'type': 'http', 'headers': []})

    def make(self, values=None):
        return workbook_bytes(**self.refs, values=values or self.values)

    def state(self, values=None):
        class Analytics:
            def export_order_rows(inner, request, order):
                return copy.deepcopy(self.analytics) if order == '1001' else []
        return check_orders(None, read_order_workbook(self.make(values)), **self.refs, analytics_client=Analytics())

    def poll(self, result_id):
        for _ in range(200):
            status = json.loads(generation.get_result_status(self.request, result_id).body)
            if status['status'] in {'complete', 'error'}:
                self.assertEqual(status['status'], 'complete', status)
                return status['report']
            time.sleep(.025)
        self.fail('Workbook worker did not finish.')

    def test_template_dropdowns_and_export_identifiers_dates_quantities_round_trip(self):
        raw = self.make()
        book = load_workbook(io.BytesIO(raw))
        self.assertEqual(book.sheetnames, ['Order Entry', 'Choices', 'Guide'])
        self.assertEqual(book['Choices'].sheet_state, 'hidden')
        self.assertGreaterEqual(len(book['Order Entry'].data_validations.dataValidation), 15)
        self.assertIn('LK_templates', book.defined_names)
        self.assertIn('LK_skus', book.defined_names)
        self.assertEqual(book['Order Entry']['A6'].value, '0002')
        self.assertIsInstance(book['Order Entry']['D5'].value, (int, float))
        self.assertEqual(book['Order Entry']['G5'].value.strftime('%Y-%m-%d'), '2026-11-11')
        self.assertEqual(book['Order Entry'].freeze_panes, 'C5')
        self.assertTrue(any(c.hidden and c.outlineLevel == 1 for c in book['Order Entry'].column_dimensions.values()))
        book.close()
        orders = read_order_workbook(raw)
        self.assertEqual(orders['0002']['header']['po_number'], 'PO001')
        self.assertEqual(orders['1001']['lines'][0]['quantity'], '600')

    def test_defaults_are_per_field_and_conflicts_need_review(self):
        state = self.state()
        model = field_review(state, '1001')
        fields = {f['path']: f for section in model['sections'] for f in section['fields']}
        self.assertEqual(fields['line:0:quantity']['value'], '600')
        self.assertEqual(fields['line:0:quantity']['source'], 'workbook')
        self.assertTrue(fields['line:0:quantity']['conflict'])
        self.assertEqual(fields['line:0:length_in']['source'], 'product_master')
        with self.assertRaises(ValueError):
            resolve_fields(state, '1001', {})
        for source, expected in [('analytics', 26), ('workbook', 24)]:
            resolved = resolve_fields(state, '1001', dict(acknowledge_matches=True, fields={
                'line:0:quantity': {'source': source}, 'header:po_number': {'source': 'custom', 'value': 'EDITED-PO'}}))
            doc = build_order_documents('1001', resolved, state)
            self.assertEqual(doc['errors'], [])
            self.assertEqual(doc['header']['po_number'], 'EDITED-PO')
            self.assertEqual(sum(float(row['qty_on_pallet']) for row in doc['packing_list']['packing_lists'][0]['items']), expected)

    def test_repacked_box_does_not_inherit_a_saved_gtin_for_a_different_pack_quantity(self):
        values = copy.deepcopy(self.values)
        values['Order Lines'][0].update(quantity=600, pack_by='Pounds per box', pack_value=30, unit_lbs=1,
                                        length_in=24, width_in=16, height_in=10, gross_weight_lbs=31)
        state = self.state(values)
        resolved = resolve_fields(state, '1001', dict(acknowledge_matches=True))
        self.assertEqual(resolved['lines'][0]['case_gtin'], '10850068684998')
        doc = build_order_documents('1001', resolved, state)
        self.assertTrue(all(not job['product']['gtin'] for job in doc['jobs']))
        # An explicit user choice can restore a GTIN for an order-only carton.
        resolved = resolve_fields(state, '1001', dict(acknowledge_matches=True, fields={
            'line:0:case_gtin': {'source':'product_master'}}))
        doc = build_order_documents('1001', resolved, state)
        self.assertEqual(doc['jobs'][0]['product']['gtin'], '10850068684998')

    def test_missing_order_and_reused_record_have_explicit_match_review(self):
        state = self.state()
        self.assertIsNone(resolve_fields(state, '0002', dict(skip=True)))
        self.assertTrue(field_review(state, '0002')['notices'])
        duplicate = state['entries']['1001']
        duplicate['records'].append({**copy.deepcopy(duplicate['records'][0]), 'ecomdash_id': 'REC-OTHER'})
        with self.assertRaises(ValueError):
            resolve_fields(state, '1001', dict(acknowledge_matches=True))
        self.assertEqual(resolve_fields(state, '1001', dict(record_id='REC-OTHER', acknowledge_matches=True))['record_id'], 'REC-OTHER')
        self.assertEqual(resolve_fields(state, '1001', dict(record_id='__none__', acknowledge_matches=True))['record_id'], '')

    def test_incomplete_input_fills_blanks_from_app_and_can_be_completed_inline(self):
        values = copy.deepcopy(self.values)
        values['Order Lines'][0].pop('quantity')
        values['Orders'][0].pop('ship_to')
        values['Order Lines'][1].pop('length_in')
        state = self.state(values)
        model = field_review(state, '1001')
        fields = {f['path']: f for section in model['sections'] for f in section['fields']}
        self.assertEqual(fields['line:0:quantity']['value'], '650')
        self.assertEqual(fields['line:0:quantity']['source'], 'analytics')
        self.assertEqual(fields['header:ship_to']['source'], 'analytics')
        self.assertEqual(fields['line:0:length_in']['value'], '24')
        with self.assertRaisesRegex(ValueError, 'Box Length'):
            resolve_fields(state, '0002', dict(acknowledge_matches=True))
        resolved = resolve_fields(state, '0002', dict(acknowledge_matches=True, fields={
            'line:0:length_in': {'source': 'custom', 'value': '6'}}))
        doc = build_order_documents('0002', resolved, state)
        self.assertEqual(doc['errors'], [])
        self.assertFalse(state['entries']['0002']['input']['lines'][0].get('length_in'))

    def test_bulk_and_standard_pallet_route_fill_skus_sequentially_with_the_same_plan(self):
        values = copy.deepcopy(self.values)
        values['Orders'] = [values['Orders'][0]]
        values['Order Lines'][1].update(order_number='1001', quantity=20)
        values['Labels'][1]['order_number'] = '1001'
        state = self.state(values)
        document = build_order_documents('1001', resolve_fields(state, '1001', dict(acknowledge_matches=True)), state)
        self.assertEqual(document['errors'], [])
        mpl = document['packing_list']['packing_lists'][0]
        self.assertEqual(mpl['customer_no'], '1001')
        self.assertEqual(sum(int(row['qty_on_pallet']) for row in mpl['items']), 26)
        standard = calculate_pallet_plan(self.request, dict(mpl=mpl, product_master=document['packing_list']['product_master'], action='auto'))
        self.assertEqual(standard['mpl']['items'], mpl['items'])
        self.assertEqual(standard['mpl']['_pallet_weights'], mpl['_pallet_weights'])
        self.assertEqual(standard['mpl']['_pallet_ids'], mpl['_pallet_ids'])

    def test_directory_defaults_and_edited_sku_do_not_reuse_unrelated_product_data(self):
        state = self.state()
        state['directory'] = [dict(storefront='Generic B2B', dc='ORIGIN', record_type='SHIP_FROM', address='Origin\n100 Example Road', is_active=True)]
        state['entries']['1001']['input']['header']['ship_from'] = ''
        model = field_review(state, '1001')
        fields = {f['path']: f for section in model['sections'] for f in section['fields']}
        self.assertEqual(fields['header:ship_from']['source'], 'directory')
        changed = field_review(state, '1001', {'fields': {'line:0:sku': {'source': 'custom', 'value': 'OTHER-SKU'}}})
        changed_fields = {f['path']: f for section in changed['sections'] for f in section['fields']}
        self.assertEqual(changed_fields['line:0:case_gtin']['value'], '')
        self.assertEqual(changed_fields['line:0:length_in']['value'], '')
        self.assertTrue(any('not on' in notice for notice in changed['notices']))

    def test_blank_sku_is_repaired_only_by_a_unique_analytics_match_and_bad_edits_block(self):
        values = copy.deepcopy(self.values)
        values['Order Lines'][0].update(sku='', description='Known product')
        state = self.state(values)
        model = field_review(state, '1001')
        fields = {f['path']: f for section in model['sections'] for f in section['fields']}
        self.assertEqual(fields['line:0:sku']['value'], 'KNOWN-1LB')
        self.assertEqual(fields['line:0:sku']['source'], 'analytics')
        with self.assertRaisesRegex(ValueError, 'date'):
            resolve_fields(state, '1001', dict(acknowledge_matches=True, fields={
                'header:ship_date': {'source':'custom', 'value':'not-a-date'}}))
        with self.assertRaisesRegex(ValueError, 'no longer available'):
            resolve_fields(state, '0002', dict(acknowledge_matches=True, fields={
                'line:0:quantity': {'source':'analytics'}}))
        with self.assertRaisesRegex(ValueError, 'Ship To Address'):
            resolve_fields(state, '1001', dict(acknowledge_matches=True, fields={
                'header:ship_to': {'source':'custom','value':''}}))
        resolved = resolve_fields(state, '1001', dict(acknowledge_matches=True, fields={
            'label:0:line_id': {'source':'custom','value':'NOT-A-LINE'}}))
        self.assertEqual(resolved['labels'][0]['line_id'], 'NOT-A-LINE')
        self.assertTrue(build_order_documents('1001', resolved, state)['errors'])

    def test_description_only_item_uses_order_packaging_without_matching_or_changing_master(self):
        values = copy.deepcopy(self.values)
        values['Order Lines'][1]['sku'] = ''
        values['Order Lines'][1].update(quantity=25, pack_by='Units per box', pack_value=10, unit_lbs=1)
        values['Labels'][1]['sku'] = ''
        before = copy.deepcopy(self.products)
        state = self.state(values)
        review = field_review(state, '0002')
        section = next(section for section in review['sections'] if section['kind'] == 'line')
        self.assertEqual(section['product_match'], 'missing')
        self.assertEqual(next(field for field in section['fields'] if field['name'] == 'config_id')['value'], '')
        resolved = resolve_fields(state, '0002', dict(acknowledge_matches=True))
        doc = build_order_documents('0002', resolved, state)
        self.assertEqual(doc['errors'], [])
        self.assertEqual(doc['review']['lines'][0]['boxes'], 3)
        self.assertEqual(doc['pallet_count'], 1)
        self.assertEqual(doc['packing_list']['packing_lists'][0]['items'][0]['description'], 'Uploaded product')
        from pipelines.kehe_pipeline import render_kehe_master_packing_list_pdf
        with tempfile.TemporaryDirectory() as dest:
            pdf = Path(dest)/'order-only.pdf'
            render_kehe_master_packing_list_pdf(doc['packing_list'], str(pdf))
            with pymupdf.open(pdf) as rendered:
                self.assertIn('UPLOADED PRODUCT', rendered[0].get_text().upper())
        self.assertEqual(self.products, before)
        values['Order Lines'][1]['description'] = ''
        with self.assertRaisesRegex(ValueError, 'Description'):
            resolve_fields(self.state(values), '0002', dict(acknowledge_matches=True))

    def test_custom_partial_box_conserves_demand_and_gross_weight_and_missing_data_blocks(self):
        values = copy.deepcopy(self.values)
        line = values['Order Lines'][1]
        line.update(quantity=650, pack_by='Pounds per box', pack_value=30, unit_lbs=1, gross_weight_lbs=31)
        state = self.state(values)
        doc = build_order_documents('0002', resolve_fields(state, '0002', dict(acknowledge_matches=True)), state)
        self.assertEqual(doc['errors'], [])
        rows = doc['packing_list']['packing_lists'][0]['items']
        self.assertEqual(sum(float(row['qty_on_pallet']) for row in rows), 22)
        self.assertEqual(sum(float(row['qty_on_pallet'])*float(row['quantity_per_case']) for row in rows), 650)
        self.assertEqual(sorted({job['run']['net_weight'] for job in doc['jobs']}), ['20 lb', '30 lb'])
        self.assertEqual(box_groups(650, 'Total boxes', 28, 1)[0]['count'], 6)
        line.pop('length_in')
        with self.assertRaisesRegex(ValueError, 'Length'):
            state = self.state(values)
            build_order_documents('0002', resolve_fields(state, '0002', dict(acknowledge_matches=True)), state)

    def test_workbook_duplicate_order_and_missing_order_reference_are_reported(self):
        legacy = Path(__file__).parent / 'fixtures/order-workbook-legacy.xlsx'
        with patch('labelkit.order_workbook_io.TEMPLATE', legacy):
            parsed = read_order_workbook(self.make())
            self.assertEqual(parsed['1001']['lines'][0]['quantity'], '600')
            values = copy.deepcopy(self.values)
            values['Orders'].append(self.header)
            with self.assertRaisesRegex(ValueError, 'repeated'):
                read_order_workbook(self.make(values))
            values = copy.deepcopy(self.values)
            values['Order Lines'][0]['order_number'] = 'not-listed'
            with self.assertRaisesRegex(ValueError, 'missing from Orders'):
                read_order_workbook(self.make(values))

    def test_one_sheet_shared_order_details_and_extra_labels_do_not_duplicate_demand(self):
        values = copy.deepcopy(self.values)
        values['Orders'][0]['expected_delivery_date'] = '2026-11-12'
        values['Labels'][0]['expected_delivery_date'] = '2026-11-15'
        values['Labels'].append({**values['Labels'][0], 'level':'Each'})
        parsed = read_order_workbook(self.make(values))
        self.assertEqual(len(parsed['1001']['lines']), 1)
        self.assertEqual(parsed['1001']['lines'][0]['quantity'], '600')
        self.assertEqual(len(parsed['1001']['labels']), 2)
        self.assertEqual(parsed['1001']['header']['expected_delivery_date'], '2026-11-12')
        self.assertEqual(parsed['1001']['labels'][1]['expected_delivery_date'], '2026-11-15')
        rows = [dict(order_number='001', sku='A', quantity='10', po_number='PO-A', _row=5),
                dict(order_number='001', sku='B', quantity='20', _row=6)]
        expanded = expand_entry(rows)
        self.assertEqual(len(expanded['Orders']), 1)
        self.assertEqual(expanded['Orders'][0]['po_number'], 'PO-A')
        rows[1]['po_number'] = 'PO-B'
        with self.assertRaisesRegex(ValueError, 'Customer PO differs'):
            expand_entry(rows)

    def test_one_sheet_multiple_templates_and_same_sku_separate_lines(self):
        values = copy.deepcopy(self.values)
        values['Labels'][0]['template_id'] = 'STANDARD_CASE_PACK_4X6; PURPLE_PEARL_CASE_4X6'
        values['Order Lines'].append({**values['Order Lines'][0], 'line_id':'C', 'quantity':50})
        parsed = read_order_workbook(self.make(values))
        self.assertEqual(len(parsed['1001']['lines']), 2)
        self.assertEqual(sum(float(line['quantity']) for line in parsed['1001']['lines']), 650)
        self.assertEqual(len(parsed['1001']['labels']), 2)
        self.assertEqual(parsed['1001']['labels'][1]['template_id'], 'PURPLE_PEARL_CASE_4X6')

    def test_explicit_barcode_requires_valid_gtin_and_multiple_templates_preserve_levels(self):
        values = copy.deepcopy(self.values)
        values['Labels'][1]['print_barcode'] = 'Yes'
        state = self.state(values)
        doc = build_order_documents('0002', resolve_fields(state, '0002', dict(acknowledge_matches=True)), state)
        self.assertTrue(any('no valid GTIN' in error for error in doc['errors']))
        values = copy.deepcopy(self.values)
        values['Labels'].append({**values['Labels'][0], 'level': 'Each'})
        state = self.state(values)
        doc = build_order_documents('1001', resolve_fields(state, '1001', dict(acknowledge_matches=True, fields={'line:0:quantity': {'source': 'analytics'}})), state)
        self.assertEqual(doc['errors'], [])
        self.assertEqual([job['run']['carton_total'] for job in doc['jobs']], ['26', '650'])

    def test_api_checks_then_review_then_real_pdfs_in_zip_and_owner_is_enforced(self):
        raw = self.make()
        class Analytics:
            def export_order_rows(inner, request, order):
                return copy.deepcopy(self.analytics) if order == '1001' else []
        with patch('labelkit.order_workbook_jobs.reference_snapshot', return_value=self.refs), \
             patch('labelkit.order_workbook_jobs.ANALYTICS_CLIENT', Analytics()):
            response = asyncio.run(routes.check_order_upload(self.request, UploadFile(filename='orders.xlsx', file=io.BytesIO(raw))))
            check_id = json.loads(response.body)['result_id']
            report = self.poll(check_id)
            self.assertEqual(report['phase'], 'matching')
            with self.assertRaises(HTTPException) as error:
                routes.generate_order_upload(self.request, {'result_id': check_id})
            self.assertEqual(error.exception.status_code, 409)
            result = routes.resolve_order_upload(self.request, {'result_id': check_id, 'choices': {
                '1001': {'acknowledge_matches': True, 'fields': {'line:0:quantity': {'source': 'analytics'}}}, '0002': {'acknowledge_matches': True}}})
            review_id = json.loads(result.body)['result_id']
            review = self.poll(review_id)
            self.assertTrue(review['can_generate'], review)
            if review['warning_count']:
                with self.assertRaises(HTTPException):
                    routes.generate_order_upload(self.request, {'result_id': review_id})
            generated = routes.generate_order_upload(self.request, {'result_id': review_id, 'approve_warnings': True})
            final_id = json.loads(generated.body)['result_id']
            final = self.poll(final_id)
            self.assertEqual(final['generated'], 2, final)
            self.assertEqual(final['failed'], 0)
            with patch('labelkit.routes.generation._request_actor', return_value={'user_id': 'different-account'}):
                with self.assertRaises(HTTPException) as error:
                    generation.get_result_status(self.request, final_id)
                self.assertEqual(error.exception.status_code, 404)
            download = generation.get_result_file(self.request, final_id)
            with zipfile.ZipFile(download.path) as archive:
                self.assertEqual(archive.read('Source_Order_Workbook.xlsx'), raw)
                for folder, labels in [('SO_1001', 26), ('SO_0002', 2)]:
                    for name in ['Labels.pdf', 'Packing_List_and_TiHi.pdf', 'Pallet_Labels.pdf']:
                        pdf = pymupdf.open(stream=archive.read(f'{folder}/{name}'), filetype='pdf')
                        self.assertGreater(pdf.page_count, 0)
                        if name == 'Labels.pdf':
                            self.assertEqual(pdf.page_count, labels)
                        if name == 'Packing_List_and_TiHi.pdf':
                            self.assertIn('APPROVED', pdf[0].get_text())
                        if name == 'Pallet_Labels.pdf':
                            self.assertIn('CUSTOMER PO#S ON THIS PALLET:', pdf[0].get_text())
                        pdf.close()
                self.assertIn('Processing_Report.csv', archive.namelist())
                reviewed = read_order_workbook(archive.read('Reviewed_Order_Inputs.xlsx'))
                self.assertEqual(reviewed['1001']['lines'][0]['quantity'], '650')

    def test_skip_and_per_order_render_failure_never_publish_incomplete_order_files(self):
        state = self.state()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root/'source.xlsx'
            source.write_bytes(self.make())
            state['input_path'] = str(source)
            review_id = create_result_job(root, 'order_excel_review')
            resolve_worker(review_id, state, {'1001': {'skip':True}, '0002': {'acknowledge_matches':True}})
            self.assertEqual(RESULT_JOBS[review_id]['order_workbook_prepared']['skipped'], ['1001'])
            self.assertTrue(RESULT_JOBS[review_id]['report']['can_generate'])
            resolve_worker(review_id, state, {order: {'acknowledge_matches':True} for order in state['entries']})
            prepared = RESULT_JOBS[review_id]['order_workbook_prepared']
            from labelkit.order_workbook_jobs import render_kehe_master_packing_list_pdf as render
            def fail_first(draft, path):
                if draft['packing_lists'][0]['order_no'] == '1001':
                    raise ValueError('Injected packing-list render failure')
                return render(draft, path)
            with patch('labelkit.order_workbook_jobs.render_kehe_master_packing_list_pdf', side_effect=fail_first):
                generate_worker(review_id, prepared)
            report = RESULT_JOBS[review_id]['report']
            self.assertEqual((report['generated'],report['failed']), (1,1))
            with zipfile.ZipFile(RESULT_JOBS[review_id]['output_path']) as archive:
                self.assertFalse(any(name.startswith('SO_1001/') for name in archive.namelist()))
                self.assertIn('SO_0002/Labels.pdf', archive.namelist())
                self.assertIn('Injected packing-list render failure', archive.read('Processing_Report.json').decode())


if __name__ == '__main__':
    unittest.main()
