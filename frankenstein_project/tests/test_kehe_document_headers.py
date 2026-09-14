import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from pipelines.kehe.document_headers import build_document_shipments
from pipelines.kehe.pallet_labels import build_kehe_pallet_label_draft


def _segment(parent: ET.Element, segment_id: str, **values: str) -> ET.Element:
    segment = ET.SubElement(parent, "SegmentRef", ID=segment_id)
    for position, value in values.items():
        ET.SubElement(segment, "Element", Pos=position, Value=value)
    return segment


class KeheDocumentHeaderTests(unittest.TestCase):
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
        _segment(pallet, "MAN", **{"01": "GM", "02": "001234567890123457"})

        item = ET.SubElement(transaction, "HL-LOOP")
        _segment(item, "HL", **{"01": "4", "02": "3", "03": "I"})
        _segment(item, "LIN", **{"01": "1", "02": "UP", "03": "850068684784"})
        _segment(item, "SN1", **{"02": "12", "03": "EA"})
        _segment(item, "PID", **{"05": "TEST PRODUCT"})

        with tempfile.TemporaryDirectory() as temp_dir:
            xml_path = Path(temp_dir) / "kehe.xml"
            ET.ElementTree(root).write(xml_path, encoding="utf-8", xml_declaration=True)

            shipments = build_document_shipments([str(xml_path)])
            draft = build_kehe_pallet_label_draft([str(xml_path)])

        header = shipments["shipments"][0]["header"]
        self.assertEqual("PLT", header["td1_package_code"])
        self.assertEqual("1", header["xml_total_pallets"])
        self.assertEqual("UPS", header["carrier"])
        self.assertEqual("PO-TEST", header["customer_po_number"])
        self.assertEqual(1, draft["summary"]["groups"])
        self.assertEqual("001234567890123457", draft["pallets"][0]["source_sscc"])


if __name__ == "__main__":
    unittest.main()
