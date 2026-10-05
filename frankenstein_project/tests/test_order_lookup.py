import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from labelkit.b2b_orders import _resolve_b2b_order_customer
from labelkit.draft_store import (
    _datastore_row_to_mpl_draft,
    _datastore_save_mpl_drafts,
    _hydrate_saved_mpl_record,
    _mpl_draft_for_storage,
    _mpl_draft_to_datastore_row,
)
from labelkit.jobs import MAX_CACHED_REPORTS, RESULT_JOBS, RESULT_REPORTS, _prune_old_results
from labelkit.order_intake import (
    _analytics_case_conversion,
    _analytics_kehe_case_conversion,
    _analytics_order_details,
    _analytics_order_instance_groups,
    _analytics_quantity,
    _b2b_analytics_order_items_for_products,
    _partner_customer_id_from_order,
    _partner_customer_id_from_text,
    _product_each_gtin,
    _select_analytics_order_instance,
    _validated_sales_order_number,
)
from labelkit.reference_data import normalize_product_master_row
from labelkit.reference_import import _apply_shared_directory_ship_from
from labelkit.routes.b2b import lookup_order_documents
from labelkit.routes.generation import _refresh_mpl_render_product_master, _with_kehe_prepare_xml_files
from labelkit.routes.orders import lookup_mpl_order
from labelkit.routes.system import serve_frontend_index
from labelkit.runtime import FRONTEND_DIST, _current_project_user, _require_permission
from labelkit.draft_storage import MPL_VERSION_LIMIT, bounded_versions
from labelkit.reference_data import DEFAULT_DIRECTORY_SHIP_FROM, _dedupe_dc_directory_rows, normalize_dc_directory_row
from pipelines.kehe.common import (
    _validate_mpl_each_item_numbers,
    apply_product_master_to_mpl_draft,
)
from pipelines.kehe.product_master import _match_product_master_row
from pipelines.kehe.asn_parser import load_kehe_dc_directory


class AuthenticationHeaderTrustTests(unittest.TestCase):
    def test_auth_required_ignores_caller_supplied_identity_and_role_headers(self):
        request = Request({
            "type": "http",
            "method": "GET",
            "path": "/api/admin/diagnostics",
            "headers": [
                (b"x-labelkit-user", b"attacker"),
                (b"x-labelkit-email", b"attacker@example.com"),
                (b"x-labelkit-role", b"Admin"),
            ],
            "query_string": b"",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 12345),
            "scheme": "http",
            "http_version": "1.1",
        })

        with patch("labelkit.runtime.AUTH_REQUIRED", True), patch("labelkit.runtime._init_catalyst_user_app", return_value=None):
            user = _current_project_user(request)
            self.assertFalse(user["authenticated"])
            self.assertEqual("User", user["role"])
            with self.assertRaises(HTTPException) as raised:
                _require_permission(request, "admin")

        self.assertEqual(401, raised.exception.status_code)


class ResultJobRetentionTests(unittest.TestCase):
    def test_pruning_preserves_processing_job_directories(self):
        original_jobs = dict(RESULT_JOBS)
        original_reports = dict(RESULT_REPORTS)
        try:
            RESULT_JOBS.clear()
            RESULT_REPORTS.clear()
            with tempfile.TemporaryDirectory() as temp_dir:
                active_dir = Path(temp_dir) / "active"
                active_dir.mkdir()
                RESULT_JOBS["active"] = {"status": "processing", "temp_dir": str(active_dir)}
                for index in range(MAX_CACHED_REPORTS):
                    RESULT_JOBS[f"done-{index}"] = {"status": "complete", "temp_dir": ""}

                _prune_old_results()

                self.assertIn("active", RESULT_JOBS)
                self.assertTrue(active_dir.exists())
                self.assertNotIn("done-0", RESULT_JOBS)
        finally:
            RESULT_JOBS.clear()
            RESULT_JOBS.update(original_jobs)
            RESULT_REPORTS.clear()
            RESULT_REPORTS.update(original_reports)


class KehePrepareHelperTests(unittest.TestCase):
    def test_prepare_helper_rejects_non_xml_and_cleans_temp_directory(self):
        class Upload:
            filename = "not-an-xml.pdf"

            async def close(self):
                return None

        created_dirs = []
        real_mkdtemp = tempfile.mkdtemp

        def make_temp_dir(*, prefix):
            path = real_mkdtemp(prefix=prefix)
            created_dirs.append(Path(path))
            return path

        with patch("tempfile.mkdtemp", side_effect=make_temp_dir):
            with self.assertRaisesRegex(HTTPException, "Invalid XML file") as raised:
                import asyncio
                asyncio.run(_with_kehe_prepare_xml_files(
                    [Upload()],
                    temp_prefix="kehe_prepare_test_",
                    error_message="Prepare failed",
                    operation=lambda _paths: {},
                ))

        self.assertEqual(400, raised.exception.status_code)
        self.assertEqual(1, len(created_dirs))
        self.assertFalse(created_dirs[0].exists())


def _frontend_javascript_bundle() -> str:
    """Return every locally delivered script so feature tests follow modular builds."""
    scripts_dir = FRONTEND_DIST / "assets" / "js"
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(scripts_dir.rglob("*.js"))
    )


class AnalyticsOrderInstanceTests(unittest.TestCase):
    def test_unified_order_documents_lookup_reuses_b2b_matching_pipeline(self):
        request = Request({"type": "http", "method": "POST", "path": "/api/order-documents/orders/lookup", "headers": []})
        payload = {"sales_order_number": "70001"}
        sentinel = object()
        with patch("labelkit.routes.b2b.lookup_b2b_order", return_value=sentinel) as lookup:
            result = lookup_order_documents(request, payload)
        self.assertIs(result, sentinel)
        lookup.assert_called_once_with(request, payload)

    def test_analytics_quantity_rejects_non_finite_values(self):
        for value in ("1e999", "inf", "-inf", "nan"):
            with self.subTest(value=value):
                self.assertIsNone(_analytics_quantity(value))

        self.assertEqual(12, _analytics_quantity("12"))

    def test_kehe_directory_combines_separate_address_role_rows(self):
        rows = {"rows": [
            {"storefront": "KeHE", "dc": "45", "name": "Ontario", "address": "SHIP TO", "address_roles": ["SHIP_TO"], "match_values": ["91761"], "is_active": True},
            {"storefront": "KeHE", "dc": "45", "name": "Ontario", "address": "BILL TO", "address_roles": ["BILL_TO"], "match_values": ["0569813430045"], "is_active": True},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "directory.json"
            path.write_text(json.dumps(rows), encoding="utf-8")
            load_kehe_dc_directory.cache_clear()
            with patch("pipelines.kehe.asn_parser.DIRECTORY_PATH", path):
                directory = load_kehe_dc_directory()
            load_kehe_dc_directory.cache_clear()

        self.assertEqual("SHIP TO", directory["45"]["delivery_address"])
        self.assertEqual("BILL TO", directory["45"]["billing_address"])
        self.assertTrue({"91761", "0569813430045", "45", "Ontario"}.issubset(set(directory["45"]["match_values"])))

    def test_mpl_missing_item_numbers_are_added_to_packing_list_warnings(self):
        draft = {"packing_lists": [{"warnings": [], "items": [{"sku": "SKU-1", "item_number": ""}]}]}

        missing = _validate_mpl_each_item_numbers(draft)

        self.assertEqual(["SKU-1"], missing)
        self.assertIn("Item Number is missing for: SKU-1.", draft["packing_lists"][0]["warnings"])

    def test_directory_applies_shared_bakell_origin_without_replacing_destination_addresses(self):
        row = normalize_dc_directory_row({
            "storefront": "Example",
            "dc": "A1",
            "delivery_address": "Destination",
            "billing_address": "Billing",
        })

        self.assertEqual(DEFAULT_DIRECTORY_SHIP_FROM, row["ship_from"])
        self.assertEqual("Destination", row["delivery_address"])
        self.assertEqual("Billing", row["billing_address"])
        self.assertEqual([], _dedupe_dc_directory_rows([{}]))

        imported = [normalize_dc_directory_row({"storefront": "Example", "dc": "B2"})]
        _apply_shared_directory_ship_from(imported, [{"ship_from": "NEW ORIGIN\n100 NEW STREET"}])
        self.assertEqual("NEW ORIGIN\n100 NEW STREET", imported[0]["ship_from"])

        imported_with_override = [normalize_dc_directory_row({
            "storefront": "Example",
            "dc": "C3",
            "ship_from": "ALTERNATE ORIGIN\n200 OTHER STREET",
        })]
        _apply_shared_directory_ship_from(
            imported_with_override,
            [
                {"ship_from": "ONE-OFF ORIGIN"},
                {"ship_from": "CURRENT DEFAULT"},
                {"ship_from": "CURRENT DEFAULT"},
            ],
        )
        self.assertEqual("ALTERNATE ORIGIN\n200 OTHER STREET", imported_with_override[0]["ship_from"])

        imported_without_override = [normalize_dc_directory_row({"storefront": "Example", "dc": "D4"})]
        _apply_shared_directory_ship_from(
            imported_without_override,
            [
                {"ship_from": "ONE-OFF ORIGIN"},
                {"ship_from": "CURRENT DEFAULT"},
                {"ship_from": "CURRENT DEFAULT"},
            ],
        )
        self.assertEqual("CURRENT DEFAULT", imported_without_override[0]["ship_from"])

    def test_directory_address_can_be_reused_for_multiple_dropdown_roles(self):
        row = normalize_dc_directory_row({
            "storefront": "DecoPac",
            "dc": "MAIN",
            "name": "DecoPac Office",
            "address": "DecoPac\n123 Main St\nAnytown, CA 90000",
            "address_roles": ["SHIP_TO", "BILL_TO"],
        })

        self.assertEqual(["SHIP_TO", "BILL_TO"], row["address_roles"])
        self.assertEqual("SHIP_TO,BILL_TO", row["record_type"])
        self.assertEqual(row["address"], row["delivery_address"])
        self.assertEqual(row["address"], row["billing_address"])
        self.assertEqual("", row["ship_from"])
        self.assertTrue(row["unique_key"].endswith("|ship_to+bill_to"))

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

    def test_reused_order_selector_recommends_best_product_master_match_without_selecting_it(self):
        rows = [
            {"Ecomdash ID": "old", "Invoice Date": "01 Jan 2024 10:00:00", "Storefront": "Acme", "SKUNumber": "UNKNOWN"},
            {"Ecomdash ID": "new", "Invoice Date": "01 Jan 2025 10:00:00", "Storefront": "Acme", "SKUNumber": "KNOWN"},
        ]
        products = [{"storefront": "Acme", "sku": "KNOWN", "packaging_level": "Each", "is_active": True}]

        selected_rows, selected_id, selection = _select_analytics_order_instance(rows, "", "SO-101", products)

        self.assertEqual(rows, selected_rows)
        self.assertEqual("", selected_id)
        self.assertTrue(selection["requires_order_selection"])
        self.assertEqual("new", selection["order_instances"][0]["ecomdash_id"])
        self.assertTrue(selection["order_instances"][0]["recommended"])
        self.assertEqual(1, selection["order_instances"][0]["matched_sku_count"])
        self.assertFalse(selection["order_instances"][1]["recommended"])

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

    def test_partner_customer_detection_uses_all_order_and_product_signals(self):
        self.assertEqual("fancy", _partner_customer_id_from_order(
            {
                "storefront": "Fancy Sprinkles",
                "email_id": "warehouse@example.com",
            },
            [{"product": {"storefront": "DecoPac"}}],
        ))
        self.assertEqual("decopac", _partner_customer_id_from_order(
            {"email_id": "warehouse@example.com"},
            [{"product": {"storefront": "DecoPac"}}],
        ))
        self.assertEqual("dutch_bros", _partner_customer_id_from_order(
            {},
            [{"candidate_storefronts": ["Dutch Bros"]}],
        ))

    def test_b2b_customer_resolution_prefers_email_then_product_master(self):
        email_match = _resolve_b2b_order_customer(
            {"email_id": "shipping+fancy.sprinkles@example.com", "storefront": "BAKELL.COM"},
            [{"match_status": "matched", "product": {"storefront": "Generic Wholesale"}}],
        )
        self.assertEqual("Fancy Sprinkles", email_match["name"])
        self.assertEqual("email", email_match["source"])

        product_match = _resolve_b2b_order_customer(
            {"email_id": "warehouse@example.com", "storefront": "BAKELL.COM"},
            [{"match_status": "matched", "product": {"storefront": "DecoPac"}}],
        )
        self.assertEqual("DecoPac", product_match["name"])
        self.assertEqual("product_master", product_match["source"])

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

    def test_alphanumeric_sku_does_not_match_another_sku_by_shared_digits(self):
        product_rows = [{
            "storefront": "KeHE",
            "packaging_level": "Case",
            "sku": "TW-EXAMPLE4",
            "description": "Example Case Product",
            "case_qty": "36",
            "is_active": True,
        }]

        matched = _match_product_master_row({
            "storefront": "BAKELL.COM",
            "sku": "4G-BG-RED",
            "item_number": "4G-BG-RED",
            "description": "4g Red Edible Brew Glitter",
        }, product_rows)

        self.assertIsNone(matched)

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
        self.assertEqual("matched_level_sku", items[0]["match_reason_code"])
        self.assertIn("Case SKU", items[0]["match_reason"])
        self.assertEqual("no_product_master_sku", items[1]["match_reason_code"])
        self.assertIn("No active Product Master", items[1]["match_reason"])
        self.assertEqual("XYZ-999", items[1]["item_number"])
        self.assertEqual("Order-only product", items[1]["description"])
        self.assertEqual("2.5", items[1]["unit_weight_lbs"])

    def test_b2b_packaging_summary_respects_enabled_levels_and_review_state(self):
        order_rows = [{
            "Sales Order Number": "B2B-LABEL-LEVELS",
            "Storefront": "Acme Foods",
            "SKUNumber": "ACME-EACH",
            "Quantity Ordered": "24",
        }]
        shared = {
            "storefront": "Acme Foods",
            "config_id": "ACME-LABEL-LEVELS",
            "is_active": True,
        }
        products = [
            {
                **shared,
                "packaging_level": "Each",
                "sku": "ACME-EACH",
                "case_qty": "1",
                "label_enabled": True,
                "label_template_id": "EACH-LABEL",
                "barcode_type": "UPC_A",
                "default_copies": "2",
                "verification_status": "VERIFIED",
            },
            {
                **shared,
                "packaging_level": "Inner Pack",
                "sku": "ACME-INNER",
                "case_qty": "6",
                "label_enabled": True,
                "label_template_id": "",
                "verification_status": "NEEDS_REVIEW",
            },
            {
                **shared,
                "packaging_level": "Case",
                "sku": "ACME-CASE",
                "case_qty": "24",
                "label_enabled": False,
                "label_template_id": "CASE-LABEL",
                "verification_status": "VERIFIED",
            },
        ]

        item = _b2b_analytics_order_items_for_products(order_rows, products)[0]
        summary = {level["packaging_level"]: level for level in item["packaging_summary"]}

        self.assertTrue(summary["Each"]["label_available"])
        self.assertEqual("UPC_A", summary["Each"]["barcode_type"])
        self.assertEqual("2", summary["Each"]["default_copies"])
        self.assertFalse(summary["Each"]["label_review_required"])
        self.assertTrue(summary["Inner Pack"]["label_enabled"])
        self.assertFalse(summary["Inner Pack"]["label_available"])
        self.assertTrue(summary["Inner Pack"]["label_review_required"])
        self.assertFalse(summary["Case"]["label_enabled"])
        self.assertTrue(summary["Case"]["label_template_available"])
        self.assertFalse(summary["Case"]["label_available"])

    def test_shared_product_sku_groups_levels_but_exact_level_sku_sets_order_uom(self):
        order_rows = [
            {
                "Sales Order Number": "LEVEL-SKU-ORDER",
                "Storefront": "Example",
                "SKUNumber": "ABC100",
                "Quantity Ordered": "100",
            },
            {
                "Sales Order Number": "LEVEL-SKU-ORDER",
                "Storefront": "Example",
                "SKUNumber": "ABC100-100",
                "Quantity Ordered": "2",
            },
        ]
        products = [
            {
                "storefront": "Example",
                "config_id": "ABC100",
                "packaging_level": "Each",
                "sku": "ABC100",
                "case_qty": "1",
                "is_active": True,
            },
            {
                "storefront": "Example",
                "config_id": "ABC100",
                "packaging_level": "Case",
                "sku": "ABC100-100",
                "case_qty": "100",
                "is_active": True,
            },
        ]

        items = _b2b_analytics_order_items_for_products(order_rows, products)
        by_sku = {item["sku"]: item for item in items}

        self.assertEqual("matched_level_sku", by_sku["ABC100"]["match_reason_code"])
        self.assertEqual("Each", by_sku["ABC100"]["source_packaging_level"])
        self.assertEqual(1, by_sku["ABC100"]["quantity_ordered"])
        self.assertEqual("matched_level_sku", by_sku["ABC100-100"]["match_reason_code"])
        self.assertEqual("Case", by_sku["ABC100-100"]["source_packaging_level"])
        self.assertEqual(2, by_sku["ABC100-100"]["quantity_ordered"])

    def test_same_level_sku_on_multiple_levels_defaults_incoming_quantity_to_each(self):
        order_rows = [{
            "Sales Order Number": "DUPLICATE-LEVEL-SKU",
            "Storefront": "Example",
            "SKUNumber": "ABC100",
            "Quantity Ordered": "12",
        }]
        products = [
            {
                "storefront": "Example", "config_id": "ABC100", "packaging_level": "Each",
                "sku": "ABC100", "case_qty": "1", "display_sku_uom": "Each", "is_active": True,
            },
            {
                "storefront": "Example", "config_id": "ABC100", "packaging_level": "Case",
                "sku": "ABC100", "case_qty": "12", "display_sku_uom": "Each", "is_active": True,
            },
            {
                "storefront": "Example", "config_id": "ABC100", "packaging_level": "Shipper Contents",
                "sku": "ABC100", "case_qty": "12", "display_sku_uom": "Each", "is_active": True,
            },
        ]

        item = _b2b_analytics_order_items_for_products(order_rows, products)[0]

        self.assertEqual("matched", item["match_status"])
        self.assertEqual("shared_level_sku_defaulted", item["match_reason_code"])
        self.assertTrue(item["needs_match_review"])
        self.assertEqual("Each", item["source_packaging_level"])
        self.assertEqual(1, item["quantity_ordered"])
        self.assertIn("defaulted to Each", item["match_reason"])

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

    def test_matched_non_kehe_case_converts_order_eaches_for_packing_list(self):
        conversion = _analytics_case_conversion(1044, {
            "storefront": "BAKELL.COM",
            "packaging_level": "Case",
            "case_qty": "36",
            "sku": "MIC_372813082828",
        })

        self.assertIsNotNone(conversion)
        self.assertEqual(1044, conversion["quantity_ordered_eaches"])
        self.assertEqual(29, conversion["quantity_ordered_cases"])
        self.assertEqual(29, conversion["quantity_ordered"])
        self.assertTrue(conversion["case_conversion_exact"])

    def test_mpl_lookup_converts_large_b2b_each_quantity_before_tihi(self):
        order_rows = [{
            "Sales Order Number": "70913",
            "Ecomdash ID": "102432595",
            "Storefront": "BAKELL.COM",
            "SKUNumber": "MIC_372813082828",
            "Product Name": "Michaels Mistletoe Magic",
            "Quantity Ordered": "1044",
        }]
        products = [{
            "storefront": "BAKELL.COM",
            "packaging_level": "Case",
            "in_packing_list": True,
            "case_qty": "36",
            "sku": "MIC_372813082828",
            "gtin": "10000000000001",
            "gross_weight_lbs": "2",
            "length_in": "11",
            "width_in": "8",
            "height_in": "6",
        }]

        with (
            patch("labelkit.routes.orders._require_permission"),
            patch("labelkit.runtime.ANALYTICS_CLIENT.export_order_rows", return_value=order_rows),
            patch("labelkit.routes.orders._datastore_load_product_master", return_value=products),
        ):
            response = lookup_mpl_order(object(), {"sales_order_number": "70913"})

        payload = json.loads(response.body)
        self.assertEqual(29, payload["items"][0]["quantity_ordered"])
        self.assertEqual(1044, payload["items"][0]["quantity_ordered_eaches"])
        self.assertEqual(1, payload["summary"]["converted_to_cases"])

    def test_mpl_lookup_matches_display_sku_using_configured_unit(self):
        order_rows = [{
            "Sales Order Number": "DISPLAY-1",
            "Ecomdash ID": "DISPLAY-ORDER",
            "Storefront": "Fancy Sprinkles",
            "SKUNumber": "COMMON-DISPLAY-SKU",
            "Quantity Ordered": "72",
        }]
        products = [
            {
                "storefront": "Fancy Sprinkles",
                "config_id": "FANCY-ONE",
                "display_sku": "COMMON-DISPLAY-SKU",
                "display_sku_uom": "Each",
                "packaging_level": "Each",
                "sku": "FANCY-EACH",
                "case_qty": "1",
                "is_active": True,
            },
            {
                "storefront": "Fancy Sprinkles",
                "config_id": "FANCY-ONE",
                "display_sku": "COMMON-DISPLAY-SKU",
                "display_sku_uom": "Each",
                "packaging_level": "Case",
                "sku": "FANCY-CASE",
                "case_qty": "36",
                "is_active": True,
            },
        ]

        with (
            patch("labelkit.routes.orders._require_permission"),
            patch("labelkit.runtime.ANALYTICS_CLIENT.export_order_rows", return_value=order_rows),
            patch("labelkit.routes.orders._datastore_load_product_master", return_value=products),
        ):
            response = lookup_mpl_order(object(), {"sales_order_number": "DISPLAY-1"})

        payload = json.loads(response.body)
        self.assertEqual("matched", payload["items"][0]["match_status"])
        self.assertEqual("Each", payload["items"][0]["source_packaging_level"])
        self.assertEqual(72, payload["items"][0]["quantity_ordered_eaches"])
        self.assertEqual(2, payload["items"][0]["quantity_ordered"])

        b2b_items = _b2b_analytics_order_items_for_products(order_rows, products)
        self.assertEqual("matched", b2b_items[0]["match_status"])
        self.assertEqual("Case", b2b_items[0]["product"]["packaging_level"])
        self.assertEqual("CASE", b2b_items[0]["quantity_uom"])
        self.assertEqual(2, b2b_items[0]["quantity_ordered"])

    def test_mpl_lookup_defaults_a_shared_level_sku_to_each(self):
        order_rows = [{
            "Sales Order Number": "SHARED-LEVEL-SKU",
            "Ecomdash ID": "SHARED-LEVEL-ORDER",
            "Storefront": "Acme Foods",
            "SKUNumber": "PACK-SKU",
            "Quantity Ordered": "3",
        }]
        products = [
            {
                "storefront": "Acme Foods",
                "config_id": "ACME-PACK-SKU",
                "display_sku": "PACK-SKU",
                "display_sku_uom": "Case",
                "packaging_level": "Each",
                "sku": "PACK-SKU",
                "case_qty": "1",
                "is_active": True,
            },
            {
                "storefront": "Acme Foods",
                "config_id": "ACME-PACK-SKU",
                "display_sku": "PACK-SKU",
                "display_sku_uom": "Case",
                "packaging_level": "Case",
                "sku": "PACK-SKU",
                "case_qty": "24",
                "is_active": True,
            },
            {
                "storefront": "Acme Foods",
                "config_id": "ACME-PACK-SKU",
                "display_sku": "PACK-SKU",
                "display_sku_uom": "Case",
                "packaging_level": "Shipper Contents",
                "sku": "PACK-SKU",
                "case_qty": "24",
                "is_active": True,
            },
        ]

        with (
            patch("labelkit.routes.orders._require_permission"),
            patch("labelkit.runtime.ANALYTICS_CLIENT.export_order_rows", return_value=order_rows),
            patch("labelkit.routes.orders._datastore_load_product_master", return_value=products),
        ):
            response = lookup_mpl_order(object(), {"sales_order_number": "SHARED-LEVEL-SKU"})

        payload = json.loads(response.body)
        item = payload["items"][0]
        self.assertEqual("matched", item["match_status"])
        self.assertEqual("shared_level_sku_defaulted", item["match_reason_code"])
        self.assertEqual("Each", item["source_packaging_level"])
        self.assertEqual(3, item["quantity_ordered_eaches"])
        self.assertEqual(1, item["quantity_ordered"])
        self.assertTrue(item["needs_match_review"])
        self.assertEqual(1, payload["summary"]["defaulted_level_skus"])

    def test_mpl_lookup_converts_each_sku_and_preserves_case_sku_count(self):
        order_rows = [
            {
                "Sales Order Number": "LEVEL-SPECIFIC-SKUS",
                "Ecomdash ID": "LEVEL-SPECIFIC-ORDER",
                "Storefront": "Acme Foods",
                "SKUNumber": "ACME-EACH",
                "Quantity Ordered": "72",
            },
            {
                "Sales Order Number": "LEVEL-SPECIFIC-SKUS",
                "Ecomdash ID": "LEVEL-SPECIFIC-ORDER",
                "Storefront": "Acme Foods",
                "SKUNumber": "ACME-INNER",
                "Quantity Ordered": "12",
            },
            {
                "Sales Order Number": "LEVEL-SPECIFIC-SKUS",
                "Ecomdash ID": "LEVEL-SPECIFIC-ORDER",
                "Storefront": "Acme Foods",
                "SKUNumber": "ACME-CASE",
                "Quantity Ordered": "3",
            },
        ]
        products = [
            {
                "storefront": "Acme Foods",
                "config_id": "ACME-LEVELS",
                "packaging_level": "Each",
                "sku": "ACME-EACH",
                "case_qty": "1",
                "is_active": True,
            },
            {
                "storefront": "Acme Foods",
                "config_id": "ACME-LEVELS",
                "packaging_level": "Inner Pack",
                "sku": "ACME-INNER",
                "case_qty": "6",
                "is_active": True,
            },
            {
                "storefront": "Acme Foods",
                "config_id": "ACME-LEVELS",
                "packaging_level": "Case",
                "sku": "ACME-CASE",
                "case_qty": "24",
                "inner_packs_per_case": "4",
                "is_active": True,
            },
        ]

        with (
            patch("labelkit.routes.orders._require_permission"),
            patch("labelkit.runtime.ANALYTICS_CLIENT.export_order_rows", return_value=order_rows),
            patch("labelkit.routes.orders._datastore_load_product_master", return_value=products),
        ):
            response = lookup_mpl_order(object(), {"sales_order_number": "LEVEL-SPECIFIC-SKUS"})

        payload = json.loads(response.body)
        self.assertEqual(["Each", "Inner Pack", "Case"], [item["source_packaging_level"] for item in payload["items"]])
        self.assertEqual([72, 72, 72], [item["quantity_ordered_eaches"] for item in payload["items"]])
        self.assertEqual([3, 3, 3], [item["quantity_ordered_cases"] for item in payload["items"]])

        b2b_items = _b2b_analytics_order_items_for_products(order_rows, products)
        self.assertEqual(["Each", "Inner Pack", "Case"], [item["source_packaging_level"] for item in b2b_items])
        self.assertEqual([3, 3, 3], [item["quantity_ordered"] for item in b2b_items])

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

        with patch("labelkit.routes.generation._datastore_load_product_master", return_value=authoritative_rows):
            refreshed = _refresh_mpl_render_product_master(object(), stale_draft)

        item = refreshed["packing_lists"][0]["items"][0]
        self.assertEqual("850068684786", item["item_number"])
        self.assertEqual("850068684786", item["each_gtin"])
        self.assertEqual("", stale_draft["packing_lists"][0]["items"][0]["item_number"])
        _validate_mpl_each_item_numbers(refreshed)


class MplDraftStorageTests(unittest.TestCase):
    def test_mpl_version_history_is_bounded_per_parent(self):
        records = [{
            "id": f"draft-1-v{revision}",
            "revision": revision,
            "draft": {"_version_parent_id": "draft-1"},
        } for revision in range(1, 9)]
        records.append({
            "id": "other-v1",
            "revision": 1,
            "draft": {"_version_parent_id": "other"},
        })

        bounded = bounded_versions(records, "draft-1")

        related = [row for row in bounded if row["draft"]["_version_parent_id"] == "draft-1"]
        self.assertEqual(MPL_VERSION_LIMIT, len(related))
        self.assertEqual([8, 7, 6, 5, 4], [row["revision"] for row in related])
        self.assertTrue(any(row["id"] == "other-v1" for row in bounded))

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

        with patch("labelkit.draft_store._mpl_drafts_datastore_table", return_value=table):
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

    def test_datastore_draft_uses_deployed_compact_column_schema(self):
        row = _mpl_draft_to_datastore_row({
            "id": "draft-1",
            "name": "70913",
            "document_type": "MPL",
            "status": "DRAFT",
            "customer_code": "KEHE",
            "po_number": "PO-70913",
            "created_by": "qa@example.com",
            "updated_by": "qa@example.com",
            "draft": {"packing_lists": []},
        })

        self.assertEqual(
            {"DRAFT_ID", "NAME", "CREATED_AT", "UPDATED_AT", "DRAFT_JSON", "IS_ACTIVE"},
            set(row),
        )

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
        self.assertEqual(0, restored["revision"])

    def test_draft_revision_round_trips_in_compact_json(self):
        row = _mpl_draft_to_datastore_row({
            "id": "draft-1",
            "name": "Draft",
            "revision": 7,
            "draft": {"packing_lists": []},
        })

        restored = _datastore_row_to_mpl_draft(row)

        self.assertEqual(7, restored["revision"])


class FrontendDeliveryTests(unittest.TestCase):
    def test_unified_order_documents_workspace_coordinates_existing_generators(self):
        html = serve_frontend_index().body.decode("utf-8")
        javascript = _frontend_javascript_bundle()

        self.assertIn('id="operations-workspace-page"', html)
        self.assertIn('onclick="selectOperationsWorkspace()"', html)
        self.assertIn('id="operations-generate-labels"', html)
        self.assertIn('id="operations-generate-mpl"', html)
        self.assertIn('id="operations-generate-pallets"', html)
        self.assertIn('id="operations-labels-mount"', html)
        self.assertIn('data-operations-panel="files"', html)
        self.assertIn('id="operations-review-mpl"', html)
        self.assertIn('id="operations-review-pallet-labels"', html)
        self.assertIn('/assets/js/operations-workspace.js', html)
        self.assertIn("function completeOperationsOrderLoad(payload, orderNumber", javascript)
        self.assertIn("completeB2BOrderLoad(payload, orderNumber)", javascript)
        self.assertIn("buildAnalyticsOrderMplDraft(payload, 'standard')", javascript)
        self.assertIn("buildPalletLabelDraftFromMplDraft(orderDocumentsState.mplDraft)", javascript)
        self.assertIn("Choose at least one label template for this product.", javascript)
        self.assertIn("Assign the packing-list items to at least one pallet", javascript)
        self.assertIn("'/api/order-documents/orders/lookup'", javascript)

    def test_frontend_styles_and_pdf_runtime_are_local_modules(self):
        html = serve_frontend_index().body.decode("utf-8")

        for filename in (
            "app.css",
            "base.css",
            "components.css",
            "operations.css",
            "document-editor.css",
            "preview.css",
            "b2b.css",
            "responsive.css",
            "tokens.css",
        ):
            with self.subTest(filename=filename):
                self.assertIn(f'/assets/css/{filename}', html)
                self.assertTrue((FRONTEND_DIST / "assets" / "css" / filename).is_file())

        self.assertIn('/assets/vendor/pdfjs-3.11.174/pdf.min.js', html)
        self.assertNotIn('cdnjs.cloudflare.com/ajax/libs/pdf.js', html)
        self.assertTrue(
            (FRONTEND_DIST / "assets" / "vendor" / "pdfjs-3.11.174" / "pdf.worker.min.js").is_file()
        )

    def test_catalyst_browser_sdk_is_loaded_only_when_runtime_auth_requires_it(self):
        html = serve_frontend_index().body.decode("utf-8")
        javascript = (FRONTEND_DIST / "assets" / "js" / "app.js").read_text(encoding="utf-8")

        self.assertNotIn('<script src="/__catalyst/sdk/init.js"></script>', html)
        self.assertNotIn('catalystWebSDK.js"></script>', html)
        self.assertIn("function ensureCatalystBrowserSdk()", javascript)
        self.assertIn("appRuntimeConfig.auth_required && appRuntimeConfig.auth_mode === 'embedded'", javascript)

    def test_order_workflows_expose_recommendations_match_reasons_and_output_status(self):
        html = serve_frontend_index().body.decode("utf-8")
        javascript = _frontend_javascript_bundle()

        self.assertIn('onclick="focusNextProductIssue()"', html)
        self.assertIn("function renderOrderInstanceTableRows", javascript)
        self.assertIn("order-instance-recommended", javascript)
        self.assertIn("match_reason: source?.match_reason", javascript)
        self.assertIn("Assign templates in Batch Setup", javascript)
        self.assertIn("Selected label", javascript)
        self.assertIn("Sales Order ${orderNumber} is ready", javascript)
        self.assertIn("Matching order lines to Product Master", javascript)

    def test_feature_scripts_are_delivered_as_separate_modules(self):
        html = serve_frontend_index().body.decode("utf-8")
        app_javascript = (FRONTEND_DIST / "assets" / "js" / "app.js").read_text(encoding="utf-8")
        expected_modules = {
            "reference-data.js": "function normalizeProductRow",
            "mpl-tihi.js": "function autoPalletizeMpl",
            "b2b-workspace.js": "function renderB2BCreator",
            "document-model.js": "function buildPartnerMplDraft",
            "document-editor.js": "function renderDocumentEditor",
            "operations-workspace.js": "function renderOperationsWorkspace",
        }

        for filename, owned_function in expected_modules.items():
            with self.subTest(filename=filename):
                self.assertIn(f'/assets/js/{filename}', html)
                module_javascript = (
                    FRONTEND_DIST / "assets" / "js" / filename
                ).read_text(encoding="utf-8")
                self.assertIn(owned_function, module_javascript)
                self.assertNotIn(owned_function, app_javascript)

    def test_index_html_is_not_cached(self):
        response = serve_frontend_index()

        self.assertEqual("no-store, no-cache, must-revalidate, max-age=0", response.headers["cache-control"])
        self.assertEqual("no-cache", response.headers["pragma"])

    def test_mpl_autosave_and_version_controls_are_delivered(self):
        html = serve_frontend_index().body.decode("utf-8")
        javascript = _frontend_javascript_bundle()

        self.assertIn('/assets/js/modules/mpl-draft-sync.js', html)
        self.assertIn('id="mpl-save-state"', html)
        self.assertIn('id="btn-mpl-versions"', html)
        self.assertIn('expected_revision:', javascript)
        self.assertIn('create_version:', javascript)
        self.assertIn("renderBtn.classList.toggle('hidden', type === 'masterPackingList')", javascript)
        self.assertNotIn("? 'Generate PDF Only'", javascript)

    def test_product_setup_uses_level_skus_then_calculated_summary(self):
        javascript = (FRONTEND_DIST / "assets" / "js" / "reference-data.js").read_text(encoding="utf-8")

        self.assertIn("give the complete packaging hierarchy one shared Product SKU", javascript)
        self.assertIn("Orders match the exact level SKU below: ABC100 can be Each while ABC100-100 can be Case.", javascript)
        self.assertIn("The same product name is available to labels and packing lists.", javascript)
        self.assertIn("Used as the customer-facing Item #; the Level SKU still determines the order UOM.", javascript)
        self.assertIn("entries.forEach(({ index }) => { mplProductMasterRows[index][key] = normalizedValue; });", javascript)
        self.assertIn("The matching SKU determines whether the quantity is Each, Inner Pack, or Case.", javascript)
        self.assertIn("Matches orders sold at this package level.", javascript)
        self.assertIn("Each Weight (g)", javascript)
        self.assertIn("Product summary", javascript)
        self.assertIn("Calculated product weight", javascript)
        self.assertLess(
            javascript.index('<section class="mpl-product-levels-card">'),
            javascript.index('<section class="mpl-product-final-details mpl-product-summary-card">'),
        )
        self.assertNotIn("<summary>Advanced matching details</summary>", javascript)
        self.assertNotIn("Alternate incoming SKU", javascript)
        self.assertNotIn("Product Group ID <input", javascript)
        self.assertNotIn("It is copied automatically", javascript)
        self.assertNotIn("mplProductMasterRows[groupIndex].display_sku = String(value || '').trim()", javascript)

    def test_b2b_unique_review_groups_keep_every_order_job_and_order_ship_to_wins(self):
        javascript = (FRONTEND_DIST / "assets" / "js" / "b2b-workspace.js").read_text(encoding="utf-8")
        context_javascript = (FRONTEND_DIST / "assets" / "js" / "order-context.js").read_text(encoding="utf-8")

        self.assertIn("const uniqueGroups = [...reviewGroups.values()]", javascript)
        self.assertIn("line_index: index", (FRONTEND_DIST / "assets" / "js" / "modules" / "b2b-label-model.js").read_text(encoding="utf-8"))
        self.assertIn("const selectedBatchJob = b2bOrderLabelJobs[b2bSelectedOrderJobIndex]", javascript)
        self.assertIn("job.directory = {", javascript)
        self.assertIn("delivery_address: b2bOrderDestinationOverride", javascript)
        self.assertIn("orderDetails.ship_to_name", javascript)
        self.assertIn("details.shipping_street1", context_javascript)
        self.assertIn("const destinationName = b2bOrderShipToName || destinationRow.name", javascript)

    def test_frontend_shell_is_fluid_and_routes_are_canonical_hash_urls(self):
        html = serve_frontend_index().body.decode("utf-8")
        responsive_css = (FRONTEND_DIST / "assets" / "css" / "responsive.css").read_text(encoding="utf-8")
        router_javascript = (FRONTEND_DIST / "assets" / "js" / "modules" / "router.js").read_text(encoding="utf-8")

        self.assertIn('/assets/css/responsive.css', html)
        self.assertIn("--workspace-inline-gutter", responsive_css)
        self.assertIn(".selection-shell", responsive_css)
        self.assertIn("max-width: none", responsive_css)
        self.assertIn("@media (max-width: 900px)", responsive_css)
        self.assertIn('const nextHash = `#${normalized}`;', router_javascript)

    def test_all_modules_receive_the_shared_visual_system(self):
        html = serve_frontend_index().body.decode("utf-8")
        module_css = (FRONTEND_DIST / "assets" / "css" / "module-system.css").read_text(encoding="utf-8")

        self.assertIn('/assets/css/module-system.css', html)
        self.assertGreaterEqual(html.count('module-header-card'), 2)
        self.assertGreaterEqual(html.count('module-surface-card'), 6)
        self.assertIn('[data-module="michaels"]', module_css)
        self.assertIn('[data-module="kehe"]', module_css)
        self.assertIn('.kehe-reference-btn', module_css)
        self.assertIn('@media (max-width: 700px)', (FRONTEND_DIST / "assets" / "css" / "responsive.css").read_text(encoding="utf-8"))

    def test_b2b_creator_uses_progressive_hierarchy_and_dynamic_run_fields(self):
        response = serve_frontend_index()
        html = response.body.decode("utf-8")
        javascript = _frontend_javascript_bundle()

        self.assertIn('data-b2b-selector-wrap="customer"', html)
        for selector in ("product", "level", "directory"):
            self.assertIn(f'class="hidden" data-b2b-selector-wrap="{selector}"', html)
        self.assertIn('class="hidden b2b-template-field" data-b2b-selector-wrap="template"', html)
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
        self.assertIn("setB2BSelectorVisibility('level', !!selectedGroup && !loadedOrder)", javascript)
        self.assertIn("b2bRunFieldNames(template).forEach(field =>", javascript)
        self.assertIn("function calculateOrderCartonCount(item, product)", javascript)
        self.assertIn("b2bRunFields.carton_total = String(orderCartons)", javascript)
        self.assertIn("window.LabelKitB2BOrderJobs.buildB2BOrderLabelJobs", javascript)
        self.assertIn("job.order_only_product_index = index", javascript)
        self.assertIn("order_only: true", javascript)
        self.assertIn("window.LabelKitB2BOrderJobs.buildB2BOrderLabelJobs", javascript)
        self.assertIn("job.order_only_product_index = index", javascript)
        self.assertIn("const editActionLabel = selectedTemplateIds.length ? 'Edit active label' : 'Choose templates'", javascript)
        self.assertIn("editor.scrollIntoView({ behavior: 'smooth', block: 'start' })", javascript)
        self.assertIn("function toggleB2BTemplate(templateId, selected, context = 'manual', jobIndex = null)", javascript)
        self.assertIn("b2bTemplatePickerHtml", javascript)
        self.assertIn("function renderB2BLabelQueue()", javascript)
        self.assertIn("function selectB2BWorkItem(jobIndex, templateId)", javascript)
        self.assertIn("function persistB2BActiveRunFields()", javascript)
        self.assertIn('id="b2b-label-queue"', html)
        self.assertIn('id="b2b-editor-navigator"', html)
        self.assertIn('id="b2b-editor-queue-track"', html)
        self.assertIn('id="b2b-label-editor-card"', html)
        self.assertIn("if (Number.isInteger(job.order_only_product_index))", javascript)
        self.assertIn("job.product = { ...job.product, [field]: value }", javascript)
        self.assertIn('id="b2b-order-ship-from-name"', javascript)
        self.assertIn('id="b2b-order-ship-from-input"', javascript)
        self.assertIn("function updateB2BOrderShipFrom(field, value)", javascript)
        self.assertIn('id="b2b-order-bill-to-input"', javascript)
        self.assertIn("function updateB2BOrderAddress(field, value)", javascript)
        self.assertIn('id="b2b-order-destination-input"', javascript)
        self.assertIn("Order values stay separate from Product Master", html)
        self.assertIn("template_selection_required: templateSelectionRequired", javascript)
        self.assertIn("const unresolvedCount = baseJobs.filter(row => !b2bTemplateIdsForJob(row).length || row.template_selection_required).length", javascript)
        self.assertIn("expandB2BTemplateJobs(baseJobs)", javascript)
        self.assertIn("This run will generate ${estimatedPages.toLocaleString()} label pages", javascript)
        self.assertIn("'/api/b2b/render-batch-archive'", javascript)
        self.assertIn("setPreviewReady(false)", javascript)
        self.assertIn("numbered PDFs in ${filename}", javascript)
        self.assertIn("Object.prototype.hasOwnProperty.call(level || {}, 'label_enabled')", javascript)
        self.assertIn("needs_label_review: reviewReasons.length > 0", javascript)
        self.assertIn('/assets/js/modules/b2b-label-model.js', html)
        self.assertIn("selectedOrderJob?.review_reasons", javascript)
        self.assertIn("No Enabled Labels for This Order", javascript)
        self.assertIn("function organizeB2BProductSettings(template, product)", javascript)
        self.assertIn('id="b2b-product-settings-current"', html)
        self.assertIn('id="b2b-product-settings-additional"', html)
        self.assertIn("function selectB2BOrderJob(value, requestedTemplateId = '')", javascript)
        self.assertIn("function selectB2BOrderCustomer(value)", javascript)
        self.assertIn("overridePanel.classList.toggle('hidden', loadedOrder)", javascript)
        self.assertIn('aria-label="Available label templates"', javascript)
        self.assertIn('class="b2b-template-group-label"', javascript)
        self.assertNotIn('class="b2b-other-template-options"', javascript)
        self.assertIn("Order values stay separate from Product Master", html)
        self.assertIn("function detectB2BOrderCustomer(payload, matchedProduct)", javascript)
        self.assertIn("payload?.detected_partner_customer", javascript)
        self.assertIn("payload?.detected_customer?.name", javascript)
        self.assertIn("function b2bOrderReviewGroupKey(job)", javascript)
        self.assertIn('id="b2b-order-destination-input"', javascript)
        self.assertIn("function updateB2BOrderDestination(value)", javascript)
        self.assertIn("line(s)", javascript)
        self.assertIn('id="b2b-sku-template-list"', html)
        self.assertIn('id="b2b-order-customer-select"', javascript)
        self.assertIn("job.match_status = 'customer_override'", javascript)
        self.assertIn("Values are run-only and will not overwrite the original Product Master records.", javascript)
        self.assertIn("/api/b2b/render-batch", javascript)
        self.assertIn("Label Job${count === 1 ? '' : 's'} & Open PDF", javascript)
        self.assertNotIn("await generateB2BPreview(true, { automatic: true })", javascript)

    def test_combined_customer_order_module_uses_kehe_style_editors_and_previews(self):
        html = serve_frontend_index().body.decode("utf-8")
        javascript = _frontend_javascript_bundle()

        self.assertIn('id="operations-workspace-page"', html)
        self.assertIn('id="operations-sales-order-number"', html)
        self.assertIn('id="operations-labels-mount"', html)
        self.assertIn('class="b2b-creator-layout"', html)
        self.assertIn('id="operations-review-mpl"', html)
        self.assertIn('id="operations-review-pallet-labels"', html)
        self.assertIn('data-operations-panel="files"', html)
        self.assertNotIn('id="partner-workspace-page"', html)
        self.assertNotIn('id="b2b-workspace-page"', html)
        self.assertNotIn('id="mpl-workspace-page"', html)
        self.assertIn("function detectPartnerCustomer(payload)", javascript)
        self.assertIn("function buildPartnerLabelJobs(payload, customerId)", javascript)
        self.assertIn("function buildPartnerMplDraft(payload, customerId)", javascript)
        self.assertIn("appendPartnerOnlyLabelJobs(payload, orderDocumentsState.customerId)", javascript)
        self.assertIn("buildPalletLabelDraftFromMplDraft(orderDocumentsState.mplDraft)", javascript)
        self.assertIn("function renderInlineMplAddressPicker(mplIndex, field, value)", javascript)
        self.assertIn("openGeneratedOutput", javascript)
        self.assertIn("Open each PDF directly from here", javascript)
        self.assertIn("const saveBeforeGenerate = !!options.saveMplDraft && activeKeheDocumentType === 'masterPackingList';", javascript)


if __name__ == "__main__":
    unittest.main()
