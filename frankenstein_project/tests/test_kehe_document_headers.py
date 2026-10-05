import asyncio
import io
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch
from fastapi import UploadFile

from pipelines.kehe.asn_parser import Item, Pack
from pipelines.kehe.common import _aggregate_mpl_items_for_editor
from pipelines.kehe.document_headers import build_document_shipments
from pipelines.kehe.gs1_labels import run_pipeline
from pipelines.kehe.mpl import build_kehe_master_packing_list_draft, render_kehe_master_packing_list_pdf
from pipelines.kehe.pack_labels import build_kehe_pack_label_draft, render_kehe_pack_label_pdf
from pipelines.kehe.pallet_labels import build_kehe_pallet_label_draft, render_kehe_pallet_label_pdf
from labelkit.routes.generation import (
    prepare_kehe_master_packing_list,
    prepare_kehe_pack_labels,
    prepare_kehe_pallet_label,
)


def _segment(parent: ET.Element, segment_id: str, **values: str) -> ET.Element:
    segment = ET.SubElement(parent, "SegmentRef", ID=segment_id)
    for position, value in values.items():
        ET.SubElement(segment, "Element", Pos=position, Value=value)
    return segment


class KeheDocumentHeaderTests(unittest.TestCase):
    def test_prepare_endpoints_share_xml_upload_helper_and_keep_document_shapes(self):
        request = object()
        endpoints = (
            (prepare_kehe_pallet_label, {}, {"pallets": []}, "kehe_pallet_prepare_"),
            (prepare_kehe_master_packing_list, {"product_master_json": "[]"}, {"packing_lists": []}, "kehe_mpl_prepare_"),
            (prepare_kehe_pack_labels, {"product_master_json": "[]"}, {"pack_labels": []}, "kehe_pack_labels_prepare_"),
        )
        for endpoint, kwargs, expected, temp_prefix in endpoints:
            with self.subTest(endpoint=endpoint.__name__), tempfile.TemporaryDirectory() as root:
                created_paths = []
                real_mkdtemp = tempfile.mkdtemp

                def make_temp_dir(*, prefix):
                    path = real_mkdtemp(prefix=prefix, dir=root)
                    created_paths.append(Path(path))
                    return path

                module = "labelkit.routes.generation"
                with patch(f"{module}._require_permission"), patch("tempfile.mkdtemp", side_effect=make_temp_dir):
                    with patch(f"{module}._sync_kehe_dc_directory_for_pipeline"), \
                         patch(f"{module}._datastore_load_product_master", return_value=[]), \
                         patch(f"{module}._shared_product_master_file_read", return_value=[]), \
                         patch(f"{module}.build_kehe_pallet_label_draft", return_value={"pallets": []}), \
                         patch(f"{module}.build_kehe_master_packing_list_draft", return_value={"packing_lists": []}), \
                         patch(f"{module}.build_kehe_pack_label_draft", return_value={"pack_labels": []}):
                        upload = UploadFile(filename="prepared.xml", file=io.BytesIO(b"<Root/>"))
                        response = asyncio.run(endpoint(request, [upload], **kwargs))

                self.assertEqual(200, response.status_code)
                payload = json.loads(response.body)
                self.assertIn(next(iter(expected)), payload)
                self.assertTrue(created_paths[0].name.startswith(temp_prefix))
                self.assertFalse(created_paths[0].exists())

    def test_pack_label_marks_invalid_gtin14_check_digit_for_review(self):
        label = {
            "id": "invalid-gtin",
            "gtin": "000000000000001",
            "description": "Test pack",
            "packaging_level": "Inner Pack",
            "copies": 1,
            "print_selected": True,
        }
        draft = {"pack_labels": [label]}

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "pack-label.pdf"
            report = render_kehe_pack_label_pdf(draft, str(output))

        self.assertEqual("Needs Review", label["status"])
        self.assertIn("GTIN-14 check digit is invalid.", label["warnings"])
        self.assertEqual("Needs Review", report["rows"][0]["status"])

    def test_mpl_aggregation_combines_duplicate_items_and_po_numbers(self):
        first = Pack(
            sscc="001234567890123452",
            po="PO-ONE",
            items=[Item(upc="850068684784", description="TEST PRODUCT", qty=12)],
        )
        second = Pack(
            sscc="001234567890123469",
            po="PO-TWO",
            items=[Item(upc="850068684784", description="TEST PRODUCT", qty=24)],
        )

        rows = _aggregate_mpl_items_for_editor(
            [first, second],
            [],
            total_pallets="1",
            preserve_pack_pallets=False,
        )

        self.assertEqual(1, len(rows))
        self.assertEqual("36", rows[0]["total_shipped"])
        self.assertEqual("PO-ONE, PO-TWO", rows[0]["customer_po_number"])

    def test_shipment_helpers_are_available_to_pallet_label_preparation(self):
        root = ET.Element("Root")
        transaction = ET.SubElement(root, "Transaction")
        _segment(transaction, "BSN", **{"01": "00", "02": "ASN-TEST"})

        shipment = ET.SubElement(transaction, "HL-LOOP")
        _segment(shipment, "HL", **{"01": "1", "03": "S"})
        _segment(shipment, "TD1", **{"01": "PLT", "02": "1", "07": "100", "08": "LB"})
        _segment(shipment, "TD5", **{"02": "2", "03": "UPSN", "05": "UPS"})
        _segment(shipment, "REF", **{"01": "BM", "02": "BOL-TEST"})
        _segment(shipment, "DTM", **{"01": "011", "02": "20260914"})
        for qualifier, name in (("SF", "BAKELL LLC"), ("ST", "KEHE TEST DC"), ("VN", "BAKELL")):
            n1_loop = ET.SubElement(shipment, "N1-LOOP")
            _segment(n1_loop, "N1", **{"01": qualifier, "02": name})
            _segment(n1_loop, "N3", **{"01": "100 TEST STREET"})
            _segment(n1_loop, "N4", **{"01": "AURORA", "02": "CO", "03": "80011", "04": "US"})

        order = ET.SubElement(transaction, "HL-LOOP")
        _segment(order, "HL", **{"01": "2", "02": "1", "03": "O"})
        _segment(order, "PRF", **{"01": "PO-TEST", "04": "20260913"})
        _segment(order, "REF", **{"01": "IA", "02": "VENDOR-TEST"})

        pallet = ET.SubElement(transaction, "HL-LOOP")
        _segment(pallet, "HL", **{"01": "3", "02": "2", "03": "T"})
        _segment(pallet, "MAN", **{"01": "GM", "02": "001234567890123452"})

        item = ET.SubElement(transaction, "HL-LOOP")
        _segment(item, "HL", **{"01": "4", "02": "3", "03": "I"})
        _segment(item, "LIN", **{"01": "1", "02": "UP", "03": "850068684784"})
        _segment(item, "SN1", **{"02": "12", "03": "EA"})
        _segment(item, "PID", **{"05": "TEST PRODUCT"})

        with tempfile.TemporaryDirectory() as temp_dir:
            xml_path = Path(temp_dir) / "kehe.xml"
            ET.ElementTree(root).write(xml_path, encoding="utf-8", xml_declaration=True)

            shipments = build_document_shipments([str(xml_path)])
            pallet_draft = build_kehe_pallet_label_draft([str(xml_path)])
            mpl_draft = build_kehe_master_packing_list_draft([str(xml_path)])
            pack_draft = build_kehe_pack_label_draft(
                [str(xml_path)],
                product_master_rows=[{
                    "is_active": True,
                    "gtin": "850068684784",
                    "description": "TEST PRODUCT",
                    "packaging_level": "Case",
                    "case_qty": "12",
                    "default_copies": "2",
                    "gross_weight_lbs": "5",
                }],
            )

            outputs = {
                "pallet": Path(temp_dir) / "pallet.pdf",
                "mpl": Path(temp_dir) / "mpl.pdf",
                "pack": Path(temp_dir) / "pack.pdf",
                "gs1": Path(temp_dir) / "gs1.pdf",
            }
            render_kehe_pallet_label_pdf(pallet_draft, str(outputs["pallet"]))
            render_kehe_master_packing_list_pdf(mpl_draft, str(outputs["mpl"]))
            render_kehe_pack_label_pdf(pack_draft, str(outputs["pack"]))
            run_pipeline([str(xml_path)], str(outputs["gs1"]))

            for output in outputs.values():
                self.assertGreater(output.stat().st_size, 0, output.name)

        header = shipments["shipments"][0]["header"]
        self.assertEqual("PLT", header["td1_package_code"])
        self.assertEqual("1", header["xml_total_pallets"])
        self.assertEqual("UPS", header["carrier"])
        self.assertEqual("PO-TEST", header["customer_po_number"])
        self.assertEqual(1, pallet_draft["summary"]["groups"])
        self.assertEqual("001234567890123452", pallet_draft["pallets"][0]["source_sscc"])
        self.assertEqual(1, mpl_draft["summary"]["packing_lists"])
        self.assertEqual(1, pack_draft["summary"]["labels"])


if __name__ == "__main__":
    unittest.main()
