import copy
import unittest
from unittest.mock import patch

from labelkit.document_rules import document_readiness, pallet_plan
from labelkit.product_quality import analyze_product_master_rows
from labelkit.routes.generation import _refresh_mpl_render_product_master


class DocumentRulesTests(unittest.TestCase):
    def setUp(self):
        self.products = [dict(sku='CASE', gtin='10850079841588', description='Crown', packaging_level='Case',
                              storefront='Dutch Bros', config_id='A', case_qty='12', length_in='8', width_in='5',
                              height_in='5', gross_weight_lbs='10', in_packing_list=True, is_active=True)]
        self.mpl = dict(items=[dict(sku='CASE', case_upc='10850079841588', description='Reviewed description',
                                   qty_on_pallet='200', total_ordered='200', total_shipped='200', location_on_pallet='1')],
                        _tihi_constraints=dict(cases_per_layer=36, max_layers=2))

    def test_auto_plan_preserves_demand_respects_limits_and_includes_base_height(self):
        original = copy.deepcopy(self.mpl)
        plan = pallet_plan(self.mpl, self.products, 'auto')
        self.assertEqual(self.mpl, original)
        self.assertEqual(sum(int(row['total_ordered']) for row in plan['mpl']['items']), 200)
        self.assertEqual(sum(int(row['qty_on_pallet']) for row in plan['mpl']['items']), 200)
        self.assertGreater(len(plan['entries']), 1)
        for entry in plan['entries']:
            self.assertEqual(entry['ti'], 36)
            self.assertLessEqual(entry['hi'], 2)
            self.assertEqual(entry['overflow_cases'], 0)
            self.assertLessEqual(entry['gross_weight_lbs'], 2000)
            self.assertEqual(entry['loaded_height'], entry['used_height'] + 6)

    def test_missing_measurements_stay_unassigned_and_manual_weight_is_preserved(self):
        products = [dict(self.products[0], height_in='')]
        plan = pallet_plan(self.mpl, products, 'auto')
        self.assertEqual(plan['mpl']['_pallet_ids'], [])
        self.assertEqual(plan['mpl']['items'][0]['location_on_pallet'], '')
        self.assertTrue(plan['mpl']['warnings'])
        mpl = dict(self.mpl, _pallet_weights={'1': '2200 lbs'})
        self.assertEqual(pallet_plan(mpl, self.products)['mpl']['_pallet_weights']['1'], '2200 lbs')

    def test_backend_rechecks_saved_geometry_and_uses_reviewed_master_snapshot(self):
        draft = dict(reviewed_product_master=self.products, packing_lists=[dict(self.mpl, _tihi_snapshot={
            'source_signature': 'obsolete', 'entries': [{'pallet_label': '1', 'image_data_url': 'untrusted image', 'ti': 999}]} )])
        with patch('labelkit.routes.generation._datastore_load_product_master', side_effect=AssertionError('Should use reviewed data')):
            rendered = _refresh_mpl_render_product_master(None, draft)
        entry = rendered['packing_lists'][0]['_tihi_snapshot']['entries'][0]
        self.assertEqual(entry['ti'], 36)
        self.assertEqual(entry['image_data_url'], '')
        self.assertEqual(draft['packing_lists'][0]['_tihi_snapshot']['entries'][0]['ti'], 999)

    def test_one_backend_validator_serves_quality_and_document_readiness(self):
        result = analyze_product_master_rows([dict(self.products[0], gtin='10850079841589')])
        self.assertIn('invalid_gtin', [issue['code'] for issue in result['rows'][0]['issues']])
        self.assertIn('product_weight', result['groups'][0]['criteria'])
        self.assertIn('tihi', result['groups'][0]['capabilities'])
        result = document_readiness('packLabels', {'pack_labels': [{'gtin': '10850079841589', 'case_qty': '12', 'gross_weight_lbs': '10'}]})
        self.assertFalse(result['ready'])
        self.assertEqual(result['issues'][0]['category'], 'barcode')
        result = document_readiness('labels', {'jobs': [{'template_id': 'A', 'product': {'sku': 'CASE'}, 'run': {}}]},
                                    [{'template_id': 'A', 'required_run_fields': ['po_number']}])
        self.assertFalse(result['ready'])
        self.assertIn('po number', result['issues'][0]['message'])


if __name__ == '__main__':
    unittest.main()
