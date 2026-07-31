import json
import unittest
from pathlib import Path

import fitz

from pipelines.b2b_labels import render_b2b_label_pdf, validate_b2b_job


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
        self.assertEqual(9, len(self.templates))
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
                self.assertIn("Box 2 of 3", text)

    def test_registry_contains_only_current_templates_and_compact_layout_is_shared(self):
        template_ids = {template["template_id"] for template in self.templates}
        self.assertEqual(
            {
                "DECOPAC_CASE_4X6",
                "DISNEY_CASE_3X3",
                "FANCY_SRD_3X3",
                "FANCY_MASTER_PACK_3X3",
                "DUTCH_PFG_3X3",
                "DUTCH_OTHER_3X3",
                "MIXED_CASE_3X1_5",
                "STANDARD_CASE_PACK_4X6",
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


if __name__ == "__main__":
    unittest.main()
