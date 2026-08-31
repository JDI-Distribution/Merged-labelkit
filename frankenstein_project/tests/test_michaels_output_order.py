import unittest
import zipfile
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import fitz

from pipelines.michaels import pipeline
from server import split_michaels_output_by_shipping_pdf


def _one_page_pdf(text: str) -> bytes:
    document = fitz.open()
    page = document.new_page(width=288, height=432)
    page.insert_text((24, 48), text)
    payload = document.tobytes()
    document.close()
    return payload


class MichaelsOutputOrderTests(unittest.TestCase):
    def _render_with_order(self, tmp_path: Path, group_by_pdf: bool):
        pack_b = pipeline.Pack(
            sscc="000000000000000002",
            tracking="1ZBBBBBBBBBBBBBBBB",
            po="40000002",
            store="200",
        )
        pack_a = pipeline.Pack(
            sscc="000000000000000001",
            tracking="1ZAAAAAAAAAAAAAAAA",
            po="40000001",
            store="100",
        )
        all_packs = [pack_b, pack_a]
        shipping_path = tmp_path / "shipping.pdf"
        shipping_doc = fitz.open()
        shipping_doc.new_page()
        shipping_doc.new_page()
        shipping_doc.save(shipping_path)
        shipping_doc.close()

        with ExitStack() as stack:
            stack.enter_context(
                mock.patch.object(pipeline, "convert_from_path", return_value=["A", "B"])
            )
            stack.enter_context(
                mock.patch.object(
                    pipeline,
                    "_ocr_image",
                    side_effect=lambda image: pack_a.tracking if image == "A" else pack_b.tracking,
                )
            )
            stack.enter_context(
                mock.patch.object(
                    pipeline,
                    "_shipping_page_to_bytes",
                    side_effect=lambda _document, page_index: _one_page_pdf(
                        f"SHIP-{page_index + 1}"
                    ),
                )
            )
            stack.enter_context(
                mock.patch.object(
                    pipeline,
                    "render_gs1_label_page",
                    side_effect=lambda pack, order_index, total_orders: _one_page_pdf(
                        f"GS1-{pack.store}-ORDER-{order_index}-OF-{total_orders}"
                    ),
                )
            )
            stack.enter_context(
                mock.patch.object(
                    pipeline,
                    "render_packing_list_pages",
                    side_effect=lambda pack, order_index, total_orders: _one_page_pdf(
                        f"PACK-{pack.store}-ORDER-{order_index}-OF-{total_orders}"
                    ),
                )
            )

            by_tracking, by_po, by_store, by_po_store = pipeline.build_pack_indexes(all_packs)
            output_path = tmp_path / ("pdf-order.pdf" if group_by_pdf else "xml-order.pdf")
            source_doc = fitz.open(shipping_path)
            try:
                report = pipeline._render_shipping_label_first(
                    fitz_doc=source_doc,
                    shipping_pdf_path=str(shipping_path),
                    all_packs=all_packs,
                    by_tracking=by_tracking,
                    by_po=by_po,
                    by_store=by_store,
                    by_po_store=by_po_store,
                    out_pdf=str(output_path),
                    ocr_dpi=72,
                    group_by_shipping_pdf=group_by_pdf,
                )
            finally:
                source_doc.close()

        output_doc = fitz.open(output_path)
        try:
            page_text = [page.get_text() for page in output_doc]
        finally:
            output_doc.close()
        return report, page_text

    def test_defaults_to_uploaded_pdf_grouping(self):
        with TemporaryDirectory() as temp_dir:
            report, page_text = self._render_with_order(Path(temp_dir), group_by_pdf=True)

        self.assertEqual(report["summary"]["output_order"], "Uploaded PDF order")
        self.assertIn("GS1-100-ORDER-1-OF-2", page_text[1])
        self.assertIn("GS1-200-ORDER-2-OF-2", page_text[4])
        self.assertEqual(report["rows"][0]["output_start_page"], 1)
        self.assertEqual(report["rows"][1]["output_start_page"], 4)

    def test_can_group_in_asn_xml_order(self):
        with TemporaryDirectory() as temp_dir:
            report, page_text = self._render_with_order(Path(temp_dir), group_by_pdf=False)

        self.assertEqual(report["summary"]["output_order"], "ASN XML order")
        self.assertIn("GS1-200-ORDER-1-OF-2", page_text[1])
        self.assertIn("GS1-100-ORDER-2-OF-2", page_text[4])
        self.assertEqual(report["rows"][0]["output_start_page"], 4)
        self.assertEqual(report["rows"][1]["output_start_page"], 1)

    def test_multiple_uploads_become_separate_pdfs_in_zip(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            combined_path = temp_path / "combined-output.pdf"
            combined_doc = fitz.open()
            for page_number in range(1, 7):
                page = combined_doc.new_page()
                page.insert_text((24, 48), f"OUTPUT-PAGE-{page_number}")
            combined_doc.save(combined_path)
            combined_doc.close()

            shipping_paths = []
            for name in ("US batch.pdf", "CAN batch.pdf"):
                path = temp_path / name
                document = fitz.open()
                document.new_page()
                document.save(path)
                document.close()
                shipping_paths.append(path)

            report = {
                "rows": [
                    {"label_page": 1, "output_start_page": 1, "output_end_page": 3},
                    {"label_page": 2, "output_start_page": 4, "output_end_page": 6},
                ]
            }
            zip_path, output_names, preview_path = split_michaels_output_by_shipping_pdf(
                combined_output_path=combined_path,
                shipping_pdf_paths=shipping_paths,
                shipping_pdf_names=["US original.pdf", "CAN original.pdf"],
                report=report,
                temp_dir=temp_path,
            )

            self.assertEqual(
                output_names,
                ["US batch_michaels_output.pdf", "CAN batch_michaels_output.pdf"],
            )
            with zipfile.ZipFile(zip_path) as archive:
                self.assertEqual(archive.namelist(), output_names)
                first_pdf = fitz.open(stream=archive.read(output_names[0]), filetype="pdf")
                second_pdf = fitz.open(stream=archive.read(output_names[1]), filetype="pdf")
                try:
                    self.assertEqual(first_pdf.page_count, 3)
                    self.assertEqual(second_pdf.page_count, 3)
                    self.assertIn("OUTPUT-PAGE-1", first_pdf[0].get_text())
                    self.assertIn("OUTPUT-PAGE-4", second_pdf[0].get_text())
                finally:
                    first_pdf.close()
                    second_pdf.close()

            preview = fitz.open(preview_path)
            try:
                self.assertEqual(preview.page_count, 7)
                self.assertIn("OUTPUT-PAGE-1", preview[0].get_text())
                self.assertIn('PDF "US original.pdf" END', preview[3].get_text())
                self.assertIn('PDF "CAN original.pdf" START', preview[3].get_text())
                self.assertIn("OUTPUT-PAGE-4", preview[4].get_text())
            finally:
                preview.close()


if __name__ == "__main__":
    unittest.main()
