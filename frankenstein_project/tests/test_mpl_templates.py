import tempfile
import unittest
from pathlib import Path

import fitz

from pipelines.kehe.common import _mpl_template_id, render_kehe_master_packing_list_pdf


class MplTemplateTests(unittest.TestCase):
    def _draft(self, template_id: str, *, standalone: bool = True):
        return {
            "document_type": "kehe_master_packing_list",
            "standalone_mpl": standalone,
            "template_id": template_id,
            "product_master": [
                {
                    "storefront": "Test",
                    "packaging_level": "Each",
                    "gtin": "00850068684784",
                    "sku": "TEST-SKU",
                    "description": "Test Product",
                    "in_packing_list": True,
                },
                {
                    "storefront": "Test",
                    "packaging_level": "Case",
                    "gtin": "10850068684781",
                    "sku": "TEST-SKU",
                    "description": "Test Product",
                    "dimensions_in": "12 x 10 x 8",
                    "weight_lbs": "10",
                    "in_packing_list": True,
                },
            ],
            "packing_lists": [
                {
                    "id": "MPL-TEST",
                    "template_id": template_id,
                    "status": "Ready",
                    "customer_po_number": "PO-100",
                    "ship_to": "TEST CUSTOMER\n123 MAIN ST\nREDLANDS, CA 92373",
                    "supplier_info": "BAKELL LLC\n1967 ESSEX CT\nREDLANDS, CA 92373",
                    "bill_to": "TEST CUSTOMER\n123 MAIN ST\nREDLANDS, CA 92373",
                    "total_pallets": "1",
                    "_pallet_ids": ["1"],
                    "_pallet_weights": {},
                    "items": [
                        {
                            "line": 1,
                            "location_on_pallet": "1",
                            "sku": "TEST-SKU",
                            "description": "Test Product",
                            "qty_on_pallet": "12",
                            "total_ordered": "12",
                            "total_shipped": "12",
                            "uom": "CASES",
                        }
                    ],
                }
            ],
        }

    def _render_first_page_text(self, draft) -> str:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "mpl.pdf"
            render_kehe_master_packing_list_pdf(draft, str(output_path))
            with fitz.open(output_path) as document:
                return document[0].get_text()

    def test_kehe_draft_is_locked_to_kehe_template(self):
        mpl = {"template_id": "compact"}

        template_id = _mpl_template_id({"standalone_mpl": False}, mpl)

        self.assertEqual("kehe", template_id)
        self.assertEqual("kehe", mpl["template_id"])

    def test_standalone_standard_template_renders_standard_title(self):
        text = self._render_first_page_text(self._draft("standard"))

        self.assertIn("PACKING LIST", text)
        self.assertNotIn("COMPACT PACKING LIST", text)

    def test_standalone_compact_template_renders_compact_title(self):
        text = self._render_first_page_text(self._draft("compact"))

        self.assertIn("COMPACT PACKING LIST", text)

    def test_standalone_kehe_template_renders_master_title(self):
        text = self._render_first_page_text(self._draft("kehe"))

        self.assertIn("MASTER PACKING LIST", text)
        self.assertNotIn("COMPACT PACKING LIST", text)

    def test_kehe_render_ignores_standalone_template_request(self):
        text = self._render_first_page_text(self._draft("compact", standalone=False))

        self.assertIn("MASTER PACKING LIST", text)
        self.assertNotIn("COMPACT PACKING LIST", text)


if __name__ == "__main__":
    unittest.main()
