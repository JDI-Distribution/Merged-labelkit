"""Regression coverage for Michaels formulations sharing a level SKU."""

import csv
import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from contextlib import ExitStack

from fastapi import UploadFile

from labelkit.audit_log import _product_row_key
from labelkit.product_quality import analyze_product_master_rows
from labelkit.product_store import _datastore_save_product_rows, _product_master_file_read, _product_master_file_write, _product_to_datastore_row
from labelkit.reference_data import _dedupe_product_master_rows, _validate_configuration_rows
from labelkit.reference_import import _merge_import_rows, _prepare_product_import_rows, _preview_excel_import
from labelkit.routes.reference import confirm_mpl_product_master_import
from labelkit.spreadsheets import _read_spreadsheet_bytes


def formulations():
    return [
        dict(storefront="Michaels", sku="MIC_816202418306", packaging_level="Each", description=name, gtin=gtin, is_active=True)
        for name, gtin in [
            ("Synthetic White Pearl", "00850068684038"),
            ("Natural White Pearl", "00850079841659"),
        ]
    ]


class MichaelsConfigurationTests(unittest.TestCase):
    def test_idless_same_sku_file_preview_confirm_and_repeat_preserve_configurations(self):
        """Exercise the real import endpoints with isolated file persistence."""
        with tempfile.TemporaryDirectory() as root, ExitStack() as stack:
            path = Path(root) / "products.json"
            _product_master_file_write([{**formulations()[0], "config_id": "EXISTING-SYNTHETIC"}], path)
            for module in ("labelkit.reference_import", "labelkit.routes.reference"):
                stack.enter_context(patch(f"{module}._require_permission"))
                stack.enter_context(patch(f"{module}._datastore_load_product_master", return_value=None))
                stack.enter_context(patch(f"{module}._shared_product_master_file_read", side_effect=lambda: _product_master_file_read(path)))
            stack.enter_context(patch("labelkit.routes.reference._datastore_save_product_master", return_value=None))
            stack.enter_context(patch("labelkit.routes.reference._product_master_file_write", side_effect=lambda rows, *_: _product_master_file_write(rows, path)))
            stack.enter_context(patch("labelkit.routes.reference._audit_row_changes"))

            buffer = io.StringIO(newline="")
            writer = csv.writer(buffer)
            writer.writerow(["Customer", "SKU", "GTIN", "Description", "Packaging Level"])
            for row in formulations():
                writer.writerow([row["storefront"], row["sku"], row["gtin"], row["description"], "Each"])
            data = buffer.getvalue().encode()

            async def import_twice():
                for attempt in range(2):
                    upload = UploadFile(filename="shared-sku.csv", file=io.BytesIO(data))
                    preview = json.loads((await _preview_excel_import(object(), upload, "mpl_product_master")).body)
                    self.assertEqual(2, len(preview["rows"]))
                    self.assertEqual(2, len({row["config_id"] for row in preview["rows"]}))
                    self.assertEqual("EXISTING-SYNTHETIC", preview["rows"][0]["config_id"])
                    self.assertEqual(1 if attempt == 0 else 0, preview["summary"]["added_rows"])
                    saved = json.loads((await confirm_mpl_product_master_import(object(), {"rows": preview["rows"]})).body)
                    self.assertEqual(2, len(saved["rows"]))
                    self.assertEqual({row["gtin"] for row in formulations()}, {row["gtin"] for row in saved["rows"]})
                loaded = _product_master_file_read(path)
                self.assertEqual(2, len(loaded))
                self.assertEqual(1, len({(row["storefront"], row["sku"]) for row in loaded}))

            asyncio.run(import_twice())

    def test_legacy_each_records_get_distinct_stable_configuration_ids(self):
        rows = _dedupe_product_master_rows(formulations())
        self.assertEqual(2, len(rows))
        self.assertEqual(2, len({row["config_id"] for row in rows}))
        self.assertEqual(rows, _dedupe_product_master_rows(rows))
        self.assertEqual(rows, _dedupe_product_master_rows(formulations()))

    def test_equivalent_gtin_padding_uses_the_same_legacy_identity(self):
        row = formulations()[0]
        alternate = {**row, "gtin": "850068684038"}
        self.assertEqual(1, len(_dedupe_product_master_rows([row, alternate])))

    def test_file_and_datastore_roundtrip_preserve_both_and_independent_edits(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "products.json"
            rows = _product_master_file_write(formulations(), path)
            rows[0]["description"] = "Edited synthetic"
            rows[0]["is_active"] = False
            _product_master_file_write(rows, path)
            loaded = _product_master_file_read(path)
            self.assertEqual("Natural White Pearl", loaded[1]["description"])
            self.assertTrue(loaded[1]["is_active"])
            self.assertFalse(loaded[0]["is_active"])
            catalyst = [_product_to_datastore_row(row, include_storefront=True) for row in loaded]
            self.assertEqual(loaded, _dedupe_product_master_rows(catalyst))

    def test_csv_roundtrip_and_repeat_import_do_not_add_records(self):
        rows = _dedupe_product_master_rows(formulations())
        rows.append({**rows[0], "packaging_level": "Case", "sku": "MIC-CASE", "gtin": "10850068684035", "case_qty": "12"})
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow(["Customer", "Configuration ID", "Level SKU", "Packaging Level", "GTIN", "Description", "Eaches Contained"])
        for row in rows:
            writer.writerow([row["storefront"], row["config_id"], row["sku"], row["packaging_level"], row["gtin"], row["description"], row.get("case_qty", "1")])
        raw = _read_spreadsheet_bytes("products.csv", buffer.getvalue().encode())
        imported = _prepare_product_import_rows(raw, rows)
        for _ in range(2):
            rows = _dedupe_product_master_rows(_merge_import_rows(rows, imported, _product_row_key))
        self.assertEqual(3, len(rows))
        self.assertEqual(2, len({row["config_id"] for row in rows}))
        self.assertIn("00850079841659", {row["gtin"] for row in rows})

    def test_idless_import_reuses_custom_id_by_sku_gtin_and_level(self):
        current = _dedupe_product_master_rows([{**formulations()[0], "config_id": "CUSTOM-ID"}])
        incoming = [{**formulations()[0], "gtin": "850068684038", "description": "Updated"}, formulations()[1]]
        imported = _prepare_product_import_rows(incoming, current)
        self.assertEqual("CUSTOM-ID", imported[0]["config_id"])
        self.assertNotEqual("CUSTOM-ID", imported[1]["config_id"])
        self.assertEqual(2, len(_merge_import_rows(current, imported, _product_row_key)))

    def test_shared_case_and_inner_skus_preserve_configurations_for_any_customer(self):
        for level in ("Each", "Inner Pack", "Case"):
            incoming = [{**row, "storefront": "KeHE", "packaging_level": level} for row in formulations()]
            imported = _prepare_product_import_rows(incoming, [])
            saved = _dedupe_product_master_rows(imported)
            self.assertEqual(2, len(saved))
            self.assertEqual(2, len({row["config_id"] for row in saved}))
            again = _prepare_product_import_rows(incoming, saved)
            self.assertEqual(2, len(_merge_import_rows(saved, again, _product_row_key)))

    def test_conflicting_configuration_level_is_rejected_before_file_write(self):
        rows = [{**row, "config_id": "SAME-ID"} for row in formulations()]
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "products.json"
            with self.assertRaisesRegex(ValueError, "conflicting Each rows"):
                _product_master_file_write(rows, path)
            self.assertFalse(path.exists())
        quality = analyze_product_master_rows(rows)
        self.assertTrue(all(any(issue["code"] == "configuration_level_conflict" for issue in row["issues"]) for row in quality["rows"]))

    def test_identical_rows_can_be_deduplicated_and_shared_sku_is_not_an_error(self):
        rows = _dedupe_product_master_rows(formulations())
        _validate_configuration_rows(rows + [rows[0]])
        quality = analyze_product_master_rows(rows)
        self.assertFalse(any(issue["severity"] == "duplicate" for row in quality["rows"] for issue in row["issues"]))

    def test_non_michaels_shared_sku_preserves_both_gtins(self):
        rows = [{**row, "storefront": "KeHE"} for row in formulations()]
        result = _dedupe_product_master_rows(rows)
        self.assertEqual(2, len(result))
        self.assertEqual(2, len({row["config_id"] for row in result}))

    def test_unique_legacy_sku_keeps_its_existing_packaging_hierarchy(self):
        rows = [
            {**formulations()[0], "storefront": "KeHE", "packaging_level": "Each"},
            {**formulations()[0], "storefront": "KeHE", "packaging_level": "Case", "gtin": "10850068684035"},
        ]
        saved = _dedupe_product_master_rows(rows)
        self.assertEqual(2, len(saved))
        self.assertTrue(all(not row["config_id"] for row in saved))

    def test_xlsx_text_gtins_and_configuration_ids_survive_import(self):
        from openpyxl import Workbook
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["Customer", "Configuration ID", "Level SKU", "Packaging Level", "GTIN", "Description"])
        for index, row in enumerate(formulations()):
            sheet.append([row["storefront"], f"CONFIG-{index}", row["sku"], "Each", row["gtin"], row["description"]])
            sheet.cell(row=index + 2, column=5).number_format = "@"
        data = io.BytesIO()
        workbook.save(data)
        workbook.close()
        imported = _prepare_product_import_rows(_read_spreadsheet_bytes("products.xlsx", data.getvalue()), [])
        self.assertEqual([row["gtin"] for row in formulations()], [row["gtin"] for row in imported])
        self.assertEqual(["CONFIG-0", "CONFIG-1"], [row["config_id"] for row in imported])

    def test_datastore_updates_existing_formulation_and_inserts_sibling(self):
        from test_product_master_migration import _FakeTable
        wanted = _dedupe_product_master_rows(formulations())
        existing = {**_product_to_datastore_row(wanted[0], include_storefront=True), "ROWID": "101"}
        table = _FakeTable([existing])
        with patch("labelkit.product_store._product_datastore_table", return_value=table):
            saved = _datastore_save_product_rows(object(), wanted, "mpl_product_master", "datastore", include_storefront=True)
        self.assertEqual(2, len(saved))
        self.assertEqual(1, len(table.updated))
        self.assertEqual("101", table.updated[0]["ROWID"])
        self.assertEqual(1, len(table.inserted))
        self.assertNotEqual(table.updated[0]["UNIQUE_KEY"], table.inserted[0]["UNIQUE_KEY"])
        self.assertFalse(table.deleted)


if __name__ == "__main__":
    unittest.main()
