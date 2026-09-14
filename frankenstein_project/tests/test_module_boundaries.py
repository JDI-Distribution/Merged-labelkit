import unittest

from labelkit import order_intake
import pipelines.kehe_pipeline as kehe_compat
from pipelines.kehe import asn_parser as kehe_asn
from pipelines.kehe import document_headers as kehe_headers
from pipelines.kehe import gs1_labels as kehe_gs1
from pipelines.kehe import mpl as kehe_mpl
from pipelines.kehe import mpl_renderer as kehe_mpl_renderer
from pipelines.kehe import pack_labels as kehe_pack
from pipelines.kehe import pallet_labels as kehe_pallet
from pipelines.kehe import product_master as kehe_products
from pipelines.kehe import tihi as kehe_tihi
from pipelines.kehe import tihi_layout as kehe_tihi_layout
from pipelines.michaels import asn_parser as michaels_asn
from pipelines.michaels import matcher as michaels_matcher
from pipelines.michaels import ocr as michaels_ocr
from pipelines.michaels import renderers as michaels_renderers


class ModuleBoundaryTests(unittest.TestCase):
    def test_kehe_boundaries_own_their_implementations(self):
        self.assertEqual(kehe_asn.__name__, kehe_asn.parse_asn.__module__)
        self.assertEqual(kehe_headers.__name__, kehe_headers.build_document_shipments.__module__)
        self.assertEqual(kehe_products.__name__, kehe_products.apply_product_master_to_mpl_draft.__module__)
        self.assertEqual(kehe_gs1.__name__, kehe_gs1.render_gs1_label_page.__module__)
        self.assertEqual(kehe_pallet.__name__, kehe_pallet.render_kehe_pallet_label_pdf.__module__)
        self.assertEqual(kehe_pack.__name__, kehe_pack.render_kehe_pack_label_pdf.__module__)
        self.assertEqual(kehe_mpl.__name__, kehe_mpl.render_kehe_master_packing_list_pdf.__module__)
        self.assertEqual(kehe_mpl_renderer.__name__, kehe_mpl._mpl_template_id.__module__)
        self.assertEqual(kehe_tihi_layout.__name__, kehe_tihi._mpl_build_tihi_entries.__module__)

    def test_kehe_compatibility_wrapper_preserves_useful_public_api(self):
        expected_names = (
            "Address",
            "Item",
            "Order",
            "Pack",
            "build_document_shipments",
            "format_sscc_groups",
            "normalize_sscc",
            "parse_asn",
            "parse_kehe_document_header",
            "parse_kehe_document_headers",
            "wrap_text",
        )
        for name in expected_names:
            self.assertIn(name, kehe_compat.__all__)
            self.assertTrue(hasattr(kehe_compat, name), name)

    def test_michaels_boundaries_own_their_implementations(self):
        self.assertEqual(michaels_asn.__name__, michaels_asn.parse_asn.__module__)
        self.assertEqual(michaels_ocr.__name__, michaels_ocr._extract_page_identifiers.__module__)
        self.assertEqual(michaels_matcher.__name__, michaels_matcher._match_pack.__module__)
        self.assertEqual(michaels_renderers.__name__, michaels_renderers.render_gs1_label_page.__module__)

    def test_order_intake_logic_is_not_implemented_in_server(self):
        self.assertEqual(order_intake.__name__, order_intake._analytics_case_conversion.__module__)
        self.assertEqual(order_intake.__name__, order_intake._select_analytics_order_instance.__module__)


if __name__ == "__main__":
    unittest.main()
