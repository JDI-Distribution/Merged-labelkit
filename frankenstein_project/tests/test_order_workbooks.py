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
from labelkit.order_workbook_documents import box_groups, build_order_documents
from labelkit.order_workbook_io import read_order_workbook, workbook_bytes
from labelkit.order_workbook_match import check_orders, resolve_source
from labelkit.reference_data import normalize_product_master_row
from labelkit.routes import order_workbooks as routes, generation


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
        self.assertEqual(book.sheetnames[:3], ['Orders', 'Order Lines', 'Labels'])
        self.assertGreaterEqual(len(book['Orders'].data_validations.dataValidation), 8)
        self.assertIn('LK_templates', book.defined_names)
        self.assertIn('LK_skus', book.defined_names)
        self.assertEqual(book['Orders']['A3'].value, '0002')
        self.assertIsInstance(book['Order Lines']['D2'].value, (int, float))
        self.assertEqual(book['Orders']['E2'].value.strftime('%Y-%m-%d'), '2026-11-11')
        book.close()
        orders = read_order_workbook(raw)
        self.assertEqual(orders['0002']['header']['po_number'], 'PO001')
        self.assertEqual(orders['1001']['lines'][0]['quantity'], '600')

    def test_no_implicit_conflict_resolution_and_analytics_vs_workbook_quantities(self):
        state = self.state()
        entry = state['entries']['1001']
        self.assertTrue(any('quantity' in row['field'] for row in entry['differences']))
        for source in ('', 'auto'):
            with self.assertRaises(ValueError):
                resolve_source(entry, dict(source=source))
        for source, expected in [('analytics', 26), ('workbook', 24)]:
            resolved = resolve_source(entry, dict(source=source))
            doc = build_order_documents('1001', resolved, state)
            self.assertEqual(doc['errors'], [])
            mpl = doc['packing_list']['packing_lists'][0]
            self.assertEqual(sum(float(row['qty_on_pallet']) for row in mpl['items']), expected)
            self.assertEqual(doc['jobs'][0]['run']['carton_total'], str(expected))

    def test_missing_order_requires_workbook_or_skip_and_ambiguous_records_require_id(self):
        state = self.state()
        missing = state['entries']['0002']
        with self.assertRaises(ValueError):
            resolve_source(missing, dict(source='analytics'))
        self.assertIsNone(resolve_source(missing, dict(source='skip')))
        duplicate = copy.deepcopy(state['entries']['1001'])
        duplicate['records'].append({**copy.deepcopy(duplicate['records'][0]), 'ecomdash_id': 'REC-OTHER'})
        with self.assertRaises(ValueError):
            resolve_source(duplicate, dict(source='analytics'))
        self.assertEqual(resolve_source(duplicate, dict(source='analytics', record_id='REC-OTHER'))['record_id'], 'REC-OTHER')

    def test_custom_partial_box_conserves_demand_and_gross_weight_and_missing_data_blocks(self):
        values = copy.deepcopy(self.values)
        line = values['Order Lines'][1]
        line.update(quantity=650, pack_by='Pounds per box', pack_value=30, unit_lbs=1, gross_weight_lbs=31)
        state = self.state(values)
        doc = build_order_documents('0002', resolve_source(state['entries']['0002'], dict(source='workbook')), state)
        self.assertEqual(doc['errors'], [])
        rows = doc['packing_list']['packing_lists'][0]['items']
        self.assertEqual(sum(float(row['qty_on_pallet']) for row in rows), 22)
        self.assertEqual(sum(float(row['qty_on_pallet'])*float(row['quantity_per_case']) for row in rows), 650)
        self.assertEqual(sorted({job['run']['net_weight'] for job in doc['jobs']}), ['20 lb', '30 lb'])
        self.assertEqual(box_groups(650, 'Total boxes', 28, 1)[0]['count'], 6)
        line.pop('length_in')
        with self.assertRaisesRegex(ValueError, 'length'):
            state = self.state(values)
            build_order_documents('0002', resolve_source(state['entries']['0002'], dict(source='workbook')), state)

    def test_workbook_duplicate_order_and_missing_order_reference_are_reported(self):
        values = copy.deepcopy(self.values)
        values['Orders'].append(self.header)
        with self.assertRaisesRegex(ValueError, 'repeated'):
            read_order_workbook(self.make(values))
        values = copy.deepcopy(self.values)
        values['Order Lines'][0]['order_number'] = 'not-listed'
        with self.assertRaisesRegex(ValueError, 'missing from Orders'):
            read_order_workbook(self.make(values))

    def test_explicit_barcode_requires_valid_gtin_and_multiple_templates_preserve_levels(self):
        values = copy.deepcopy(self.values)
        values['Labels'][1]['print_barcode'] = 'Yes'
        state = self.state(values)
        doc = build_order_documents('0002', resolve_source(state['entries']['0002'], dict(source='workbook')), state)
        self.assertTrue(any('no valid GTIN' in error for error in doc['errors']))
        values = copy.deepcopy(self.values)
        values['Labels'].append({**values['Labels'][0], 'level': 'Each'})
        state = self.state(values)
        doc = build_order_documents('1001', resolve_source(state['entries']['1001'], dict(source='analytics')), state)
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
                '1001': {'source': 'analytics'}, '0002': {'source': 'workbook'}}})
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
                        pdf.close()
                self.assertIn('Processing_Report.csv', archive.namelist())


if __name__ == '__main__':
    unittest.main()
