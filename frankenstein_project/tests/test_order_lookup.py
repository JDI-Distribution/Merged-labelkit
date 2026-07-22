import unittest

from server import (
    _analytics_order_instance_groups,
    _analytics_kehe_case_conversion,
    _datastore_row_to_mpl_draft,
    _mpl_draft_for_storage,
    _mpl_draft_to_datastore_row,
)


class AnalyticsOrderInstanceTests(unittest.TestCase):
    def test_reused_order_number_is_split_by_ecomdash_id(self):
        rows = [
            {
                "Sales Order Number": "39830",
                "Ecomdash ID": "102971428",
                "Invoice Date": "26 May 2026 11:23:13",
                "Storefront": "BrewGlitter.com",
                "Billing Customer Name": "KeHE Distributors, LLC",
                "SKUNumber": "TW-BRS205-4OZ",
            },
            {
                "Sales Order Number": "39830",
                "Ecomdash ID": "102971428",
                "Invoice Date": "26 May 2026 11:23:13",
                "Storefront": "BrewGlitter.com",
                "Billing Customer Name": "KeHE Distributors, LLC",
                "SKUNumber": "SECOND-SKU",
            },
            {
                "Sales Order Number": "39830",
                "Ecomdash ID": "84704273",
                "Invoice Date": "05 Mar 2023 12:24:43",
                "Storefront": "BAKELL.COM",
                "Billing Customer Name": "Dawn Smith",
                "SKUNumber": "CCW367",
            },
        ]

        instances = _analytics_order_instance_groups(rows)

        self.assertEqual(2, len(instances))
        self.assertEqual("102971428", instances[0]["ecomdash_id"])
        self.assertEqual(2, instances[0]["sku_count"])
        self.assertEqual(2, len(instances[0]["rows"]))
        self.assertEqual("84704273", instances[1]["ecomdash_id"])

    def test_kehe_eaches_convert_to_cases_using_product_case_pack(self):
        conversion = _analytics_kehe_case_conversion(684, {
            "storefront": "KeHE",
            "case_qty": "36",
        })

        self.assertIsNotNone(conversion)
        self.assertEqual(684, conversion["quantity_ordered_eaches"])
        self.assertEqual(19, conversion["quantity_ordered_cases"])
        self.assertEqual(19, conversion["quantity_ordered"])
        self.assertTrue(conversion["case_conversion_exact"])
        self.assertEqual(0, conversion["case_conversion_remainder_eaches"])

    def test_partial_kehe_case_rounds_up_and_records_remainder(self):
        conversion = _analytics_kehe_case_conversion(685, {
            "storefront": "KeHE",
            "case_qty": "36",
        })

        self.assertEqual(20, conversion["quantity_ordered_cases"])
        self.assertFalse(conversion["case_conversion_exact"])
        self.assertEqual(1, conversion["case_conversion_remainder_eaches"])

    def test_kehe_uses_six_by_six_default_when_case_pack_is_not_configured(self):
        conversion = _analytics_kehe_case_conversion(72, {
            "storefront": "KeHE",
            "case_qty": "1",
        })

        self.assertEqual(2, conversion["quantity_ordered_cases"])
        self.assertEqual(36, conversion["eaches_per_case"])
        self.assertEqual(6, conversion["eaches_per_inner_pack"])
        self.assertEqual(6, conversion["inner_packs_per_case"])
        self.assertEqual("kehe_default", conversion["case_pack_source"])

    def test_non_kehe_quantity_is_not_converted(self):
        conversion = _analytics_kehe_case_conversion(684, {
            "storefront": "BAKELL.COM",
            "case_qty": "36",
        })

        self.assertIsNone(conversion)


class MplDraftStorageTests(unittest.TestCase):
    def test_storage_copy_keeps_mpl_and_removes_regenerable_bulk_data(self):
        draft = {
            "product_master": [{"sku": "TW-BRS205-4OZ"}],
            "packing_lists": [{
                "customer_po_number": "39830",
                "items": [{"sku": "TW-BRS205-4OZ", "qty_on_pallet": "64"}],
                "_tihi_snapshot": {
                    "sheet_image_data_url": "data:image/png;base64,large",
                },
            }],
        }

        stored = _mpl_draft_for_storage(draft)

        self.assertNotIn("product_master", stored)
        self.assertNotIn("_tihi_snapshot", stored["packing_lists"][0])
        self.assertEqual("39830", stored["packing_lists"][0]["customer_po_number"])
        self.assertEqual("TW-BRS205-4OZ", stored["packing_lists"][0]["items"][0]["sku"])

    def test_datastore_draft_is_compressed_and_round_trips(self):
        draft = {
            "packing_lists": [{
                "customer_po_number": "39830",
                "items": [
                    {"sku": "TW-BRS205-4OZ", "qty_on_pallet": "64"}
                    for _ in range(11)
                ],
            }],
        }
        record = {"id": "draft-39830", "name": "39830", "draft": draft}

        row = _mpl_draft_to_datastore_row(record)
        restored = _datastore_row_to_mpl_draft(row)

        self.assertTrue(row["DRAFT_JSON"].startswith("zlib:"))
        self.assertEqual(draft, restored["draft"])


if __name__ == "__main__":
    unittest.main()
