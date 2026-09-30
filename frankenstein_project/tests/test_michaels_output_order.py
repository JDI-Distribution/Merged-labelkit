import unittest
import zipfile
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import pymupdf as fitz

from pipelines.michaels import pipeline
from labelkit.file_operations import MAX_MICHAELS_OUTPUT_PAGES, split_michaels_output_by_page_limit
from server import RESULT_JOBS, run_michaels_generation_job, split_michaels_output_by_shipping_pdf


def _one_page_pdf(text: str) -> bytes:
    document = fitz.open()
    page = document.new_page(width=288, height=432)
    page.insert_text((24, 48), text)
    payload = document.tobytes()
    document.close()
    return payload


class MichaelsOutputOrderTests(unittest.TestCase):
    def test_shipping_pdf_over_500_pages_is_not_rejected_before_batched_rasterization(self):
        class OversizedDocument:
            page_count = 501

        def batch_images(_pdf_path, **kwargs):
            count = kwargs["last_page"] - kwargs["first_page"] + 1
            return [mock.Mock() for _ in range(count)]

        with mock.patch.object(
            pipeline,
            "convert_from_path",
            side_effect=batch_images,
        ) as convert:
            with mock.patch.object(pipeline, "_ocr_image", return_value=""), mock.patch.object(
                pipeline,
                "_extract_page_identifiers",
                return_value=("1ZAAAAAAAAAAAAAAAA", "", ""),
            ), mock.patch.object(
                pipeline,
                "_shipping_page_to_bytes",
                side_effect=RuntimeError("reached output assembly"),
            ):
                with self.assertRaisesRegex(RuntimeError, "reached output assembly"):
                    pipeline._render_shipping_label_first(
                        fitz_doc=OversizedDocument(),
                        shipping_pdf_path="large.pdf",
                        all_packs=[],
                        by_tracking={},
                        by_po={},
                        by_store={},
                        by_po_store={},
                        out_pdf="out.pdf",
                        ocr_dpi=200,
                    )

        self.assertEqual(32, convert.call_count)

    def test_oversized_michaels_output_splits_into_numbered_pdf_parts(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            output_path = temp_path / "combined.pdf"
            source = fitz.open()
            for _ in range(1001):
                source.new_page(width=288, height=432)
            source.save(output_path)
            source.close()
            report = {"rows": [{"output_start_page": 1, "output_end_page": 1001}]}

            archive_path, output_names = split_michaels_output_by_page_limit(
                output_path,
                report,
                temp_path,
                base_filename="michaels_output",
            )

            self.assertEqual(["michaels_output_part_001.pdf", "michaels_output_part_002.pdf"], output_names)
            with zipfile.ZipFile(archive_path) as archive:
                self.assertEqual(output_names, archive.namelist())
                first = fitz.open(stream=archive.read(output_names[0]), filetype="pdf")
                second = fitz.open(stream=archive.read(output_names[1]), filetype="pdf")
                try:
                    self.assertEqual(1000, first.page_count)
                    self.assertEqual(1, second.page_count)
                finally:
                    first.close()
                    second.close()

    def test_michaels_worker_sets_zip_and_page_limit_report_for_large_single_upload(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            result_id = "michaels-large-output-test"
            output_path = temp_path / "michaels_dts_output.pdf"
            RESULT_JOBS[result_id] = {"temp_dir": str(temp_path), "status": "processing"}

            def render_large_output(*, out_pdf, **_kwargs):
                output_doc = fitz.open()
                try:
                    for _ in range(MAX_MICHAELS_OUTPUT_PAGES + 1):
                        output_doc.new_page(width=288, height=432)
                    output_doc.save(out_pdf)
                finally:
                    output_doc.close()
                return {
                    "summary": {},
                    "rows": [{"output_start_page": 1, "output_end_page": MAX_MICHAELS_OUTPUT_PAGES + 1}],
                }

            try:
                with mock.patch("server.run_michaels_pipeline", side_effect=render_large_output):
                    run_michaels_generation_job(result_id, ["order.xml"], ["shipping.pdf"])

                job = RESULT_JOBS[result_id]
                self.assertEqual("complete", job["status"], job.get("detail"))
                self.assertEqual("application/zip", job["media_type"])
                self.assertEqual(2, len(job["separate_output_names"]))
                self.assertTrue(job["report"]["summary"]["page_limited_split"])
                self.assertEqual(MAX_MICHAELS_OUTPUT_PAGES + 1, job["report"]["summary"]["output_pages"])
                self.assertTrue(Path(job["preview_path"]).exists())
            finally:
                RESULT_JOBS.pop(result_id, None)

    def test_packing_list_rejects_row_too_tall_to_fit_instead_of_paging_forever(self):
        pack = pipeline.Pack(
            sscc="000000000000000001",
            po="40000001",
            items=[pipeline.Item(vendor_item="VENDOR", michaels_sku="SKU", description="TOO LONG " * 2000, qty=1)],
        )

        with self.assertRaisesRegex(ValueError, "too tall to fit on a page"):
            pipeline.render_packing_list_pages(pack, 1, 1)

    def test_long_generated_label_and_packing_list_text_is_preserved(self):
        description = "LONGMICHAELSDESCRIPTION" * 7
        vendor_item = "VENDORITEM" * 8
        michaels_sku = "1234567890" * 4
        pack = pipeline.Pack(
            sscc="000000000000000001",
            tracking="1ZAAAAAAAAAAAAAAAA",
            po="40000001" * 4,
            store="123456789012345",
            ship_from=pipeline.Address(name="LONG SHIP FROM CUSTOMER NAME" * 3, line1="123 VERY LONG ORIGIN STREET NAME" * 2),
            ship_to=pipeline.Address(name="LONG SHIP TO CUSTOMER NAME" * 3, line1="456 VERY LONG DESTINATION STREET NAME" * 2),
            items=[pipeline.Item(vendor_item=vendor_item, michaels_sku=michaels_sku, description=description, qty=12)],
        )

        packing_pdf = pipeline.render_packing_list_pages(pack, 1, 1)
        packing_document = fitz.open(stream=packing_pdf, filetype="pdf")
        table_words = [
            word
            for page in packing_document
            for word in page.get_text("words")
            if word[1] > 130
        ]

        def column_text(x_min, x_max):
            words = [word for word in table_words if x_min <= word[0] < x_max]
            return "".join(word[4] for word in sorted(words, key=lambda word: (word[1], word[0])))

        # Read each table column independently. A plain PDF text extraction can
        # interleave adjacent columns even though all of their text is present.
        self.assertEqual(description, column_text(95, 184))
        self.assertEqual(vendor_item, column_text(0, 60))
        self.assertEqual(michaels_sku, column_text(60, 95))

        label_pdf = pipeline.render_gs1_label_page(pack, 1, 1)
        label_text = "".join(
            page.get_text() for page in fitz.open(stream=label_pdf, filetype="pdf")
        ).replace(" ", "").replace("\n", "")
        self.assertIn(pack.po, label_text)
        self.assertIn(pack.store, label_text)

    def test_michaels_addresses_keep_default_lines_without_pipe_separators(self):
        pack = pipeline.Pack(
            sscc="000000000000000001",
            po="63484",
            store="100",
            ship_from=pipeline.Address(
                name="BAKELL LLC",
                line1="1967 ESSEX CT",
                city="REDLANDS",
                state="CA",
                zip="92373",
            ),
            ship_to=pipeline.Address(
                name="Receiving Location",
                line1="100 MAIN STREET",
                city="ANYTOWN",
                state="CA",
                zip="90000",
            ),
        )

        outputs = [
            pipeline.render_gs1_label_page(pack, 1, 1),
            pipeline.render_packing_list_pages(pack, 1, 1),
        ]
        for output in outputs:
            with fitz.open(stream=output, filetype="pdf") as document:
                text = "\n".join(page.get_text() for page in document)
            self.assertNotIn(" | ", text)
            address_lines = [line.strip() for line in text.splitlines()]
            self.assertIn("BAKELL LLC", address_lines)
            self.assertIn("1967 ESSEX CT", address_lines)
            self.assertIn("REDLANDS", text)
            self.assertIn("92373", text)

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
