import unittest
from unittest.mock import patch

from pipelines.kehe.common import (
    _apply_product_row_to_item,
    _default_copies,
    _is_kehe_pack_label_eligible,
    _mpl_build_tihi_entries,
    _normalize_product_master_rows,
)
from pipelines.kehe.pack_labels import _label_weight_lbs
from server import (
    _canonicalize_import_rows,
    _datastore_save_product_rows,
    _product_to_datastore_row,
    normalize_product_master_row,
)


REMOVED_COLUMNS = {"LABEL_REQUIRED", "DIMENSIONS_IN", "WEIGHT_LBS", "LABELS_PER_UNIT"}
REMOVED_KEYS = {"label_required", "dimensions_in", "weight_lbs", "labels_per_unit"}


class ProductMasterMigrationTests(unittest.TestCase):
    def test_updated_input_template_is_importable_and_skips_usage_row(self):
        rows = _canonicalize_import_rows([
            {
                "Storefront / Customer": "USAGE GUIDE — not imported",
                "Ecomdash SKU": "Matches order lines to Product Master.",
            },
            {
                "Storefront / Customer": "KeHE",
                "Ecomdash SKU": "TW-EXAMPLE",
                "Product Description": "Example Case Product",
                "Packaging Level": "Case",
                "Width/Breadth (in)": 12,
                "Each Net Weight": 4,
                "Each Weight Unit": "oz",
                "Packaging/Tare Weight": 0.5,
                "Packaging Weight Unit": "lb",
                "Eaches / Package": 6,
                "Active": True,
            },
        ], "mpl_product_master")

        self.assertEqual(1, len(rows))
        row = rows[0]
        self.assertEqual("KeHE", row["storefront"])
        self.assertEqual("TW-EXAMPLE", row["sku"])
        self.assertEqual("Example Case Product", row["description"])
        self.assertEqual("12", row["width_in"])
        self.assertAlmostEqual(113.3980925, float(row["each_net_weight_g"]), places=6)
        self.assertAlmostEqual(680.388555, float(row["package_net_weight_g"]), places=6)
        self.assertAlmostEqual(2.0, float(row["gross_weight_lbs"]), places=6)
        self.assertTrue(row["is_active"])

    def test_hierarchical_template_headings_import_final_product_weights(self):
        rows = _canonicalize_import_rows([{
            "Customer / Storefront": "KeHE",
            "Config ID": "TW-CRS109-4OZ",
            "SKU": "TW-CRS109-4OZ",
            "Product Description": "Gold Brew Glitter",
            "Product Status": "VERIFIED",
            "Packaging Level": "Case",
            "GTIN": "40850068684654",
            "Eaches Contained": 36,
            "Each Weight (g)": 113,
            "Total Product Weight (g)": 4068,
            "Total Weight with Packaging (lb)": 10,
            "Final Length (in)": 18,
            "Final Width/Breadth (in)": 12,
            "Final Height (in)": 8,
            "Level Active": True,
        }], "mpl_product_master")

        self.assertEqual(1, len(rows))
        row = rows[0]
        self.assertEqual("TW-CRS109-4OZ", row["config_id"])
        self.assertEqual("Case", row["packaging_level"])
        self.assertEqual("36", row["case_qty"])
        self.assertEqual("113", row["each_net_weight_g"])
        self.assertEqual("4068", row["package_net_weight_g"])
        self.assertEqual("10", row["gross_weight_lbs"])
        self.assertEqual(("18", "12", "8"), (row["length_in"], row["width_in"], row["height_in"]))
        self.assertEqual("VERIFIED", row["verification_status"])
        self.assertTrue(row["is_active"])

    def test_only_each_level_receives_an_inherent_quantity(self):
        each = normalize_product_master_row({"packaging_level": "Each", "sku": "A"})
        inner = normalize_product_master_row({"packaging_level": "Inner Pack", "sku": "A"})
        case = normalize_product_master_row({"packaging_level": "Case", "sku": "A"})
        self.assertEqual("1", each["case_qty"])
        self.assertEqual("", inner["case_qty"])
        self.assertEqual("", case["case_qty"])

        pipeline_rows = _normalize_product_master_rows([
            {"packaging_level": "Each", "sku": "A"},
            {"packaging_level": "Inner Pack", "sku": "A"},
            {"packaging_level": "Case", "sku": "A"},
        ])
        self.assertEqual(["1", "", ""], [row["case_qty"] for row in pipeline_rows])

    def test_legacy_values_convert_without_round_trip_fields(self):
        row = normalize_product_master_row({
            "STOREFRONT": "KeHE",
            "SKU": "ABC",
            "PACKAGING_LEVEL": "Case",
            "DIMENSIONS_IN": "18(l) X 12(w) X 8(h)",
            "WEIGHT_LBS": "16",
            "LABELS_PER_UNIT": "3",
            "LABEL_REQUIRED": "1",
            "IS_ACTIVE": True,
        })

        self.assertEqual(("18", "12", "8"), (row["length_in"], row["width_in"], row["height_in"]))
        self.assertEqual("16", row["gross_weight_lbs"])
        self.assertEqual("3", row["default_copies"])
        self.assertTrue(row["in_packing_list"])
        self.assertFalse(REMOVED_KEYS.intersection(row))

        datastore_row = _product_to_datastore_row(row, include_storefront=True)
        self.assertFalse(REMOVED_COLUMNS.intersection(datastore_row))

    def test_packing_list_inclusion_is_active_case_only(self):
        active_case = normalize_product_master_row({"packaging_level": "Case", "is_active": True, "sku": "A"})
        inactive_case = normalize_product_master_row({"packaging_level": "Case", "is_active": False, "sku": "B"})
        active_inner = normalize_product_master_row({"packaging_level": "Inner Pack", "is_active": True, "sku": "C"})
        self.assertTrue(active_case["in_packing_list"])
        self.assertFalse(inactive_case["in_packing_list"])
        self.assertFalse(active_inner["in_packing_list"])

    def test_kehe_inner_pack_eligibility_and_copy_fallbacks(self):
        inner = {"packaging_level": "Inner Pack", "gtin": "10850068684684", "is_active": True, "default_copies": ""}
        case = {"packaging_level": "Case", "gtin": "20850068684681", "is_active": True, "default_copies": "4"}
        disabled = {**case, "is_active": False}
        self.assertTrue(_is_kehe_pack_label_eligible(inner))
        self.assertEqual(6, _default_copies(inner))
        self.assertEqual(4, _default_copies(case))
        self.assertFalse(_is_kehe_pack_label_eligible(disabled))

    def test_kehe_inner_pack_weight_is_derived_from_each_weight_and_quantity(self):
        case = {"packaging_level": "Case", "each_net_weight_g": "113", "gross_weight_lbs": "10"}
        inner = {"packaging_level": "Inner Pack", "case_qty": "6"}
        self.assertAlmostEqual((113 * 6) / 453.59237, float(_label_weight_lbs(inner, case)), places=3)
        self.assertEqual("10", _label_weight_lbs(case, case))

    def test_mpl_weight_comes_from_gross_weight(self):
        item = {"qty_on_pallet": "2"}
        product = {
            "packaging_level": "Case",
            "length_in": "12",
            "width_in": "8",
            "height_in": "6",
            "gross_weight_lbs": "4.5",
        }
        _apply_product_row_to_item(item, product)
        self.assertEqual("4.5", item["unit_weight_lbs"])
        self.assertEqual("9 lbs", item["calculated_weight_lbs"])
        self.assertEqual(("12", "8", "6"), (item["length_in"], item["width_in"], item["height_in"]))

    def test_tihi_requires_numeric_dimensions(self):
        valid_item = {
            "location_on_pallet": "1",
            "qty_on_pallet": "2",
            "sku": "ABC",
            "length_in": "12",
            "width_in": "8",
            "height_in": "6",
            "unit_weight_lbs": "4.5",
        }
        entries, warnings = _mpl_build_tihi_entries({}, [valid_item])
        self.assertTrue(entries)
        self.assertFalse(warnings)

        legacy_only = {
            "location_on_pallet": "1",
            "qty_on_pallet": "2",
            "sku": "ABC",
            "dimensions_in": "12 x 8 x 6",
            "unit_weight_lbs": "4.5",
        }
        entries, warnings = _mpl_build_tihi_entries({}, [legacy_only])
        self.assertFalse(entries)
        self.assertTrue(any("missing Case dimensions" in warning for warning in warnings))

    def test_normalized_product_master_keeps_blank_default_copies(self):
        rows = _normalize_product_master_rows([{
            "storefront": "DecoPac",
            "config_id": "DECOPAC-1-CASE",
            "packaging_level": "Case",
            "gtin": "123",
            "default_copies": "",
            "is_active": True,
        }])
        self.assertEqual("", rows[0]["default_copies"])


class _FakeTable:
    def __init__(self, rows):
        self.rows = rows
        self.updated = []
        self.inserted = []
        self.deleted = []

    def get_paged_rows(self, *args, **kwargs):
        return {"content": self.rows, "more_records": False}

    def update_rows(self, rows):
        self.updated.extend(rows)

    def insert_rows(self, rows):
        self.inserted.extend(rows)

    def delete_rows(self, row_ids):
        self.deleted.extend(row_ids)


class ProductMasterDatastoreWriteTests(unittest.TestCase):
    def test_existing_row_is_updated_without_table_clear(self):
        table = _FakeTable([{
            "ROWID": "101",
            "STOREFRONT": "KeHE",
            "PACKAGING_LEVEL": "Case",
            "SKU": "ABC",
            "GTIN": "123",
            "IS_ACTIVE": True,
        }])
        wanted = [{
            "storefront": "KeHE",
            "packaging_level": "Case",
            "sku": "ABC",
            "gtin": "123",
            "length_in": "12",
            "width_in": "8",
            "height_in": "6",
            "gross_weight_lbs": "4.5",
            "is_active": True,
        }]
        with patch("server._product_datastore_table", return_value=table):
            _datastore_save_product_rows(object(), wanted, "mpl_product_master", "datastore", include_storefront=True)

        self.assertEqual(1, len(table.updated))
        self.assertEqual("101", table.updated[0]["ROWID"])
        self.assertFalse(table.inserted)
        self.assertFalse(table.deleted)
        self.assertFalse(REMOVED_COLUMNS.intersection(table.updated[0]))


if __name__ == "__main__":
    unittest.main()
