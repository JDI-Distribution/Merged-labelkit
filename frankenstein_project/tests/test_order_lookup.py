import unittest
from unittest.mock import patch

from server import (
    _analytics_order_instance_groups,
    _analytics_kehe_case_conversion,
    _hydrate_saved_mpl_record,
    _product_each_gtin,
    _datastore_row_to_mpl_draft,
    _mpl_draft_for_storage,
    _mpl_draft_to_datastore_row,
    _refresh_mpl_render_product_master,
    normalize_product_master_row,
    serve_frontend_index,
)
from pipelines.kehe.common import (
    _validate_mpl_each_item_numbers,
    apply_product_master_to_mpl_draft,
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
            "sku": "TW-BRS205-4OZ",
        }, [{
            "storefront": "KeHE",
            "packaging_level": "Inner Pack",
            "case_qty": "6",
            "sku": "TW-BRS205-4OZ",
        }])

        self.assertIsNotNone(conversion)
        self.assertEqual(684, conversion["quantity_ordered_eaches"])
        self.assertEqual(19, conversion["quantity_ordered_cases"])
        self.assertEqual(19, conversion["quantity_ordered"])
        self.assertEqual(6, conversion["eaches_per_inner_pack"])
        self.assertEqual(6, conversion["inner_packs_per_case"])
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

    def test_kehe_does_not_guess_when_case_pack_is_not_configured(self):
        conversion = _analytics_kehe_case_conversion(72, {
            "storefront": "KeHE",
            "case_qty": "1",
        })

        self.assertIsNone(conversion)

    def test_missing_package_quantity_stays_blank(self):
        row = normalize_product_master_row({
            "storefront": "KeHE",
            "packaging_level": "Case",
            "sku": "TW-BRS205-4OZ",
        })

        self.assertEqual("", row["case_qty"])

    def test_non_kehe_quantity_is_not_converted(self):
        conversion = _analytics_kehe_case_conversion(684, {
            "storefront": "BAKELL.COM",
            "case_qty": "36",
        })

        self.assertIsNone(conversion)

    def test_mpl_item_number_uses_each_gtin_from_same_product_group(self):
        case_product = {
            "storefront": "KeHE",
            "packaging_level": "Case",
            "gtin": "20850068684780",
            "sku": "TW-BRS205-4OZ",
        }
        each_gtin = _product_each_gtin(case_product, [
            case_product,
            {
                "storefront": "KeHE",
                "packaging_level": "Each",
                "gtin": "850068684786",
                "sku": "TW-BRS205-4OZ",
            },
            {
                "storefront": "Other Store",
                "packaging_level": "Each",
                "gtin": "999999999999",
                "sku": "TW-BRS205-4OZ",
            },
        ])

        self.assertEqual("850068684786", each_gtin)


class KeheMplItemNumberTests(unittest.TestCase):
    def test_xml_mpl_enrichment_uses_each_gtin_for_item_number(self):
        draft = {
            "product_master": [
                {
                    "storefront": "KeHE",
                    "in_packing_list": True,
                    "packaging_level": "Case",
                    "gtin": "20850068684780",
                    "sku": "TW-BRS205-4OZ",
                    "weight_lbs": "16",
                },
                {
                    "storefront": "KeHE",
                    "packaging_level": "Each",
                    "gtin": "850068684786",
                    "sku": "TW-BRS205-4OZ",
                },
            ],
            "packing_lists": [{
                "status": "Ready",
                "warnings": [],
                "items": [{
                    "item_number": "TW-BRS205-4OZ",
                    "sku": "TW-BRS205-4OZ",
                    "gtin": "20850068684780",
                    "qty_on_pallet": "1",
                    "location_on_pallet": "1",
                }],
            }],
        }

        apply_product_master_to_mpl_draft(draft, force=True)

        item = draft["packing_lists"][0]["items"][0]
        self.assertEqual("850068684786", item["item_number"])
        self.assertEqual("850068684786", item["each_gtin"])
        self.assertEqual("20850068684780", item["gtin"])
        self.assertEqual("20850068684780", item["case_upc"])

    def test_missing_each_gtin_is_flagged_instead_of_using_case_or_sku(self):
        draft = {
            "product_master": [{
                "storefront": "KeHE",
                "in_packing_list": True,
                "packaging_level": "Case",
                "gtin": "20850068684780",
                "sku": "TW-BRS205-4OZ",
            }],
            "packing_lists": [{
                "status": "Ready",
                "warnings": [],
                "items": [{
                    "item_number": "TW-BRS205-4OZ",
                    "sku": "TW-BRS205-4OZ",
                    "gtin": "20850068684780",
                    "qty_on_pallet": "1",
                }],
            }],
        }

        apply_product_master_to_mpl_draft(draft, force=True)

        mpl = draft["packing_lists"][0]
        self.assertEqual("", mpl["items"][0]["item_number"])
        self.assertEqual("Needs Review", mpl["status"])
        self.assertIn("Each row with a GTIN is required", mpl["warnings"][0])

        with self.assertRaisesRegex(ValueError, "Item Number must be the Product Master Each GTIN"):
            _validate_mpl_each_item_numbers(draft)

    def test_unmatched_xml_item_is_not_allowed_to_keep_unverified_upc(self):
        draft = {
            "product_master": [],
            "packing_lists": [{
                "status": "Ready",
                "warnings": [],
                "items": [{
                    "item_number": "20850068684780",
                    "upc": "20850068684780",
                    "sku": "UNKNOWN-SKU",
                }],
            }],
        }

        apply_product_master_to_mpl_draft(draft)

        mpl = draft["packing_lists"][0]
        self.assertEqual("", mpl["items"][0]["item_number"])
        self.assertIn("enabled Product Master Case row", mpl["warnings"][0])

    def test_mpl_render_refreshes_stale_draft_from_authoritative_product_master(self):
        stale_draft = {
            "product_master": [{
                "storefront": "KeHE",
                "in_packing_list": True,
                "packaging_level": "Case",
                "gtin": "20850068684780",
                "sku": "TW-BRS205-4OZ",
            }],
            "packing_lists": [{
                "status": "Needs Review",
                "warnings": [
                    "SKU TW-BRS205-4OZ: Product Master Each row with a GTIN is required for MPL Item Number.",
                ],
                "items": [{
                    "item_number": "",
                    "sku": "TW-BRS205-4OZ",
                    "gtin": "20850068684780",
                    "case_upc": "20850068684780",
                    "qty_on_pallet": "19",
                    "location_on_pallet": "1",
                }],
            }],
        }
        authoritative_rows = [
            {
                "storefront": "KeHE",
                "in_packing_list": True,
                "packaging_level": "Case",
                "gtin": "20850068684780",
                "sku": "TW-BRS205-4OZ",
                "weight_lbs": "16",
            },
            {
                "storefront": "KeHE",
                "packaging_level": "Each",
                "gtin": "850068684786",
                "sku": "TW-BRS205-4OZ",
            },
        ]

        with patch("server._datastore_load_product_master", return_value=authoritative_rows):
            refreshed = _refresh_mpl_render_product_master(object(), stale_draft)

        item = refreshed["packing_lists"][0]["items"][0]
        self.assertEqual("850068684786", item["item_number"])
        self.assertEqual("850068684786", item["each_gtin"])
        self.assertEqual("", stale_draft["packing_lists"][0]["items"][0]["item_number"])
        _validate_mpl_each_item_numbers(refreshed)


class MplDraftStorageTests(unittest.TestCase):
    def test_saved_draft_rehydrates_legacy_sku_item_number_from_each_gtin(self):
        record = {
            "id": "saved-39830",
            "name": "39830",
            "draft": {
                "packing_lists": [{
                    "status": "Ready",
                    "warnings": [],
                    "items": [{
                        "item_number": "TW-BRS205-4OZ",
                        "sku": "TW-BRS205-4OZ",
                        "gtin": "20850068684780",
                        "qty_on_pallet": "19",
                    }],
                }],
            },
        }
        product_rows = [
            {
                "storefront": "KeHE",
                "in_packing_list": True,
                "packaging_level": "Case",
                "gtin": "20850068684780",
                "sku": "TW-BRS205-4OZ",
            },
            {
                "storefront": "KeHE",
                "packaging_level": "Each",
                "gtin": "850068684786",
                "sku": "TW-BRS205-4OZ",
            },
        ]

        hydrated = _hydrate_saved_mpl_record(record, product_rows)

        self.assertEqual(
            "850068684786",
            hydrated["draft"]["packing_lists"][0]["items"][0]["item_number"],
        )
        self.assertEqual(
            "TW-BRS205-4OZ",
            record["draft"]["packing_lists"][0]["items"][0]["item_number"],
        )

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


class FrontendDeliveryTests(unittest.TestCase):
    def test_index_html_is_not_cached(self):
        response = serve_frontend_index()

        self.assertEqual("no-store, no-cache, must-revalidate, max-age=0", response.headers["cache-control"])
        self.assertEqual("no-cache", response.headers["pragma"])


if __name__ == "__main__":
    unittest.main()
