import unittest
from unittest.mock import patch

from fastapi import HTTPException

from server import (
    FRONTEND_DIST,
    _analytics_order_details,
    _analytics_order_instance_groups,
    _analytics_kehe_case_conversion,
    _b2b_analytics_order_items_for_products,
    _hydrate_saved_mpl_record,
    _product_each_gtin,
    _datastore_row_to_mpl_draft,
    _datastore_save_mpl_drafts,
    _mpl_draft_for_storage,
    _mpl_draft_to_datastore_row,
    _partner_customer_id_from_text,
    _refresh_mpl_render_product_master,
    _select_analytics_order_instance,
    _validated_sales_order_number,
    normalize_product_master_row,
    serve_frontend_index,
)
from pipelines.kehe.common import (
    _validate_mpl_each_item_numbers,
    apply_product_master_to_mpl_draft,
)


class AnalyticsOrderInstanceTests(unittest.TestCase):
    def test_order_lookup_helpers_validate_and_select_consistently(self):
        self.assertEqual("SO-101", _validated_sales_order_number({"sales_order_number": " SO-101 "}))
        with self.assertRaises(HTTPException):
            _validated_sales_order_number({"sales_order_number": "bad\nnumber"})

        rows = [
            {"Ecomdash ID": "100", "SKUNumber": "A"},
            {"Ecomdash ID": "200", "SKUNumber": "B"},
        ]
        selected_rows, selected_id, selection = _select_analytics_order_instance(rows, "200", "SO-101")
        self.assertEqual("200", selected_id)
        self.assertIsNone(selection)
        self.assertEqual(["B"], [row["SKUNumber"] for row in selected_rows])

    def test_partner_customer_is_detected_from_order_email_text(self):
        examples = {
            "orders@decopac.com": "decopac",
            "shipping-dutchbros@example.com": "dutch_bros",
            "Fancy Sprinkles <orders@example.com>": "fancy",
        }

        for email_id, expected in examples.items():
            with self.subTest(email_id=email_id):
                self.assertEqual(expected, _partner_customer_id_from_text(email_id))

        self.assertEqual("", _partner_customer_id_from_text("warehouse@example.com"))

    def test_order_email_is_exposed_as_email_id(self):
        details = _analytics_order_details([{"Email": "orders@decopac.com"}])

        self.assertEqual("orders@decopac.com", details["email_id"])

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

    def test_b2b_analytics_order_items_match_case_product_rows(self):
        analytics_rows = [
            {
                "Sales Order Number": "SO-9001",
                "Quantity Ordered": "12",
                "SKUNumber": "ABC-123",
                "Ecomdash ID": "9001",
                "Billing Customer Name": "Acme Foods",
                "Storefront": "Acme Foods",
            },
            {
                "Sales Order Number": "SO-9001",
                "Quantity Ordered": "8",
                "SKUNumber": "ABC-123",
                "Ecomdash ID": "9001",
                "Billing Customer Name": "Acme Foods",
                "Storefront": "Acme Foods",
            },
            {
                "Sales Order Number": "SO-9001",
                "Quantity Ordered": "7",
                "SKUNumber": "XYZ-999",
                "Product Name": "Order-only product",
                "Unit Weight Lbs": "2.5",
                "Ecomdash ID": "9001",
                "Billing Customer Name": "Acme Foods",
                "Storefront": "Acme Foods",
            },
        ]
        product_rows = [
            {
                "storefront": "Acme Foods",
                "packaging_level": "Case",
                "in_packing_list": True,
                "case_qty": "24",
                "sku": "ABC-123",
                "label_template_id": "standard",
                "config_id": "ACME-CASE",
            },
        ]

        items = _b2b_analytics_order_items_for_products(analytics_rows, product_rows)

        self.assertEqual(2, len(items))
        self.assertEqual("ABC-123", items[0]["sku"])
        self.assertEqual(20, items[0]["quantity_ordered"])
        self.assertEqual("matched", items[0]["match_status"])
        self.assertEqual("standard", items[0]["product"]["label_template_id"])
        self.assertEqual("unmatched", items[1]["match_status"])
        self.assertEqual("XYZ-999", items[1]["item_number"])
        self.assertEqual("Order-only product", items[1]["description"])
        self.assertEqual("2.5", items[1]["unit_weight_lbs"])

    def test_b2b_unique_key_includes_packaging_level(self):
        row = normalize_product_master_row({
            "storefront": "DecoPac",
            "packaging_level": "Case",
            "sku": "SHARED-SKU",
            "config_id": "DECOPAC-62924-CASE",
        })

        self.assertEqual("decopac|decopac-62924-case|case", row["unique_key"])

        each_row = normalize_product_master_row({
            "storefront": "DecoPac",
            "packaging_level": "Each",
            "sku": "SHARED-SKU",
            "config_id": "DECOPAC-62924-CASE",
        })
        self.assertEqual("decopac|decopac-62924-case|each", each_row["unique_key"])
        self.assertNotEqual(row["unique_key"], each_row["unique_key"])

    def test_legacy_unique_key_falls_back_to_storefront_packaging_and_sku(self):
        row = normalize_product_master_row({
            "storefront": "DecoPac",
            "packaging_level": "Case",
            "sku": "SHARED-SKU",
            "config_id": "",
        })

        self.assertEqual("decopac|case|shared-sku", row["unique_key"])

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

    def test_missing_each_gtin_uses_sku_as_visible_item_number(self):
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
        self.assertEqual("TW-BRS205-4OZ", mpl["items"][0]["item_number"])
        self.assertEqual("Needs Review", mpl["status"])
        self.assertIn("no Each GTIN", mpl["warnings"][0])

        self.assertEqual([], _validate_mpl_each_item_numbers(draft))

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
        self.assertEqual("UNKNOWN-SKU", mpl["items"][0]["item_number"])
        self.assertIn("using order data", mpl["warnings"][0])

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
    def test_existing_datastore_draft_is_updated_without_delete_and_reinsert(self):
        class FakeDraftTable:
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

        existing = _mpl_draft_to_datastore_row({
            "id": "draft-1",
            "name": "Before",
            "document_type": "MPL",
            "draft": {"packing_lists": [{"id": "MPL-1", "items": []}]},
        })
        existing["ROWID"] = "9001"
        table = FakeDraftTable([existing])
        wanted = [{
            "id": "draft-1",
            "name": "After",
            "document_type": "MPL",
            "draft": {"packing_lists": [{"id": "MPL-1", "items": [{"sku": "ABC"}]}]},
        }]

        with patch("server._mpl_drafts_datastore_table", return_value=table):
            saved = _datastore_save_mpl_drafts(object(), wanted, "MPL")

        self.assertTrue(saved)
        self.assertEqual("9001", table.updated[0]["ROWID"])
        self.assertEqual("After", table.updated[0]["NAME"])
        self.assertFalse(table.inserted)
        self.assertFalse(table.deleted)

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

    def test_draft_document_type_and_status_round_trip(self):
        record = {
            "id": "run-1",
            "name": "B2B Run",
            "document_type": "B2B_LABEL_RUN",
            "status": "GENERATED",
            "customer_code": "DECOPAC",
            "po_number": "PO-123",
            "created_by": "qa@example.com",
            "updated_by": "qa@example.com",
            "draft": {"result_id": "abc"},
        }

        row = _mpl_draft_to_datastore_row(record)
        restored = _datastore_row_to_mpl_draft(row)

        self.assertEqual("B2B_LABEL_RUN", restored["document_type"])
        self.assertEqual("GENERATED", restored["status"])
        self.assertEqual("DECOPAC", restored["customer_code"])
        self.assertEqual("PO-123", restored["po_number"])


class FrontendDeliveryTests(unittest.TestCase):
    def test_index_html_is_not_cached(self):
        response = serve_frontend_index()

        self.assertEqual("no-store, no-cache, must-revalidate, max-age=0", response.headers["cache-control"])
        self.assertEqual("no-cache", response.headers["pragma"])

    def test_b2b_creator_uses_progressive_hierarchy_and_dynamic_run_fields(self):
        response = serve_frontend_index()
        html = response.body.decode("utf-8")
        javascript = (FRONTEND_DIST / "assets" / "js" / "app.js").read_text(encoding="utf-8")

        self.assertIn('data-b2b-selector-wrap="customer"', html)
        for selector in ("product", "level", "template", "directory"):
            self.assertIn(f'class="hidden" data-b2b-selector-wrap="{selector}"', html)
        self.assertIn('id="b2b-label-editor-canvas"', html)
        self.assertIn('id="b2b-product-settings"', html)
        self.assertIn('id="b2b-product-gtin"', html)
        self.assertIn('id="b2b-product-barcode-type"', html)
        self.assertIn('id="b2b-run-fields-empty"', html)
        self.assertIn('id="b2b-render-button" type="button" onclick="generateB2BPreview(true)"', html)
        self.assertNotIn('onclick="generateB2BPreview(false)">Render Final PDF', html)
        self.assertEqual(5, html.count("data-b2b-run-wrap="))
        self.assertNotIn('data-b2b-run-field="po_number"', html)
        self.assertIn("function b2bRunFieldNames(template)", javascript)
        self.assertIn("function b2bLabelEditorHtml(template, product, directory, context = {})", javascript)
        self.assertIn("function renderB2BProductSettings(product", javascript)
        self.assertIn("function commitB2BLabelEdit(element)", javascript)
        self.assertIn("function commitB2BRunLabelEdit(element)", javascript)
        self.assertIn("setB2BSelectorVisibility('level', !!selectedGroup)", javascript)
        self.assertIn("b2bRunFieldNames(template).forEach(field =>", javascript)

    def test_combined_customer_order_module_uses_kehe_style_editors_and_previews(self):
        html = serve_frontend_index().body.decode("utf-8")
        javascript = (FRONTEND_DIST / "assets" / "js" / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="partner-workspace-page"', html)
        self.assertIn('id="partner-sales-order-number"', html)
        for button_id in (
            "btn-partner-pack-labels",
            "btn-partner-pallet-labels",
            "btn-partner-mpl",
            "btn-preview-partner-pack-labels",
            "btn-preview-partner-pallet-labels",
            "btn-preview-partner-mpl",
        ):
            self.assertIn(f'id="{button_id}"', html)
        self.assertNotIn('id="partner-label-editor-list"', html)
        self.assertNotIn('id="partner-labels-preview"', html)
        self.assertNotIn('id="partner-mpl-preview"', html)
        self.assertIn("function openPartnerLabelEditor(kind", javascript)
        self.assertIn("function openPartnerPreview(kind)", javascript)
        self.assertIn("function renderPartnerLabelsEditor(kind", javascript)
        self.assertIn("commitPartnerProductLabelEdit(this)", javascript)
        self.assertIn("commitPartnerRunLabelEdit(this)", javascript)
        self.assertIn('onclick="editPartnerPackingList()"', html)
        self.assertIn('id="partner-customer-options"', html)
        self.assertNotIn('data-partner-customer="total_wine"', html)
        self.assertLess(html.index('DecoPac / Dutch Bros / Fancy'), html.index('Packing List &amp; Ti-Hi'))
        self.assertIn("let PARTNER_WORKFLOW_CONFIG", javascript)
        self.assertIn("async function loadCustomerWorkflowConfig()", javascript)
        self.assertIn("renderPartnerCustomerOptions();", javascript)
        self.assertIn("function selectPartnerCustomer(customerId", javascript)
        self.assertNotIn("total_wine", javascript)
        self.assertNotIn("openCombinedPartnerWorkflow", javascript)
        self.assertIn("Customer-specific manual MPL layouts", javascript)
        self.assertIn("onclick=\"setMplTemplate(${mplIndex}, '${cfg.mplTemplateId}')\"", javascript)
        self.assertIn("palletJob.run.copies = '2'", javascript)
        self.assertIn("function detectPartnerCustomer(payload)", javascript)
        self.assertIn("payload?.detected_partner_customer", javascript)
        self.assertIn("function buildPartnerLabelJobs(payload, customerId)", javascript)
        self.assertIn("async function renderPartnerPreviews()", javascript)
        self.assertIn("const saveBeforeGenerate = !!options.saveMplDraft;", javascript)


if __name__ == "__main__":
    unittest.main()
