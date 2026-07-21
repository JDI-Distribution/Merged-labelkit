import unittest

from server import (
    _analytics_order_instance_groups,
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
