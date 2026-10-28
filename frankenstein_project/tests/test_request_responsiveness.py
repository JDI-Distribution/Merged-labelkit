import asyncio
import json
import threading
import unittest
from unittest.mock import patch

from labelkit.routes import reference
from server import app


async def get_response(path):
    incoming = asyncio.Queue()
    incoming.put_nowait({'type': 'http.request', 'body': b'', 'more_body': False})
    messages = []

    async def send(message):
        messages.append(message)
        if message['type'] == 'http.response.body' and not message.get('more_body', False):
            incoming.put_nowait({'type': 'http.disconnect'})

    await app({'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
               'method': 'GET', 'scheme': 'http', 'path': path,
               'raw_path': path.encode(), 'root_path': '', 'query_string': b'',
               'headers': [], 'server': ('testserver', 80), 'client': ('127.0.0.1', 1234)},
              incoming.get, send)
    return next(message['status'] for message in messages if message['type'] == 'http.response.start')


class RequestResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_catalog_read_does_not_block_other_requests(self):
        entered = threading.Event()
        release = threading.Event()

        def slow_catalog(_request):
            entered.set()
            release.wait(1)
            return []

        with patch.object(reference, '_require_permission'), \
             patch.object(reference, '_datastore_load_product_master', side_effect=slow_catalog):
            loading = asyncio.create_task(reference.get_mpl_product_master(None))
            try:
                await asyncio.wait_for(asyncio.to_thread(entered.wait, 1), 2)
                # A different request must be able to run while Catalyst is still waiting.
                self.assertFalse(loading.done(), 'The catalog read blocked the server event loop.')
            finally:
                release.set()
                response = await loading
            self.assertEqual(json.loads(response.body)['rows'], [])

    async def test_home_and_health_stay_available_during_a_slow_catalog_request(self):
        entered = threading.Event()
        release = threading.Event()

        def slow_catalog(_request):
            entered.set()
            release.wait(2)
            return []

        with patch.object(reference, '_require_permission'), \
             patch.object(reference, '_datastore_load_product_master', side_effect=slow_catalog):
            loading = asyncio.create_task(get_response('/api/mpl/product-master'))
            try:
                self.assertTrue(await asyncio.wait_for(asyncio.to_thread(entered.wait, 1), 2))
                statuses = await asyncio.wait_for(asyncio.gather(get_response('/'), get_response('/health')), 1)
                self.assertEqual(statuses, [200, 200])
                self.assertFalse(loading.done(), 'Unrelated pages waited for the slow catalog request.')
            finally:
                release.set()
                self.assertEqual(await loading, 200)

    async def test_concurrent_reference_updates_keep_the_same_revision_check(self):
        existing = [{'dc': 'A', 'address': 'Original'}]

        def save(_request, rows):
            existing[:] = rows
            return list(rows)

        from labelkit.runtime import reference_revision
        from fastapi import HTTPException
        revision = reference_revision(existing)
        with patch.object(reference, '_require_permission'), \
             patch.object(reference, '_datastore_load_dc_directory', side_effect=lambda request: list(existing)), \
             patch.object(reference, '_datastore_save_dc_directory', side_effect=save), \
             patch.object(reference, '_audit_row_changes'):
            results = await asyncio.gather(*[
                reference.save_mpl_directory(None, {'expected_revision': revision, 'rows': [{'dc': 'A', 'address': value}]})
                for value in ('First update', 'Second update')
            ], return_exceptions=True)
        self.assertEqual(sum(not isinstance(result, Exception) for result in results), 1)
        errors = [result for result in results if isinstance(result, HTTPException)]
        self.assertEqual([error.status_code for error in errors], [409])


if __name__ == '__main__':
    unittest.main()
