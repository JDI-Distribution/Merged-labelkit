import io
import tempfile
import unittest
from pathlib import Path

import pymupdf
from reportlab.pdfgen import canvas
from pipelines.address_text import normalize_address_fields, normalize_address_text
from pipelines.kehe.common import _draw_value_lines
from pipelines.kehe.pallet_labels import render_kehe_pallet_label_pdf
from pipelines.b2b_labels.renderer import _job_value
from pipelines.michaels.renderers import wrap_address_parts
from labelkit.reference_data import normalize_dc_directory_row
from labelkit.draft_store import _mpl_draft_for_storage, _hydrate_saved_mpl_record


class AddressDelimiterTests(unittest.TestCase):
    def test_only_address_fields_are_normalized_and_existing_order_is_preserved(self):
        data = {'ship_to': 'Contact | Warehouse\n123 Street | Suite 200',
                'product': {'description': 'Sugar | Purple', 'sku': 'A|B'},
                'order_details': {'shipping_street1': '123 Street|Suite 200'}}
        normalize_address_fields(data)
        self.assertEqual(data['ship_to'], 'Contact\nWarehouse\n123 Street\nSuite 200')
        self.assertEqual(data['order_details']['shipping_street1'], '123 Street\nSuite 200')
        self.assertEqual(data['product'], {'description': 'Sugar | Purple', 'sku': 'A|B'})
        self.assertEqual(normalize_address_text('A\nB'), 'A\nB')

    def test_directory_and_saved_drafts_remove_legacy_pipes(self):
        source = {'record_type': 'SHIP_TO', 'address': 'Warehouse | 123 Main | CA 92373'}
        row = normalize_dc_directory_row(source)
        self.assertEqual(row['address'], 'Warehouse\n123 Main\nCA 92373')
        self.assertEqual(source['address'], 'Warehouse | 123 Main | CA 92373')
        draft = {'packing_lists': [{'ship_to': source['address'], 'items': []}]}
        self.assertNotIn('|', _mpl_draft_for_storage(draft)['packing_lists'][0]['ship_to'])
        hydrated = _hydrate_saved_mpl_record({'draft': draft}, [])
        self.assertNotIn('|', hydrated['draft']['packing_lists'][0]['ship_to'])

    def test_gs1_address_drawing_never_inserts_pipe_delimiters(self):
        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer)
        _draw_value_lines(pdf, ['Warehouse | Dock A', '123 Street', 'City CA 92373'], 30, 750, 250, max_lines=6)
        pdf.save()
        with pymupdf.open(stream=buffer.getvalue(), filetype='pdf') as document:
            text = document[0].get_text()
            self.assertIn('Warehouse\nDock A\n123 Street\nCity CA 92373', text)
            self.assertNotIn('|', text)

    def test_pallet_placard_addresses_do_not_contain_pipes(self):
        draft = {'pallets': [{'ship_from': 'Supplier | 123 Road | Redlands CA 92373',
                               'ship_to': 'Warehouse | 456 Road | City TX 75001', 'copies': 1}]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'pallet.pdf'
            render_kehe_pallet_label_pdf(draft, str(path))
            with pymupdf.open(path) as pdf:
                text = pdf[0].get_text()
                self.assertNotIn('|', text)
                self.assertIn('Warehouse', text)
                self.assertIn('456 Road', text)

    def test_b2b_and_michaels_use_address_only_cleanup(self):
        job = {'run': {'ship_from': 'Supplier | Street'}, 'product': {'description': 'Sugar | Purple'}}
        self.assertEqual(_job_value(job, 'ship_from'), 'Supplier\nStreet')
        self.assertEqual(_job_value(job, 'description'), 'Sugar | Purple')
        self.assertEqual(wrap_address_parts(['Warehouse | Dock A', 'Street'], 'Helvetica', 8, 300), ['Warehouse', 'Dock A', 'Street'])


if __name__ == '__main__':
    unittest.main()
