import asyncio
import copy
import io
import json
import shutil
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import pymupdf
from fastapi import HTTPException, UploadFile
from starlette.requests import Request

from labelkit.jobs import RESULT_JOBS, create_result_job
from labelkit.routes import generation, order_archive


class ApprovedOrderArchiveTests(unittest.TestCase):
    def setUp(self):
        self.request=Request({'type':'http','headers':[]})
        self.created=[]
        with pymupdf.open() as document:
            document.new_page().insert_text((30,30),'Approved manual pallet weight: 777 lbs')
            self.pdf=document.tobytes()
        self.manifest=dict(order_numbers=['0001','0002','0003'],skipped=['0002'],orders=[
            dict(order_number='0001',record_id='A',files=[dict(index=0,name='Packing_List.pdf')]),
            dict(order_number='0003',record_id='B',files=[dict(index=1,name='Packing_List.pdf')])])

    def tearDown(self):
        for result_id in self.created:
            job=RESULT_JOBS.pop(result_id,None)
            if job:shutil.rmtree(job['temp_dir'],ignore_errors=True)

    def test_manifest_preserves_identifiers_order_and_unique_file_assignment(self):
        self.assertEqual(order_archive.validate_manifest(self.manifest,2)['order_numbers'],['0001','0002','0003'])
        for edit in ['duplicate','traversal','missing','reordered','extra-file','bad-skip']:
            value=copy.deepcopy(self.manifest)
            if edit=='duplicate':value['orders'][1]['files'][0]['index']=0
            if edit=='traversal':value['orders'][0]['files'][0]['name']='../other.pdf'
            if edit=='missing':value['orders'][0]['files']=[]
            if edit=='reordered':value['orders'].reverse()
            if edit=='extra-file':value['orders'][1]['files'][0]['index']=2
            if edit=='bad-skip':value['skipped']=['MISSING']
            with self.subTest(edit=edit),self.assertRaises(ValueError):order_archive.validate_manifest(value,2)

    def test_package_copies_exact_approved_bytes_without_rendering_or_replanning(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for index in range(2):(root/f'upload-{index}').write_bytes(self.pdf)
            result_id=create_result_job(root,'approved_orders');self.created.append(result_id)
            with patch('labelkit.document_rules.pallet_plan',side_effect=AssertionError('Must not recalculate')):
                order_archive.package_approved_orders(result_id,self.manifest)
            job=RESULT_JOBS[result_id];self.assertEqual(job['status'],'complete',job)
            with zipfile.ZipFile(job['output_path']) as archive:
                self.assertEqual(archive.read('SO_0001/Packing_List.pdf'),self.pdf)
                self.assertEqual(archive.read('SO_0003/Packing_List.pdf'),self.pdf)
                report=json.loads(archive.read('Processing_Report.json'))
                self.assertEqual([row['order_number'] for row in report['orders']],['0001','0002','0003'])
                self.assertEqual(report['pages'],2)
                self.assertNotIn('SO_0002/Packing_List.pdf',archive.namelist())

    def test_nested_label_zip_is_preserved_and_unsafe_parts_are_rejected(self):
        for name,expected in [('labels_part_001.pdf','complete'),('../escape.pdf','error')]:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);buffer=io.BytesIO()
                with zipfile.ZipFile(buffer,'w') as archive:archive.writestr(name,self.pdf)
                (root/'upload-0').write_bytes(buffer.getvalue())
                manifest=dict(order_numbers=['100'],skipped=[],orders=[dict(order_number='100',files=[dict(index=0,name='Labels.zip')])])
                result_id=create_result_job(root,'approved_orders');self.created.append(result_id)
                order_archive.package_approved_orders(result_id,manifest)
                self.assertEqual(RESULT_JOBS[result_id]['status'],expected)
                if expected=='complete':
                    with zipfile.ZipFile(RESULT_JOBS[result_id]['output_path']) as archive:self.assertEqual(archive.read('SO_100/Labels.zip'),buffer.getvalue())
                else:self.assertFalse(RESULT_JOBS[result_id].get('output_path'))

    def test_api_uses_existing_owned_result_downloads_and_closes_uploads(self):
        uploads=[UploadFile(filename='a.pdf',file=io.BytesIO(self.pdf)),UploadFile(filename='b.pdf',file=io.BytesIO(self.pdf))]
        response=asyncio.run(order_archive.archive_orders(self.request,json.dumps(self.manifest),uploads))
        result_id=response['result_id'];self.created.append(result_id)
        for _ in range(200):
            job=RESULT_JOBS[result_id]
            if job['status']!='processing':break
            time.sleep(.01)
        self.assertEqual(job['status'],'complete',job)
        self.assertTrue(all(upload.file.closed for upload in uploads))
        self.assertTrue(Path(generation.get_result_file(self.request,result_id).path).is_file())
        with patch('labelkit.routes.generation._request_actor',return_value={'user_id':'another-account'}):
            with self.assertRaises(HTTPException):generation.get_result_file(self.request,result_id)

    def test_invalid_manifest_closes_uploads_without_creating_a_job(self):
        upload=UploadFile(filename='a.pdf',file=io.BytesIO(self.pdf))
        with self.assertRaises(HTTPException):asyncio.run(order_archive.archive_orders(self.request,'[]',[upload]))
        self.assertTrue(upload.file.closed)
