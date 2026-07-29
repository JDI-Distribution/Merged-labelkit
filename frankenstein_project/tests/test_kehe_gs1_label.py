import re
import unittest

import fitz

from pipelines.kehe.common import Address, Item, Pack, render_gs1_label_page


class KeheGs1LabelTests(unittest.TestCase):
    def _render_text(self, pack: Pack) -> str:
        pdf_bytes = render_gs1_label_page(pack, order_index=1, total_orders=1)
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            return re.sub(r"\s+", " ", document[0].get_text()).strip()

    def test_ship_to_name_wraps_without_truncating_kehe_distributors(self):
        pack = Pack(
            sscc="001234567890123457",
            store="46",
            ship_from=Address(
                name="BAKELL LLC",
                line1="1967 ESSEX CT",
                city="REDLANDS",
                state="CA",
                zip="92373",
                country="USA",
            ),
            ship_to=Address(
                name="KEHE DISTRIBUTORS",
                line1="9550 SW GEMINI DR",
                city="BEAVERTON",
                state="OR",
                zip="97008",
                country="USA",
            ),
        )

        text = self._render_text(pack)

        self.assertIn("DC 46 - KEHE DISTRIBUTORS", text)
        self.assertIn("Manufacturing Plant #:", text)

    def test_traceability_rows_show_available_values(self):
        pack = Pack(
            sscc="001234567890123457",
            ship_to=Address(name="KEHE DISTRIBUTORS", zip="97008"),
            items=[
                Item(
                    upc="850068684784",
                    description="Test Product",
                    qty=1,
                    lot="LOT-123",
                    expiration_date="20300804",
                    manufacture_date="20250804",
                    plant="PLANT-42",
                )
            ],
        )

        text = self._render_text(pack)

        self.assertIn("Lot #: LOT-123", text)
        self.assertIn("Expiration Date: 08/04/2030", text)
        self.assertIn("Manufacturing Date: 08/04/2025", text)
        self.assertIn("Manufacturing Plant #: PLANT-42", text)


if __name__ == "__main__":
    unittest.main()
