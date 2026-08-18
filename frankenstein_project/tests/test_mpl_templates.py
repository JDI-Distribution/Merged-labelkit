import base64
import tempfile
import unittest
from pathlib import Path

import fitz

from pipelines.kehe.common import _MPL_BRAND_LOGO_PATHS, _mpl_template_id, render_kehe_master_packing_list_pdf


class MplTemplateTests(unittest.TestCase):
    _ONE_PIXEL_PNG = "data:image/png;base64," + base64.b64encode(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDAT\x08\xd7c\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82"
    ).decode("ascii")

    def _draft(self, template_id: str, *, standalone: bool = True, brand_id: str = "jdi_distribution"):
        titles = {
            "decopac": "Pallet Breakdown",
            "dutch_bros": "Pallet Breakdown",
            "standard": "MASTER PACKING LIST",
        }
        suppliers = {
            "brew_glitter": "BREW GLITTER",
            "bakell": "BAKELL LLC",
            "pfg": "PFG",
            "jdi_distribution": "JDI DISTRIBUTION",
        }
        return {
            "document_type": "kehe_master_packing_list",
            "standalone_mpl": standalone,
            "template_id": template_id,
            "brand_id": brand_id,
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
                    "each_net_weight_g": "25",
                    "case_qty": "48",
                    "in_packing_list": True,
                },
            ],
            "packing_lists": [
                {
                    "id": "MPL-TEST",
                    "title": titles.get(template_id, "MASTER PACKING LIST"),
                    "standard_heading": "Packing List",
                    "standard_subheading": "Shipment and Pallet Detail",
                    "template_id": template_id,
                    "brand_id": brand_id,
                    "status": "Ready",
                    "customer_po_number": "PO-100",
                    "ship_to": "TEST CUSTOMER\n123 MAIN ST\nREDLANDS, CA 92373",
                    "supplier_info": f"{suppliers[brand_id]}\n1967 ESSEX CT\nREDLANDS, CA 92373",
                    "bill_to": "TEST CUSTOMER\n123 MAIN ST\nREDLANDS, CA 92373",
                    "total_pallets": "1",
                    "pallet_heading": "PALLET 1",
                    "delivery_from_name": suppliers[brand_id],
                    "phone_number": "909-555-0100",
                    "_pallet_ids": ["1"],
                    "_pallet_weights": {"1": "120 LBS"},
                    "_pallet_dimensions": {"1": "48 x 40 in"},
                    "_pallet_tihi": {"1": "5 x 4"},
                    "items": [
                        {
                            "line": 1,
                            "location_on_pallet": "1",
                            "sku": "TEST-SKU",
                            "description": "Test Product",
                            "invoice_po_number": "INV-100",
                            "lot": "LOT-42",
                            "color": "Gold",
                            "balance_owed": "0",
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

    def _render_first_page_size(self, draft):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "mpl.pdf"
            render_kehe_master_packing_list_pdf(draft, str(output_path))
            with fitz.open(output_path) as document:
                return document[0].rect.width, document[0].rect.height

    def _render_first_page_image_count(self, draft) -> int:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "mpl.pdf"
            render_kehe_master_packing_list_pdf(draft, str(output_path))
            with fitz.open(output_path) as document:
                return len(document[0].get_images(full=True))

    def _render_page_texts(self, draft):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "mpl.pdf"
            render_kehe_master_packing_list_pdf(draft, str(output_path))
            with fitz.open(output_path) as document:
                return [page.get_text() for page in document]

    def _add_second_pallet_and_snapshots(self, draft):
        mpl = draft["packing_lists"][0]
        second_item = dict(mpl["items"][0])
        second_item.update({"line": 2, "location_on_pallet": "2", "item_number": "TEST-SKU-2"})
        mpl["items"].append(second_item)
        mpl["_pallet_ids"] = ["1", "2"]
        mpl["_pallet_weights"]["2"] = "130 LBS"
        mpl["_pallet_dimensions"]["2"] = "48 x 40 in"
        mpl["_pallet_tihi"]["2"] = "4 x 3"
        mpl["total_pallets"] = "2"
        mpl["_tihi_snapshot"] = {
            "constraints": {},
            "warnings": [],
            "entries": [
                {"pallet": "1", "pallet_label": "1", "image_data_url": self._ONE_PIXEL_PNG},
                {"pallet": "2", "pallet_label": "2", "image_data_url": self._ONE_PIXEL_PNG},
            ],
        }
        return draft

    def test_kehe_draft_is_locked_to_kehe_template(self):
        mpl = {"template_id": "compact"}

        template_id = _mpl_template_id({"standalone_mpl": False}, mpl)

        self.assertEqual("kehe", template_id)
        self.assertEqual("kehe", mpl["template_id"])

    def test_standalone_standard_template_renders_standard_title(self):
        text = self._render_first_page_text(self._draft("standard"))

        self.assertIn("MASTER PACKING LIST", text)
        self.assertIn("Packing List", text)
        self.assertIn("SHIPMENT AND PALLET DETAIL", text)
        self.assertNotIn("COMPACT PACKING LIST", text)

    def test_standard_letterhead_text_is_editable_and_reaches_pdf(self):
        draft = self._draft("standard")
        mpl = draft["packing_lists"][0]
        mpl["standard_heading"] = "Outbound Shipping Manifest"
        mpl["standard_subheading"] = "Warehouse Release and Pallet Detail"

        text = self._render_first_page_text(draft)

        self.assertIn("Outbound Shipping Manifest", text)
        self.assertIn("WAREHOUSE RELEASE AND PALLET DETAIL", text)
        self.assertNotIn("Editable supplier-branded shipping document", text)

    def test_standalone_decopac_template_renders_decopac_title_and_details(self):
        draft = self._draft("decopac", brand_id="bakell")
        text = self._render_first_page_text(draft)
        width, height = self._render_first_page_size(draft)

        self.assertIn("Pallet Breakdown", text)
        self.assertIn("BAKELL", text)
        self.assertIn("DELIVERY FROM", text)
        self.assertIn("Units on this Pallet", text)
        self.assertIn("PALLET SUMMARY", text)
        self.assertIn("LOT-42", text)
        self.assertIn("5 x 4", text)
        self.assertGreater(width, height)

    def test_standalone_dutch_bros_template_renders_customer_title(self):
        draft = self._draft("dutch_bros", brand_id="pfg")
        text = self._render_first_page_text(draft)
        width, height = self._render_first_page_size(draft)

        self.assertIn("DUTCH BROS", text)
        self.assertIn("Pallet Breakdown", text)
        self.assertIn("PFG", text)
        self.assertIn("PALLET SUMMARY", text)
        self.assertIn("Units on this Pallet", text)
        self.assertGreater(width, height)

    def test_decopac_and_dutch_bros_default_to_bakell_when_brand_is_missing(self):
        for template_id in ("decopac", "dutch_bros"):
            with self.subTest(template=template_id):
                draft = self._draft(template_id, brand_id="jdi_distribution")
                draft.pop("brand_id", None)
                mpl = draft["packing_lists"][0]
                mpl.pop("brand_id", None)
                mpl["supplier_info"] = "JDI DISTRIBUTION\n1967 ESSEX CT\nREDLANDS, CA 92373"
                image_count = self._render_first_page_image_count(draft)
                self.assertEqual("bakell", mpl["brand_id"])
                self.assertGreaterEqual(image_count, 1)

    def test_removed_compact_standalone_option_migrates_to_standard(self):
        draft = self._draft("compact")
        text = self._render_first_page_text(draft)
        self.assertEqual("standard", draft["packing_lists"][0]["template_id"])
        self.assertIn("MASTER PACKING LIST", text)
        self.assertNotIn("COMPACT PACKING LIST", text)

    def test_standalone_kehe_template_remains_available(self):
        draft = self._draft("kehe")
        text = self._render_first_page_text(draft)
        self.assertEqual("kehe", draft["packing_lists"][0]["template_id"])
        self.assertIn("MASTER PACKING LIST", text)
        self.assertIn("Customer PO Number", text)

    def test_kehe_omits_secondary_line_item_metadata(self):
        draft = self._draft("kehe")
        item = draft["packing_lists"][0]["items"][0]
        item["quantity_per_case"] = "1"
        item["product_size"] = "1 LB"

        text = self._render_first_page_text(draft)

        self.assertNotIn("PO: INV-100", text)
        self.assertNotIn("LOT: LOT-42", text)
        self.assertNotIn("QTY/CASE: 1", text)
        self.assertNotIn("SIZE: 1 LB", text)

    def test_standard_omits_secondary_line_item_metadata(self):
        draft = self._draft("standard")
        item = draft["packing_lists"][0]["items"][0]
        item["quantity_per_case"] = "1"
        item["product_size"] = "1 LB"

        text = self._render_first_page_text(draft)

        self.assertNotIn("PO: INV-100", text)
        self.assertNotIn("LOT: LOT-42", text)
        self.assertNotIn("QTY/CASE: 1", text)
        self.assertNotIn("SIZE: 1 LB", text)

    def test_all_four_supplier_brands_render_in_standard_template(self):
        expected = {
            "brew_glitter": "BREW GLITTER",
            "bakell": "BAKELL",
            "pfg": "PFG",
            "jdi_distribution": "JDI DISTRIBUTION",
        }
        for brand_id, brand_text in expected.items():
            with self.subTest(brand=brand_id):
                text = self._render_first_page_text(self._draft("standard", brand_id=brand_id))
                self.assertIn(brand_text, text)

    def test_all_four_supplier_brands_use_png_artwork_in_pdf(self):
        for brand_id, logo_path in _MPL_BRAND_LOGO_PATHS.items():
            with self.subTest(brand=brand_id):
                self.assertEqual(".png", logo_path.suffix.lower())
                self.assertTrue(logo_path.is_file())
                with tempfile.TemporaryDirectory() as temp_dir:
                    output_path = Path(temp_dir) / f"{brand_id}.pdf"
                    render_kehe_master_packing_list_pdf(
                        self._draft("standard", brand_id=brand_id),
                        str(output_path),
                    )
                    with fitz.open(output_path) as document:
                        self.assertGreaterEqual(len(document[0].get_images(full=True)), 1)

    def test_kehe_render_ignores_standalone_template_request(self):
        text = self._render_first_page_text(self._draft("dutch_bros", standalone=False))

        self.assertIn("MASTER PACKING LIST", text)
        self.assertNotIn("COMPACT PACKING LIST", text)

    def test_standard_pdf_places_all_tihi_previews_after_pallet_details(self):
        texts = self._render_page_texts(self._add_second_pallet_and_snapshots(self._draft("standard")))

        self.assertIn("MASTER PACKING LIST", texts[0])
        self.assertNotIn("TI-HI LAYOUT PREVIEW", texts[0])
        self.assertIn("PALLET 1 TI-HI LAYOUT PREVIEW", texts[-2])
        self.assertIn("PALLET 2 TI-HI LAYOUT PREVIEW", texts[-1])

    def test_decopac_pdf_places_summary_before_all_tihi_previews(self):
        draft = self._add_second_pallet_and_snapshots(self._draft("decopac", brand_id="bakell"))
        texts = self._render_page_texts(draft)

        self.assertIn("PALLET SUMMARY", texts[0])
        self.assertNotIn("TI-HI LAYOUT PREVIEW", texts[0])
        self.assertIn("PALLET 1 TI-HI LAYOUT PREVIEW", texts[-2])
        self.assertIn("PALLET 2 TI-HI LAYOUT PREVIEW", texts[-1])


if __name__ == "__main__":
    unittest.main()
