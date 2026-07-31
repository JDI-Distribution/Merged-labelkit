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
                "pack_statement": "96 units per case",
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
                self.assertIn("Box 2 of 3", text)

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


if __name__ == "__main__":
    unittest.main()
