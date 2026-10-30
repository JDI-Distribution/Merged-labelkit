import asyncio
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from starlette.requests import Request
from labelkit import draft_store, jobs
from labelkit.catalyst import replace_rows
from labelkit.draft_storage import decode_draft_row
from labelkit.directory_store import _dc_directory_file_read
from labelkit.product_store import _product_master_file_read
from labelkit.routes import drafts, generation, reference, system
from labelkit.runtime import reference_revision


class AuditRegressions(unittest.TestCase):
    def test_shared_render_worker_preserves_all_three_document_types_and_reports_failures(self):
        for kit, worker, renderer in (
            ('kehe_pallet_label', jobs.run_kehe_pallet_label_render_job, 'render_kehe_pallet_label_pdf'),
            ('kehe_master_packing_list', jobs.run_kehe_master_packing_list_render_job, 'render_kehe_master_packing_list_pdf'),
            ('kehe_pack_labels', jobs.run_kehe_pack_label_render_job, 'render_kehe_pack_label_pdf'),
        ):
            for produces_file in (True, False):
                with self.subTest(kit=kit, produces_file=produces_file), tempfile.TemporaryDirectory() as directory, \
                     patch.dict(jobs.RESULT_JOBS, {}, clear=True), patch.dict(jobs.RESULT_REPORTS, {}, clear=True):
                    result = jobs.create_result_job(Path(directory), kit)
                    draft = {'reviewed': 'value'}

                    def render(**kwargs):
                        self.assertEqual(kwargs['draft'], draft)
                        kwargs['progress_callback']('Rendering test')
                        if produces_file:
                            Path(kwargs['out_pdf']).write_bytes(b'test')
                        return {'pages': 1}

                    with patch.object(jobs, renderer, side_effect=render):
                        worker(result, draft)
                    job = jobs.RESULT_JOBS[result]
                    self.assertEqual(job['status'], 'complete' if produces_file else 'error')
                    if produces_file:
                        self.assertEqual(job['report'], {'pages': 1})
                        self.assertEqual(Path(job['output_path']).name, jobs.KIT_CONFIG[kit]['output_filename'])
                    else:
                        self.assertEqual(job['detail'], 'Output PDF was not generated.')

    def test_render_thread_start_failure_releases_job_and_temporary_folder(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(jobs.RESULT_JOBS, {}, clear=True), \
             patch.object(generation.tempfile, 'mkdtemp', return_value=directory), \
             patch.object(generation.threading.Thread, 'start', side_effect=RuntimeError('Cannot start worker')):
            with self.assertRaisesRegex(RuntimeError, 'Cannot start worker'):
                generation._start_document_render('kehe_pack_labels', {}, lambda *_: None)
            self.assertEqual(jobs.RESULT_JOBS, {})
            self.assertFalse(Path(directory).exists())

    def test_spa_rejects_parent_and_absolute_paths(self):
        for path in ('../../server.py', str(Path(system.FRONTEND_DIST).parents[1] / 'server.py')):
            with self.subTest(path=path), self.assertRaises(HTTPException) as caught:
                asyncio.run(system.spa_fallback(path, None))
            self.assertEqual(caught.exception.status_code, 404)
        response = asyncio.run(system.spa_fallback('operations/saved', None))
        self.assertEqual(response.status_code, 200)

    def test_same_named_uploads_reach_prepare_as_distinct_files(self):
        files = [UploadFile(io.BytesIO(value), filename='shipment.xml') for value in (b'FIRST', b'SECOND')]
        response = asyncio.run(generation._with_kehe_prepare_xml_files(
            files, temp_prefix='audit_test_', error_message='Test prepare',
            operation=lambda paths: {'contents': [Path(path).read_text() for path in paths]}))
        self.assertEqual(json.loads(response.body)['contents'], ['FIRST', 'SECOND'])

    def test_reference_saves_reject_malformed_and_stale_snapshots(self):
        existing = [{'dc': 'KEEP', 'address': 'Existing address'}]
        with patch.object(reference, '_require_permission'), \
             patch.object(reference, '_datastore_load_dc_directory', return_value=existing), \
             patch.object(reference, '_datastore_save_dc_directory', return_value=[]) as save, \
             patch.object(reference, '_audit_row_changes'):
            for payload, status in (({}, 400), ({'rows': [None]}, 400), ({'rows': []}, 428),
                                    ({'rows': [], 'expected_revision': reference_revision([])}, 409)):
                with self.subTest(payload=payload), self.assertRaises(HTTPException) as caught:
                    asyncio.run(reference.save_mpl_directory(None, payload))
                self.assertEqual(caught.exception.status_code, status)
            save.assert_not_called()
            result = asyncio.run(reference.save_mpl_directory(None, {
                'rows': [], 'expected_revision': reference_revision(existing)}))
            self.assertEqual(json.loads(result.body)['revision'], reference_revision([]))

    def test_generic_mpl_save_cannot_bypass_revision_checks(self):
        with patch.object(drafts, '_require_permission'), \
             patch.object(drafts, '_mpl_drafts_read', return_value=[{'id': 'A', 'revision': 2}]), \
             patch.object(drafts, '_mpl_drafts_write') as save:
            response = asyncio.run(drafts.save_document_draft(None, {
                'document_type': 'MPL', 'id': 'A', 'expected_revision': 1, 'draft': {}}))
            self.assertEqual(response.status_code, 409)
            save.assert_not_called()

    def test_corrupt_local_files_are_preserved_and_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'records.json'
            for content in ('{broken', '{"rows": "broken"}'):
                path.write_text(content)
                for reader in (_product_master_file_read, _dc_directory_file_read):
                    with self.subTest(reader=reader.__name__, content=content), self.assertRaises(HTTPException):
                        reader(path)
                self.assertEqual(path.read_text(), content)
            with patch.object(draft_store, 'MPL_DRAFTS_FILE', path), \
                 patch.object(draft_store, '_datastore_load_mpl_drafts', return_value=None), \
                 self.assertRaises(HTTPException):
                draft_store._mpl_drafts_read()

    def test_corrupt_cloud_draft_is_not_replaced_by_an_empty_object(self):
        for payload in ('{broken', '[]', 'zlib:broken'):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                decode_draft_row({'DRAFT_JSON': payload})

    def test_partial_datastore_batch_is_restored(self):
        class Table:
            def __init__(self):
                self.rows = [{'ROWID': '1', 'id': 'A', 'value': 'old'}]
                self.failed = False
            def get_paged_rows(self, **kwargs):
                return {'content': copy.deepcopy(self.rows)}
            def update_rows(self, rows):
                for row in rows:
                    self.rows = [dict(row) if old['ROWID'] == row['ROWID'] else old for old in self.rows]
            def insert_rows(self, rows):
                for row in rows:
                    self.rows.append({**row, 'ROWID': str(len(self.rows) + 1)})
                if not self.failed:
                    self.failed = True
                    raise RuntimeError('Injected failure after insertion')
            def delete_rows(self, ids):
                self.rows = [row for row in self.rows if row['ROWID'] not in ids]
        table = Table()
        original = copy.deepcopy(table.rows)
        with self.assertRaisesRegex(RuntimeError, 'Injected failure'):
            replace_rows(table, [{'id': 'A', 'value': 'new'}, {'id': 'B', 'value': 'new'}],
                         key=lambda row: row['id'], decode=lambda row: {k: v for k, v in row.items() if k != 'ROWID'}, encode=dict)
        self.assertEqual(table.rows, original)

    def test_damaged_cloud_draft_is_visible_and_preserved_while_other_drafts_save(self):
        damaged = {'ROWID': 'broken-row', 'DRAFT_ID': 'broken', 'NAME': 'Damaged',
                   'DRAFT_JSON': 'zlib:broken', 'IS_ACTIVE': True}
        class Table:
            def __init__(self): self.rows = [copy.deepcopy(damaged)]
            def get_paged_rows(self, *args, **kwargs): return {'content': copy.deepcopy(self.rows)}
            def insert_rows(self, rows): self.rows.extend({**row, 'ROWID': 'new'} for row in rows)
            def update_rows(self, rows): raise AssertionError('Damaged record must not be updated')
            def delete_rows(self, rows): raise AssertionError('Damaged record must not be deleted')
        table = Table()
        with patch.object(draft_store, '_mpl_drafts_datastore_table', return_value=table):
            loaded = draft_store._datastore_load_mpl_drafts(None, 'MPL')
            self.assertEqual(loaded[0]['status'], 'UNREADABLE')
            self.assertIn('storage_error', draft_store._mpl_draft_summary(loaded[0]))
            draft_store._datastore_save_mpl_drafts(None, loaded + [{'id': 'healthy', 'draft': {}}], 'MPL')
        self.assertEqual(table.rows[0], damaged)
        self.assertEqual(decode_draft_row(table.rows[1])['id'], 'healthy')

    def test_oversized_cloud_draft_is_rejected_before_any_write(self):
        import random
        from labelkit.draft_storage import encode_draft_row
        payload = random.Random(42).randbytes(20000).hex()
        with self.assertRaisesRegex(ValueError, 'size limit'):
            encode_draft_row({'id': 'large', 'draft': {'payload': payload}}, 'now')

    def test_stored_snapshot_keeps_every_level_of_order_configs_and_rehydrates_other_choices(self):
        frozen = [{'storefront': 'Buyer', 'config_id': 'used', 'sku': f'used-{level}', 'packaging_level': level}
                  for level in ('Each', 'Inner Pack', 'Case')]
        other = {'storefront': 'Buyer', 'config_id': 'other', 'sku': 'other'}
        original = {'reviewed_product_master': frozen + [other],
                    'packing_lists': [{'items': [{'sku': 'used-Case', 'storefront': 'Buyer'}]}]}
        stored = draft_store._mpl_draft_for_storage(original)
        self.assertEqual(stored['reviewed_product_master'], frozen)
        self.assertEqual(len(original['reviewed_product_master']), 4)
        with patch.object(draft_store, 'apply_product_master_to_mpl_draft'):
            reopened = draft_store._hydrate_saved_mpl_record({'draft': stored}, frozen + [other])['draft']
        self.assertEqual(len(reopened['reviewed_product_master']), 4)
        self.assertEqual(reopened['reviewed_product_master'][:3], frozen)

    def test_active_job_limit_and_download_protection(self):
        with patch.dict(jobs.RESULT_JOBS, {}, clear=True), patch.dict(jobs.RESULT_REPORTS, {}, clear=True), \
             tempfile.TemporaryDirectory() as directory:
            for index in range(jobs.MAX_ACTIVE_JOBS):
                path = Path(directory) / str(index)
                path.mkdir()
                jobs.create_result_job(path, 'test')
            rejected = Path(directory) / 'rejected'
            rejected.mkdir()
            with self.assertRaises(HTTPException) as caught:
                jobs.create_result_job(rejected, 'test')
            self.assertEqual(caught.exception.status_code, 429)
            self.assertFalse(rejected.exists())
            jobs.RESULT_JOBS.clear()
            jobs.RESULT_JOBS['downloading'] = {'status': 'complete', 'downloads': 1}
            for index in range(jobs.MAX_CACHED_REPORTS):
                jobs.RESULT_JOBS[str(index)] = {'status': 'complete'}
            jobs._prune_old_results()
            self.assertIn('downloading', jobs.RESULT_JOBS)
