import json
import unittest
from pathlib import Path

import pymupdf as fitz

from pipelines.b2b_labels import render_b2b_label_pdf, validate_b2b_job
from server import _render_b2b_batch_pdf


APP_DIR = Path(__file__).resolve().parents[1]


class B2BLabelRendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        registry = json.loads(
            (APP_DIR / "data" / "b2b_label_templates.json").read_text(encoding="utf-8")
        )
        cls.templates = registry["templates"]

    def _job(self, template):
        return {
            "template_id": template["template_id"],
            "product": {
                "storefront": template.get("customer") or "Test Customer",
                "sku": "TEST-SKU-001",
                "customer_item_number": "62924",
                "description": "Brew Glitter Red 4g Pump Case",
                "gtin": "607772629240",
                "barcode_type": "UPC_A",
                "case_qty": "96",
                "each_net_weight_g": "4",
                "package_net_weight_g": "384",
                "gross_weight_lbs": "8.5",
                "length_in": "11",
                "width_in": "8",
                "height_in": "12",
            },
            "directory": {
                "name": template.get("customer") or "Test Customer",
                "delivery_address": "ANOKA, MN USA",
                "manufacturer_name": "BAKELL LLC",
                "manufacturer_address": "1967 ESSEX CT\nREDLANDS, CA 92373\nUSA",
                "receiving_email": "receiving@example.com",
                "docking_instructions": "Receiving by appointment Monday through Friday.",
            },
            "run": {
                "po_number": "PO-1001",
                "order_number": "SO-2002",
                "invoice_number": "INV-3003",
                "lot_number": "LOT-4004",
                "best_before": "2027-08-10",
                "ship_date": "2026-08-01",
                "quantity_label": "288 units",
                "expected_delivery_date": "2026-08-10",
                "project_name": "Bulk Brew Glitter",
                "allergens": "None",
                "required_statement": "Further processing and labeling required for retail sale.",
                "carton_total": "3",
                "carton_start": "2",
                "carton_end": "3",
                "copies": str(template.get("default_copies") or 1),
            },
        }

    def test_registry_has_a_working_renderer_for_every_supported_label(self):
        self.assertEqual(11, len(self.templates))
        for template in self.templates:
            with self.subTest(template=template["template_id"]):
                job = self._job(template)
                result = render_b2b_label_pdf(job, template)
                expected_pages = 2 * int(template.get("default_copies") or 1)
                self.assertEqual(expected_pages, result["pages"])
                self.assertTrue(result["pdf_bytes"].startswith(b"%PDF"))

                document = fitz.open(stream=result["pdf_bytes"], filetype="pdf")
                self.assertEqual(expected_pages, document.page_count)
                page = document[0]
                self.assertAlmostEqual(float(template["physical_width_in"]) * 72, page.rect.width, delta=0.5)
                self.assertAlmostEqual(float(template["physical_height_in"]) * 72, page.rect.height, delta=0.5)
                text = "\n".join(item.get_text() for item in document)
                renderer = template.get("renderer_key")
                if renderer == "fancy_pallet_3x3":
                    self.assertIn("2", text)
                    self.assertIn("3", text)
                elif renderer == "decopac_case_4x6":
                    self.assertIn("Carton No.  2 of 3", text)
                else:
                    self.assertIn("Box 2 of 3", text)

    def test_registry_contains_only_current_templates_and_compact_layout_is_shared(self):
        template_ids = {template["template_id"] for template in self.templates}
        self.assertEqual(
            {
                "DECOPAC_CASE_4X6",
                "DISNEY_CASE_3X3",
                "FANCY_SRD_3X3",
                "FANCY_MASTER_PACK_3X3",
                "FANCY_PALLET_3X3",
                "DUTCH_PFG_3X3",
                "DUTCH_OTHER_3X3",
                "MIXED_CASE_3X1_5",
                "STANDARD_CASE_PACK_4X6",
                "STANDARD_CASE_PACK_VERTICAL_4X6",
                "BULK_FURTHER_PROCESSING_4X6",
            },
            template_ids,
        )
        compact_ids = {
            template["template_id"]
            for template in self.templates
            if template.get("renderer_key") == "compact_case_3x3"
        }
        self.assertEqual(
            {"FANCY_SRD_3X3", "FANCY_MASTER_PACK_3X3", "DUTCH_PFG_3X3", "DUTCH_OTHER_3X3"},
            compact_ids,
        )

    def test_every_template_has_at_least_one_enabled_configuration(self):
        product_document = json.loads(
            (APP_DIR / "data" / "mpl_product_master.json").read_text(encoding="utf-8")
        )
        enabled_templates = {
            str(row.get("label_template_id") or "")
            for row in product_document.get("rows", [])
            if row.get("label_enabled") and row.get("is_active")
        }
        for template in self.templates:
            self.assertIn(template["template_id"], enabled_templates)

    def test_missing_business_values_are_warnings_not_renderer_blocks(self):
        template = self.templates[0]
        job = self._job(template)
        job["product"]["customer_item_number"] = ""
        warnings = validate_b2b_job(job, template)
        self.assertTrue(any("customer_item_number" in warning for warning in warnings))
        result = render_b2b_label_pdf(job, template)
        self.assertGreater(len(result["pdf_bytes"]), 1000)

    def test_impossible_carton_range_is_rejected(self):
        template = self.templates[0]
        job = self._job(template)
        job["run"].update({"carton_start": "4", "carton_end": "3", "carton_total": "3"})
        with self.assertRaisesRegex(ValueError, "Carton range"):
            render_b2b_label_pdf(job, template)

    def test_quantity_uses_case_qty_text(self):
        template = next(t for t in self.templates if t["template_id"] == "DECOPAC_CASE_4X6")
        job = self._job(template)
        job["product"]["case_qty"] = "42"

        result = render_b2b_label_pdf(job, template)
        text = "\n".join(page.get_text() for page in fitz.open(stream=result["pdf_bytes"], filetype="pdf"))

        self.assertIn("Master Carton of 42", text)

    def test_every_label_can_optionally_render_or_hide_a_configured_barcode(self):
        for template in self.templates:
            with self.subTest(template=template["template_id"]):
                if template.get("barcode_policy") != "OPTIONAL" or "GTIN_14" not in template.get("allowed_barcode_types", []):
                    continue

                enabled_job = self._job(template)
                enabled_job["run"]["print_barcode"] = True
                enabled = render_b2b_label_pdf(enabled_job, template)
                enabled_text = "".join(
                    page.get_text() for page in fitz.open(stream=enabled["pdf_bytes"], filetype="pdf")
                ).replace(" ", "").replace("\n", "")
                self.assertIn("607772629240", enabled_text)

                disabled_job = self._job(template)
                disabled_job["run"]["print_barcode"] = False
                disabled = render_b2b_label_pdf(disabled_job, template)
                disabled_text = "".join(
                    page.get_text() for page in fitz.open(stream=disabled["pdf_bytes"], filetype="pdf")
                ).replace(" ", "").replace("\n", "")
                self.assertNotIn("607772629240", disabled_text)

    def test_long_label_text_is_preserved_in_final_pdf(self):
        long_description = "LONGDESCRIPTION" * 10
        long_sku = "SKU" * 14
        for template in self.templates:
            with self.subTest(template=template["template_id"]):
                if template.get("renderer_key") == "fancy_pallet_3x3":
                    continue
                job = self._job(template)
                job["product"]["description"] = long_description
                job["product"]["sku"] = long_sku
                job["run"]["print_barcode"] = True
                result = render_b2b_label_pdf(job, template)
                text = "".join(
                    page.get_text() for page in fitz.open(stream=result["pdf_bytes"], filetype="pdf")
                ).replace(" ", "").replace("\n", "")
                self.assertIn(long_description, text)

    def test_partner_batch_renders_all_selected_order_lines(self):
        decopac = next(template for template in self.templates if template["template_id"] == "DECOPAC_CASE_4X6")
        dutch = next(template for template in self.templates if template["template_id"] == "DUTCH_OTHER_3X3")
        first = self._job(decopac)
        first["run"].update({"carton_total": "2", "carton_start": "1", "carton_end": "2", "copies": "1"})
        second = self._job(dutch)
        second["product"]["sku"] = "DUTCH-SKU-002"
        second["run"].update({"carton_total": "1", "carton_start": "1", "carton_end": "1", "copies": "1"})
        fancy = next(template for template in self.templates if template["template_id"] == "FANCY_SRD_3X3")
        third = self._job(fancy)
        third["product"]["sku"] = "FANCY-SKU-003"
        third["run"].update({"carton_total": "1", "carton_start": "1", "carton_end": "1", "copies": "1"})

        pdf_bytes, pages, _warnings = _render_b2b_batch_pdf([first, second, third])

        self.assertEqual(4, pages)
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            self.assertEqual(4, document.page_count)
            self.assertAlmostEqual(6 * 72, document[0].rect.width, delta=0.5)
            self.assertAlmostEqual(6 * 72, document[-1].rect.width, delta=0.5)

    def test_combined_panel_formats_stay_on_one_physical_page(self):
        expected_repeat_text = {
            "DECOPAC_CASE_4X6": "Brew Glitter Red 4g Pump Case",
            "DUTCH_OTHER_3X3": "Brew Glitter Red 4g Pump Case",
            "FANCY_SRD_3X3": "Brew Glitter Red 4g Pump Case",
            "STANDARD_CASE_PACK_4X6": "Box 1 of 1",
            "STANDARD_CASE_PACK_VERTICAL_4X6": "Box 1 of 1",
        }
        for template_id, repeated_text in expected_repeat_text.items():
            template = next(item for item in self.templates if item["template_id"] == template_id)
            job = self._job(template)
            job["run"].update({"carton_total": "1", "carton_start": "1", "carton_end": "1", "copies": "1"})
            result = render_b2b_label_pdf(job, template)
            with fitz.open(stream=result["pdf_bytes"], filetype="pdf") as document:
                self.assertEqual(1, document.page_count)
                self.assertAlmostEqual(6 * 72, document[0].rect.width, delta=0.5)
                self.assertAlmostEqual(4 * 72, document[0].rect.height, delta=0.5)
                self.assertGreaterEqual(document[0].get_text().count(repeated_text), 2)

    def test_fancy_pallet_defaults_to_two_copies_per_pallet(self):
        template = next(item for item in self.templates if item["template_id"] == "FANCY_PALLET_3X3")
        job = self._job(template)
        job["run"].update({"carton_total": "2", "carton_start": "1", "carton_end": "2", "copies": "2"})
        result = render_b2b_label_pdf(job, template)
        self.assertEqual(4, result["pages"])
        text = "\n".join(page.get_text() for page in fitz.open(stream=result["pdf_bytes"], filetype="pdf"))
        for expected in ("DATE:", "NAME:", "QTY:", "LOT CODE:", "BB DATE:"):
            self.assertIn(expected, text)

if __name__ == "__main__":
    unittest.main()
