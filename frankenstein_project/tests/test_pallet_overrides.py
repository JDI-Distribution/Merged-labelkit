import unittest

from pipelines.kehe.tihi_layout import _mpl_build_tihi_entries, _mpl_tihi_constraints
from pipelines.kehe.mpl_renderer import _mpl_order_balance_cases, _mpl_prepare_items


class PalletOverrideTests(unittest.TestCase):
    def item(self, quantity=9):
        return dict(line=1, location_on_pallet="1", sku="CASE", qty_on_pallet=str(quantity),
                    total_ordered=str(quantity), total_shipped=str(quantity),
                    length_in="12", width_in="10", height_in="5", unit_weight_lbs="1")

    def test_override_changes_layout_and_loaded_height(self):
        mpl = {"_tihi_constraints": {"cases_per_layer": 4}}
        entries, warnings = _mpl_build_tihi_entries(mpl, [self.item()])
        entry = entries[0]
        self.assertEqual(warnings, [])
        self.assertEqual((entry["ti"], entry["hi"]), (4, 3))
        self.assertEqual(entry["loaded_height"], 21)
        self.assertEqual(entry["shown_cases"], 9)
        self.assertLessEqual(max(sum(p["layer_index"] == i for p in entry["placements"]) for i in range(3)), 4)

    def test_optional_hi_limit_reports_overflow(self):
        mpl = {"_tihi_constraints": {"cases_per_layer": 4, "max_layers": 2}}
        entries, warnings = _mpl_build_tihi_entries(mpl, [self.item()])
        self.assertEqual(entries[0]["overflow_cases"], 1)
        self.assertEqual(entries[0]["hi"], 2)
        self.assertTrue(warnings)

    def test_defaults_remain_automatic_and_override_is_per_pallet(self):
        self.assertEqual(_mpl_tihi_constraints()["cases_per_layer"], 0)
        entries, _ = _mpl_build_tihi_entries({}, [self.item()])
        self.assertEqual(entries[0]["hi"], 1)
        mpl = {"_tihi_constraints": {"cases_per_layer": 4},
               "_tihi_pallet_constraints": {"2": {"cases_per_layer": 3}}}
        self.assertEqual(_mpl_tihi_constraints(mpl, "1")["cases_per_layer"], 4)
        self.assertEqual(_mpl_tihi_constraints(mpl, "2")["cases_per_layer"], 3)

    def test_order_balance_aggregates_split_sku_without_offsetting_other_skus(self):
        items = [dict(sku="A", total_ordered="10", total_shipped="6"),
                 dict(sku="A", total_ordered="0", total_shipped="3"),
                 dict(sku="B", total_ordered="1", total_shipped="2")]
        self.assertEqual(_mpl_order_balance_cases(items), 1)
        self.assertEqual(_mpl_order_balance_cases([self.item()]), 0)
        mpl = {"items": [dict(self.item(), total_shipped=0)]}
        self.assertEqual(_mpl_order_balance_cases(_mpl_prepare_items(mpl)), 9)


if __name__ == '__main__':
    unittest.main()
